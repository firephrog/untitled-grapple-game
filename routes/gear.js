'use strict';

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { GEAR_REGISTRY } = require('../game/GearRegistry');

// Middleware to verify JWT token
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  const jwt = require('jsonwebtoken');
  const CFG = require('../config');
  
  try {
    const decoded = jwt.verify(token, CFG.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * GET /api/gear
 * Get user's gear data (unlocked and equipped)
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Build gear list with unlocked status and equipped status
    const gearList = Object.entries(GEAR_REGISTRY).map(([id, data]) => ({
      id,
      name: data.name,
      description: data.description,
      rarity: data.rarity,
      damage: data.damage,
      cooldown: data.cooldown,
      image: data.image,
      equipped: user.equippedGear === id,
    }));

    res.json({
      gear: gearList,
      equippedGear: user.equippedGear || 'sniper',
    });
  } catch (err) {
    console.error('[GET /api/gear] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/gear/equip
 * Equip a specific gear
 */
router.post('/equip', verifyToken, async (req, res) => {
  try {
    const { gearId } = req.body;
    if (!gearId) return res.status(400).json({ error: 'gearId required' });
    if (!GEAR_REGISTRY[gearId]) return res.status(400).json({ error: 'Invalid gear' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Update equipped gear
    user.equippedGear = gearId;
    await user.save();

    res.json({ success: true, equippedGear: user.equippedGear });
  } catch (err) {
    console.error('[POST /api/gear/equip] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/gear/unlock
 * Unlock a gear for a user (admin/reward function)
 */
router.post('/unlock', verifyToken, async (req, res) => {
  try {
    const { gearId, targetUserId } = req.body;
    if (!gearId) return res.status(400).json({ error: 'gearId required' });
    if (!GEAR_REGISTRY[gearId]) return res.status(400).json({ error: 'Invalid gear' });

    // Use targetUserId if provided (admin), otherwise use requester's ID
    const userId = targetUserId || req.userId;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ success: true, equippedGear: user.equippedGear });
  } catch (err) {
    console.error('[POST /api/gear/unlock] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
