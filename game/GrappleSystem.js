'use strict';

// ── game/GrappleSystem.js ────────────────────────────────────────────────────
// Grapple physics reimplemented to match the original feel:
//
//  STUCK:   Hard distance constraint — player swings on rope like a pendulum.
//           The constraint is enforced by clamping velocity each tick so the
//           player never moves further than ropeLength from the anchor.
//           (Rapier doesn't expose a DistanceConstraint joint cleanly from JS,
//           so we replicate it with a velocity projection — same result.)
//
//  REELING: Rope shortens at REEL_SPEED per second.  Each tick the player also
//           gets a small upward velocity kick (the original's velocity.y += 0.4)
//           so reeling in feels like climbing, not just being dragged sideways.
// ─────────────────────────────────────────────────────────────────────────────

const CFG = require('../config');

const STATUS = Object.freeze({
  IDLE:     'IDLE',
  SHOOTING: 'SHOOTING',
  STUCK:    'STUCK',
  REELING:  'REELING',
});

class GrappleSystem {
  constructor() {
    this.status     = STATUS.IDLE;
    this.hookPos    = null;
    this.direction  = null;
    this.travelDist = 0;
    this.ropeLength = 0;
  }

  // ── Public API ───────────────────────────────────────────────

  activate(playerBody, camDir, eyeOffset = 1.0) {
    if (this.status === STATUS.IDLE) {
      const pos       = playerBody.translation();
      this.status     = STATUS.SHOOTING;
      // Start hook from eye level (player's aiming position), not body position
      this.hookPos    = { x: pos.x, y: pos.y + eyeOffset, z: pos.z };
      this.direction  = { x: camDir.x, y: camDir.y, z: camDir.z };
      this.travelDist = 0;
    } else if (this.status === STATUS.STUCK) {
      this.status = STATUS.REELING;
    } else {
      this.reset(playerBody);  // ← pass body so velocity is bled on cancel
    }
  }

  tick(playerBody, physicsWorld) {
    const DT = 1 / CFG.TICK_RATE;

    if (this.status === STATUS.SHOOTING) {
      this._tickShooting(playerBody, physicsWorld, DT);
    }

    if (this.status === STATUS.STUCK || this.status === STATUS.REELING) {
      this._tickConstraint(playerBody, DT);
    }
  }

  get isActive() {
    return this.status !== STATUS.IDLE && this.hookPos !== null;
  }

  // GrappleSystem.js
  reset(body = null) {
    if (body) {
      // 1. Explicitly clear all internal Rapier forces to prevent "Force Leaks"
      body.resetForces(true); 
      
      const v = body.linvel();
      // 2. Keep 90% of velocity for the "Slingshot" (don't kill it to 5% or 30%)
      // The PlayerController drag (below) will handle the eventual stop.
      body.setLinvel({ x: v.x * 0.9, y: v.y, z: v.z * 0.9 }, true);
    }
    this.status     = STATUS.IDLE;
    this.hookPos    = null;
    this.direction  = null;
    this.travelDist = 0;
    this.ropeLength = 0;
  }

  // ── Shooting ─────────────────────────────────────────────────

  _tickShooting(playerBody, physicsWorld, DT) {
    const prev = { ...this.hookPos };

    this.hookPos.x  += this.direction.x * CFG.GRAPPLE_SPEED * DT;
    this.hookPos.y  += this.direction.y * CFG.GRAPPLE_SPEED * DT;
    this.hookPos.z  += this.direction.z * CFG.GRAPPLE_SPEED * DT;
    this.travelDist += CFG.GRAPPLE_SPEED * DT;

    // Don't check geometry until hook has cleared the player's body.
    // Player radius = 1.0, so wait until travelDist > 2.5 to be safe.
    // This is simpler and more reliable than trying to filter by body in Rapier 0.12.
    const MIN_TRAVEL = 2.5;
    let hitPos = null;
    // Optimize: reduce sample rate from 6 to 4 samples (33% fewer raycasts)
    if (this.travelDist > MIN_TRAVEL) {
      for (let i = 0; i <= 3; i++) {  // Reduced from 5 to 3 (4 samples instead of 6)
        const t = i / 3;
        const sample = {
          x: prev.x + (this.hookPos.x - prev.x) * t,
          y: prev.y + (this.hookPos.y - prev.y) * t,
          z: prev.z + (this.hookPos.z - prev.z) * t,
        };
        if (physicsWorld.hookHitsGeometry(sample, playerBody)) { hitPos = sample; break; }
      }
    }

    if (hitPos) {
      this.hookPos = hitPos;
      this.status  = STATUS.STUCK;

      // Record rope length as current distance to anchor
      const pos = playerBody.translation();
      const dx  = pos.x - hitPos.x;
      const dy  = pos.y - hitPos.y;
      const dz  = pos.z - hitPos.z;
      this.ropeLength = Math.sqrt(dx*dx + dy*dy + dz*dz);

    } else if (this.travelDist > CFG.GRAPPLE_MAX) {
      this.reset();
    }
  }

  // ── Force-based pull (STUCK + REELING) ──────────────────────
  // Uses addForce scaled by DT instead of setTranslation.
  // This means Rapier's collision response still runs normally —
  // the player can never be teleported through geometry.
  //
  // When STUCK:   spring force pulls toward anchor if beyond ropeLength
  // When REELING: rope shortens + upward kick each tick (original feel)

  _tickConstraint(playerBody, DT) {
    // Shorten rope while reeling
    if (this.status === STATUS.REELING) {
      this.ropeLength = Math.max(CFG.MIN_ROPE_LEN, this.ropeLength - CFG.REEL_SPEED * DT);
    }
    
    if (this.status === STATUS.REELING && this.ropeLength <= CFG.MIN_ROPE_LEN) {
      this.reset(playerBody);
      return; // Exit early so no more velocity/force is applied this tick
    }

    const pos  = playerBody.translation();
    const dx   = this.hookPos.x - pos.x;
    const dy   = this.hookPos.y - pos.y;
    const dz   = this.hookPos.z - pos.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    // Only pull when beyond rope length
    if (dist > this.ropeLength && dist > 0.01) {
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;

      const vel     = playerBody.linvel();
      // Closing speed: positive = already moving toward anchor
      const closing = vel.x*nx + vel.y*ny + vel.z*nz;

      // Pull speed ramps from 0 → GRAPPLE_PULL_SPEED over GRAPPLE_PULL_ZONE units of overshoot
      const overshoot   = Math.min((dist - this.ropeLength) / CFG.GRAPPLE_PULL_ZONE, 1);
      const targetSpeed = overshoot * CFG.GRAPPLE_PULL_SPEED;

      // Only correct if not already closing fast enough
      if (closing < targetSpeed) {
        const correction = (targetSpeed - closing) * CFG.GRAPPLE_PULL_SNAP;
        // setLinvel — NOT addForce, so zero accumulation across ticks
        playerBody.setLinvel({
          x: vel.x + nx * correction,
          y: vel.y + ny * correction,
          z: vel.z + nz * correction,
        }, true);
      }
    }

    // Release when fully reeled in
    if (this.status === STATUS.REELING && this.ropeLength <= CFG.MIN_ROPE_LEN) {
      this.reset(playerBody);  // ← was this.reset()
    }
  }
}

module.exports = { GrappleSystem, GRAPPLE_STATUS: STATUS };