'use strict';

const express                = require('express');
const { createServer }       = require('http');
const path                   = require('path');
const { Server }             = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const mongoose               = require('mongoose');  
const bcrypt                 = require('bcryptjs'); 
const jwt                    = require('jsonwebtoken'); 

const { PrivateRoom }     = require('./rooms/PrivateRoom');
const { MatchmakingRoom } = require('./rooms/MatchmakingRoom');
const { Lobby, getLobby } = require('./rooms/Lobby');
const { skinRoutes, unlockSkin, unlockGrapple } = require('./routes/skins');
const CFG                 = require('./config');
const User = require('./models/User'); 


//mango db
mongoose.connect(CFG.MONGO_URI)
  .then(async () => {
    console.log('✅  MongoDB connected');
    
    // one-time migration — remove after running once
    const users = await User.find({ 'friends.list': { $exists: true } });
    for (const user of users) {
      const oldList = user.friends?.list || {};
      const newList = {};
      for (const [key, value] of Object.entries(oldList)) {
        if (typeof value === 'string') {
          newList[value] = { messages: [] };
        } else {
          newList[key] = value;
        }
      }
      await User.findByIdAndUpdate(user._id, { $set: { 'friends.list': newList } });
    }
    console.log('✅  Friends list migration done');
  })
  .catch(err => { console.error('❌  MongoDB:', err); process.exit(1); });
// ── end MongoDB block ────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR));
app.use(express.json());
app.use('/api/skins', skinRoutes);

// ── Auth routes ──────────────────────────────────────────── // ← ADD BLOCK
app.post('/auth/signup', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    if (password.length < 8)   return res.status(400).json({ error: 'Password must be 8+ characters.' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username can only contain letters, numbers and underscores.' });
    if (await User.findOne({ username })) return res.status(409).json({ error: 'Username already taken.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, passwordHash, email: email || null });
    const token = jwt.sign({ userId: user._id, username }, CFG.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ username, token });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(400).json({ error: err.message });
  }
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

//client database send route

app.post('/api/save', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });

  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const { data } = req.body;
    await User.findByIdAndUpdate(userId, { $set: { settings: data.settings } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Invalid token.' });
  }
});

//find user route
app.get('/api/users/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('username status userPrefix usernameColor prefixColor wins deaths');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: `Server error: ${err}` });
  }
});

//friend request

app.post('/api/users/:username/friend-request', async (req, res) => {
  const header = req.headers.authorization || ' ';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token not found' });
  try {
    const { userId, username } = jwt.verify(token, CFG.JWT_SECRET);
    const target = await User.findOne({ username: req.params.username });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target._id.equals(userId)) return res.status(400).json({ error: 'Cannot add yourself.' });
    // add to their pending requests
    await User.findByIdAndUpdate(target._id, {
      $set: { [`friends.requests.${userId}`]: username }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Server error: ${err}` });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const { requesterId, requesterUsername } = req.body;

    await User.findByIdAndUpdate(userId, {
      $unset: { [`friends.requests.${requesterId}`]: '' }
    });

    await User.findByIdAndUpdate(userId, {
      $set: { [`friends.list.${requesterUsername}`]: { messages: [] } }
    });
    const me = await User.findById(userId).select('username');
    await User.findByIdAndUpdate(requesterId, {
      $set: { [`friends.list.${me.username}`]: { messages: [] } }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/friends/decline', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const { requesterId } = req.body;

    await User.findByIdAndUpdate(userId, {
      $unset: { [`friends.requests.${requesterId}`]: '' }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

//message api

//send a message

app.post('/api/users/:username/messages', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });

  try {
    const { userId, username } = jwt.verify(token, CFG.JWT_SECRET);
    const targetUsername = req.params.username;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text.' });
    if (text.length > 500) return res.status(400).json({ error: 'Message too long.' });

    const target = await User.findOne({ username: targetUsername });
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const message = {
      from:      username,
      text:      text.trim(),
      timestamp: new Date(),
      read:      false,
    };

    // push into sender's thread
    const sender = await User.findById(userId);
    const senderList = sender.friends?.list || {};
    if (!senderList[targetUsername]) return res.status(400).json({ error: 'Not friends.' });
    if (!senderList[targetUsername].messages) senderList[targetUsername].messages = [];
    senderList[targetUsername].messages.push(message);
    await User.findByIdAndUpdate(userId, { $set: { 'friends.list': senderList } });

    // push into target's thread
    const targetUser = await User.findById(target._id);
    const targetList = targetUser.friends?.list || {};
    if (!targetList[username]) return res.status(400).json({ error: 'Not friends.' });
    if (!targetList[username].messages) targetList[username].messages = [];
    targetList[username].messages.push(message);
    await User.findByIdAndUpdate(target._id, { $set: { 'friends.list': targetList } });
    
    const lobby = getLobby();
    if (lobby) {
      lobby.notifyUser(target._id.toString(), 'newMessage', {
        from:      username,
        text:      message.text,
        timestamp: message.timestamp,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

//grab messages from database

app.get('/api/users/:username/messages', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });

  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const targetUsername = req.params.username;

    const user = await User.findById(userId).select('friends');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const thread = user.friends?.list?.[targetUsername]?.messages || [];
    res.json({ messages: thread });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

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
gameServer.define('lobby', Lobby);

httpServer.listen(CFG.PORT, () => {
  console.log(`\n🎮  Server running → http://localhost:${CFG.PORT}`);
  console.log(`    Room types: private | matchmaking\n`);
});