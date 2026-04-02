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

  const curVel = body.linvel();
  if (inputs.space && grounded) {
    body.setLinvel({ x: curVel.x, y: CFG.JUMP_VEL, z: curVel.z }, true);
  }

  const newVel = body.linvel();
  const grappling = grappleStatus === 'STUCK' || grappleStatus === 'REELING';
  const moving = inputs.w || inputs.s || inputs.a || inputs.d;

  if (moving) {
    if (grappling) {
      // While grappling, we add force to "swing"
      body.addForce({ x: vx * 0.3, y: 0, z: vz * 0.3 }, true);
    } else {
      // Normal walking should use setLinvel to OVERRIDE old forces/velocities
      body.setLinvel({ x: vx * CFG.WALK_SPEED, y: body.linvel().y, z: vz * CFG.WALK_SPEED }, true);
    }
  // PlayerController.js -> inside applyMovement
  } else {
    // --- THIS SECTION REPLACES YOUR OLD FRICTION LOGIC ---
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x**2 + vel.z**2);
    const STOP_THRESHOLD = 0.1;

    if (speed > STOP_THRESHOLD) {
      // Ground drag is high (stops you), Air drag is low (slingshot)
      const dragCoefficient = grounded ? 12.0 : 1.5; 
      
      // Calculate how much speed to "drop" this tick
      // This is "Active Drag" - it fights the acceleration you feel
      const drop = speed * dragCoefficient * (1 / 60); 
      const newSpeed = Math.max(0, speed - drop);
      const factor = newSpeed / speed;

      body.setLinvel({
        x: vel.x * factor,
        y: vel.y,
        z: vel.z * factor,
      }, true);
    } else {
      // Snap to zero if below threshold to kill the "slow creep"
      body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
    }
  }
}

module.exports = { applyMovement };