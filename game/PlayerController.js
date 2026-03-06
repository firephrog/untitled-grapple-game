'use strict';

// ── game/PlayerController.js ─────────────────────────────────────────────────
// Pure functions: no room state, no Colyseus, no side effects.
// Takes a Rapier body + input data and mutates velocity directly.
// Can be unit-tested in isolation.
// ─────────────────────────────────────────────────────────────────────────────

const CFG = require('../config');

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
  // Flatten camera forward onto XZ plane and normalise
  const horizLen = Math.sqrt(camDir.x ** 2 + camDir.z ** 2);
  const fx = horizLen > 0 ? camDir.x / horizLen : 0;
  const fz = horizLen > 0 ? camDir.z / horizLen : 0;
  // Strafe direction is 90° rotation of forward on XZ
  const sx = -fz;
  const sz =  fx;

  // Accumulate desired XZ velocity direction
  let vx = 0, vz = 0;
  if (inputs.w) { vx += fx; vz += fz; }
  if (inputs.s) { vx -= fx; vz -= fz; }
  if (inputs.d) { vx += sx; vz += sz; }
  if (inputs.a) { vx -= sx; vz -= sz; }

  // Jump — must happen before we overwrite Y velocity below
  const curVel = body.linvel();
  if (inputs.space && grounded) {
    body.setLinvel({ x: curVel.x, y: CFG.JUMP_VEL, z: curVel.z }, true);
  }

  // Preserve current Y so gravity/jump aren't disrupted
  const newVel = body.linvel();
  const grappling = grappleStatus === 'STUCK' || grappleStatus === 'REELING';
  const moving    = inputs.w || inputs.s || inputs.a || inputs.d;

  if (moving) {
    if (grappling) {
      // Air-strafe style: additive force rather than set velocity,
      // so the grapple spring can still do its job
      body.addForce({ x: vx * 0.3, y: 0, z: vz * 0.3 }, true);
    } else {
      body.setLinvel({ x: vx * CFG.WALK_SPEED, y: newVel.y, z: vz * CFG.WALK_SPEED }, true);
    }
  } else {
    // Friction-style horizontal damping when no keys held
    body.setLinvel({ x: newVel.x * 0.8, y: newVel.y, z: newVel.z * 0.8 }, true);
  }
}

module.exports = { applyMovement };
