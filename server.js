'use strict';

const express                = require('express');
const { createServer }       = require('http');
const path                   = require('path');
const { Server }             = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const mongoose               = require('mongoose');   // ← ADD
const bcrypt                 = require('bcryptjs');   // ← ADD
const jwt                    = require('jsonwebtoken'); // ← ADD

const { PrivateRoom }     = require('./rooms/PrivateRoom');
const { MatchmakingRoom } = require('./rooms/MatchmakingRoom');
const CFG                 = require('./config');

//mango db
mongoose.connect(CFG.MONGO_URI)
  .then(() => console.log('✅  MongoDB connected'))
  .catch(err => { console.error('❌  MongoDB:', err); process.exit(1); });

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 32, match: /^[a-zA-Z0-9_]+$/ },
  passwordHash: { type: String, required: true },
  email:        { type: String, default: null },
  wins:         { type: Number, default: 0 },
  deaths:       { type: Number, default: 0 },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
// ── end MongoDB block ────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// ── Auth routes ──────────────────────────────────────────── // ← ADD BLOCK
app.post('/auth/signup', async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  if (password.length < 8)   return res.status(400).json({ error: 'Password must be 8+ characters.' });
  if (await User.findOne({ username })) return res.status(409).json({ error: 'Username already taken.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username, passwordHash, email: email || null });
  const token = jwt.sign({ userId: user._id, username }, CFG.JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ username, token });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  const user = await User.findOne({ username });
  if (!user || !await bcrypt.compare(password, user.passwordHash))
    return res.status(401).json({ error: 'Invalid username or password.' });
  const token = jwt.sign({ userId: user._id, username }, CFG.JWT_SECRET, { expiresIn: '7d' });
  res.json({ username, token });
});

app.get('/auth/me', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token.' });
  }
});
// ── end auth routes ──────────────────────────────────────────
// ── Short-code lookup endpoint ────────────────────────────────
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