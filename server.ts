import express, { Request, Response } from "express";
import next from "next";
import { Server, Socket } from "socket.io";
import { createServer } from "node:http";
import { getWebRTCConfigPath, readWebRTCConfig } from "./lib/webrtc-config";

const PORT = Number(process.env.PORT ?? 3000);
const PEER_PORT = Number(process.env.PEER_PORT ?? 4000);
const HOSTNAME = process.env.HOSTNAME ?? "0.0.0.0";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SPACE ?? "/socket.io";
const HOME_URL = process.env.NEXT_PUBLIC_HOME ?? `http://localhost:${PORT}`;
const PEER_SERVER_URL =
  process.env.NEXT_PUBLIC_WSS_PEER_URI ?? `http://localhost:${PEER_PORT}`;
const dev = process.env.NODE_ENV !== "production";

type RoomParticipants = Record<
  string,
  {
    instanceId: string;
    count: number;
  }
>;

const rooms: Record<string, RoomParticipants> = {};

const defaultOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `https://meet.gdmn.app`
];

const peerOrigins = [
  `http://localhost:${PEER_PORT}`,
  `http://127.0.0.1:${PEER_PORT}`,
  `https://meet-peer.gdmn.app`
];

const trustedOrigins = new Set(
  [...defaultOrigins, ...peerOrigins, HOME_URL]
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function getForwardedValue(value?: string) {
  return value?.split(",")[0]?.trim();
}

function getRequestOrigin(req: Request) {
  const host =
    getForwardedValue(req.header("x-forwarded-host")) ?? req.header("host");

  if (!host) {
    return HOME_URL;
  }

  const isLocalHost =
    host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol =
    getForwardedValue(req.header("x-forwarded-proto")) ??
    (isLocalHost ? req.protocol : "https");

  return `${protocol}://${host}`;
}

function derivePeerServerUrl(origin: string) {
  try {
    const peerUrl = new URL(origin);

    if (
      peerUrl.hostname === "localhost" ||
      peerUrl.hostname === "127.0.0.1"
    ) {
      peerUrl.port = String(PEER_PORT);
    } else {
      const labels = peerUrl.hostname.split(".");

      if (labels[0] && !labels[0].endsWith("-peer")) {
        labels[0] = `${labels[0]}-peer`;
        peerUrl.hostname = labels.join(".");
      }

      peerUrl.port = "";
    }

    return peerUrl.toString().replace(/\/$/, "");
  } catch {
    return PEER_SERVER_URL;
  }
}

const nextApp = next({ dev, port: PORT, hostname: HOSTNAME });
const handle = nextApp.getRequestHandler();

let io: Server | undefined;

function logStartupDiagnostics() {
  console.log("Startup environment variables:");
  console.log(JSON.stringify(process.env, null, 2));
  console.log(`Resolved WebRTC config path: ${getWebRTCConfigPath()}`);

  try {
    console.log("Resolved WebRTC config:");
    console.log(JSON.stringify(readWebRTCConfig(), null, 2));
  } catch (error) {
    console.error("Unable to read WebRTC config at startup", error);
  }
}

function setNoStore(res: Response) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

function startSocketServer() {
  io = new Server(PEER_PORT, {
    cors: {
      origin(origin, callback) {
        if (!origin || trustedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"]
    },
    path: SOCKET_PATH,
    connectionStateRecovery: {
      maxDisconnectionDuration: 5 * 60 * 1000,
      skipMiddlewares: true
    }
  });

  io.on("connection", (socket: Socket) => {
    const roomId = String(socket.handshake.query.roomId ?? "");
    const participantId = String(socket.handshake.query.participantId ?? "");
    const instanceId = String(socket.handshake.query.instanceId ?? "");

    if (!roomId || !participantId || !instanceId) {
      socket.disconnect();
      return;
    }

    const room = rooms[roomId];

    if (!room) {
      rooms[roomId] = {
        [participantId]: {
          instanceId,
          count: 1
        }
      };
    } else if (!room[participantId]) {
      room[participantId] = {
        instanceId,
        count: 1
      };
    } else if (room[participantId].instanceId !== instanceId) {
      socket.emit("already_in_room");
      socket.disconnect();
      return;
    } else {
      room[participantId].count += 1;
    }

    socket.join(roomId);

    socket.on("message", (data) => {
      socket.to(roomId).emit("message", data);
    });

    socket.on("disconnect", () => {
      socket.to(roomId).emit("message", {
        type: "SOCKET_DISCONNECTED",
        payload: {
          roomId,
          participantId
        }
      });

      const participant = rooms[roomId]?.[participantId];

      if (!participant) {
        return;
      }

      participant.count -= 1;

      if (participant.count <= 0) {
        delete rooms[roomId][participantId];
      }

      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
      }
    });
  });

  console.log(`Socket server listening on ${PEER_PORT}${SOCKET_PATH}`);
}

function removeParticipant(roomId: string, participantId: string) {
  if (!rooms[roomId]?.[participantId]) {
    return;
  }

  delete rooms[roomId][participantId];

  if (Object.keys(rooms[roomId]).length === 0) {
    delete rooms[roomId];
  }
}

logStartupDiagnostics();
startSocketServer();

nextApp.prepare().then(() => {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    setNoStore(res);
    res.status(200).json({
      ok: true,
      appPort: PORT,
      peerPort: PEER_PORT
    });
  });

  app.get("/api/runtime-config", (_req, res) => {
    setNoStore(res);
    const homeUrl = getRequestOrigin(_req);

    res.status(200).json({
      homeUrl,
      peerServerUrl: derivePeerServerUrl(homeUrl),
      socketPath: SOCKET_PATH
    });
  });

  app.get("/api/webrtc-config", (_req: Request, res: Response) => {
    try {
      setNoStore(res);
      res.status(200).json(readWebRTCConfig());
    } catch (error) {
      console.error("Unable to load WebRTC config", error);
      res.status(500).json({ error: "Unable to load WebRTC config" });
    }
  });

  app.post(
    "/user_closing_tab",
    (
      req: Request<{}, {}, {}, { participantId?: string; roomId?: string }>,
      res: Response
    ) => {
      const participantId = req.query.participantId;
      const roomId = req.query.roomId;

      if (participantId && roomId) {
        removeParticipant(roomId, participantId);

        io?.to(roomId).emit("message", {
          type: "LEAVE",
          payload: {
            fromId: participantId
          }
        });
      }

      res.sendStatus(200);
    }
  );

  app.all("*", (req: Request, res: Response) => handle(req, res));

  createServer(app).listen(PORT, HOSTNAME, () => {
    console.log(`App server listening on http://${HOSTNAME}:${PORT}`);
  });
});
