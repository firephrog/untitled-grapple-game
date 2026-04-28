'use strict';

// ── game/PlayerController.js ─────────────────────────────────────────────────
// Pure functions: no room state, no Colyseus, no side effects.
// Takes a Rapier body + input data and mutates velocity directly.
// Can be unit-tested in isolation.
// ─────────────────────────────────────────────────────────────────────────────

const CFG = require('../config');

// Module-level scratch vectors — reused every call to avoid per-tick allocation.
const _vel  = { x: 0, y: 0, z: 0 };
const _force = { x: 0, y: 0, z: 0 };

/**
 * Apply one frame of player input to a Rapier rigid body.
 *
 * @param {object} body       Rapier RigidBody
 * @param {object} inputs     { w, a, s, d, space }
 * @param {object} camDir     { x, y, z } normalised camera forward
 * @param {boolean} grounded
 * @param {string}  grappleStatus  'IDLE' | 'SHOOTING' | 'STUCK' | 'REELING'
 */
function applyMovement(body, inputs, camDir, grounded, grappleStatus) {
  const horizLen = Math.sqrt(camDir.x ** 2 + camDir.z ** 2);
  const fx = horizLen > 0 ? camDir.x / horizLen : 0;
  const fz = horizLen > 0 ? camDir.z / horizLen : 0;
  const sx = -fz;
  const sz =  fx;

  let vx = 0, vz = 0;
  if (inputs.w) { vx += fx; vz += fz; }
  if (inputs.s) { vx -= fx; vz -= fz; }
  if (inputs.d) { vx += sx; vz += sz; }
  if (inputs.a) { vx -= sx; vz -= sz; }

  // Read velocity once — reuse throughout this call.
  const curVel = body.linvel();
  const curVx = curVel.x, curVy = curVel.y, curVz = curVel.z;

  if (inputs.space && grounded) {
    _vel.x = curVx; _vel.y = CFG.JUMP_VEL; _vel.z = curVz;
    body.setLinvel(_vel, true);
  }

  const grappling = grappleStatus === 'STUCK' || grappleStatus === 'REELING';
  const moving = inputs.w || inputs.s || inputs.a || inputs.d;

  if (moving) {
    if (grappling) {
      _force.x = vx * 0.3; _force.y = 0; _force.z = vz * 0.3;
      body.addForce(_force, true);
    } else {
      _vel.x = vx * CFG.WALK_SPEED; _vel.y = curVy; _vel.z = vz * CFG.WALK_SPEED;
      body.setLinvel(_vel, true);
    }
  } else {
    const speed = Math.sqrt(curVx * curVx + curVz * curVz);
    const STOP_THRESHOLD = 0.1;

    if (speed > STOP_THRESHOLD) {
      const dragCoefficient = grounded ? 12.0 : 2.0;
      const drop = speed * dragCoefficient * (1 / 60);
      const factor = Math.max(0, speed - drop) / speed;
      _vel.x = curVx * factor; _vel.y = curVy; _vel.z = curVz * factor;
      body.setLinvel(_vel, true);
    } else {
      _vel.x = 0; _vel.y = curVy; _vel.z = 0;
      body.setLinvel(_vel, true);
    }
  }
}

module.exports = { applyMovement };