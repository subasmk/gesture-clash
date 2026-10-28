// ==========================================
// GESTURE CLASH — 1v1 first-person arena server
// Two laptops on the same WiFi/hotspot. One round:
// first elimination wins, winner screen, auto reset.
// ==========================================
const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const os = require("os");
const selfsigned = require("selfsigned");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

// ---------- Arena definition (shared layout) ----------
// Boxes: center x/z, footprint w (x) by d (z), height h. Layout is
// mirror-symmetric so neither spawn has an advantage.
const halfBoxes = [
  { x: 0, z: 0, w: 6, d: 6, h: 3 },       // centre block
  { x: 10, z: 6, w: 4, d: 4, h: 2.2 },
  { x: -10, z: 6, w: 4, d: 4, h: 2.2 },
  { x: 6, z: -12, w: 8, d: 3, h: 1.8 },
  { x: -6, z: -12, w: 8, d: 3, h: 1.8 },
  { x: 14, z: 14, w: 3, d: 8, h: 2.6 },
  { x: -14, z: 14, w: 3, d: 8, h: 2.6 },
  { x: 16, z: -4, w: 5, d: 3, h: 1.6 },
  { x: -16, z: -4, w: 5, d: 3, h: 1.6 },
  { x: 0, z: 16, w: 10, d: 3, h: 2.0 },
  { x: 4, z: -18, w: 3, d: 3, h: 2.4 },
  { x: -4, z: -18, w: 3, d: 3, h: 2.4 }
];
const BOXES = [];
for (const b of halfBoxes) {
  BOXES.push(b);
  if (b.z !== 0) BOXES.push({ ...b, z: -b.z });
}
const ARENA = { size: 46, boxes: BOXES };
const SPAWNS = [
  { x: -18, z: 0, yaw: -Math.PI / 2 },  // slot 0 faces +x (east)
  { x: 18, z: 0, yaw: Math.PI / 2 }     // slot 1 faces -x (west)
];
// three.js camera forward (XZ) for a given yaw: (-sin yaw, -cos yaw)
// slot 0 at x=-18 must face +x: -sin(yaw)=1 -> yaw=-PI/2 ✔ ; slot 1 faces -x: yaw=PI/2 ✔

const HIT_RADIUS = 0.95;      // metres — forgiving for an expo demo
const SHOT_COOLDOWN_MS = 320;
const COUNTDOWN_MS = 3000;
const WINNER_SHOW_MS = 6000;

// ---------- Match state ----------
let match = null;
function newMatch() {
  return {
    status: "lobby", // lobby | countdown | playing | ended
    players: [null, null], // { id, name, x, z, yaw, pitch, ready, alive, lastShotAt }
    winner: null, // slot index
    countdownTimer: null,
    resetTimer: null, roundTimer: null, endsAt: null
  };
}
match = newMatch();

function resetPositions() {
  match.players.forEach((p, i) => {
    if (!p) return;
    p.x = SPAWNS[i].x; p.z = SPAWNS[i].z;
    p.yaw = SPAWNS[i].yaw; p.pitch = 0;
    p.alive = true; p.lastUpdateAt=Date.now(); p.lastShotAt=0;
  });
}

function publicState() {
  return {
    status: match.status,
    winner: match.winner, endsAt: match.endsAt,
    players: match.players.map(p => p ? {
      name: p.name, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch,
      ready: p.ready, alive: p.alive
    } : null)
  };
}

// ---------- Shot resolution (2D, server-validated) ----------
function segmentHitsBox(x1, z1, x2, z2, b) {
  // Slab test of segment against the box footprint
  const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
  const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
  const dx = x2 - x1, dz = z2 - z1;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (x1 < minX || x1 > maxX) return false; }
  else {
    let t1 = (minX - x1) / dx, t2 = (maxX - x1) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z1 < minZ || z1 > maxZ) return false; }
  else {
    let t1 = (minZ - z1) / dz, t2 = (maxZ - z1) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

function resolveShot(shooterSlot) {
  const s = match.players[shooterSlot];
  const t = match.players[1 - shooterSlot];
  if (!s || !t || !t.alive) return { hit: false };
  const result = shotHit(s, t, BOXES);
  return result;
}

// ---------- App / servers ----------
const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/vendor/three.min.js", (_req, res) =>
  res.sendFile(path.join(__dirname, "node_modules/three/build/three.min.js")));
app.use("/vendor/hands", express.static(path.join(__dirname, "node_modules/@mediapipe/hands")));
app.use("/vendor/camera_utils", express.static(path.join(__dirname, "node_modules/@mediapipe/camera_utils")));
app.get("/health", (_req, res) => res.json({ ok: true, status: match.status }));

const { shotHit, validatePosition, localAddresses } = require('./logic');
const pems = selfsigned.generate([{ name: "commonName", value: "gesture-clash" }], { days: 365, keySize: 2048 });
// Fail closed: remote webcam capture is not available over ordinary HTTP.
const server = https.createServer({ key: pems.private, cert: pems.cert }, app);
const protocol = 'https';
const io = new Server(server);

// ---------- Flow ----------
function broadcast() { io.emit("state", publicState()); }

function startCountdown() {
  match.status = "countdown";
  resetPositions();
  broadcast();
  io.emit("countdownStart", { ms: COUNTDOWN_MS });
  clearTimeout(match.countdownTimer);
  match.countdownTimer = setTimeout(() => {
    if (match.status !== "countdown") return;
    match.status = "playing";
    match.endsAt = Date.now() + 90000;
    match.roundTimer = setTimeout(() => endRound(null), 90000);
    io.emit("roundStart");
    broadcast();
  }, COUNTDOWN_MS);
}

