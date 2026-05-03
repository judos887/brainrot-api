import express from "express";

const app = express();
app.use(express.json());

const API_SECRET = "ae55e3445f7e585c6295c103f0f5c245fa7275aa4bea8b9bfbffbf6e7ca6e719";

let registeredBots = new Set();
let scannedServers = new Map();
let hopStats = [];
let claimedServers = new Map(); // jobId -> { claimedAt, botId }

const CLAIM_TTL_MS = 10 * 1000; // 10 Sekunden

function checkSecret(req, res, next) {
  if (req.headers["x-api-secret"] !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Brainrot API v2.0 (coordination only)",
    endpoints: [
      "POST /scanner-register",
      "GET /scanner-list",
      "POST /add-server",
      "POST /claim-server",
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

  console.log(
    `Server ${jobId} scanned with ${(brainrots && brainrots.length) || 0} brainrots`
  );
  res.json({ success: true });
});

app.post("/claim-server", checkSecret, (req, res) => {
  const { jobId, botId } = req.body || {};
  if (!jobId || !botId) return res.status(400).json({ error: "Missing jobId or botId" });

  const now = Date.now();

  for (const [jid, info] of claimedServers.entries()) {
    if (now - info.claimedAt > CLAIM_TTL_MS) {
      claimedServers.delete(jid);
    }
  }

  const existing = claimedServers.get(jobId);
  if (existing && now - existing.claimedAt <= CLAIM_TTL_MS) {
    return res.json({ success: false, reason: "claimed" });
  }

  claimedServers.set(jobId, { claimedAt: now, botId });
  console.log(`Server ${jobId} claimed by ${botId}`);
  res.json({ success: true });
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
    total_brainrots_found: totalBrainrots,
    current_claims: Array.from(claimedServers.entries())
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
