const express = require('express');
const app = express();
app.use(express.json());

const API_SECRET = "ae55e3445f7e585c6295c103f0f5c245fa7275aa4bea8b9bfbffbf6e7ca6e719";

let registeredBots = new Set();
let scannedServers = new Map();
let serverQueue = [];
let hopStats = [];

const PLACE_ID = "109983668079237";

function checkSecret(req, res, next) {
    if (req.headers['x-api-secret'] !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.post('/scanner-register', checkSecret, (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'No username' });
    registeredBots.add(username);
    console.log(`✅ Bot registered: ${username}`);
    res.json({ success: true, total_bots: registeredBots.size });
});

app.get('/scanner-list', checkSecret, (req, res) => {
    res.json({ usernames: Array.from(registeredBots) });
});

app.post('/add-server', checkSecret, (req, res) => {
    const { jobId, players, brainrots, timestamp } = req.body;
    
    scannedServers.set(jobId, {
        players,
        brainrots: brainrots || [],
        timestamp,
        scannedAt: Date.now()
    });
    
    console.log(`📊 Server ${jobId} scanned: ${brainrots?.length || 0} brainrots`);
    res.json({ success: true });
});

app.get('/get-server', checkSecret, async (req, res) => {
    try {
        const response = await fetch(`https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Desc&limit=100`);
        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            return res.status(404).json({ error: 'No servers found' });
        }
        
        const goodServers = data.data.filter(s => 
            s.playing >= 4 && 
            s.playing <= 7 &&
            s.id !== req.query.current
        );
        
        if (goodServers.length === 0) {
            const anyServer = data.data.filter(s => s.id !== req.query.current);
            if (anyServer.length > 0) {
                const random = anyServer[Math.floor(Math.random() * anyServer.length)];
                console.log(`⚠️ No ideal servers, sending: ${random.id} (${random.playing}/8)`);
                return res.json({ job_id: random.id });
            }
            return res.status(404).json({ error: 'No available servers' });
        }
        
        const random = goodServers[Math.floor(Math.random() * goodServers.length)];
        console.log(`🎯 Sending server: ${random.id} (${random.playing}/8)`);
        res.json({ job_id: random.id });
        
    } catch (error) {
        console.error('Error fetching servers:', error);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

app.post('/record-hop', checkSecret, (req, res) => {
    hopStats.push({
        ...req.body,
        timestamp: Date.now()
    });
    console.log(`🔄 Hop recorded: VPS ${req.body.vps_name}, Found: ${req.body.found_brainrots}`);
    res.json({ success: true });
});

app.get('/stats', (req, res) => {
    const totalBrainrots = Array.from(scannedServers.values())
        .reduce((sum, s) => sum + (s.brainrots?.length || 0), 0);
    
    res.json({
        total_bots: registeredBots.size,
        total_servers_scanned: scannedServers.size,
        total_hops: hopStats.length,
        total_brainrots_found: totalBrainrots,
        recent_hops: hopStats.slice(-10)
    });
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: 'Brainrot API v1.0',
        endpoints: [
            'POST /scanner-register',
            'GET /scanner-list',
            'POST /add-server',
            'GET /get-server',
            'POST /record-hop',
            'GET /stats'
        ]
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API running on port ${PORT}`);
});
