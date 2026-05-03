import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// === CONFIG ===
const API_SECRET = "ae55e3445f7e585c6295c103f0f5c245fa7275aa4bea8b9bfbffbf6e7ca6e719";
// dein PlaceId (das Spiel, das die Bots scannen sollen)
const PLACE_ID = process.env.PLACE_ID || "109983668079237";

// Helpers
function checkSecret(req, res, next) {
  if (req.headers["x-api-secret"] !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// einfache Stats
let hops = [];
let addServerEvents = [];

// ==============================
// ROTER ENDPOINT: HEALTHCHECK
// ==============================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    placeId: PLACE_ID,
    endpoints: [
      "POST /add-server",
      "GET  /get-server",
      "POST /record-hop",
      "GET  /stats"
    ]
  });
});

// ==============================
// /add-server  -> nur Logging
// ==============================
app.post("/add-server", checkSecret, (req, res) => {
  const { jobId, players, brainrots, timestamp } = req.body || {};
  if (!jobId) {
    return res.status(400).json({ error: "No jobId" });
  }

  const totalValue = Array.isArray(brainrots)
    ? brainrots.reduce((s, b) => s + (b.value || 0), 0)
    : 0;

  addServerEvents.push({
    jobId,
    players: players || 0,
    totalValue,
    brainrots: brainrots || [],
    timestamp: timestamp || Date.now()
  });

  console.log(
    `[ADD-SERVER] jobId=${jobId} players=${players || 0} totalValue=${totalValue}`
  );
  res.json({ success: true });
});

// ==============================
// Roblox Serverliste holen
// ==============================
async function fetchRobloxServers() {
  let servers = [];
  let cursor = "";
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    let url = `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Desc&limit=100`;
    if (cursor) url += `&cursor=${cursor}`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Viode-Hopper/1.0",
        "Accept": "application/json"
      }
    });

    if (!resp.ok) {
      console.error("[GET-SERVER] Roblox API HTTP", resp.status);
      break;
    }

    const data = await resp.json();
    if (!data || !Array.isArray(data.data) || data.data.length === 0) {
      console.log("[GET-SERVER] Roblox API: keine data.data");
      break;
    }

    servers = servers.concat(data.data);

    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
  }

  return servers;
}

// ==============================
// /get-server  -> neuen Server wählen
// ==============================
const ASSIGNED = new Map(); // jobId -> { assignedAt, botId }
const ASSIGN_TTL_MS = 60 * 1000;

app.get("/get-server", checkSecret, async (req, res) => {
  try {
    const now = Date.now();
    const botId = req.query.bot || "unknown";
    const currentJobId = req.query.current || null;

    // alte Assignments aufräumen
    for (const [jobId, info] of ASSIGNED.entries()) {
      if (now - info.assignedAt > ASSIGN_TTL_MS) {
        ASSIGNED.delete(jobId);
      }
    }

    const servers = await fetchRobloxServers();
    if (!servers || servers.length === 0) {
      console.log("[GET-SERVER] keine Server von Roblox erhalten");
      return res.status(404).json({ error = "No servers from Roblox" });
    }

    // Filter: nicht current, nicht voll, nicht assigned
    const candidates = servers.filter((s) => {
      if (!s.id) return false;
      if (s.id === currentJobId) return false;
      if (typeof s.playing !== "number" || typeof s.maxPlayers !== "number")
        return false;
      if (s.playing >= s.maxPlayers) return false;
      const info = ASSIGNED.get(s.id);
      if (info && now - info.assignedAt <= ASSIGN_TTL_MS) return false;
      return true;
    });

    if (candidates.length === 0) {
      console.log("[GET-SERVER] keine passenden Kandidaten (alle assigned/voll)");
      return res.status(404).json({ error: "No suitable servers" });
    }

    // leichte Priorität: 4–7 Spieler bevorzugen
    const good = candidates.filter(
      (s) => s.playing >= 4 && s.playing <= 7
    );
    const pool = good.length > 0 ? good : candidates;

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    ASSIGNED.set(chosen.id, { assignedAt: now, botId });

    console.log(
      `[GET-SERVER] -> jobId=${chosen.id} (${chosen.playing}/${chosen.maxPlayers}) to bot=${botId}`
    );

    res.json({ job_id: chosen.id });
  } catch (err) {
    console.error("[GET-SERVER] Exception:", err);
    res.status(500).json({ error: "Roblox API error" });
  }
});

// ==============================
// /record-hop -> nur Stats
// ==============================
app.post("/record-hop", checkSecret, (req, res) => {
  hops.push({ ...req.body, timestamp: Date.now() });
  console.log("[HOP]", req.body);
  res.json({ success: true });
});

// ==============================
// /stats
// ==============================
app.get("/stats", (req, res) => {
  res.json({
    addServerEvents: addServerEvents.length,
    hops: hops.length,
    lastAddServer: addServerEvents[addServerEvents.length - 1] || null,
    lastHop: hops[hops.length - 1] || null
  });
});

// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}, PLACE_ID=${PLACE_ID}`);
});
