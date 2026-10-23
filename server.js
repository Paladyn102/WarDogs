const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();
const {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} = require("node:crypto");
const WebSocket = require("ws");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 3000;
const sessionSecret = process.env.SESSION_SECRET || randomBytes(48).toString("base64url");
const sessionCookieName = "voice_room_session";
const sessionLifetimeSeconds = 12 * 60 * 60;
const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const maxRooms = 500;
const maxChatMessages = 100;
const maxChatMessageLength = 500;
const chatCooldownMs = 750;
const publicDirectory = path.join(__dirname, "public");
const turnUrls = (process.env.TURN_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const turnUsername = process.env.TURN_USERNAME || "";
const turnCredential = process.env.TURN_CREDENTIAL || "";
const roles = new Set([
  "listener",
  "supple",
  "support",
  "szturm",
  "general-supple",
  "general-support",
  "general-szturm",
]);
const chatTeamLabels = {
  listener: "Słuchacz",
  supple: "Supple",
  support: "Support",
  szturm: "Szturm",
};
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const rooms = new Map();

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("Ustaw SESSION_SECRET przed uruchomieniem w trybie produkcyjnym.");
}

if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET musi mieć co najmniej 32 znaki.");
}

if (
  turnUrls.length > 0
  && turnUrls.some((url) => !/^turns?:/i.test(url))
) {
  throw new Error("TURN_URLS może zawierać tylko adresy turn: lub turns:.");
}

if (
  (turnUrls.length > 0 || turnUsername || turnCredential)
  && (turnUrls.length === 0 || !turnUsername || !turnCredential)
) {
  throw new Error("Skonfiguruj komplet TURN_URLS, TURN_USERNAME i TURN_CREDENTIAL.");
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function constantTimeEqual(first, second) {
  const firstHash = createHash("sha256").update(first).digest();
  const secondHash = createHash("sha256").update(second).digest();
  return timingSafeEqual(firstHash, secondHash);
}

function sessionSignature(roomCode, expiresAt, isCreator) {
  return createHmac("sha256", sessionSecret)
    .update(`voice-room:${roomCode}:${expiresAt}:${isCreator ? "creator" : "guest"}`)
    .digest("base64url");
}

function getSession(request) {
  const cookies = request.headers.cookie || "";
  const cookie = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));

  if (!cookie) {
    return undefined;
  }

  const [roomCode, expiresAtText, creatorFlag, signature] = cookie
    .slice(sessionCookieName.length + 1)
    .split(".");
  const expiresAt = Number(expiresAtText);
  const room = rooms.get(roomCode);
  if (
    !room
    || room.expiresAt <= Date.now()
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= Date.now()
    || !["0", "1"].includes(creatorFlag)
    || !signature
  ) {
    return undefined;
  }

  const isCreator = creatorFlag === "1";
  if (!constantTimeEqual(signature, sessionSignature(roomCode, expiresAt, isCreator))) {
    return undefined;
  }
  return { roomCode, room, isCreator };
}

function createRoomCode() {
  let code;
  do {
    const bytes = randomBytes(10);
    code = [...bytes].map((byte) => roomCodeAlphabet[byte % roomCodeAlphabet.length]).join("");
  } while (rooms.has(code));
  return code;
}

function createRoomSession(request, response, roomCode, isCreator) {
  const expiresAt = Date.now() + sessionLifetimeSeconds * 1000;
  const flag = isCreator ? "1" : "0";
  const token = `${roomCode}.${expiresAt}.${flag}.${sessionSignature(roomCode, expiresAt, isCreator)}`;
  response.setHeader("Set-Cookie", sessionCookie(request, token, sessionLifetimeSeconds));
}

