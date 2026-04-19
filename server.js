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
const { skinRoutes, unlockSkin, unlockGrapple, unlockBombSkin } = require('./routes/skins');
const gearRoutes          = require('./routes/gear');
const CFG                 = require('./config');
const User = require('./models/User'); 
const { TITLES, TITLE_LIST, getTitle } = require('./skins');
const { migrateSkinsStructure } = require('./migrations/migrateSkinsStructure'); 


//mango db
mongoose.connect(CFG.MONGO_URI)
  .then(async () => {
    console.log('✅  MongoDB connected');
    
    // one-time migration — initialize skins and titles for all users
    const users = await User.find({});
    for (const user of users) {
      const updates = {};
      
      // Set default skin, grapple, and gear if not already set
      if (!user.equippedSkin) updates.equippedSkin = 'default';
      if (!user.equippedGrapple) updates.equippedGrapple = 'default';
      if (!user.equippedGear) updates.equippedGear = 'sniper';
      if (!user.userPrefix) updates.userPrefix = 'player';
      updates.status = 'Offline';
      
      // Ensure 'default' is in unlocked skins
      if (!user.unlockedSkins?.includes('default')) {
        updates.$addToSet = updates.$addToSet || {};
        updates.$addToSet.unlockedSkins = 'default';
      }
      
      // Ensure 'default' is in unlocked grapples
      if (!user.unlockedGrapples?.includes('default')) {
        updates.$addToSet = updates.$addToSet || {};
        updates.$addToSet.unlockedGrapples = 'default';
      }
      
      // Ensure 'player' is in unlocked titles
      if (!user.unlockedTitles?.includes('player')) {
        updates.$addToSet = updates.$addToSet || {};
        updates.$addToSet.unlockedTitles = 'player';
      }
      
      if (Object.keys(updates).length > 0) {
        await User.findByIdAndUpdate(user._id, updates);
      }
    }
    console.log('✅  Necessary Migrations done!');
    
    // Run new skins structure migration
    await migrateSkinsStructure();
  })
  .catch(err => { console.error('❌  MongoDB:', err); process.exit(1); });
// ── end MongoDB block ────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
app.use(express.static(PUBLIC_DIR));

// Serve skin models and assets from skins/models directory
// Maps /skins/* to skins/models/*
const SKINS_DIR = path.resolve(process.cwd(), 'skins/models');
app.use('/skins', express.static(SKINS_DIR));

app.use(express.json());
app.use('/api/skins', skinRoutes);
app.use('/api/gear', gearRoutes);

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
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.passwordHash))
      return res.status(401).json({ error: 'Invalid username or password.' });
    const token = jwt.sign({ userId: user._id, username }, CFG.JWT_SECRET, { expiresIn: '7d' });
    res.json({ username, token });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/auth/me', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(400).json({ error: err.message });
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
    console.error('Save error:', err.message);
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
    console.error('Find user error:', err.message);
    res.status(500).json({ error: `Server error: ${err.message}` });
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
    
    // Send notification to target user
    const lobby = getLobby();
    if (lobby) {
      lobby.notifyUser(target._id.toString(), 'friendRequest', {
        from: username
      });
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('Friend request error:', err.message);
    res.status(500).json({ error: `Server error: ${err.message}` });
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

    // Send notification to requester
    const lobby = getLobby();
    if (lobby) {
      lobby.notifyUser(requesterId.toString(), 'friendAccepted', {
        from: me.username
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Accept friend request error:', err.message);
    res.status(500).json({ error: `Server error: ${err.message}` });
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
    console.error('Decline friend request error:', err.message);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

app.post('/api/friends/remove', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId, username } = jwt.verify(token, CFG.JWT_SECRET);
    const { friendUsername } = req.body;

    // Find the friend user
    const friend = await User.findOne({ username: friendUsername });
    if (!friend) return res.status(404).json({ error: 'Friend not found.' });

    // Remove friend from both users' friend lists
    await User.findByIdAndUpdate(userId, {
      $unset: { [`friends.list.${friendUsername}`]: '' }
    });

    await User.findByIdAndUpdate(friend._id, {
      $unset: { [`friends.list.${username}`]: '' }
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
    
    // Pagination: limit (default 20) and skip (default 0)
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Cap at 100
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);

    const user = await User.findById(userId).select('friends');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const thread = user.friends?.list?.[targetUsername]?.messages || [];
    const total = thread.length;
    
    // Return paginated messages + total count
    const messages = thread.slice(Math.max(0, total - skip - limit), total - skip);
    res.json({ messages, total, skip, limit });
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

//update title api
app.post('/api/titles/unlock', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const { titleId } = req.body;
    const title = getTitle(titleId);
    if (title.id !== titleId) return res.status(400).json({ error: 'Invalid title ID.' });
    await User.findByIdAndUpdate(userId, { $addToSet: { unlockedTitles: titleId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.post('/api/titles/equip', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const { titleId } = req.body;
    const title = getTitle(titleId);
    if (title.id !== titleId) return res.status(400).json({ error: 'Invalid title ID.' });
    const user = await User.findById(userId).select('unlockedTitles');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.unlockedTitles.includes(titleId)) return res.status(403).json({ error: 'Title not unlocked.' });
    await User.findByIdAndUpdate(userId, { userPrefix: title.name, prefixColor: title.prefixColor, usernameColor: title.usernameColor });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

app.get('/api/titles', async (req, res) => {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const user = await User.findById(userId).select('unlockedTitles userPrefix');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({
      titles: TITLE_LIST,
      unlockedTitles: user.unlockedTitles || [],
      equippedTitle: user.userPrefix,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/users-by-id/:userId ─────────────────────────
app.get('/api/users-by-id/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('username userPrefix prefixColor usernameColor');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ username: user.username, userPrefix: user.userPrefix, prefixColor: user.prefixColor, usernameColor: user.usernameColor });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
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