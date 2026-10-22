import http from "http";
import { WebSocketServer } from "ws";
import { createClient } from "redis";

const port = Number(process.env.PORT || 5000);
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "websocket-server" }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

const redisSub = createClient({ url: redisUrl });
const redisPub = createClient({ url: redisUrl });

const rooms: Record<
  string,
  { users: { userId: string; name: string; ws: any }[]; subscribedResults: boolean; subscribedRoom: boolean }
> = {};

function generateRoomId(): string {
  let id: string;
  do { id = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[id]);
  return id;
}

function broadcastLocal(roomId: string, data: any, exceptUserId?: string | null) {
  rooms[roomId]?.users.forEach((u) => {
    if (u.userId !== exceptUserId) {
      try { u.ws.send(JSON.stringify(data)); } catch (_) {}
    }
  });
}

function sendToLocalUser(roomId: string, targetUserId: string, data: any): boolean {
  const u = rooms[roomId]?.users.find((u) => u.userId === targetUserId);
  if (!u) return false;
  try { u.ws.send(JSON.stringify(data)); } catch (_) {}
  return true;
}

async function publishToRoom(
  roomId: string,
  data: any,
  excludeUserId?: string | null,
  targetUserId?: string | null
) {
  const envelope = {
    ...data,
    _excludeUserId: excludeUserId ?? null,
    _targetUserId: targetUserId ?? null,
  };
  await redisPub.publish(`room:${roomId}`, JSON.stringify(envelope)).catch(console.error);
}

function ensureRoomChannelSubscribed(roomId: string) {
  if (!rooms[roomId] || rooms[roomId].subscribedRoom) return;
  rooms[roomId].subscribedRoom = true;

  redisSub.subscribe(`room:${roomId}`, async (raw) => {
    if (!rooms[roomId]) return;

    let envelope: any;
    try { envelope = JSON.parse(raw); } catch (_) { return; }

    const { _excludeUserId, _targetUserId, ...data } = envelope;

    if (_targetUserId) {
      sendToLocalUser(roomId, _targetUserId, data);
      return;
    }

    if (data.type === "userJoined" || data.type === "userLeft") {
      try {
        const map = await redisPub.hGetAll(`users:${roomId}`);
        const users = Object.entries(map).map(([id, name]) => ({ id, name }));
        broadcastLocal(roomId, { type: "users", users });
      } catch (_) {}
      return;
    }

    if (data.type === "requestForAllData") {
      const answerer = rooms[roomId].users.find((u) => u.userId !== _excludeUserId);
      if (answerer) {
        try {
          answerer.ws.send(JSON.stringify({
            type: "requestForAllData",
            userId: data.userId,
          }));
        } catch (_) {}
      }
      return;
    }

    broadcastLocal(roomId, data, _excludeUserId);
  });
}

function ensureResultsChannelSubscribed(roomId: string) {
  if (!rooms[roomId] || rooms[roomId].subscribedResults) return;
  rooms[roomId].subscribedResults = true;

  redisSub.subscribe(`results:${roomId}`, (raw) => {
    if (!rooms[roomId]) return;
    try {
      const msg = JSON.parse(raw);
      const output = msg?.payload?.output ?? msg?.payload?.error ?? "";
      broadcastLocal(roomId, { type: "output", message: output });
    } catch (_) {}
  });
}

async function start() {
  await redisSub.connect();
  await redisPub.connect();
  console.log("Redis connected (pub + sub clients)");

  wss.on("connection", (ws, req) => {
    const params = new URLSearchParams(req.url?.split("?")[1]);
    let roomId = params.get("roomId");
    const userId = params.get("id")!;
    const name = params.get("name")!;

    const isNewRoom = !roomId;
    if (!roomId) roomId = generateRoomId();

    if (!rooms[roomId]) {
      rooms[roomId] = { users: [], subscribedResults: false, subscribedRoom: false };
    }

    ensureRoomChannelSubscribed(roomId);
    ensureResultsChannelSubscribed(roomId);

    ws.send(JSON.stringify({ type: "roomId", roomId, isNewRoom }));

    rooms[roomId].users.push({ userId, name, ws });

    (async () => {
      await redisPub.hSet(`users:${roomId}`, userId, name).catch(console.error);
      await publishToRoom(roomId!, { type: "userJoined", userId, name });
    })();

    ws.on("message", async (raw) => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch (_) { return; }

      switch (data.type) {

        case "requestToGetUsers": {
          try {
            const map = await redisPub.hGetAll(`users:${roomId!}`);
            const users = Object.entries(map).map(([id, uname]) => ({ id, name: uname }));
            ws.send(JSON.stringify({ type: "users", users }));
          } catch (_) {}
          break;
        }

        case "requestForAllData": {
          await publishToRoom(roomId!, { type: "requestForAllData", userId }, userId);
          break;
        }

        case "allData": {
          const delivered = sendToLocalUser(roomId!, data.userId, data);
          if (!delivered) {
            await publishToRoom(roomId!, data, null, data.userId);
          }
          break;
        }

        case "code":
        case "input":
        case "language":
        case "submitBtnStatus":
        case "cursorPosition":
        case "clearOutput":
        case "drawing": {
          await publishToRoom(roomId!, { ...data, userId }, userId);
          break;
        }

        case "chatMessage": {

          await publishToRoom(roomId!, { ...data, userId }, null);
          break;
        }

        case "requestDrawingState": {
          await publishToRoom(
            roomId!,
            { type: "requestDrawingState", roomId: data.roomId, userId: data.userId },
            userId
          );
          break;
        }

        case "drawingSnapshot": {
          const delivered = sendToLocalUser(roomId!, data.targetUserId, data);
          if (!delivered) {
            await publishToRoom(roomId!, data, null, data.targetUserId);
          }
          break;
        }
      }
    });

    ws.on("close", async () => {
      if (!rooms[roomId!]) return;

      rooms[roomId!].users = rooms[roomId!].users.filter((u) => u.userId !== userId);

      await redisPub.hDel(`users:${roomId!}`, userId).catch(() => {});
      await publishToRoom(roomId!, { type: "userLeft", userId }).catch(() => {});

      if (rooms[roomId!].users.length === 0) {
        redisSub.unsubscribe(`results:${roomId!}`).catch(() => {});
        redisSub.unsubscribe(`room:${roomId!}`).catch(() => {});
        delete rooms[roomId!];
      }
    });
  });

  server.listen(port, "0.0.0.0", () =>
    console.log(`WebSocket server running on port ${port}`)
  );
}

start().catch(async (err) => {
  console.error("WS server fatal error:", err);
  await redisSub.quit().catch(() => {});
  await redisPub.quit().catch(() => {});
  process.exit(1);
});
