'use strict';

// ── game/ParrySystem.js ──────────────────────────────────────────────────────
// Manages parry state for a single player.
// A successful parry blocks incoming attacks within the parry window.
// ─────────────────────────────────────────────────────────────────────────────

const CFG = require('../config');

class ParrySystem {
  constructor() {
    this.isActive = false;          // Whether parry is currently active
    this.activatedAt = 0;           // Timestamp when parry was activated
    this.lastParryTime = 0;         // Timestamp of last parry
  }

  /**
   * Activate the parry. Returns whether parry was successfully activated
   * (not on cooldown).
   * @returns {boolean} true if parry activated, false if on cooldown
   */
  activate() {
    const now = Date.now();
    
    // Check cooldown
    if (now - this.lastParryTime < CFG.PARRY_COOLDOWN_MS) {
      return false;  // Still on cooldown
    }

    this.isActive = true;
    this.activatedAt = now;
    this.lastParryTime = now;
    return true;
  }

  /**
   * Check if an attack hitting right now would be parried.
   * Returns true if the attack is blocked, false otherwise.
   * @returns {boolean}
   */
  isAttackBlocked() {
    if (!this.isActive) return false;

    const now = Date.now();
    const elapsed = now - this.activatedAt;

    // Attack is blocked if within the parry window
    return elapsed < CFG.PARRY_WINDOW_MS;
  }

  /**
   * End the parry window (called after parry window expires or attacker hits).
   */
  deactivate() {
    this.isActive = false;
  }

  /**
   * Get remaining cooldown time in milliseconds.
   * @returns {number} 0 if ready, otherwise milliseconds until ready
   */
  getCooldownRemaining() {
    const now = Date.now();
    const elapsed = now - this.lastParryTime;
    return Math.max(0, CFG.PARRY_COOLDOWN_MS - elapsed);
  }
}

module.exports = ParrySystem;
