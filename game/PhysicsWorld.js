'use strict';

// ── game/PhysicsWorld.js ──────────────────────────────────────────────────────
// Builds a Rapier physics world from a map's collision JSON.
//
// The collision JSON contains raw triangle data baked from Blender:
//   { "vertices": [x,y,z, ...], "indices": [i,i,i, ...] }
//
// Rapier's trimesh collider takes these arrays directly and builds an
// exact collision shape matching your Blender mesh — slopes, curves,
// arches, anything concave or convex all work correctly.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');
const CFG  = require('../config');

// Pre-allocated direction constants — shared across all PhysicsWorld instances
// to avoid per-call allocation in isGrounded / hookHitsGeometry.
const GROUND_RAY_DIR = Object.freeze({ x: 0, y: -1, z: 0 });
const HOOK_RAY_DIRS  = Object.freeze([
  Object.freeze({ x:  0, y: -1, z:  0 }),
  Object.freeze({ x:  0, y:  1, z:  0 }),
  Object.freeze({ x:  1, y:  0, z:  0 }),
  Object.freeze({ x: -1, y:  0, z:  0 }),
  Object.freeze({ x:  0, y:  0, z:  1 }),
  Object.freeze({ x:  0, y:  0, z: -1 }),
]);

// Pre-parsed collision mesh cache — keyed by absolute collision file path.
// Populated by PhysicsWorld.preload() at startup so no game tick ever calls
// fs.readFileSync or JSON.parse synchronously (which would stall the event loop).
const _meshCache = new Map();

let RAPIER = null;
const RAPIER_READY = (async () => {
  const r = require('@dimforge/rapier3d-compat');
  await r.init();
  RAPIER = r;
})();

class PhysicsWorld {
  /**
   * @param {object} map  Map definition from maps/index.js
   */
  constructor(map) {
    if (!RAPIER) throw new Error('PhysicsWorld created before RAPIER_READY resolved');
    this.map = map;
    this.world = new RAPIER.World({ x: 0, y: CFG.GRAVITY, z: 0 });
    this._buildFromCollisionMesh();

    // Pre-allocated scratch objects to eliminate per-tick GC pressure.
    // Rapier's Ray stores a reference to origin/dir objects and reads
    // their x/y/z values at castRay time, so mutating these works correctly.
    this._groundRayOrigin = { x: 0, y: 0, z: 0 };
    this._groundRay       = new RAPIER.Ray(this._groundRayOrigin, GROUND_RAY_DIR);

    this._hookRayOrigin   = { x: 0, y: 0, z: 0 };
    this._hookRays        = HOOK_RAY_DIRS.map(dir => new RAPIER.Ray(this._hookRayOrigin, dir));
  }

  // ── Build static geometry from collision JSON ─────────────────
  //
  // How Rapier trimesh works:
  //   vertices  Float32Array of [x0,y0,z0, x1,y1,z1, ...]
  //   indices   Uint32Array  of [i0,i1,i2, i3,i4,i5, ...] (triangles)
  //
  // Each group of 3 indices forms one triangle referencing 3 vertex positions.
  // Rapier builds a BVH (bounding volume hierarchy) over all triangles so
  // collision queries run in O(log n) time regardless of mesh complexity.

