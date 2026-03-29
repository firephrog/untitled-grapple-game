'use strict';

// ── routes/skins.js ───────────────────────────────────────────────────────────
// Mount in server.js:
//   const { skinRoutes, unlockSkin, unlockGrapple } = require('./routes/skins');
//   app.use('/api/skins', skinRoutes);
// ─────────────────────────────────────────────────────────────────────────────

const { Router } = require('express');
const jwt        = require('jsonwebtoken');
const CFG        = require('../config');
const User       = require('../models/User');
const { SKIN_LIST, GRAPPLE_LIST, getSkin, getGrapple } = require('../skins');

const router = Router();

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token.' });
  try { req.auth = jwt.verify(token, CFG.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token.' }); }
}

// ── Unlock helpers (call from server code, not HTTP) ─────────
async function unlockSkin(userId, skinId) {
  const skin = getSkin(skinId);
  if (skin.id !== skinId) return false;
  await User.findByIdAndUpdate(userId, { $addToSet: { unlockedSkins: skinId } });
  return true;
}

async function unlockGrapple(userId, grappleId) {
  const grapple = getGrapple(grappleId);
  if (grapple.id !== grappleId) return false;
  await User.findByIdAndUpdate(userId, { $addToSet: { unlockedGrapples: grappleId } });
  return true;
}

// ── GET /api/skins ────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth.userId)
    .select('unlockedSkins equippedSkin unlockedGrapples equippedGrapple');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({
    skins:            SKIN_LIST,
    unlockedSkins:    user.unlockedSkins,
    equippedSkin:     user.equippedSkin,
    grapples:         GRAPPLE_LIST,
    unlockedGrapples: user.unlockedGrapples,
    equippedGrapple:  user.equippedGrapple,
  });
});

// ── POST /api/skins/equip ─────────────────────────────────────
router.post('/equip', requireAuth, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: 'skinId required.' });
  const skin = getSkin(skinId);
  if (skin.id !== skinId) return res.status(404).json({ error: 'Unknown skin.' });
  const user = await User.findById(req.auth.userId).select('unlockedSkins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.unlockedSkins.includes(skinId)) return res.status(403).json({ error: 'Skin not unlocked.' });
  await User.findByIdAndUpdate(req.auth.userId, { equippedSkin: skinId });
  res.json({ ok: true, equippedSkin: skinId });
});

// ── POST /api/skins/equip-grapple ────────────────────────────
router.post('/equip-grapple', requireAuth, async (req, res) => {
  const { grappleId } = req.body;
  if (!grappleId) return res.status(400).json({ error: 'grappleId required.' });
  const grapple = getGrapple(grappleId);
  if (grapple.id !== grappleId) return res.status(404).json({ error: 'Unknown grapple.' });
  const user = await User.findById(req.auth.userId).select('unlockedGrapples');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.unlockedGrapples.includes(grappleId)) return res.status(403).json({ error: 'Grapple not unlocked.' });
  await User.findByIdAndUpdate(req.auth.userId, { equippedGrapple: grappleId });
  res.json({ ok: true, equippedGrapple: grappleId });
});

// ── GET /api/skins/player/:username ──────────────────────────
router.get('/player/:username', async (req, res) => {
  const user = await User.findOne({ username: req.params.username })
    .select('equippedSkin equippedGrapple');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const skin    = getSkin(user.equippedSkin);
  const grapple = getGrapple(user.equippedGrapple);
  res.json({
    skinId:    skin.id,
    glb:       skin.glb,
    scale:     skin.scale,
    eyeOffset: skin.eyeOffset,
    grapple: {
      image: grapple.image,
      localImage: grapple.localImage,
      scale: grapple.scale,
      color: grapple.color,
    },
  });
});

module.exports = { skinRoutes: router, unlockSkin, unlockGrapple };