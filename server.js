'use strict';
require('dotenv').config();

const express                = require('express');
const { createServer }       = require('http');
const path                   = require('path');
const { Server }             = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const mongoose               = require('mongoose');  
const bcrypt                 = require('bcryptjs'); 
const jwt                    = require('jsonwebtoken'); 
const crypto                 = require('crypto');

const PrivateRoom     = require('./rooms/PrivateRoom');
const MatchmakingRoom = require('./rooms/MatchmakingRoom');
const RankedRoom      = require('./rooms/RankedRoom');
const FreeForAllRoom  = require('./rooms/FreeForAllRoom');
const { Lobby, getLobby } = require('./rooms/Lobby');
const { skinRoutes, unlockSkin, unlockGrapple, unlockBombSkin } = require('./routes/skins');
const gearRoutes      = require('./routes/gear');
const CFG             = require('./config');
const User            = require('./models/User');
const { TITLES, TITLE_LIST, getTitle } = require('./skins');
const { migrateSkinsStructure }        = require('./migrations/migrateSkinsStructure');
const { getGrpcClient }                = require('./game/GrpcClient');
const { getRedisGameBridge }           = require('./game/RedisGameBridge');
const { writeDiagnostic, getDiagnosticsPath } = require('./lib/DiagnosticsLogger');

const EVENT_LOOP_WARN_MS = Math.max(1, Number(process.env.EVENT_LOOP_WARN_MS || 20));
const EVENT_LOOP_LOG_MS = Math.max(EVENT_LOOP_WARN_MS, Number(process.env.EVENT_LOOP_LOG_MS || 60));


//mango db
mongoose.connect(CFG.MONGO_URI)
  .then(async () => {
    console.log('[STARTUP] MongoDB connected');
    
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
    console.log('[STARTUP] Necessary Migrations done!');
    // Run new skins structure migration
    await migrateSkinsStructure();
  })
  .catch(err => { console.error('[STARTUP] MongoDB:', err); process.exit(1); });
// ── end MongoDB block ────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

// ── Setup middleware first ────────────────────────────────
app.use(express.json());

