import { createClient } from "redis";
import * as k8s from "@kubernetes/client-node";
import { randomUUID } from "node:crypto";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const EXECUTION_NAMESPACE = process.env.EXECUTION_NAMESPACE || "collabcode";
const EXECUTION_TIMEOUT_SECONDS = Number(process.env.EXECUTION_TIMEOUT_SECONDS || 30);
const POD_ACTIVE_DEADLINE_SECONDS = Number(
  process.env.POD_ACTIVE_DEADLINE_SECONDS || (EXECUTION_TIMEOUT_SECONDS + 60)
);

const subscriber = createClient({ url: REDIS_URL });
const publisher = createClient({ url: REDIS_URL });

const kubeConfig = new k8s.KubeConfig();
try {
  kubeConfig.loadFromCluster();
  console.log("Loaded kubeconfig from cluster");
} catch (e) {
  kubeConfig.loadFromDefault();
  console.log("Loaded kubeconfig from default");
}
const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);

type Submission = {
  roomId: any;
  id: string;
  language: "python" | "cpp" | "javascript" | "java" | "rust" | "go";
  code: string;
  input?: string;
};

type ExecutionResult = {
  status: "accepted" | "runtime_error" | "compile_error" | "timeout" | "internal_error";
  output: string;
};

function getRuntime(language: Submission["language"]) {
  if (language === "python") {
    return {
      image: "python:3.9-slim",
      command: [
        "sh", "-lc",
        [
          "set -e",
          "mkdir -p /workspace",
          'echo "$CODE_B64" | base64 -d > /workspace/Main.py',
          'echo "$INPUT_B64" | base64 -d > /workspace/input.txt',
          `timeout ${EXECUTION_TIMEOUT_SECONDS}s python -u /workspace/Main.py < /workspace/input.txt`,
        ].join(" && "),
      ],
    };
  }

  if (language === "cpp") {
    return {
      image: "gcc:11",
      command: [
        "sh", "-lc",
        [
          "set -e",
          "mkdir -p /workspace",
          'echo "$CODE_B64" | base64 -d > /workspace/Main.cpp',
          'echo "$INPUT_B64" | base64 -d > /workspace/input.txt',
          "g++ /workspace/Main.cpp -O2 -std=c++17 -o /workspace/a.out",
          `timeout ${EXECUTION_TIMEOUT_SECONDS}s /workspace/a.out < /workspace/input.txt`,
        ].join(" && "),
      ],
    };
  }

  if (language === "java") {
    return {
      image: "eclipse-temurin:21-jdk-jammy",
      command: [
        "sh", "-lc",
        [
          "set -e",
          "mkdir -p /workspace",
          'echo "$CODE_B64" | base64 -d > /workspace/Main.java',
          'echo "$INPUT_B64" | base64 -d > /workspace/input.txt',
          "javac /workspace/Main.java -d /workspace",
          `timeout ${EXECUTION_TIMEOUT_SECONDS}s java -cp /workspace Main < /workspace/input.txt`,
        ].join(" && "),
      ],
    };
  }

  if (language === "rust") {
    return {
      image: "rust:1-bookworm",
      command: [
        "sh", "-lc",
        [
          "export PATH=$PATH:/usr/local/cargo/bin:/root/.cargo/bin",
          "set -e",
          "mkdir -p /workspace",
          'echo "$CODE_B64" | base64 -d > /workspace/Main.rs',
          'echo "$INPUT_B64" | base64 -d > /workspace/input.txt',
          "/usr/local/cargo/bin/rustc /workspace/Main.rs -o /workspace/a.out",
          `timeout ${EXECUTION_TIMEOUT_SECONDS}s /workspace/a.out < /workspace/input.txt`,
        ].join(" && "),
      ],
    };
  }

  if (language === "go") {
    return {
      image: "golang:1.22-bookworm",
      command: [
        "sh", "-lc",
        [
          "export PATH=$PATH:/usr/local/go/bin",
          "set -e",
          "mkdir -p /workspace",
          'echo "$CODE_B64" | base64 -d > /workspace/Main.go',
          'echo "$INPUT_B64" | base64 -d > /workspace/input.txt',

          "GOCACHE=/tmp/go-cache /usr/local/go/bin/go build -o /workspace/a.out /workspace/Main.go 2>&1",
          `timeout ${EXECUTION_TIMEOUT_SECONDS}s /workspace/a.out < /workspace/input.txt 2>&1`,
        ].join(" && "),
      ],
    };
  }

  const jsWrapper = `
const fs = require('fs');
const input = fs.readFileSync('/workspace/input.txt', 'utf8');
const lines = input.split(/\\r?\\n/);
let idx = 0;
global.prompt = (msg) => {
  if (msg !== undefined) process.stdout.write(String(msg));
  return (lines[idx++] ?? '').trimEnd();
};
global.readline = {
  createInterface: () => ({
    question: (q, cb) => cb(global.prompt(q)),
    close: () => {},
    on: () => {},
  }),
};
const vm = require('vm');
const userCode = fs.readFileSync('/workspace/usercode.js', 'utf8');
const script = new vm.Script(userCode, { filename: 'usercode.js' });
script.runInThisContext();
`.trim();
  const jsWrapperB64 = Buffer.from(jsWrapper, 'utf8').toString('base64');

  return {
    image: "node:20-slim",
    jsWrapperB64: jsWrapperB64,
    command: [
      "sh", "-lc",
      [
        "set -e",
        "mkdir -p /workspace",
        'echo "$INPUT_B64" | base64 -d > /workspace/input.txt',
        'echo "$CODE_B64" | base64 -d > /workspace/usercode.js',
        'echo "$WRAPPER_B64" | base64 -d > /workspace/wrapper.js',
        `timeout ${EXECUTION_TIMEOUT_SECONDS}s node /workspace/wrapper.js 2>&1`,
      ].join(" && "),
    ],
  };
}

