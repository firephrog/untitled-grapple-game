'use strict';

// ── config.js ─────────────────────────────────────────────────────────────────
// Single source of truth for every tunable constant.
// Change values here — restart server — no rebuild needed.
//
// FORCE vs IMPULSE note:
//   addForce()     → called every tick (60/s), so values should be small
//   applyImpulse() → called once (on explosion), so values can be larger
//   setLinvel()    → directly sets velocity, frame-rate independent
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {

  // ── Server ─────────────────────────────────────────────────
  PORT:       process.env.PORT || 3000,

  // ── Database & Auth ────────────────────────────────────────  ← ADD
  MONGO_URI:  process.env.MONGO_URI  || 'mongodb+srv://phrog:basicTestPass@cluster0.t8grp4o.mongodb.net/?appName=Cluster0',
  JWT_SECRET: process.env.JWT_SECRET || 'DeezNuts420',

  // ── Room limits ────────────────────────────────────────────
  PRIVATE_MAX_CLIENTS:      2,
  MATCHMAKING_MAX_CLIENTS:  2,

  // ── Physics ────────────────────────────────────────────────
  TICK_RATE:       60,          // Hz – physics simulation rate
  PATCH_RATE_MS:   16,          // ms – Colyseus state delta rate (slightly up from 10 for better perf)
  GRAVITY:         -20,

  // ── Map ────────────────────────────────────────────────────
  BLOCK_COUNT:     30,
  BLOCK_SPREAD:    60,          // XZ spread in units
  BLOCK_MIN_Y:     5,
  BLOCK_MAX_Y:     25,

  // ── Player ─────────────────────────────────────────────────
  PLAYER_RADIUS:   1,
  PLAYER_MASS:     1,
  WALK_SPEED:      12,          // units/s — set directly via setLinvel, no DT needed
  JUMP_VEL:        10,          // units/s — set directly via setLinvel, no DT needed
  LINEAR_DAMPING:  0.1,
  SPAWN_X_HOST:    -20,
  SPAWN_X_GUEST:    20,
  SPAWN_Y:          5,
  VOID_Y:          -200,  // deep enough that you won't die during spawn debugging
  START_HEALTH:    100,

  // ── Grapple ────────────────────────────────────────────
  GRAPPLE_SPEED:       120,   // units/s — hook travel speed
  GRAPPLE_MAX:          80,   // max hook travel distance before auto-cancel
  REEL_SPEED:           40,   // units/s — rope shortens this fast while reeling
  GRAPPLE_PULL_SPEED:   36,   // max speed (units/s) the pull accelerates you toward anchor
  GRAPPLE_PULL_SNAP:    0.25, // 0-1: how instantly you reach pull speed per tick (0=never,1=instant)
  GRAPPLE_PULL_ZONE:    5,    // units of overshoot before pull reaches full speed
  MIN_ROPE_LEN:         1,  // rope length at which reeling auto-releases

  // Air strafe while grappling
  GRAPPLE_STRAFE_FORCE: 8,    // addForce * DT while grappling + holding a move key


  // ── Bombs ──────────────────────────────────────────────────
  BOMB_RADIUS:     0.5,
  BOMB_TTL_MS:     500,        // ms before detonation (longer = more fun to dodge)
  BOMB_SPAWN_COOLDOWN_MS: 3000,
  BLAST_RADIUS:    75,          // units — was 150, way too large
  BLAST_STRENGTH:  25,          // one-shot impulse magnitude
  DAMAGE_RADIUS:   25,           // units to take damage
  BOMB_DAMAGE:     40,          // HP per hit (4 hits = dead)

  // ── Parry ──────────────────────────────────────────────────
  PARRY_WINDOW_MS:    1000,      // 0.175s window to block attacks
  PARRY_COOLDOWN_MS:  2000,     // 2s cooldown after parry

};