'use strict';

// ── routes/skins.js ───────────────────────────────────────────────────────────
// Express router for skin-related API endpoints.
//
// Mount in server.js:
//   const { skinRoutes } = require('./routes/skins');
//   app.use('/api/skins', skinRoutes);
//
// To grant a skin from anywhere else in server code (achievements, admin, etc.):
//   const { unlockSkin } = require('./routes/skins');
//   await unlockSkin(userId, 'ghost');
// ─────────────────────────────────────────────────────────────────────────────

const { Router } = require('express');
const jwt        = require('jsonwebtoken');
const CFG        = require('../config');
const User       = require('../models/User');
const { SKIN_LIST, getSkin } = require('../skins');

const router = Router();

// ── Reusable unlock helper ────────────────────────────────────
/**
 * Grant a skin to a user. Safe to call multiple times (uses $addToSet).
 * @param {string|ObjectId} userId  MongoDB user _id
 * @param {string}          skinId  must exist in skins/index.js
 * @returns {Promise<boolean>}  true if skin exists, false if unknown id
 */
async function unlockSkin(userId, skinId) {
  const skin = getSkin(skinId);
  if (skin.id !== skinId) return false;   // unknown skin — getSkin fell back to default
  await User.findByIdAndUpdate(userId, { $addToSet: { unlockedSkins: skinId } });
  return true;
}

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    req.auth = jwt.verify(token, CFG.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

// ── GET /api/skins ────────────────────────────────────────────
// Returns the skin catalogue + the calling player's ownership state.
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth.userId).select('unlockedSkins equippedSkin');
  if (!user) return res.status(404).json({ error: 'User not found.' });

  res.json({
    skins:        SKIN_LIST,
    unlockedSkins: user.unlockedSkins,
    equippedSkin:  user.equippedSkin,
  });
});

// ── POST /api/skins/equip ─────────────────────────────────────
// Body: { skinId: string }
// Sets the player's active skin. Player must already own it.
router.post('/equip', requireAuth, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId || typeof skinId !== 'string') {
    return res.status(400).json({ error: 'skinId required.' });
  }

  const skin = getSkin(skinId);
  if (skin.id !== skinId) {
    return res.status(404).json({ error: 'Unknown skin.' });
  }

  const user = await User.findById(req.auth.userId).select('unlockedSkins');
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (!user.unlockedSkins.includes(skinId)) {
    return res.status(403).json({ error: 'Skin not unlocked.' });
  }

  await User.findByIdAndUpdate(req.auth.userId, { equippedSkin: skinId });
  res.json({ ok: true, equippedSkin: skinId });
});

// ── GET /api/skins/player/:username ──────────────────────────
// Returns equipped skin data for any player by username.
// Used by the room to look up opponent skin before game start.
router.get('/player/:username', async (req, res) => {
  const user = await User.findOne({ username: req.params.username })
    .select('equippedSkin');
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const skin = getSkin(user.equippedSkin);
  res.json({
    skinId:    skin.id,
    glb:       skin.glb,
    scale:     skin.scale,
    eyeOffset: skin.eyeOffset,
  });
});

module.exports = { skinRoutes: router, unlockSkin };