function sessionCookie(request, value, maxAge) {
  const secure = request.socket.encrypted || request.headers["x-forwarded-proto"] === "https";
  return `${sessionCookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function readFormBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new Error("Żądanie jest za duże."));
        return;
      }
      resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("error", reject);
  });
}

function broadcastRoster(room) {
  const users = [...room.clients.values()].map(({ id, nickname, role, pushToTalkActive }) => ({
    id,
    nickname,
    role,
    pushToTalkActive,
  }));

  for (const socket of room.clients.keys()) {
    send(socket, { type: "roster", users });
  }
}

function broadcastChatMessage(room, message) {
  room.messages.push(message);
  if (room.messages.length > maxChatMessages) {
    room.messages.shift();
  }

  for (const socket of room.clients.keys()) {
    send(socket, { type: "chat-message", message });
  }
}

function serveFile(request, response) {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  } catch {
    response.writeHead(400).end("Nieprawidłowy adres.");
    return;
  }

  if (request.method === "GET" && pathname === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/ice-config") {
    if (!getSession(request)) {
      sendJson(response, 401, { error: "Dołącz do pokoju, aby pobrać konfigurację audio." });
      return;
    }

    const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    if (turnUrls.length > 0) {
      iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      });
    }
    sendJson(response, 200, { iceServers });
    return;
  }

  if (request.method === "GET" && pathname === "/api/session") {
    const session = getSession(request);
    sendJson(response, 200, {
      authenticated: Boolean(session),
      roomCode: session?.roomCode,
      isCreator: session?.isCreator || false,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/rooms") {
    for (const [code, room] of rooms) {
      if (room.expiresAt <= Date.now()) {
        rooms.delete(code);
      }
    }
    if (rooms.size >= maxRooms) {
      sendJson(response, 503, { error: "Nie można utworzyć więcej pokoi. Spróbuj później." });
      return;
    }

    const code = createRoomCode();
    const room = {
      code,
      expiresAt: Date.now() + sessionLifetimeSeconds * 1000,
      clients: new Map(),
      messages: [],
    };
    rooms.set(code, room);
    createRoomSession(request, response, code, true);
    sendJson(response, 201, { roomCode: code, isCreator: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/rooms/join") {
    readFormBody(request)
      .then((form) => {
        const code = (form.get("code") || "").trim().toUpperCase();
        if (!new RegExp(`^[${roomCodeAlphabet}]{10}$`).test(code)) {
          sendJson(response, 400, { error: "Wpisz prawidłowy, 10-znakowy kod pokoju." });
          return;
        }

        const room = rooms.get(code);
        if (!room || room.expiresAt <= Date.now()) {
          if (room) {
            rooms.delete(code);
          }
          sendJson(response, 404, { error: "Nie znaleziono pokoju. Sprawdź kod od znajomego." });
          return;
        }

        createRoomSession(request, response, code, false);
        sendJson(response, 200, { roomCode: code, isCreator: false });
      })
      .catch((error) => {
        sendJson(response, 413, { error: error.message });
      });
    return;
  }

  if (request.method === "POST" && pathname === "/api/logout") {
    response.writeHead(204, {
      "Cache-Control": "no-store",
      "Set-Cookie": sessionCookie(request, "", 0),
    });
    response.end();
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Metoda niedozwolona.");
    return;
  }

  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end("Nieprawidłowy adres.");
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);

  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403).end("Brak dostępu.");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Nie można wczytać pliku.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(self)",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  });
}

const server = http.createServer(serveFile);
const webSocketServer = new WebSocket.Server({
  server,
  path: "/ws",
  maxPayload: 64 * 1024,
  verifyClient: ({ req, origin }) => {
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return Boolean(getSession(req));
  },
});

const roomExpiryTimer = setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.expiresAt <= Date.now()) {
      for (const socket of room.clients.keys()) {
        socket.close(1008, "Pokój wygasł.");
      }
      rooms.delete(code);
    }
  }
}, 60_000);
roomExpiryTimer.unref();

webSocketServer.on("connection", (socket, request) => {
  const session = getSession(request);
  if (!session) {
    socket.close(1008, "Kod pokoju wygasł.");
    return;
  }
  const { room } = session;
  let user;

  socket.on("message", (data) => {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", message: "Nieprawidłowa wiadomość." });
      return;
    }

    if (message.type === "join") {
      if (user) {
        send(socket, { type: "error", message: "Jesteś już w pokoju." });
        return;
      }

      const nickname = typeof message.nickname === "string"
        ? message.nickname.trim().slice(0, 24)
        : "";

      if (!nickname) {
        send(socket, { type: "error", message: "Podaj nazwę użytkownika." });
        return;
      }

      user = { id: randomUUID(), nickname, role: "listener", pushToTalkActive: false };
      room.clients.set(socket, user);
      send(socket, { type: "welcome", id: user.id });
      send(socket, { type: "chat-history", messages: room.messages });
      broadcastRoster(room);
      return;
    }

    if (!user) {
      send(socket, { type: "error", message: "Najpierw dołącz do pokoju." });
      return;
    }

    if (message.type === "role") {
      if (!roles.has(message.role)) {
        send(socket, { type: "error", message: "Nieznana rola." });
        return;
      }

      user.role = message.role;
      user.pushToTalkActive = false;
      broadcastRoster(room);
      return;
    }

    if (message.type === "push-to-talk") {
      if (typeof message.active !== "boolean") {
        send(socket, { type: "error", message: "Nieprawidłowy stan kanału globalnego." });
        return;
      }
      if (message.active && user.role === "listener") {
        send(socket, { type: "error", message: "Słuchacz nie może nadawać na kanale globalnym." });
        return;
      }

      if (user.pushToTalkActive !== message.active) {
        user.pushToTalkActive = message.active;
        broadcastRoster(room);
      }
      return;
    }

    if (message.type === "nickname") {
      const nextNickname = typeof message.nickname === "string"
        ? message.nickname.trim().slice(0, 24)
        : "";
      if (!nextNickname) {
        send(socket, { type: "error", message: "Nazwa nie może być pusta." });
        return;
      }

      user.nickname = nextNickname;
      broadcastRoster(room);
      return;
    }

    if (message.type === "chat") {
      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        send(socket, { type: "error", message: "Wpisz treść wiadomości." });
        return;
      }
      if (text.length > maxChatMessageLength) {
        send(socket, {
          type: "error",
          message: `Wiadomość może mieć maksymalnie ${maxChatMessageLength} znaków.`,
        });
        return;
      }

      const now = Date.now();
      if (now - (user.lastChatMessageAt || 0) < chatCooldownMs) {
        send(socket, { type: "error", message: "Odczekaj chwilę przed wysłaniem kolejnej wiadomości." });
        return;
      }

      user.lastChatMessageAt = now;
      const teamRole = user.role.startsWith("general-")
        ? user.role.slice("general-".length)
        : user.role;
      broadcastChatMessage(room, {
        team: chatTeamLabels[teamRole],
        nickname: user.nickname,
        text,
      });
      return;
    }

    if (message.type === "signal") {
      if (
        typeof message.target !== "string"
        || !["offer", "answer", "ice"].includes(message.signalType)
      ) {
        send(socket, { type: "error", message: "Nieprawidłowa wiadomość połączenia." });
        return;
      }

      const recipient = [...room.clients.entries()].find(([, peer]) => peer.id === message.target);
      if (recipient) {
        send(recipient[0], {
          type: "signal",
          from: user.id,
          signalType: message.signalType,
          data: message.data,
        });
      }
      return;
    }

    send(socket, { type: "error", message: "Nieznany typ wiadomości." });
  });

  socket.on("close", () => {
    if (room.clients.delete(socket)) {
      broadcastRoster(room);
    }
  });

  socket.on("error", (error) => {
    console.error("Błąd połączenia WebSocket:", error.message);
  });
});

server.listen(port, host, () => {
  console.log(`Pokój głosowy działa pod adresem http://${host}:${port}`);
});