  _buildFromCollisionMesh() {
    // Resolve path relative to project root (where node server.js runs)
    // collision path in map is like '/maps/default.collision.json'
    // which lives on disk at public/maps/default.collision.json
    const collisionPath = path.join(
      process.cwd(), 'public', this.map.collision
    );

    let vertices, indices;

    const cached = _meshCache.get(collisionPath);
    if (cached) {
      // Fast path: use the pre-parsed typed arrays from startup preload.
      // No file I/O, no JSON.parse — zero event loop blocking.
      vertices = cached.vertices;
      indices  = cached.indices;
    } else if (fs.existsSync(collisionPath)) {
      // Fallback for maps that weren't preloaded (e.g. dynamically added maps).
      const raw  = fs.readFileSync(collisionPath, 'utf8');
      const data = JSON.parse(raw);
      vertices = new Float32Array(data.vertices);
      indices  = new Uint32Array(data.indices);
      // Cache so subsequent rooms on the same map don't re-parse from disk.
      _meshCache.set(collisionPath, { vertices, indices });
    } else {
      console.warn(`[PhysicsWorld] *** COLLISION FILE NOT FOUND: ${collisionPath} ***`);
      console.warn(`[PhysicsWorld] Using flat ground fallback — update your map path`);
      vertices = new Float32Array([
        -50, 0,  50,
         50, 0,  50,
         50, 0, -50,
        -50, 0, -50,
      ]);
      indices = new Uint32Array([0, 1, 2,  0, 2, 3]);
    }

    // Create a single fixed trimesh body for the entire map
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.0),
      body
    );

    // Store for grapple hook collision checks
    // We use Rapier's own ray cast for this now (more accurate than AABB checks)
    this._hasCollisionMesh = true;
  }

  // ── Spawn points ─────────────────────────────────────────────
  getSpawnPoint(index) {
    return this.map.spawnPoints[index] || { x: index === 0 ? -20 : 20, y: 5, z: 0 };
  }
  // ── Grounded check ───────────────────────────────────────────
  isGrounded(body) {
    if (!body) return false;
    const pos = body.translation();
    // Mutate the pre-allocated origin — Ray reads its values at castRay time.
    this._groundRayOrigin.x = pos.x;
    this._groundRayOrigin.y = pos.y - 0.5;
    this._groundRayOrigin.z = pos.z;
    const hit = this.world.castRay(this._groundRay, 0.6, false, null, null, null, body);
    return hit !== null;
  }
  createPlayerBody(spawnIndex) {
    const sp   = this.getSpawnPoint(spawnIndex);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(sp.x, sp.y, sp.z)
        .lockRotations()
        .setLinearDamping(CFG.LINEAR_DAMPING)
        .setCcdEnabled(true)
    );
    // Capsule: half-height 0.5, radius 0.5 → total height 2, same as ball radius 1
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.5).setFriction(0.0),
      body
    );
    return body;
  }

  // ── Bomb body factory ────────────────────────────────────────
  createBombBody(position, impulse) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setCcdEnabled(true)
    );
    this.world.createCollider(RAPIER.ColliderDesc.ball(CFG.BOMB_RADIUS), body);
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    return body;
  }

  // ── Grapple hook collision ───────────────────────────────────
  // Casts a short ray from the hook position in 6 axis directions.
  // Uses pre-allocated Ray objects (shared origin mutated before each cast).
  hookHitsGeometry(pos, playerBody) {
    this._hookRayOrigin.x = pos.x;
    this._hookRayOrigin.y = pos.y;
    this._hookRayOrigin.z = pos.z;
    for (let i = 0; i < 6; i++) {
      if (this.world.castRay(this._hookRays[i], 0.3, false, null, null, null, playerBody) !== null) return true;
    }
    return false;
  }

  step()           { this.world.step(); }
  removeBody(body) { this.world.removeRigidBody(body); }

  // ── Static startup preload ───────────────────────────────────
  // Call this once at server startup with every map definition.
  // Reads and parses each collision JSON asynchronously (non-blocking)
  // so that later calls to new PhysicsWorld(map) never touch the disk.
  static async preload(maps) {
    const fsPromises = require('fs').promises;
    await Promise.all(maps.map(async map => {
      const collisionPath = path.join(process.cwd(), 'public', map.collision);
      if (_meshCache.has(collisionPath)) return;
      try {
        const raw  = await fsPromises.readFile(collisionPath, 'utf8');
        const data = JSON.parse(raw);
        _meshCache.set(collisionPath, {
          vertices: new Float32Array(data.vertices),
          indices:  new Uint32Array(data.indices),
        });
        console.log(`[PhysicsWorld] Preloaded ${map.collision}`);
      } catch (e) {
        console.warn(`[PhysicsWorld] Could not preload ${map.collision}: ${e.message}`);
      }
    }));
  }
}

module.exports = { PhysicsWorld, RAPIER_READY, getRapier: () => RAPIER };