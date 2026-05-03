import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const API_SECRET = "ae55e3445f7e585c6295c103f0f5c245fa7275aa4bea8b9bfbffbf6e7ca6e719";
const PLACE_ID = "109983668079237";

let registeredBots = new Set();
let scannedServers = new Map();
let hopStats = [];

let claimedServers = new Map(); // jobId -> { claimedAt, botId }
const CLAIM_TTL_MS = 60 * 1000; // 60 Sekunden

function checkSecret(req, res, next) {
  if (req.headers["x-api-secret"] !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Brainrot API v1.0",
    endpoints: [
      "POST /scanner-register",
      "GET /scanner-list",
      "POST /add-server",
      "GET /get-server",
      "POST /record-hop",
      "GET /stats"
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

app.post("/add-server", checkSecret, (req, res) => {
  const { jobId, players, brainrots, timestamp } = req.body || {};
  if (!jobId) return res.status(400).json({ error: "No jobId" });

  scannedServers.set(jobId, {
    players: players || 0,
    brainrots: brainrots || [],
    timestamp: timestamp || Date.now(),
    scannedAt: Date.now()
  });

  console.log(`Server ${jobId} scanned with ${(brainrots && brainrots.length) || 0} brainrots`);
  res.json({ success: true });
});

app.get("/get-server", checkSecret, async (req, res) => {
  try {
    const currentJob = req.query.current;
    const botId = req.query.bot || "unknown";

    const now = Date.now();
    for (const [jobId, info] of claimedServers.entries()) {
      if (now - info.claimedAt > CLAIM_TTL_MS) {
        claimedServers.delete(jobId);
      }
    }

    const response = await fetch(
      `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Desc&limit=100`
    );
    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      return res.status(404).json({ error: "No servers" });
    }

    const good = data.data.filter(
      (s) =>
        s.id !== currentJob &&
        s.playing >= 4 &&
        s.playing <= 7 &&
        !claimedServers.has(s.id)
    );

    const pool =
      good.length > 0
        ? good
        : data.data.filter((s) => s.id !== currentJob && !claimedServers.has(s.id));

    if (pool.length === 0) {
      return res.status(404).json({ error: "No unclaimed servers" });
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    claimedServers.set(chosen.id, { claimedAt: now, botId });

    console.log(
      `Sending server ${chosen.id} to ${botId} (${chosen.playing}/${chosen.maxPlayers})`
    );

    res.json({ job_id: chosen.id });
  } catch (err) {
    console.error("Roblox API error:", err);
    res.status(500).json({ error: "Roblox API error" });
  }
});

app.post("/record-hop", checkSecret, (req, res) => {
  hopStats.push({ ...req.body, timestamp: Date.now() });
  console.log("Hop recorded:", req.body);
  res.json({ success: true });
});

app.get("/stats", (req, res) => {
  const totalBrainrots = Array.from(scannedServers.values()).reduce(
    (sum, s) => sum + ((s.brainrots && s.brainrots.length) || 0),
    0
  );
  res.json({
    total_bots: registeredBots.size,
    total_servers_scanned: scannedServers.size,
    total_hops: hopStats.length,
    total_brainrots_found: totalBrainrots
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
