'use strict';

// ── game/GearSystem.js ───────────────────────────────────────────────────────
// Manages all active gear effects (weapons, items) for one room.
// Currently supports: Sniper (raycast-based hitscan weapon)
// ─────────────────────────────────────────────────────────────────────────────

const CFG = require('../config');
const RAPIER = require('@dimforge/rapier3d-compat');

// ────────────────────────────────────────────────────────────────────────────
// GEAR DEFINITIONS
// ────────────────────────────────────────────────────────────────────────────
// This registry defines all available gear items. The client-side gearItems
// array in client/src/main.js should be kept in sync with this registry.

const GEAR_REGISTRY = {
  sniper: {
    name: 'Sniper',
    description: 'High-damage hitscan weapon with 2-second preview',
    rarity: 'high-skill',
    damage: 50,
    cooldown: 15000,  // ms
    image: '/gear/sniper_thumb.png',  // placeholder
    glb: '/gear/sniper.glb',  // GLB model path
    previewDuration: 2000,  // 2 seconds before firing
    postFireDuration: 1000,  // 1 second visible after firing
    scale: 1.0,
  },
  mace: {
    name: 'Mace',
    description: 'Heavy melee weapon, dealing AOE damage proportional to the user\'s current speed. Three second charge-up',
    rarity: 'ultra-high-skill',
    damage: 10,
    cooldown: 10000,  // ms
    image: '/gear/mace_thumb.png',  // placeholder
    glb: '/gear/mace.glb',  // GLB model path
    previewDuration: 500,  // 0.5 seconds before impact
    postFireDuration: 1000,  // 1 second visible after impact
    scale: 10.0,
    aoeRadius: 6.0,  // meters
    aoeScaleWithVelocity: true,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// PENDING SNIPE – Snipe deferred for 2 seconds before executing
// ────────────────────────────────────────────────────────────────────────────

class PendingSnipe {
  constructor(shooterId, playerEntries, cameraPos, cameraDir, eyeOffset = 1.0, delayMs = 2000) {
    this.shooterId = shooterId;
    this.playerEntries = playerEntries;
    this.cameraPos = cameraPos;      // Store the actual camera position
    this.cameraDir = cameraDir;      // Store the camera direction
    this.eyeOffset = eyeOffset;
    this.executionTime = Date.now() + delayMs;
  }

  isReady(now) {
    return now >= this.executionTime;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PENDING MACE – Mace raises up for 3 seconds, then deals AOE damage
// ────────────────────────────────────────────────────────────────────────────

class PendingMace {
  constructor(shooterId, shooterBody, playerEntries, delayMs = 3000) {
    this.shooterId = shooterId;
    this.shooterBody = shooterBody;
    this.playerEntries = playerEntries;
    this.executionTime = Date.now() + delayMs;
    this.startTime = Date.now();
    this.startVelocity = shooterBody.linvel();  // Capture velocity at activation
  }

  isReady(now) {
    return now >= this.executionTime;
  }

  getProgress(now) {
    const elapsed = now - this.startTime;
    const duration = this.executionTime - this.startTime;
    return Math.min(1, elapsed / duration);
  }
}

// ────────────────────────────────────────────────────────────────────────────

class ActiveLine {
  constructor(startPos, endPos, createdAt, duration = 3000, direction = null) {
    this.startPos = startPos;
    this.endPos = endPos;
    this.createdAt = createdAt;
    this.duration = duration;  // how long until line fades
    this.direction = direction;  // direction for client-side offset
  }

  isExpired(now) {
    return now - this.createdAt > this.duration;
  }

  getAlpha(now) {
    const elapsed = now - this.createdAt;
    return Math.max(0, 1 - (elapsed / this.duration));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ACTIVE GEAR EFFECT – Preview model shown before gear activates
// ────────────────────────────────────────────────────────────────────────────

class ActiveGearEffect {
  constructor(gearName, shooterId, position, rotation, createdAt, duration = 2000) {
    this.gearName = gearName;      // 'sniper', etc.
    this.shooterId = shooterId;    // player who activated the gear
    this.position = position;      // { x, y, z } world position
    this.rotation = rotation;      // { x, y, z } rotation (quaternion: x, y, z, w)
    this.createdAt = createdAt;
    this.duration = duration;      // how long to display (usually 2000ms)
  }

  isExpired(now) {
    return now - this.createdAt > this.duration;
  }

  getAlpha(now) {
    const elapsed = now - this.createdAt;
    return Math.max(0, 1 - (elapsed / this.duration));
  }
}


// ────────────────────────────────────────────────────────────────────────────
// GEAR SYSTEM
// ────────────────────────────────────────────────────────────────────────────

class GearSystem {
  /**
   * @param {PhysicsWorld} physicsWorld
   * @param {Function}     onSnipeHit   (shooterId, targetId, damage) → void
   *                                    Called when sniper hits a player
   * @param {Function}     onLineSpawn  (line) → void
   *                                    Called when a visual line is created
   * @param {Function}     onGearPreview (effect) → void
   *                                    Called when a gear preview effect is created
   * @param {Function}     onAoeDamage  (shooterId, targets, damage) → void
   *                                    Called when AOE gear hits multiple players
   * @param {Function}     onParticles  (position, type, count) → void
   *                                    Called to spawn particles
   */
  constructor(physicsWorld, onSnipeHit, onLineSpawn, onGearPreview, onAoeDamage, onParticles) {
    this._physics = physicsWorld;
    this._onSnipeHit = onSnipeHit;
    this._onLineSpawn = onLineSpawn;
    this._onGearPreview = onGearPreview;
    this._onAoeDamage = onAoeDamage;
    this._onParticles = onParticles;
    
    this._lines = [];  // Array of ActiveLine
    this._gearEffects = [];  // Array of ActiveGearEffect
    this._pendingSnipes = [];  // Array of PendingSnipe waiting to execute
    this._pendingMaces = [];  // Array of PendingMace waiting to execute

    // Pre-allocated tick result — avoids creating new objects every tick
    this._tickReadySnipes = [];
    this._tickReadyMaces  = [];
    this._tickResult      = { readySnipes: this._tickReadySnipes, readyMaces: this._tickReadyMaces };
  }

  /**
   * Attempt to use the sniper gear.
   * Shows a 2-second preview, then executes the actual snipe.
   * 
   * @param {RAPIER.RigidBody} shooterBody
   * @param {{ x, y, z }}      cameraPos  world position of camera
   * @param {{ x, y, z }}      cameraDir  normalized camera forward direction
   * @param {RAPIER.RigidBody[]} allBodies all dynamic bodies in world (to detect hits)
   * @param {Array<{sid, body}>} playerEntries players with their bodies
   * @param {string}            shooterId sessionId of the player shooting
   * @param {number}            eyeOffset player's eye height offset (default 1.0)
   * @returns {object} { success } 
   */
  snipe(shooterBody, cameraPos, cameraDir, allBodies, playerEntries, shooterId, eyeOffset = 1.0) {
    // Validate inputs
    if (!cameraPos || typeof cameraPos.x !== 'number' || typeof cameraPos.y !== 'number' || typeof cameraPos.z !== 'number') {
      console.warn('[GearSystem] Invalid cameraPos:', cameraPos);
      return { success: false };
    }
    if (!cameraDir || typeof cameraDir.x !== 'number' || typeof cameraDir.y !== 'number' || typeof cameraDir.z !== 'number') {
      console.warn('[GearSystem] Invalid cameraDir:', cameraDir);
      return { success: false };
    }

    try {
      // Normalize camera direction (just in case)
      const len = Math.sqrt(cameraDir.x ** 2 + cameraDir.y ** 2 + cameraDir.z ** 2);
      const dir = len > 0.01 ? {
        x: cameraDir.x / len,
        y: cameraDir.y / len,
        z: cameraDir.z / len,
      } : { x: 0, y: 0, z: 0 };

      // Create gear preview effect (visible for preview + post-fire duration)
      // Use explicit constants if not properly configured
      const previewDuration = (GEAR_REGISTRY.sniper && GEAR_REGISTRY.sniper.previewDuration) || 2000;
      const postFireDuration = (GEAR_REGISTRY.sniper && GEAR_REGISTRY.sniper.postFireDuration) || 1000;
      const totalDuration = previewDuration + postFireDuration;
      
      // Ensure totalDuration is at least 3000ms
      const effectDuration = Math.max(totalDuration, 3000);
      
      // Create quaternion from direction (rotation to point rifle along camera dir)
      const up = { x: 0, y: 1, z: 0 };
      const right = { 
        x: dir.z, // cross product of up and dir
        y: 0, 
        z: -dir.x 
      };
      const lenRight = Math.sqrt(right.x * right.x + right.z * right.z);
      if (lenRight > 0.01) {
        right.x /= lenRight; right.z /= lenRight;
      }
      const newUp = {
        x: right.z * dir.y - right.x * dir.z,
        y: right.x * dir.x + right.z * dir.z,
        z: right.z * 0 - 0 * dir.x
      };
      // Store direction as simple object for client to reconstruct
      const gearEffect = new ActiveGearEffect(
        'sniper',
        shooterId,
        { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z },
        { x: dir.x, y: dir.y, z: dir.z, w: 1 },  // direction as x,y,z; w=1 for quaternion
        Date.now(),
        effectDuration
      );
      gearEffect.direction = { x: dir.x, y: dir.y, z: dir.z };  // Store direction for client
      this._gearEffects.push(gearEffect);
      if (this._onGearPreview) {
        this._onGearPreview(gearEffect);
      }

      // Store pending snipe to execute after preview duration
      // Store actual camera position and direction to use at execution time
      const pending = new PendingSnipe(
        shooterId,
        playerEntries,
        { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z },  // Store camera position
        { x: dir.x, y: dir.y, z: dir.z },  // Store normalized direction
        eyeOffset,
        previewDuration
      );
      pending.shooterBody = shooterBody;  // Store body for physics access at fire time
      this._pendingSnipes.push(pending);

      return { success: true };
    } catch (err) {
      console.error('[GearSystem.snipe] Error:', err);
      return { success: false };
    }
  }

  /**
   * Execute a pending snipe using the current shooter position and direction.
   * 
   * @param {PendingSnipe} pending
   * @param {RAPIER.RigidBody} shooterBody Current body of shooter
   * @param {{ camDir: { x, y, z } }} shooterInput Current input of shooter (for camera direction)
   */
  executePendingSnipe(pending, shooterBody, shooterInput) {
    const { shooterId, playerEntries, eyeOffset } = pending;
    
    // Get current position from shooter's body (not stored position from 2 seconds ago)
    const shooterPos = shooterBody.translation();
    // Start from eye level, like the grapple does
    const cameraPos = { x: shooterPos.x, y: shooterPos.y + eyeOffset, z: shooterPos.z };
    const cameraDir = shooterInput?.camDir || { x: 0, y: 0, z: 1 };

    try {
      // Raycast from the exact camera position sent by client
      const maxDist = 1000;
      const SKIP_DIST = 2.0; // Large offset to escape player's own collider
      
      // Normalize direction
      const len = Math.sqrt(cameraDir.x ** 2 + cameraDir.y ** 2 + cameraDir.z ** 2);
      const dir = len > 0.01 ? {
        x: cameraDir.x / len,
        y: cameraDir.y / len,
        z: cameraDir.z / len,
      } : { x: 0, y: 0, z: 0 };
      
      // Use camera position directly (already positioned correctly on client)
      const rayOrigin = {
        x: cameraPos.x + dir.x * SKIP_DIST,
        y: cameraPos.y + dir.y * SKIP_DIST,
        z: cameraPos.z + dir.z * SKIP_DIST
      };
      const rayDir = { x: dir.x, y: dir.y, z: dir.z };

      // Use Rapier raycast to find closest hit
      let closestDist = maxDist - SKIP_DIST;
      let hitBody = null;

      const ray = new RAPIER.Ray(rayOrigin, rayDir);
      const result = this._physics.world.castRay(ray, maxDist - SKIP_DIST, true);
      
      if (result) {
        closestDist = result.toi;
        hitBody = result.collider.parent();
      }

      // Find which player (if any) was hit (exclude the shooter)
      let targetSid = null;
      if (hitBody) {
        for (const { sid, body } of playerEntries) {
          if (sid !== shooterId && body === hitBody) {
            targetSid = sid;
            break;
          }
        }
      }

      // Create the visual line (from camera to hit point, adjusted for ray offset)
      const actualOrigin = { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z };
      const hitPos = {
        x: rayOrigin.x + rayDir.x * closestDist,
        y: rayOrigin.y + rayDir.y * closestDist,
        z: rayOrigin.z + rayDir.z * closestDist,
      };

      const line = new ActiveLine(actualOrigin, hitPos, Date.now(), 3000, { x: dir.x, y: dir.y, z: dir.z });
      this._lines.push(line);
      if (this._onLineSpawn) {
        this._onLineSpawn(line);
      } else {
        console.warn('[GearSystem.executePendingSnipe] No onLineSpawn callback!');
      }

      // Deal damage if hit a player
      if (targetSid) {
        this._onSnipeHit(shooterId, targetSid, GEAR_REGISTRY.sniper.damage);
      }

      return { success: !!targetSid, targetSid };
    } catch (err) {
      console.error('[GearSystem.executePendingSnipe] Error:', err);
      return { success: false };
    }
  }

  /**
   * Attempt to use the mace gear.
   * Shows a 3-second charge animation, then executes AOE damage.
   * 
   * @param {RAPIER.RigidBody} shooterBody
   * @param {Array<{sid, body}>} playerEntries players with their bodies
   * @param {string}            shooterId sessionId of the player using mace
   * @returns {object} { success }
   */
  mace(shooterBody, playerEntries, shooterId) {
    try {
      
      // Get shooter position
      const shooterPos = shooterBody.translation();
      
      // Create gear preview effect (visible for charge duration)
      const previewDuration = (GEAR_REGISTRY.mace && GEAR_REGISTRY.mace.previewDuration) || 3000;
      const postFireDuration = (GEAR_REGISTRY.mace && GEAR_REGISTRY.mace.postFireDuration) || 1000;
      const effectDuration = previewDuration + postFireDuration;

      const gearEffect = new ActiveGearEffect(
        'mace',
        shooterId,
        { x: shooterPos.x, y: shooterPos.y + 1.5, z: shooterPos.z },  // Position above head
        { x: 0, y: 0, z: 0, w: 1 },
        Date.now(),
        effectDuration
      );
      this._gearEffects.push(gearEffect);
      if (this._onGearPreview) {
        this._onGearPreview(gearEffect);
      }

      // Store pending mace to execute after charge duration
      const pending = new PendingMace(shooterId, shooterBody, playerEntries, previewDuration);
      this._pendingMaces.push(pending);

      return { success: true };
    } catch (err) {
      console.error('[GearSystem.mace] Error:', err);
      return { success: false };
    }
  }

  /**
   * Execute a pending mace, dealing AOE damage scaled by velocity.
   * 
   * @param {PendingMace} pending
   */
  executePendingMace(pending) {
    const { shooterId, shooterBody, playerEntries, startVelocity } = pending;
    
    try {
      
      // Get current position
      const shooterPos = shooterBody.translation();
      const impactPos = { x: shooterPos.x, y: shooterPos.y, z: shooterPos.z };

      // Calculate velocity magnitude for damage scaling
      const velocity = shooterBody.linvel();
      const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
      const baseSpeed = Math.sqrt(startVelocity.x ** 2 + startVelocity.y ** 2 + startVelocity.z ** 2);
      
      // Damage scales from base damage (40) to base damage + 60 based on speed
      // Max speed considered: 30 m/s, so 40 + 60 = 100 max damage
      const speedFactor = Math.min(1, speed / 30);
      const baseDamage = GEAR_REGISTRY.mace.damage;
      const scaledDamage = baseDamage + (60 * speedFactor);
      
      // Find all players within AOE radius
      const aoeRadius = GEAR_REGISTRY.mace.aoeRadius || 3.0;
      const hitsPerformed = new Set();

      for (const { sid, body } of playerEntries) {
        if (sid === shooterId) continue;  // Skip self
        
        const targetPos = body.translation();
        const dx = targetPos.x - impactPos.x;
        const dy = targetPos.y - impactPos.y;
        const dz = targetPos.z - impactPos.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance <= aoeRadius) {
          if (this._onAoeDamage) {
            this._onAoeDamage(shooterId, sid, Math.round(scaledDamage));
          } else {
            console.warn('[GearSystem.executePendingMace] _onAoeDamage callback not defined!');
          }
          hitsPerformed.add(sid);
        }
      }

      // Spawn particles at impact
      if (this._onParticles) {
        this._onParticles(impactPos, 'mace_impact', 20 + Math.floor(speedFactor * 10));
      }

      return { success: true, targets: Array.from(hitsPerformed), damage: Math.round(scaledDamage) };
    } catch (err) {
      console.error('[GearSystem.executePendingMace] Error:', err);
      return { success: false };
    }
  }

  /**
   * Update active lines, gear effects, and pending snipes (called each tick).
   * Returns pre-allocated arrays (cleared each tick) — do not retain references.
   * @returns {{ readySnipes: PendingSnipe[], readyMaces: PendingMace[] }}
   */
  tick() {
    const now = Date.now();

    // In-place cleanup of expired lines (backwards splice avoids index shifting)
    for (let i = this._lines.length - 1; i >= 0; i--) {
      if (this._lines[i].isExpired(now)) this._lines.splice(i, 1);
    }
    for (let i = this._gearEffects.length - 1; i >= 0; i--) {
      if (this._gearEffects[i].isExpired(now)) this._gearEffects.splice(i, 1);
    }

    // Collect ready snipes/maces into pre-allocated result arrays, remove from pending
    this._tickReadySnipes.length = 0;
    this._tickReadyMaces.length  = 0;
    for (let i = this._pendingSnipes.length - 1; i >= 0; i--) {
      if (this._pendingSnipes[i].isReady(now)) {
        this._tickReadySnipes.push(this._pendingSnipes[i]);
        this._pendingSnipes.splice(i, 1);
      }
    }
    for (let i = this._pendingMaces.length - 1; i >= 0; i--) {
      if (this._pendingMaces[i].isReady(now)) {
        this._tickReadyMaces.push(this._pendingMaces[i]);
        this._pendingMaces.splice(i, 1);
      }
    }

    return this._tickResult;
  }

  /**
   * Get all currently active lines for rendering.
   * @returns {ActiveLine[]}
   */
  getActiveLines() {
    return this._lines;
  }

  /**
   * Get all currently active gear preview effects.
   * @returns {ActiveGearEffect[]}
   */
  getActiveGearEffects() {
    return this._gearEffects;
  }

  /**
   * Get gear definition by name.
   * @param {string} gearName  'sniper', etc.
   * @returns {object} gear definition or null
   */
  static getGear(gearName) {
    return GEAR_REGISTRY[gearName] || null;
  }

  /**
   * Get all available gear IDs.
   * @returns {string[]}
   */
  static getAllGearIds() {
    return Object.keys(GEAR_REGISTRY);
  }
}

module.exports = { GearSystem, GEAR_REGISTRY, ActiveGearEffect };
