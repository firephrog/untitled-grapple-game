'use strict';

// ── routes/skins.js ───────────────────────────────────────────────────────────
// Mount in server.js:
//   const { skinRoutes, unlockSkin, unlockGrapple, unlockBombSkin } = require('./routes/skins');
//   app.use('/api/skins', skinRoutes);
//
// Skins are now stored as nested objects:
//   user.skins.player[skinId] = { unlocked, equipped }
//   user.skins.grapples[grappleId] = { unlocked, equipped }
//   user.skins.bombs[bombSkinId] = { unlocked, equipped }
// ─────────────────────────────────────────────────────────────────────────────

const { Router } = require('express');
const jwt        = require('jsonwebtoken');
const CFG        = require('../config');
const User       = require('../models/User');
const SkinCache  = require('../lib/SkinCache');
const { SKIN_LIST, GRAPPLE_LIST, BOMB_SKIN_LIST, getSkin, getGrapple, getBombSkin } = require('../skins');

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
/**
 * Unlock a player skin for a user
 * @param {string} userId - MongoDB user ID
 * @param {string} skinId - Skin ID to unlock
 */
async function unlockSkin(userId, skinId) {
  const skin = getSkin(skinId);
  if (skin.id !== skinId) return false;
  await User.findByIdAndUpdate(userId, {
    $set: { [`skins.player.${skinId}`]: { unlocked: true, equipped: false } }
  });
  return true;
}

/**
 * Unlock a grapple hook skin for a user
 * @param {string} userId - MongoDB user ID
 * @param {string} grappleId - Grapple ID to unlock
 */
async function unlockGrapple(userId, grappleId) {
  const grapple = getGrapple(grappleId);
  if (grapple.id !== grappleId) return false;
  await User.findByIdAndUpdate(userId, {
    $set: { [`skins.grapples.${grappleId}`]: { unlocked: true, equipped: false } }
  });
  return true;
}

/**
 * Unlock a bomb skin for a user
 * @param {string} userId - MongoDB user ID
 * @param {string} bombSkinId - Bomb skin ID to unlock
 */
async function unlockBombSkin(userId, bombSkinId) {
  const bombSkin = getBombSkin(bombSkinId);
  if (bombSkin.id !== bombSkinId) return false;
  await User.findByIdAndUpdate(userId, {
    $set: { [`skins.bombs.${bombSkinId}`]: { unlocked: true, equipped: false } }
  });
  return true;
}

// ── GET /api/skins ────────────────────────────────────────────
// Returns all skins and the user's ownership/equipped status
router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth.userId)
    .select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Build response with ownership and equipped status
  const playerSkins = SKIN_LIST.map(skin => {
    const userSkin = user.skins?.player?.[skin.id] || {};
    return {
      ...skin,
      unlocked: userSkin.unlocked || false,
      equipped: userSkin.equipped || false,
    };
  });

  const grappleSkins = GRAPPLE_LIST.map(grapple => {
    const userGrapple = user.skins?.grapples?.[grapple.id] || {};
    return {
      ...grapple,
      unlocked: userGrapple.unlocked || false,
      equipped: userGrapple.equipped || false,
    };
  });

  const bombSkins = BOMB_SKIN_LIST.map(bomb => {
    const userBomb = user.skins?.bombs?.[bomb.id] || {};
    return {
      ...bomb,
      unlocked: userBomb.unlocked || false,
      equipped: userBomb.equipped || false,
    };
  });

  res.json({
    skins: playerSkins,
    grapples: grappleSkins,
    bombs: bombSkins,
    // Legacy fields for backward compatibility
    unlockedSkins: playerSkins.filter(s => s.unlocked).map(s => s.id),
    equippedSkin: playerSkins.find(s => s.equipped)?.id || 'default',
    unlockedGrapples: grappleSkins.filter(g => g.unlocked).map(g => g.id),
    equippedGrapple: grappleSkins.find(g => g.equipped)?.id || 'default',
    unlockedBombs: bombSkins.filter(b => b.unlocked).map(b => b.id),
    equippedBomb: bombSkins.find(b => b.equipped)?.id || 'default',
  });
});

// ── GET /api/skins/description/:skinId ────────────────────────
router.get('/description/:skinId', async (req, res) => {
  const skin = getSkin(req.params.skinId);
  if (skin.id !== req.params.skinId) return res.status(404).json({ error: 'Unknown skin.' });
  res.json({ name: skin.name, description: skin.description });
});

