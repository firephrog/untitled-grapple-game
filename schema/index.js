'use strict';

// ── schema/index.js ──────────────────────────────────────────────────────────
// Binary-encoded Colyseus schemas.  Only changed fields are sent each patch.
// float32 = 4 bytes per field, int16 = 2 bytes, boolean = 1 byte.
// ─────────────────────────────────────────────────────────────────────────────

const { Schema, MapSchema, defineTypes } = require('@colyseus/schema');

// ── Vec3 ──────────────────────────────────────────────────────
class Vec3 extends Schema {
  constructor(x = 0, y = 0, z = 0) {
    super();
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
defineTypes(Vec3, { x: 'float32', y: 'float32', z: 'float32' });

// ── GrappleState ──────────────────────────────────────────────
// Hook position is flattened to avoid deeply nested schema updates,
// which are more expensive to diff than flat float fields.
class GrappleState extends Schema {
  constructor() {
    super();
    this.active = false;
    this.hx = 0;
    this.hy = 0;
    this.hz = 0;
  }
}
defineTypes(GrappleState, {
  active: 'boolean',
  hx: 'float32',
  hy: 'float32',
  hz: 'float32',
});

// ── PlayerState ───────────────────────────────────────────────
class PlayerState extends Schema {
  constructor() {
    super();
    this.position = new Vec3();
    this.velocity = new Vec3();
    this.health   = 100;
    this.alive    = true;
    this.lastSeq  = 0;
    this.grapple  = new GrappleState();
    this.bombSkinId = 'default';
  }
}
defineTypes(PlayerState, {
  position: Vec3,
  velocity: Vec3,
  health:   'int16',
  alive:    'boolean',
  lastSeq:  'int32',
  grapple:  GrappleState,
  bombSkinId: 'string',
});

// ── BombState ─────────────────────────────────────────────────
// Flat fields beat nested Vec3/Quat here — bombs are short-lived
// and created/destroyed rapidly, so minimal schema overhead matters.
class BombState extends Schema {
  constructor(id = '', bombSkinId = 'default') {
    super();
    this.id = id;
    this.bombSkinId = bombSkinId;
    this.px = 0; this.py = 0; this.pz = 0;
    this.rx = 0; this.ry = 0; this.rz = 0; this.rw = 1;
  }
}
defineTypes(BombState, {
  id: 'string',
  bombSkinId: 'string',
  px: 'float32', py: 'float32', pz: 'float32',
  rx: 'float32', ry: 'float32', rz: 'float32', rw: 'float32',
});

// ── RoomState (root) ──────────────────────────────────────────
class RoomState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();  // sessionId → PlayerState
    this.bombs   = new MapSchema();  // bombId    → BombState
    this.phase   = 'waiting';        // 'waiting' | 'playing' | 'ended'
  }
}
defineTypes(RoomState, {
  players: { map: PlayerState },
  bombs:   { map: BombState },
  phase:   'string',
});

module.exports = { Vec3, GrappleState, PlayerState, BombState, RoomState };
