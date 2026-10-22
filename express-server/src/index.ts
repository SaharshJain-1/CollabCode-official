import express from "express";
import { createClient } from "redis";
import cors from "cors";
import Groq from "groq-sdk";

const app = express();
app.use(express.json());
app.use(cors());

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const port = Number(process.env.PORT || 3000);
const redisClient = createClient({ url: redisUrl });

redisClient.on("error", (err) => console.log("Redis Client Error", err));

const groqApiKey = process.env.GROQ_API_KEY;
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
const AUTOCOMPLETE_MODEL = "llama-3.1-8b-instant";

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "express-server" });
});

app.post("/submit", async (req, res) => {
  const { code, language, roomId, input } = req.body;
  const submissionId = `submission-${Date.now()}-${roomId}`;

  console.log(`Received submission from room ${roomId}`);

  try {
    await redisClient.lPush(
      "problems",
      JSON.stringify({ code, language, roomId, id: submissionId, input })
    );
    console.log(`Submission pushed to Redis for: ${roomId}  and problem id: ${submissionId}`);
    res.status(200).send("Submission received and stored");
  } catch (error) {
    console.log(error);
    res.status(500).send("Failed to store submission");
  }
});

app.post("/ai/chat", async (req, res) => {
  const { messages, language } = req.body;

  if (!groq) {
    return res.status(503).json({ reply: "AI service is not configured. Set GROQ_API_KEY." });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a helpful coding assistant. The user is working in ${language || "a programming language"}. Answer concisely. If you provide code, wrap it in markdown code blocks with the correct language tag.`,
        },
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 2048,
    });

    const reply = completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    res.json({ reply });
  } catch (error: any) {
    console.error("AI Chat error:", error.message);
    res.status(500).json({ reply: "AI service error. Please try again." });
  }
});

app.post("/ai/autocomplete", async (req, res) => {
  const { codeBeforeCursor, codeAfterCursor, language } = req.body;

  if (!groq) {
    return res.json({ suggestion: "" });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: AUTOCOMPLETE_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a code completion engine for ${language || "code"}. You will receive code with a <FILL_HERE> marker. Output ONLY the text that replaces <FILL_HERE>. Rules:
- Do NOT repeat any code that appears before or after <FILL_HERE>
- Do NOT wrap in markdown, backticks, or code fences
- Do NOT add explanations
- Keep completions short (1-3 lines)
- Match existing style and indentation
- If no good completion, output only: NONE`,
        },
        {
          role: "user",
          content: `${codeBeforeCursor}<FILL_HERE>${codeAfterCursor}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 128,
      stop: ["\n\n\n", "```"],
    });

    let suggestion = completion.choices[0]?.message?.content || "";
    suggestion = suggestion.replace(/```[\s\S]*/g, "").trim();
    suggestion = suggestion.replace(/<FILL_HERE>/g, "").trim();

    if (codeBeforeCursor && suggestion.length > 0) {
      const lastLine = codeBeforeCursor.split("\n").pop() || "";
      if (lastLine.trim().length > 2 && suggestion.startsWith(lastLine.trim())) {
        suggestion = suggestion.slice(lastLine.trim().length);
      }
      if (suggestion.startsWith(codeBeforeCursor.trim())) {
        suggestion = suggestion.slice(codeBeforeCursor.trim().length);
      }
    }

    if (codeAfterCursor && codeAfterCursor.trim().length > 0 && suggestion.endsWith(codeAfterCursor.trim())) {
      suggestion = suggestion.slice(0, -codeAfterCursor.trim().length);
    }

    suggestion = suggestion.trim();

    if (suggestion === "NONE" || suggestion.length === 0) {
      return res.json({ suggestion: "" });
    }

    res.json({ suggestion });
  } catch (error: any) {
    console.error("AI Autocomplete error:", error.message);
    res.json({ suggestion: "" });
  }
});

async function startServer() {
  app.listen(port, () => {
    console.log(`Express Server Listening on port ${port}`);
  });
}

redisClient.connect().then(() => {
  console.log("Redis Client Connected");
  startServer();
}).catch(err => {
  console.error("Failed to connect to Redis", err);
  process.exit(1);
});