// ── POST /api/skins/equip ─────────────────────────────────────
router.post('/equip', requireAuth, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: 'skinId required.' });
  const skin = getSkin(skinId);
  if (skin.id !== skinId) return res.status(404).json({ error: 'Unknown skin.' });
  
  const user = await User.findById(req.auth.userId).select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.skins?.player?.[skinId]?.unlocked) {
    return res.status(403).json({ error: 'Skin not unlocked.' });
  }
  
  // Unequip all player skins, then equip this one
  const updateOps = {};
  for (const id in user.skins.player) {
    updateOps[`skins.player.${id}.equipped`] = false;
  }
  updateOps[`skins.player.${skinId}.equipped`] = true;
  
  await User.findByIdAndUpdate(req.auth.userId, { $set: updateOps });
  res.json({ ok: true, equippedSkin: skinId });
});

// ── POST /api/skins/equip-grapple ────────────────────────────
router.post('/equip-grapple', requireAuth, async (req, res) => {
  const { grappleId } = req.body;
  if (!grappleId) return res.status(400).json({ error: 'grappleId required.' });
  const grapple = getGrapple(grappleId);
  if (grapple.id !== grappleId) return res.status(404).json({ error: 'Unknown grapple.' });
  
  const user = await User.findById(req.auth.userId).select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.skins?.grapples?.[grappleId]?.unlocked) {
    return res.status(403).json({ error: 'Grapple not unlocked.' });
  }
  
  // Unequip all grapples, then equip this one
  const updateOps = {};
  for (const id in user.skins.grapples) {
    updateOps[`skins.grapples.${id}.equipped`] = false;
  }
  updateOps[`skins.grapples.${grappleId}.equipped`] = true;
  
  await User.findByIdAndUpdate(req.auth.userId, { $set: updateOps });
  res.json({ ok: true, equippedGrapple: grappleId });
});

// ── POST /api/skins/equip-bomb ───────────────────────────────
router.post('/equip-bomb', requireAuth, async (req, res) => {
  const { bombSkinId } = req.body;
  if (!bombSkinId) return res.status(400).json({ error: 'bombSkinId required.' });
  const bombSkin = getBombSkin(bombSkinId);
  if (bombSkin.id !== bombSkinId) return res.status(404).json({ error: 'Unknown bomb skin.' });
  
  const user = await User.findById(req.auth.userId).select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.skins?.bombs?.[bombSkinId]?.unlocked) {
    return res.status(403).json({ error: 'Bomb skin not unlocked.' });
  }
  
  // Unequip all bomb skins, then equip this one
  const updateOps = {};
  for (const id in user.skins.bombs) {
    updateOps[`skins.bombs.${id}.equipped`] = false;
  }
  updateOps[`skins.bombs.${bombSkinId}.equipped`] = true;
  
  await User.findByIdAndUpdate(req.auth.userId, { $set: updateOps });
  res.json({ ok: true, equippedBombSkin: bombSkinId });
});

// ── GET /api/skins/player/:username ──────────────────────────
// Get opponent's equipped skins for gameplay
router.get('/player/:username', async (req, res) => {
  const user = await User.findOne({ username: req.params.username })
    .select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  
  // Find equipped player skin
  let equippedSkinId = 'default';
  if (user.skins?.player) {
    for (const [skinId, skinData] of Object.entries(user.skins.player)) {
      if (skinData.equipped) {
        equippedSkinId = skinId;
        break;
      }
    }
  }
  
  // Find equipped grapple
  let equippedGrappleId = 'default';
  if (user.skins?.grapples) {
    for (const [grappleId, grappleData] of Object.entries(user.skins.grapples)) {
      if (grappleData.equipped) {
        equippedGrappleId = grappleId;
        break;
      }
    }
  }
  
  // Find equipped bomb skin
  let equippedBombSkinId = 'default';
  if (user.skins?.bombs) {
    for (const [bombId, bombData] of Object.entries(user.skins.bombs)) {
      if (bombData.equipped) {
        equippedBombSkinId = bombId;
        break;
      }
    }
  }
  
  const skin    = getSkin(equippedSkinId);
  const grapple = getGrapple(equippedGrappleId);
  const bombSkin = getBombSkin(equippedBombSkinId);
  
  res.json({
    skinId:    skin.id,
    glb:       skin.glb ? `/api/skins/download/player/${equippedSkinId}` : null,
    scale:     skin.scale,
    eyeOffset: skin.eyeOffset,
    grapple: {
      image: grapple.image,
      localImage: grapple.localImage,
      scale: grapple.scale,
      color: grapple.color,
    },
    bombSkin: {
      id: bombSkin.id,
      glb:   bombSkin.glb ? `/api/skins/download/bomb/${equippedBombSkinId}` : null,
      scale: bombSkin.scale,
    },
  });
});

