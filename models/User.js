'use strict';

// ── models/User.js ────────────────────────────────────────────────────────────
// Mongoose schema for player accounts.
//
// Skin fields:
//   equippedSkin  - skin id currently worn (defaults to 'default')
//   unlockedSkins - array of skin ids the player owns.
//                   Starts with only 'default'. All other skins are granted
//                   explicitly via the unlockSkin() helper in routes/skins.js.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  email:        { type: String, default: null },

  // ── Stats ───────────────────────────────────────────────────
  wins:   { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },

  // ── Cosmetics ───────────────────────────────────────────────
  userPrefix:    { type: String, default: 'player' },
  prefixColor:   { type: String, default: '#bababa' },
  usernameColor: { type: String, default: '#ffffff' },
  unlockedTitles: { type: [String], default: () => ['player'] },

  equippedSkin:  { type: String, default: 'default' },
  unlockedSkins: { type: [String], default: () => ['default'] },
  equippedGrapple: { type: String, default: 'default' },
  unlockedGrapples:{ type: [String], default: () => ['default'] },

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