// Set no-cache headers for skin assets to ensure fresh content is always loaded
app.use((req, res, next) => {
  if (req.path.startsWith('/skins/') || req.path.startsWith('/api/skins/download/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// ── Define API routes BEFORE static file serving ─────────
app.use('/api/skins', skinRoutes);
app.use('/api/gear', gearRoutes);

// ── FFA Maps endpoint ──────────────────────────────────────
app.get('/api/maps/ffa/current', (req, res) => {
  const { FFA_MAPS, randomFFAMapId, getFFAMap } = require('./maps');
  const mapId = randomFFAMapId();
  const map = getFFAMap(mapId);
  if (map) {
    res.json({
      id: map.id,
      name: map.name,
      description: map.description,
      glb: map.glb,
      skyColor: map.skyColor,
      spawnPoints: map.spawnPoints
    });
  } else {
    res.status(404).json({ error: 'No FFA map available' });
  }
});

// ── Test endpoint for debugging ────────────────────────────
app.get('/api/test', (req, res) => {
  res.json({ status: 'OK', message: 'Server is working' });
});

// ── FFA maps list endpoint ────────────────────────────────
app.get('/api/ffa/maps', (req, res) => {
  try {
    console.log('[Server] GET /api/ffa/maps - endpoint called');
    
    let FFA_MAPS;
    try {
      const mapsModule = require('./maps');
      FFA_MAPS = mapsModule.FFA_MAPS;
      console.log('[Server] Loaded maps module, FFA_MAPS keys:', Object.keys(FFA_MAPS));
    } catch (importErr) {
      console.error('[Server] Failed to import maps module:', importErr);
      return res.status(500).json({ error: 'Failed to load maps: ' + importErr.message });
    }
    
    if (!FFA_MAPS || Object.keys(FFA_MAPS).length === 0) {
      console.log('[Server] FFA_MAPS is empty, returning empty array');
      return res.json([]);
    }
    
    const mapsList = Object.values(FFA_MAPS).map(map => {
      console.log('[Server] Processing map:', map.id);
      return {
        id: map.id,
        name: map.name,
        description: map.description,
        glb: map.glb,
        skyColor: map.skyColor,
        spawnPoints: map.spawnPoints
      };
    });
    
    console.log('[Server] Returning', mapsList.length, 'FFA maps');
    res.json(mapsList);
  } catch (err) {
    console.error('[Server] /api/ffa/maps Error:', err);
    res.status(500).json({ error: 'Internal error: ' + err.message });
  }
});

// ── FFA player count endpoint ────────────────────────────
app.get('/api/ffa/playercount', (req, res) => {
  try {
    // For now, just return 0 since gameServer might not be accessible yet
    // The real player count will be fetched from the Colyseus room state
    // This endpoint serves as a placeholder
    res.json({ count: 0 });
  } catch (err) {
    console.error('[FFA playercount] Error:', err.message);
    res.json({ count: 0 });
  }
});

const FIVE_MIN_COOLDOWN_MS = 5 * 60 * 1000;
const supportFallbackCooldown = new Map();
const supportFallbackDaily    = new Map(); // key → { dayStart: Date, count: Number }

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function createRecoveryCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getRetryAfterMs(lastAt, cooldownMs) {
  if (!lastAt) return 0;
  const retryAt = new Date(lastAt).getTime() + cooldownMs;
  return Math.max(0, retryAt - Date.now());
}

async function sendBrevoEmail({ to, subject, htmlContent, textContent }) {
  if (!CFG.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured.');
  }

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': CFG.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: CFG.BREVO_SENDER_NAME,
        email: CFG.BREVO_SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Brevo send failed (${resp.status}): ${body}`);
  }
}

async function sendPasswordRecoveryCodeEmail({ email, username, code, ttlMinutes }) {
  const subject = 'UGG password recovery code';
  const textContent = [
    `Hi ${username},`,
    '',
    `Your password recovery code is: ${code}`,
    `This code expires in ${ttlMinutes} minutes.`,
    '',
    'Did not get a working code or need another email?',
    '- Use Resend code in-game (5 minute cooldown).',
    '- Use Contact support in-game (5 minute cooldown).',
  ].join('\n');

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;">
      <p>Hi <strong>${username}</strong>,</p>
      <p>Your password recovery code is:</p>
      <p style="font-size:28px;letter-spacing:4px;font-weight:700;margin:8px 0;">${code}</p>
      <p>This code expires in ${ttlMinutes} minutes.</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;" />
      <p style="margin:0;">Did not get a working code or need another email?</p>
      <p style="margin:6px 0 0;">Use <strong>Resend code</strong> in-game (5 minute cooldown).</p>
      <p style="margin:6px 0 0;">Use <strong>Contact support</strong> in-game (5 minute cooldown).</p>
    </div>
  `;

  await sendBrevoEmail({ to: email, subject, htmlContent, textContent });
}

async function sendSupportRequestEmail({ username, recoveryEmail, note }) {
  const subject = `UGG support request: ${username || 'unknown-user'}`;
  const textContent = [
    'A player requested password recovery help.',
    '',
    `Username: ${username || 'n/a'}`,
    `Recovery email on file: ${recoveryEmail || 'n/a'}`,
    `Player note: ${note || 'n/a'}`,
    `Requested at: ${new Date().toISOString()}`,
  ].join('\n');

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;">
      <h3 style="margin:0 0 10px;">Password Recovery Support Request</h3>
      <p><strong>Username:</strong> ${username || 'n/a'}</p>
      <p><strong>Recovery email on file:</strong> ${recoveryEmail || 'n/a'}</p>
      <p><strong>Player note:</strong> ${note || 'n/a'}</p>
      <p><strong>Requested at:</strong> ${new Date().toISOString()}</p>
    </div>
  `;

  await sendBrevoEmail({
    to: CFG.SUPPORT_EMAIL,
    subject,
    htmlContent,
    textContent,
  });
}

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
    console.error('[AUTH] Signup error:', err.message);
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
    console.error('[AUTH] Login error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/auth/forgot-password/request', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Username is required.' });

    const user = await User.findOne({ username });
    if (!user || !user.email) {
      return res.json({
        ok: true,
        message: 'If that account has a recovery email, a code has been sent.',
      });
    }

    const code = createRecoveryCode();
    const ttlMinutes = Math.max(1, Number(CFG.PASSWORD_RESET_CODE_TTL_MIN || 10));
    user.passwordReset = user.passwordReset || {};
    user.passwordReset.codeHash = hashRecoveryCode(code);
    user.passwordReset.expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    user.passwordReset.lastSentAt = new Date();
    await user.save();

    await sendPasswordRecoveryCodeEmail({
      email: user.email,
      username: user.username,
      code,
      ttlMinutes,
    });

    res.json({ ok: true, message: 'Recovery code sent.', codeTtlMinutes: ttlMinutes });
  } catch (err) {
    console.error('[AUTH] Forgot password request error:', err.message);
    res.status(500).json({ error: 'Unable to send recovery email right now.' });
  }
});

app.post('/auth/forgot-password/resend', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Username is required.' });

    const user = await User.findOne({ username });
    if (!user || !user.email) {
      return res.json({
        ok: true,
        message: 'If that account has a recovery email, a code has been sent.',
      });
    }

    const retryAfterMs = getRetryAfterMs(user.passwordReset?.lastSentAt, FIVE_MIN_COOLDOWN_MS);
    if (retryAfterMs > 0) {
      return res.status(429).json({
        error: 'You can resend a code every 5 minutes.',
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
      });
    }

    const code = createRecoveryCode();
    const ttlMinutes = Math.max(1, Number(CFG.PASSWORD_RESET_CODE_TTL_MIN || 10));
    user.passwordReset = user.passwordReset || {};
    user.passwordReset.codeHash = hashRecoveryCode(code);
    user.passwordReset.expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    user.passwordReset.lastSentAt = new Date();
    await user.save();

    await sendPasswordRecoveryCodeEmail({
      email: user.email,
      username: user.username,
      code,
      ttlMinutes,
    });

    res.json({ ok: true, message: 'Recovery code re-sent.', codeTtlMinutes: ttlMinutes });
  } catch (err) {
    console.error('[AUTH] Forgot password resend error:', err.message);
    res.status(500).json({ error: 'Unable to resend recovery email right now.' });
  }
});

app.post('/auth/forgot-password/contact-support', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!username) return res.status(400).json({ error: 'Username is required.' });

    const user = await User.findOne({ username });
    const fallbackKey = username.toLowerCase();

    // ── 5-minute cooldown check ──
    const retryAfterMs = user
      ? getRetryAfterMs(user.passwordReset?.lastSupportAt, FIVE_MIN_COOLDOWN_MS)
      : getRetryAfterMs(supportFallbackCooldown.get(fallbackKey), FIVE_MIN_COOLDOWN_MS);

    if (retryAfterMs > 0) {
      return res.status(429).json({
        error: 'You can contact support every 5 minutes.',
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
      });
    }

    // ── 1-per-day limit check ──
    const nowMs = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (user) {
      const pr = user.passwordReset || {};
      const dayStart = pr.supportDayStart ? new Date(pr.supportDayStart).getTime() : 0;
      const sameDay  = (nowMs - dayStart) < ONE_DAY_MS;
      if (sameDay && (pr.supportCountToday || 0) >= 1) {
        const retryDaySec = Math.ceil((dayStart + ONE_DAY_MS - nowMs) / 1000);
        return res.status(429).json({
          error: 'You can only contact support once per day.',
          retryAfterSec: retryDaySec,
        });
      }
    } else {
      const daily = supportFallbackDaily.get(fallbackKey);
      if (daily) {
        const sameDay = (nowMs - new Date(daily.dayStart).getTime()) < ONE_DAY_MS;
        if (sameDay && daily.count >= 1) {
          const retryDaySec = Math.ceil((new Date(daily.dayStart).getTime() + ONE_DAY_MS - nowMs) / 1000);
          return res.status(429).json({
            error: 'You can only contact support once per day.',
            retryAfterSec: retryDaySec,
          });
        }
      }
    }

    await sendSupportRequestEmail({
      username,
      recoveryEmail: user?.email || null,
      note,
    });

    if (user) {
      user.passwordReset = user.passwordReset || {};
      user.passwordReset.lastSupportAt = new Date();
      const pr = user.passwordReset;
      const dayStart = pr.supportDayStart ? new Date(pr.supportDayStart).getTime() : 0;
      if ((nowMs - dayStart) >= ONE_DAY_MS) {
        pr.supportDayStart   = new Date();
        pr.supportCountToday = 1;
      } else {
        pr.supportCountToday = (pr.supportCountToday || 0) + 1;
      }
      await user.save();
    } else {
      const daily = supportFallbackDaily.get(fallbackKey);
      const dayStart = daily ? new Date(daily.dayStart).getTime() : 0;
      if ((nowMs - dayStart) >= ONE_DAY_MS) {
        supportFallbackDaily.set(fallbackKey, { dayStart: new Date(), count: 1 });
      } else {
        daily.count += 1;
      }
      supportFallbackCooldown.set(fallbackKey, new Date());
    }

    res.json({ ok: true, message: 'Support request sent. We will reach out soon.' });
  } catch (err) {
    console.error('[AUTH] Contact support error:', err.message);
    res.status(500).json({ error: 'Unable to contact support right now.' });
  }
});

app.post('/auth/forgot-password/verify', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!username || !code || !newPassword) {
      return res.status(400).json({ error: 'Username, code, and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be 8+ characters.' });
    }

    const user = await User.findOne({ username });
    if (!user || !user.passwordReset?.codeHash || !user.passwordReset?.expiresAt) {
      return res.status(400).json({ error: 'Invalid or expired recovery code.' });
    }

    if (new Date(user.passwordReset.expiresAt).getTime() < Date.now()) {
      user.passwordReset.codeHash = null;
      user.passwordReset.expiresAt = null;
      await user.save();
      return res.status(400).json({ error: 'Invalid or expired recovery code.' });
    }

    if (hashRecoveryCode(code) !== user.passwordReset.codeHash) {
      return res.status(400).json({ error: 'Invalid or expired recovery code.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordReset.codeHash = null;
    user.passwordReset.expiresAt = null;
    await user.save();

    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    console.error('[AUTH] Forgot password verify error:', err.message);
    res.status(500).json({ error: 'Unable to reset password right now.' });
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
    console.error('[AUTH] Auth error:', err.message);
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
    console.error('[SAVE] Save error:', err.message);
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
    console.error('[USER] Find user error:', err.message);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

//get user by ID (with ELO for ranked mode)
app.get('/api/users-by-id/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('username elo userPrefix usernameColor prefixColor');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) {
    console.error('[USER] Find user by ID error:', err.message);
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
    console.error('[FRIEND] Friend request error:', err.message);
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

// ── LEADERBOARD ROUTES ───────────────────────────────────
app.get('/api/leaderboard/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const LIMIT = 20;

    let sortField = 'wins';
    switch (category) {
      case 'wins':
        sortField = 'wins';
        break;
      case 'deaths':
        sortField = 'deaths';
        break;
      case 'ranked':
        sortField = 'elo';
        break;
      default:
        return res.status(400).json({ error: 'Invalid category. Use: wins, deaths, or ranked' });
    }

    const leaderboard = await User.find({})
      .select('username elo wins deaths userPrefix usernameColor prefixColor')
      .sort({ [sortField]: -1 })
      .limit(LIMIT)
      .lean();

    // Add rank number to each entry
    const rankedPlayers = leaderboard.map((player, index) => ({
      rank: index + 1,
      username: player.username,
      elo: player.elo || 0,
      wins: player.wins || 0,
      deaths: player.deaths || 0,
      userPrefix: player.userPrefix || 'player',
      usernameColor: player.usernameColor || '#ffffff',
      prefixColor: player.prefixColor || '#bababa',
    }));

    res.json({
      category,
      leaderboard: rankedPlayers,
      count: rankedPlayers.length,
    });
  } catch (err) {
    console.error('Leaderboard error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Get user's current rank in a category
app.get('/api/leaderboard/:category/user-rank', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });

  try {
    const { userId } = jwt.verify(token, CFG.JWT_SECRET);
    const { category } = req.params;

    let sortField = 'wins';
    switch (category) {
      case 'wins':
        sortField = 'wins';
        break;
      case 'deaths':
        sortField = 'deaths';
        break;
      case 'ranked':
        sortField = 'elo';
        break;
      default:
        return res.status(400).json({ error: 'Invalid category' });
    }

    const user = await User.findById(userId).select(`username elo wins deaths userPrefix usernameColor prefixColor ${sortField}`);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Count how many users are ranked higher
    const higherRankedCount = await User.countDocuments({
      [sortField]: { $gt: user[sortField] }
    });

    res.json({
      rank: higherRankedCount + 1,
      username: user.username,
      elo: user.elo || 0,
      wins: user.wins || 0,
      deaths: user.deaths || 0,
      userPrefix: user.userPrefix || 'player',
      usernameColor: user.usernameColor || '#ffffff',
      prefixColor: user.prefixColor || '#bababa',
      value: user[sortField] || 0,
    });
  } catch (err) {
    console.error('User rank error:', err.message);
    res.status(401).json({ error: 'Invalid token.' });
  }
});

// ── Serve static files AFTER all API routes ──────────────
// Serve skin models and assets from skins/models directory
const SKINS_DIR = path.resolve(process.cwd(), 'skins/models');
app.use('/skins', express.static(SKINS_DIR));

// Serve public files last (index.html, etc)
app.use(express.static(PUBLIC_DIR));

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Accept connections forwarded by Cloudflare tunnel / reverse proxies.
    // Cloudflare sends the real client IP in x-forwarded-for, not the socket IP.
    verifyClient: () => true,
  }),
});

// Store gameServer in app for access in routes
app.gameServer = gameServer;

gameServer.define('private',     PrivateRoom);
gameServer.define('matchmaking', MatchmakingRoom, {
  filterBy: ['ratingMin', 'ratingMax'],
});
gameServer.define('ranked',      RankedRoom, {
  filterBy: ['ratingMin', 'ratingMax'],
});
gameServer.define('ffa',         FreeForAllRoom);
gameServer.define('lobby', Lobby);

// ── Event loop stall detector ─────────────────────────────────────────────
// Fires whenever the Node.js event loop is blocked for > 20ms.
// This catches GC pauses, synchronous CPU work, WASM stalls, etc. — anything
// that prevents callbacks (including the ping handler) from running on time.
{
  const PROBE_INTERVAL = 50;   // fire every 50ms
  const WARN_THRESHOLD = EVENT_LOOP_WARN_MS;
  let _lastLoggedAt = 0;
  let _lastProbe = Date.now();
  setInterval(() => {
    const now   = Date.now();
    const stall = now - _lastProbe - PROBE_INTERVAL;
    if (stall > WARN_THRESHOLD) {
      console.warn(`[EventLoop stall] ${stall}ms — event loop was blocked`);
      if (stall >= EVENT_LOOP_LOG_MS && (now - _lastLoggedAt) >= 1000) {
        _lastLoggedAt = now;
        writeDiagnostic('event_loop_stall', {
          stallMs: stall,
          thresholdMs: EVENT_LOOP_LOG_MS,
          rssBytes: process.memoryUsage().rss,
          heapUsedBytes: process.memoryUsage().heapUsed,
        });
      }
    }
    _lastProbe = now;
  }, PROBE_INTERVAL).unref(); // unref so it doesn't keep process alive
}

process.on('uncaughtException', (err) => {
  writeDiagnostic('process_crash', {
    reason: 'uncaughtException',
    message: err?.message || String(err),
    stack: err?.stack || '',
  });
  console.error('[FATAL] uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  writeDiagnostic('process_crash', {
    reason: 'unhandledRejection',
    message: reason?.message || String(reason),
    stack: reason?.stack || '',
  });
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
});

process.on('SIGINT', () => {
  writeDiagnostic('process_signal', { signal: 'SIGINT' });
  process.exit(0);
});

process.on('SIGTERM', () => {
  writeDiagnostic('process_signal', { signal: 'SIGTERM' });
  process.exit(0);
});

httpServer.listen(CFG.PORT, () => {
  console.log(`[STARTUP] Untitled Grapple Game V0.6`);
  console.log(`[STARTUP] Server running \u2192 http://localhost:${CFG.PORT}`);
  console.log(`[STARTUP] API routes registered:`);
  console.log(`  - /api/ffa/maps`);
  console.log(`  - /api/ffa/playercount`);
  console.log(`  - /api/skins/*`);
  console.log(`  - /auth/*`);

  // Connect to gRPC game server and Redis bridge.
  getGrpcClient('pvp');
  getGrpcClient('ffa');
  const bridge = getRedisGameBridge();
  bridge.connect()
    .then(() => console.log('[STARTUP] Redis game bridge connected'))
    .catch(e  => console.error('[STARTUP] Redis bridge connection error:', e));
  console.log(`[STARTUP] gRPC PVP backend: ${process.env.CPP_SERVER_ADDR || '127.0.0.1:50051'}`);
  console.log(`[STARTUP] gRPC FFA backend: ${process.env.FFA_CPP_SERVER_ADDR || process.env.CPP_SERVER_ADDR || '127.0.0.1:50051'}`);
  console.log('[STARTUP] Game simulation: C++ server (Rapier3D via cxx bridge)');
  console.log(`[STARTUP] Diagnostics log: ${getDiagnosticsPath()}`);
  writeDiagnostic('process_start', {
    port: CFG.PORT,
    grpcPvp: process.env.CPP_SERVER_ADDR || '127.0.0.1:50051',
    grpcFfa: process.env.FFA_CPP_SERVER_ADDR || process.env.CPP_SERVER_ADDR || '127.0.0.1:50051',
  });
});