// ── POST /api/skins/preload ──────────────────────────────────
// Preload player's unlocked skins on login
// Called from client after authentication
router.post('/preload', requireAuth, async (req, res) => {
  const user = await User.findById(req.auth.userId).select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  
  // Collect all unlocked skin IDs
  const playerSkinIds = [];
  const grappleSkinIds = [];
  const bombSkinIds = [];
  
  if (user.skins?.player) {
    for (const [id, data] of Object.entries(user.skins.player)) {
      if (data.unlocked) playerSkinIds.push(id);
    }
  }
  
  if (user.skins?.grapples) {
    for (const [id, data] of Object.entries(user.skins.grapples)) {
      if (data.unlocked) grappleSkinIds.push(id);
    }
  }
  
  if (user.skins?.bombs) {
    for (const [id, data] of Object.entries(user.skins.bombs)) {
      if (data.unlocked) bombSkinIds.push(id);
    }
  }
  
  // Preload them (synchronously on request, not async)
  SkinCache.preloadSkins(playerSkinIds, 'player');
  SkinCache.preloadSkins(grappleSkinIds, 'grapple');
  SkinCache.preloadSkins(bombSkinIds, 'bomb');
  
  res.json({ 
    ok: true, 
    loaded: {
      playerSkins: playerSkinIds.length,
      grapples: grappleSkinIds.length,
      bombs: bombSkinIds.length,
    }
  });
});

// ── POST /api/skins/load-opponent ─────────────────────────────
// Load opponent's equipped skin when entering match
// Call with opponent's username
router.post('/load-opponent', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required.' });
  
  const user = await User.findOne({ username }).select('skins');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  
  // Find equipped skins
  let equippedPlayerId = 'default';
  let equippedBombId = 'default';
  
  if (user.skins?.player) {
    for (const [id, data] of Object.entries(user.skins.player)) {
      if (data.equipped) { equippedPlayerId = id; break; }
    }
  }
  
  if (user.skins?.bombs) {
    for (const [id, data] of Object.entries(user.skins.bombs)) {
      if (data.equipped) { equippedBombId = id; break; }
    }
  }
  
  // Preload them
  SkinCache.getSkin(equippedPlayerId, 'player');
  SkinCache.getSkin(equippedBombId, 'bomb');
  
  res.json({ 
    ok: true, 
    loaded: [equippedPlayerId, equippedBombId]
  });
});

// ── POST /api/skins/unload-opponent ───────────────────────────
// Unload opponent's skin when leaving match
// Only unload if the current player doesn't have it equipped
router.post('/unload-opponent', requireAuth, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required.' });
  
  const opponent = await User.findOne({ username }).select('skins');
  if (!opponent) return res.status(404).json({ error: 'User not found.' });
  
  const player = await User.findById(req.auth.userId).select('skins');
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  
  // Find opponent's equipped skins
  let oppPlayerId = 'default';
  let oppBombId = 'default';
  
  if (opponent.skins?.player) {
    for (const [id, data] of Object.entries(opponent.skins.player)) {
      if (data.equipped) { oppPlayerId = id; break; }
    }
  }
  
  if (opponent.skins?.bombs) {
    for (const [id, data] of Object.entries(opponent.skins.bombs)) {
      if (data.equipped) { oppBombId = id; break; }
    }
  }
  
  // Only unload if player doesn't have them
  let unloadedSkins = [];
  
  if (!player.skins?.player?.[oppPlayerId]?.unlocked) {
    SkinCache.unloadSkin(oppPlayerId, 'player');
    unloadedSkins.push(`player:${oppPlayerId}`);
  }
  
  if (!player.skins?.bombs?.[oppBombId]?.unlocked) {
    SkinCache.unloadSkin(oppBombId, 'bomb');
    unloadedSkins.push(`bomb:${oppBombId}`);
  }
  
  res.json({ 
    ok: true, 
    unloaded: unloadedSkins.length > 0 ? unloadedSkins : 'none'
  });
});

// ── GET /api/skins/cache-stats ───────────────────────────────
// Get cache statistics (for debugging)
router.get('/cache-stats', (req, res) => {
  res.json(SkinCache.getStats());
});

