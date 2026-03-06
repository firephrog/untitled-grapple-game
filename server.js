'use strict';

const express                = require('express');
const { createServer }       = require('http');
const path                   = require('path');
const { Server }             = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');

const { PrivateRoom }     = require('./rooms/PrivateRoom');
const { MatchmakingRoom } = require('./rooms/MatchmakingRoom');
const CFG                 = require('./config');

const app        = express();
const httpServer = createServer(app);

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR));

// ── Short-code lookup endpoint ────────────────────────────────
// Client POSTs { code: "ABC123" } and gets back the Colyseus room ID.
// The joiner then calls colyseus.joinById(roomId) with that ID.
app.use(express.json());
app.post('/find-room', async (req, res) => {
  const code = (req.body.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    const rooms = await gameServer.driver.find({ name: 'private' });
    const match = rooms.find(r => r.metadata?.shortCode === code);
    if (!match) return res.status(404).json({ error: 'Room not found' });
    if (match.clients >= match.maxClients) return res.status(410).json({ error: 'Room is full' });
    res.json({ roomId: match.roomId });
  } catch (e) {
    console.error('find-room error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Accept connections forwarded by Cloudflare tunnel / reverse proxies.
    // Cloudflare sends the real client IP in x-forwarded-for, not the socket IP.
    verifyClient: () => true,
  }),
});

gameServer.define('private',     PrivateRoom);
gameServer.define('matchmaking', MatchmakingRoom, {
  filterBy: ['ratingMin', 'ratingMax'],
});

httpServer.listen(CFG.PORT, () => {
  console.log(`\n🎮  Server running → http://localhost:${CFG.PORT}`);
  console.log(`    Room types: private | matchmaking\n`);
});