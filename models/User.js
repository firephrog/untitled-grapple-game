'use strict';

// ── models/User.js ────────────────────────────────────────────────────────────
// Mongoose schema for player accounts.
//
// Skins are now stored as nested object with categories:
//   skins.player       - player body skins { [skinId]: { unlocked, equipped } }
//   skins.grapples     - grapple hook skins { [grappleId]: { unlocked, equipped } }
//   skins.bombs        - bomb skins { [bombSkinId]: { unlocked, equipped } }
//
// Migration: Old fields (equippedSkin, unlockedSkins, etc.) are kept for
// backward compatibility but will be deprecated.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  email:        { type: String, default: null },

  // ── Stats ───────────────────────────────────────────────────
  wins:   { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  elo:    { type: Number, default: 100 }, 

  // ── Cosmetics ───────────────────────────────────────────────
  userPrefix:    { type: String, default: 'player' },
  prefixColor:   { type: String, default: '#bababa' },
  usernameColor: { type: String, default: '#ffffff' },
  unlockedTitles: { type: [String], default: () => ['player'] },

  // ── Skins (new nested structure) ────────────────────────────
  skins: {
    player: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ default: { unlocked: true, equipped: true } })
    },
    grapples: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ default: { unlocked: true, equipped: true } })
    },
    bombs: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ default: { unlocked: true, equipped: true } })
    }
  },

  // ── Legacy fields (kept for backward compatibility / migration) ───
  // equippedSkin:  { type: String, default: 'default' },
  // unlockedSkins: { type: [String], default: () => ['default'] },
  // equippedGrapple: { type: String, default: 'default' },
  // unlockedGrapples:{ type: [String], default: () => ['default'] },

  // ── Gear ────────────────────────────────────────────────────
  equippedGear: { type: String, default: 'sniper' },

  // ── Presence ────────────────────────────────────────────────
  status:   { type: String, default: 'Offline' },

  // ── Settings ────────────────────────────────────────────────
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },

  // ── Social ──────────────────────────────────────────────────
  friends: {
    requests: { type: mongoose.Schema.Types.Mixed, default: {} },
    list:     { type: mongoose.Schema.Types.Mixed, default: {} },
  },
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);