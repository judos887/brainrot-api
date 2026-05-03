import express from "express";

const app = express();
app.use(express.json());

const API_SECRET = "ae55e3445f7e585c6295c103f0f5c245fa7275aa4bea8b9bfbffbf6e7ca6e719";

let registeredBots = new Set();
let scannedServers = new Map(); // jobId -> {players, value, lastSeen, assignedTo?}
let hopStats       = [];
let serverQueue    = []; // Array von jobIds, die verteilt werden sollen

function checkSecret(req, res, next) {
  if (req.headers["x-api-secret"] !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Brainrot API v3.0 (Server pool)",
    endpoints: [
      "POST /scanner-register",
      "GET  /scanner-list",
      "POST /add-server",
      "GET  /get-server",
      "POST /record-hop",
      "GET  /stats"
    ]
  });
});

app.post("/scanner-register", checkSecret, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "No username" });
  registeredBots.add(username);
  console.log("Bot registered:", username);
  res.json({ success: true, total_bots: registeredBots.size });
});

app.get("/scanner-list", checkSecret, (req, res) => {
  res.json({ usernames: Array.from(registeredBots) });
});

// Bots schicken hier: jobId, players, brainrots (Liste), timestamp
app.post("/add-server", checkSecret, (req, res) => {
  const { jobId, players, brainrots, timestamp } = req.body || {};
  if (!jobId) return res.status(400).json({ error: "No jobId" });

  const now = Date.now();
  const value = Array.isArray(brainrots)
    ? brainrots.reduce((acc, b) => acc + (b.value || 0), 0)
    : 0;

  scannedServers.set(jobId, {
    players: players || 0,
    value: value,
    lastSeen: timestamp || now,
    assignedTo: null,
    assignedAt: null
  });

  // Server in die Queue pushen (wenn noch nicht drin)
  if (!serverQueue.includes(jobId)) {
    serverQueue.push(jobId);
  }

  console.log(
    `Server ${jobId} gespeichert: players=${players || 0}, value=${value}`
  );
  res.json({ success: true });
});

// Bots fragen hier: gib mir eine JobId > API gibt Server aus der gespeicherten Liste
app.get("/get-server", checkSecret, (req, res) => {
  const botId = req.query.bot || "unknown";
  const now   = Date.now();
  const ASSIGN_TTL = 60 * 1000; // 1 Minute

  // alte Assignments verfallen lassen
  for (const [jobId, info] of scannedServers.entries()) {
    if (info.assignedAt && now - info.assignedAt > ASSIGN_TTL) {
      info.assignedTo = null;
      info.assignedAt = null;
    }
  }

  // aus Queue nach "geeignetem" Server suchen
  while (serverQueue.length > 0) {
    const jobId = serverQueue.shift();
    const info  = scannedServers.get(jobId);
    if (!info) continue;

    // falls bereits zugewiesen & noch nicht abgelaufen -> skip
    if (info.assignedTo && now - (info.assignedAt || 0) <= ASSIGN_TTL) {
      continue;
    }

    // einfachen Qualitätsfilter: mind. 4 Spieler, mind. etwas Value
    if (info.players >= 1 && info.value > 0) {
      info.assignedTo = botId;
      info.assignedAt = now;
      console.log(`GET-SERVER -> jobId=${jobId} to bot=${botId}`);
      return res.json({ job_id: jobId });
    }
  }

  console.log("GET-SERVER: keine passenden Einträge in Queue");
  return res.status(404).json({ error: "No queued servers" });
});

app.post("/record-hop", checkSecret, (req, res) => {
  hopStats.push({ ...req.body, timestamp: Date.now() });
  console.log("Hop recorded:", req.body);
  res.json({ success: true });
});

app.get("/stats", (req, res) => {
  const totalBrainrots = Array.from(scannedServers.values()).reduce(
    (sum, s) => sum + (s.value || 0),
    0
  );

  res.json({
    total_bots: registeredBots.size,
    total_servers_scanned: scannedServers.size,
    total_hops: hopStats.length,
    total_brainrots_value: totalBrainrots,
    queued_servers: serverQueue.length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