// ── GET /api/skins/download/:type/:skinId ────────────────────
// Download skin GLB file on-demand from cache (loaded from disk on first request)
// type: 'player', 'grapple', or 'bomb'
// Maps to: /skins/{players|grapples|bombs}/{skinId}.glb
router.get('/download/:type/:skinId', async (req, res) => {
  const { type, skinId } = req.params;
  const fs = require('fs');
  const path = require('path');
  
  let skinDef = null;
  let modelSubdir = '';
  
  if (type === 'player') {
    skinDef = getSkin(skinId);
    if (skinDef.id !== skinId) return res.status(404).json({ error: 'Unknown player skin.' });
    modelSubdir = 'players';
  } else if (type === 'grapple') {
    skinDef = getGrapple(skinId);
    if (skinDef.id !== skinId) return res.status(404).json({ error: 'Unknown grapple.' });
    modelSubdir = 'grapples';
  } else if (type === 'bomb') {
    skinDef = getBombSkin(skinId);
    if (skinDef.id !== skinId) return res.status(404).json({ error: 'Unknown bomb skin.' });
    modelSubdir = 'bombs';
  } else {
    return res.status(400).json({ error: 'Invalid skin type.' });
  }
  
  // Check if skin has a GLB file (some may not - e.g., bomb default is a fallback sphere)
  if (!skinDef.glb) {
    return res.json({ 
      message: 'No GLB file (will use fallback)', 
      fallback: true 
    });
  }
  
  // Construct file path: skins/models/{type}/{skinId}.glb
  const filePath = path.join(process.cwd(), 'skins', 'models', modelSubdir, `${skinId}.glb`);
  
  // Security check: ensure the resolved path is within the skins/models directory
  const skinsDir = path.join(process.cwd(), 'skins', 'models');
  if (!filePath.startsWith(skinsDir)) {
    return res.status(400).json({ error: 'Invalid path.' });
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Skin file not found.' });
  }
  
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
  res.sendFile(filePath);
});

// ── title api ─────────────────────────────────────────────────
router.get('/titles/:username', async (req, res) => {
  const user = await User.findOne({ username: req.params.username })
    .select('unlockedTitles userPrefix prefixColor usernameColor');
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { TITLE_LIST } = require('../skins');
  res.json({
    titles:            TITLE_LIST,
    unlockedTitles:    user.unlockedTitles,
    equippedTitle:     user.userPrefix,
    prefixColor:       user.prefixColor,
    usernameColor:     user.usernameColor,
  });
});

// ── POST /api/skins/check-unlocks ────────────────────────────
// Check and unlock any earned skins/titles based on current stats
// Called after game ends to notify client of new unlocks
router.post('/check-unlocks', requireAuth, async (req, res) => {
  try {
    const newlyUnlocked = await checkAndUnlockRewards(req.auth.userId);
    res.json({ 
      ok: true, 
      newlyUnlocked,
      count: newlyUnlocked.length 
    });
  } catch (err) {
    console.error('Check unlocks error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Check and unlock skins/titles based on stats ──────────────
/**
 * Check user's stats and unlock any earned skins/titles
 * Returns list of newly unlocked items
 * @param {string} userId - MongoDB user ID
 * @returns {Promise<Array>} Array of newly unlocked items with type and id
 */
async function checkAndUnlockRewards(userId) {
  const user = await User.findById(userId).select('wins deaths unlockedTitles skins');
  if (!user) return [];

  const newlyUnlocked = [];
  const updates = {};

  // ── Title unlock criteria based on stats ──────────────────────
  const titleCriteria = [
    // Format: { titleId, condition }
    { titleId: 'sweat', condition: user.wins >= 50, name: 'Sweat' },
    { titleId: 'champion', condition: user.wins >= 250, name: 'Champion' },
    // Other titles are unlocked via database edit, as they are only given by phrog.
  ];

  const bombCriteria = [
    // Format: { bombSkinId, condition }
    { bombSkinId: 'c4', condition: user.deaths >= 100, name: 'C4' },
  ];

  // Check and unlock titles
  for (const criterion of titleCriteria) {
    if (criterion.condition && !user.unlockedTitles.includes(criterion.titleId)) {
      user.unlockedTitles.push(criterion.titleId);
      newlyUnlocked.push({
        type: 'title',
        id: criterion.titleId,
        name: criterion.name,
      });
      updates.$addToSet = updates.$addToSet || {};
      updates.$addToSet.unlockedTitles = criterion.titleId;
    }
  }

  // Check and unlock bomb skins
  for (const criterion of bombCriteria) {
    if (criterion.condition && !user.skins?.bombs?.[criterion.bombSkinId]?.unlocked) {
      newlyUnlocked.push({
        type: 'bomb',
        id: criterion.bombSkinId,
        name: criterion.name,
      });
      updates.$set = updates.$set || {};
      updates.$set[`skins.bombs.${criterion.bombSkinId}.unlocked`] = true;
    }
  }

  // Apply updates to database
  if (Object.keys(updates).length > 0) {
    await User.findByIdAndUpdate(userId, updates);
  }

  return newlyUnlocked;
}

module.exports = { skinRoutes: router, unlockSkin, unlockGrapple, unlockBombSkin, checkAndUnlockRewards };