async function waitForPodCompletion(
  name: string,
  timeoutMs: number
): Promise<"Succeeded" | "Failed" | "Timeout"> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const pod = await coreApi.readNamespacedPodStatus({ name, namespace: EXECUTION_NAMESPACE });
      const phase = pod.status?.phase;
      console.log(`Pod ${name} phase: ${phase}`);

      if (phase === "Succeeded") return "Succeeded";
      if (phase === "Failed") return "Failed";

    } catch (err: any) {

      console.log(`Pod ${name} status check error (will retry): ${err?.message}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return "Timeout";
}

async function runSubmissionInPod(submission: Submission): Promise<ExecutionResult> {
  const podName = `exec-${submission.language}-${randomUUID().slice(0, 8)}`;
  const runtime = getRuntime(submission.language);
  let created = false;

  console.log(`Creating pod ${podName} for room ${submission.roomId} (language: ${submission.language})`);

  try {
    const podManifest: k8s.V1Pod = {
      metadata: {
        name: podName,
        namespace: EXECUTION_NAMESPACE,
        labels: { app: "worker-exec" },
      },
      spec: {
        restartPolicy: "Never",
        activeDeadlineSeconds: POD_ACTIVE_DEADLINE_SECONDS,

        automountServiceAccountToken: false,
        containers: [
          {
            name: "runner",
            image: runtime.image,

            imagePullPolicy: "IfNotPresent",
            command: runtime.command,
            env: [
              {
                name: "CODE_B64",
                value: Buffer.from(submission.code || "", "utf8").toString("base64"),
              },
{
  name: "INPUT_B64",

  value: Buffer.from(
    (submission.input || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trimEnd() + "\n",
    "utf8"
  ).toString("base64"),
},
              ...(("jsWrapperB64" in runtime) ? [{ name: "WRAPPER_B64", value: (runtime as any).jsWrapperB64 }] : []),
            ],
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "500m", memory: "256Mi" },
            },
          },
        ],
      },
    };

    await coreApi.createNamespacedPod({ namespace: EXECUTION_NAMESPACE, body: podManifest });
    created = true;
    console.log(`Pod ${podName} created, waiting for completion...`);

    await new Promise((r) => setTimeout(r, 2000));

    const completion = await waitForPodCompletion(
      podName,
      (POD_ACTIVE_DEADLINE_SECONDS + 20) * 1000
    );

    console.log(`Pod ${podName} completed with status: ${completion}`);

  let logs = "";
  let terminatedExitCode: number | undefined;
  let terminatedReason: string | undefined;
    try {
      const logResp = await coreApi.readNamespacedPodLog({
        name: podName,
        namespace: EXECUTION_NAMESPACE,
        container: "runner",
      });
      logs = typeof logResp === "string" ? logResp : String(logResp ?? "");
      console.log(`Pod ${podName} logs (${logs.length} chars): ${logs.slice(0, 200)}`);
    } catch (logErr: any) {
      console.log(`Could not fetch logs for ${podName}: ${logErr?.message}`);
      logs = "";
    }

    try {
      const statusResp = await coreApi.readNamespacedPodStatus({
        name: podName,
        namespace: EXECUTION_NAMESPACE,
      });
      const runnerStatus = statusResp.status?.containerStatuses?.find(
        (container) => container.name === "runner"
      );
      terminatedExitCode = runnerStatus?.state?.terminated?.exitCode;
      terminatedReason = runnerStatus?.state?.terminated?.reason;
      console.log(
        `Pod ${podName} terminated reason=${terminatedReason ?? "unknown"}, exitCode=${terminatedExitCode ?? "unknown"}`
      );
    } catch (statusErr: any) {
      console.log(`Could not fetch terminated status for ${podName}: ${statusErr?.message}`);
    }

    if (completion === "Timeout") return { status: "timeout", output: "Execution timed out." };
    if (completion === "Failed") {
      if (terminatedExitCode === 124 || terminatedReason === "DeadlineExceeded") {
        return { status: "timeout", output: "Execution timed out." };
      }
      return {
        status: "runtime_error",
        output: logs || (terminatedExitCode !== undefined
          ? `Execution failed (exit code ${terminatedExitCode}).`
          : "Execution failed."),
      };
    }
    return { status: "accepted", output: logs };
  } catch (err: any) {
    console.error(`Pod execution error for ${podName}:`, err?.message || err);
    return {
      status: "internal_error",
      output: err instanceof Error ? err.message : "Unknown execution error",
    };
  } finally {
    if (created) {
      console.log(`Cleaning up pod ${podName}`);
      await coreApi
        .deleteNamespacedPod({
          name: podName,
          namespace: EXECUTION_NAMESPACE,
          gracePeriodSeconds: 0,
          propagationPolicy: "Background",
        })
        .catch((e) => console.log(`Pod cleanup error (ok): ${e?.message}`));
    }
  }
}

async function processSubmission(raw: string) {
  try {
    const submission = JSON.parse(raw) as Submission;
    console.log(`Processing submission ${submission.id} for room ${submission.roomId}`);
    const result = await runSubmissionInPod(submission);
    console.log(`Submission ${submission.id} result: ${result.status}`);

    await publisher.publish(
      `results:${submission.roomId}`,
      JSON.stringify({
        type: "codeResult",
        payload: {
          id: submission.id,
          output: result.output,
          error: result.status !== "accepted" ? result.output : undefined
        },
      })
    );
  } catch (err) {
    console.error("processSubmission error:", err);
  }
}

async function main() {
  console.log("Worker starting...");
  console.log(`REDIS_URL: ${REDIS_URL}`);
  console.log(`EXECUTION_NAMESPACE: ${EXECUTION_NAMESPACE}`);
  console.log(`EXECUTION_TIMEOUT_SECONDS: ${EXECUTION_TIMEOUT_SECONDS}`);
  console.log(`POD_ACTIVE_DEADLINE_SECONDS: ${POD_ACTIVE_DEADLINE_SECONDS}`);

  await subscriber.connect();
  console.log("Redis subscriber connected");

  await publisher.connect();
  console.log("Redis publisher connected");

  console.log("Worker ready, waiting for submissions...");

  while (true) {
    try {
      const item = await subscriber.brPop("problems", 0);
      if (!item?.element) continue;
      console.log("Job received from Redis queue");
      await processSubmission(item.element);
    } catch (err) {
      console.error("worker loop error:", err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main().catch(async (err) => {
  console.error("Worker fatal error:", err);
  await subscriber.quit().catch(() => undefined);
  await publisher.quit().catch(() => undefined);
  process.exit(1);
});
