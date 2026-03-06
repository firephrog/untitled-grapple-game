'use strict';

// ── game/BombSystem.js ───────────────────────────────────────────────────────
// Manages all live bombs for one room.
// BombSystem is told about explosions via a callback so it stays decoupled
// from Colyseus room broadcasting — easy to test, easy to swap transport.
// ─────────────────────────────────────────────────────────────────────────────

const CFG = require('../config');

class BombSystem {
  /**
   * @param {PhysicsWorld} physicsWorld
   * @param {Function}     onExplode   (bombId, centerPos, ownerId) → void
   *                                   Called by the room to broadcast + deal damage.
   */
  constructor(physicsWorld, onExplode) {
    this._physics   = physicsWorld;
    this._onExplode = onExplode;
    this._bombs     = new Map();  // id → { body, owner, spawnTime }
  }

  // ── Spawn ────────────────────────────────────────────────────
  /**
   * Spawn a new bomb and return its id (so the room can add it to state).
   * @param {{ x, y, z }} position
   * @param {{ x, y, z }} impulse
   * @param {string}      ownerId  sessionId of the player who threw it
   * @returns {string} bombId
   */
  spawn(position, impulse, ownerId) {
    const id   = Math.random().toString(36).substr(2, 9);
    const body = this._physics.createBombBody(position, impulse);
    this._bombs.set(id, { body, owner: ownerId, spawnTime: Date.now() });
    return id;
  }

  // ── Tick ─────────────────────────────────────────────────────
  /**
   * Called every physics tick.  Checks TTL and fires the onExplode
   * callback for any bombs that are ready to detonate.
   * @returns {string[]} ids of bombs that detonated this tick
   */
  tick() {
    const detonated = [];
    const now = Date.now();

    for (const [id, bomb] of this._bombs) {
      if (now - bomb.spawnTime < CFG.BOMB_TTL_MS) continue;

      const pos = bomb.body.translation();
      this._onExplode(id, pos, bomb.owner);

      this._physics.removeBody(bomb.body);
      this._bombs.delete(id);
      detonated.push(id);
    }

    return detonated;
  }

  // ── State sync helper ────────────────────────────────────────
  /**
   * Iterate live bombs for updating Colyseus schema each tick.
   * @param {Function} cb  (id, position, rotation) → void
   */
  forEachLive(cb) {
    for (const [id, bomb] of this._bombs) {
      cb(id, bomb.body.translation(), bomb.body.rotation());
    }
  }

  // ── Explosion physics ────────────────────────────────────────
  /**
   * Apply blast knockback to an arbitrary list of Rapier bodies
   * and return the list of player IDs that are inside damage radius.
   *
   * Separated from onExplode so the room can decide what "damage" means
   * (e.g. a future mode might have shields, respawns, etc.).
   *
   * @param {{ x, y, z }}           center
   * @param {RAPIER.RigidBody[]}    allBodies      all dynamic bodies in world
   * @param {{ sid, body }[]}       playerEntries  [{ sid, body }]
   * @param {string}                ownerId
   * @returns {{ sid, damage }[]}   players that should take damage
   */
  static resolveExplosion(center, allBodies, playerEntries, ownerId) {
    // Knockback every dynamic body in blast radius
    for (const body of allBodies) {
      const p  = body.translation();
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < CFG.BLAST_RADIUS && d > 0.01) {
        body.applyImpulse(
          { x: (dx / d) * CFG.BLAST_STRENGTH,
            y: (dy / d) * CFG.BLAST_STRENGTH,
            z: (dz / d) * CFG.BLAST_STRENGTH },
          true
        );
      }
    }

    // Determine which players take damage
    const hits = [];
    for (const { sid, body } of playerEntries) {
      if (sid === ownerId) continue;  // no self-damage
      const p  = body.translation();
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < CFG.DAMAGE_RADIUS) {
        hits.push({ sid, damage: CFG.BOMB_DAMAGE });
      }
    }
    return hits;
  }

  get size() { return this._bombs.size; }
}

module.exports = { BombSystem };
