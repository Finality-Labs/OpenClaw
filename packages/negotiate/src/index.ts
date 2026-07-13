import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { Room, PartyIdentity } from "./room.js";
import { notifyDeal } from "./settle.js";

const PORT = Number(process.env.PORT ?? 3002);

// In-memory room registry keyed by roomId (Part 1 is not required to run;
// we accept any roomId and treat the first buyer/seller joins as the pair).
const rooms = new Map<string, Room>();

// Join message a client sends right after connecting:
// { type: "join", role: "buyer"|"seller", identity: { agentRegistry, agentId, wallet, maxUnitPrice?, floorUnitPrice? } }
interface JoinMsg {
  type: "join";
  role: "buyer" | "seller";
  identity: PartyIdentity;
}

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId, {}, (result) => {
      void notifyDeal(result);
    });
    rooms.set(roomId, room);
  }
  return room;
}

export function startServer(port = PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (socket: WebSocket, req) => {
    // URL: /negotiate/:roomId
    const url = new URL(req.url ?? "/negotiate/unknown", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["negotiate", "<roomId>"]
    const roomId = parts[1] ?? "unknown";
    const room = getOrCreateRoom(roomId);
    let role: "buyer" | "seller" | null = null;

    const send = (data: string) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    };

    socket.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(JSON.stringify({ type: "system", kind: "error", message: "non-JSON frame", ts: Date.now() }));
        return;
      }

      if (msg && (msg as any).type === "join") {
        const j = msg as JoinMsg;
        if (role) {
          send(JSON.stringify({ type: "system", kind: "error", message: "already joined", ts: Date.now() }));
          return;
        }
        const ok = room.join(j.role, j.identity, send);
        if (!ok) {
          send(JSON.stringify({ type: "system", kind: "error", message: "room full or role taken", ts: Date.now() }));
          return;
        }
        role = j.role;
        return;
      }

      if (!role) {
        send(JSON.stringify({ type: "system", kind: "error", message: "send join first", ts: Date.now() }));
        return;
      }
      room.handle(role, msg);
    });

    socket.on("close", () => {
      // Room stays (transcript preserved); a reconnecting party would be a 3rd socket
      // and is rejected by Room.join. Good enough for MVP2.
    });
  });

  return wss;
}

// Run when executed directly (tsx/npm run dev).
if (import.meta.url === `file://${process.argv[1]}`) {
  const wss = startServer();
  console.log(`[negotiate] WebSocket venue listening on ws://localhost:${PORT}/negotiate/:roomId`);
  process.on("SIGINT", () => {
    wss.close();
    process.exit(0);
  });
}

export { randomUUID };
