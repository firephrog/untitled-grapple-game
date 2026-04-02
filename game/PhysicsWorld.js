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

    console.log(`[PhysicsWorld] Looking for collision file at: ${collisionPath}`);

    if (fs.existsSync(collisionPath)) {
      const raw  = fs.readFileSync(collisionPath, 'utf8');
      const data = JSON.parse(raw);
      vertices = new Float32Array(data.vertices);
      indices  = new Uint32Array(data.indices);

      // Log Y range so you can see if axis conversion is correct
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < data.vertices.length; i += 3) {
        minY = Math.min(minY, data.vertices[i]);
        maxY = Math.max(maxY, data.vertices[i]);
      }
      console.log(`[PhysicsWorld] Loaded collision: ${vertices.length/3} verts, ${indices.length/3} tris`);
      console.log(`[PhysicsWorld] Y range in collision mesh: ${minY.toFixed(2)} to ${maxY.toFixed(2)}`);
      console.log(`[PhysicsWorld] Spawn points: ${JSON.stringify(this.map.spawnPoints)}`);
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
      RAPIER.ColliderDesc.trimesh(vertices, indices).setRestitution(0.0).setFriction(0.0),
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

  // ── Player body factory ──────────────────────────────────────
  createPlayerBody(spawnIndex) {
    const sp   = this.getSpawnPoint(spawnIndex);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(sp.x, sp.y, sp.z)
        .lockRotations()
        .setLinearDamping(CFG.LINEAR_DAMPING)
    );
    // Capsule: half-height 0.5, radius 0.5 → total height 2, same as ball radius 1
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.5).setRestitution(0.0).setFriction(0.0),
      body
    );
    return body;
  }

  // ── Bomb body factory ────────────────────────────────────────
  createBombBody(position, impulse) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
    );
    this.world.createCollider(RAPIER.ColliderDesc.ball(CFG.BOMB_RADIUS), body);
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    return body;
  }

  // ── Grounded check ───────────────────────────────────────────
  isGrounded(body) {
    const pos = body.translation();
    // In Rapier 0.12, cast from INSIDE the sphere (0.5 units below centre).
    // solid:false means the ray ignores the surface it starts inside,
    // so it passes through the player's own ball collider harmlessly.
    // Max distance: 0.6 (radius 1.0 - 0.5 origin offset + 0.1 tolerance).
    const ray = new RAPIER.Ray(
      { x: pos.x, y: pos.y - 0.5, z: pos.z },
      { x: 0, y: -1, z: 0 }
    );
    const hit = this.world.castRay(ray, 0.6, false, null, null, null, body);
    return hit !== null;
  }

  // ── Grapple hook collision ───────────────────────────────────
  // Now uses Rapier ray cast against the trimesh — works for any shape.
  // Cast a short ray at the hook position in multiple directions;
  // if any hits within threshold the hook has struck geometry.
  hookHitsGeometry(pos, playerBody) {
    const THRESHOLD = 0.3;
    const dirs = [
      { x:  0, y: -1, z:  0 },
      { x:  0, y:  1, z:  0 },
      { x:  1, y:  0, z:  0 },
      { x: -1, y:  0, z:  0 },
      { x:  0, y:  0, z:  1 },
      { x:  0, y:  0, z: -1 },
    ];
    for (const dir of dirs) {
      const ray = new RAPIER.Ray(pos, dir);
      if (this.world.castRay(ray, THRESHOLD, false, null, null, null, playerBody) !== null) return true;
    }
    return false;
  }

  step()           { this.world.step(); }
  removeBody(body) { this.world.removeRigidBody(body); }
}

module.exports = { PhysicsWorld, RAPIER_READY, getRapier: () => RAPIER };