function endRound(winnerSlot) {
  if (match.status !== "playing") return;
  clearTimeout(match.roundTimer);
  match.endsAt = null;
  match.status = "ended";
  match.winner = winnerSlot;
  const loser = winnerSlot === null ? null : match.players[1 - winnerSlot];
  if (loser) loser.alive = false;
  io.emit("roundEnd", {
    winnerSlot,
    winnerName: winnerSlot !== null && match.players[winnerSlot] ? match.players[winnerSlot].name : "Player"
  });
  broadcast();
  clearTimeout(match.resetTimer);
  match.resetTimer = setTimeout(() => backToLobby(), WINNER_SHOW_MS);
}

function backToLobby() {
  clearTimeout(match.countdownTimer);
  clearTimeout(match.resetTimer);
  clearTimeout(match.roundTimer);
  match.endsAt = null;
  match.status = "lobby";
  match.winner = null;
  match.players.forEach(p => { if (p) { p.ready = false; p.alive = true; } });
  resetPositions();
  io.emit("lobbyReset");
  broadcast();
}

io.on("connection", socket => {
  socket.emit("arena", ARENA);
  socket.emit("state", publicState());

  socket.on("join", ({ name } = {}) => {
    if (socket.data.slot !== undefined) {
      const slot = socket.data.slot;
      if (match.players[slot]?.id === socket.id) return socket.emit('joined', {slot, name:match.players[slot].name});
    }
    let slot = match.players.findIndex(p => p === null);
    if (slot === -1) {
      // Reuse a disconnected ghost slot if any (same socket re-joining)
      return socket.emit("joinDenied", { text: "Both player slots are taken." });
    }
    const clean = String(name || "").trim().slice(0, 14) || `Player ${slot + 1}`;
    match.players[slot] = {
      id: socket.id, name: clean, ready: false, alive: true,
      x: SPAWNS[slot].x, z: SPAWNS[slot].z, yaw: SPAWNS[slot].yaw, pitch: 0,
      lastShotAt: 0, lastUpdateAt: Date.now()
    };
    socket.data.slot = slot;
    socket.emit("joined", { slot, name: clean });
    io.emit("notice", { text: `${clean} joined as Player ${slot + 1}` });
    broadcast();
  });

  socket.on("ready", () => {
    const slot = socket.data.slot;
    const p = match.players[slot];
    if (!p || match.status !== "lobby") return;
    p.ready = true;
    broadcast();
    if (match.players[0] && match.players[1] && match.players.every(pl => pl.ready)) {
      startCountdown();
    }
  });

  function applyUpdate(data) {
    const p = match.players[socket.data.slot];
    if (!p || p.id !== socket.id || match.status !== 'playing') return;
    const now=Date.now();
    const next=validatePosition(p, data, Math.min(.25, (now-p.lastUpdateAt)/1000), ARENA);
    p.x=next.x; p.z=next.z; p.yaw=next.yaw; p.pitch=next.pitch; p.lastUpdateAt=now;
    socket.emit('correction', {x:p.x,z:p.z});
  }
  socket.on('update', data => {applyUpdate(data); broadcast();});

  socket.on("shoot", (data = {}) => {
    applyUpdate(data);
    const slot = socket.data.slot;
    const p = match.players[slot];
    if (!p || match.status !== "playing" || !p.alive) return;
    const now = Date.now();
    if (now - p.lastShotAt < SHOT_COOLDOWN_MS) return;
    p.lastShotAt = now;
    const result = resolveShot(slot);
    io.emit("shotFired", { slot, hit: result.hit, blocked: !!result.blocked });
    if (result.hit) endRound(slot);
  });

  socket.on("resetMatch", () => {
    if (match.status === "ended" || match.status === "lobby") backToLobby();
  });

  socket.on("disconnect", () => {
    const slot = socket.data.slot;
    if (slot === undefined || !match.players[slot] || match.players[slot].id !== socket.id) return;
    const name = match.players[slot].name;
    match.players[slot] = null;
    io.emit("notice", { text: `${name} left the arena` });
    if (match.status === "playing" || match.status === "countdown") {
      io.emit("notice", { text: "Round stopped — a player disconnected." });
      backToLobby();
    } else {
      broadcast();
    }
  });
});

function localIp() { return localAddresses(os.networkInterfaces())[0] || 'localhost'; }
server.listen(PORT, "0.0.0.0", () => {
  const addresses=localAddresses(os.networkInterfaces());
  const ip = process.env.HOST_IP || localIp();
  if (!addresses.length) console.warn('No LAN IPv4 detected. Connect to trusted Wi-Fi/hotspot.');
  console.log('Candidate LAN IPv4 addresses:', addresses.join(', '));
  console.log('Verify the Wi-Fi/hotspot address with ipconfig; set HOST_IP if needed.');
  console.log(`====================================================`);
  console.log(` GESTURE CLASH SERVER ONLINE (${protocol.toUpperCase()})`);
  console.log(` Player 1 laptop:  ${protocol}://localhost:${PORT}`);
  console.log(` Player 2 laptop:  ${protocol}://${ip}:${PORT}`);
  console.log(` (HTTPS is self-signed: click Advanced -> Proceed once per laptop)`);
  console.log(`====================================================`);
});
