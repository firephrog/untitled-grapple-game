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

const GEAR_REGISTRY = {
  sniper: {
    name: 'Sniper',
    damage: 50,
    cooldown: 2500,  // ms
    image: '/static/skins/common/cheeseburger.png',  // placeholder
    glb: '/gear/sniper.glb',  // GLB model path
    previewDuration: 2000,  // 2 seconds before firing
    postFireDuration: 1000,  // 1 second visible after firing
    scale: 1.0,
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
   */
  constructor(physicsWorld, onSnipeHit, onLineSpawn, onGearPreview) {
    this._physics = physicsWorld;
    this._onSnipeHit = onSnipeHit;
    this._onLineSpawn = onLineSpawn;
    this._onGearPreview = onGearPreview;
    
    this._lines = [];  // Array of ActiveLine
    this._gearEffects = [];  // Array of ActiveGearEffect
    this._pendingSnipes = [];  // Array of PendingSnipe waiting to execute
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
      console.log('[GearSystem.snipe] Creating gear effect with duration:', {
        previewDuration,
        postFireDuration,
        totalDuration,
        gearRegistry: GEAR_REGISTRY.sniper,
      });
      
      // Ensure totalDuration is at least 3000ms
      const effectDuration = Math.max(totalDuration, 3000);
      
      const gearEffect = new ActiveGearEffect(
        'sniper',
        shooterId,
        { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z },
        { x: dir.x, y: dir.y, z: dir.z, w: 0 },
        Date.now(),
        effectDuration
      );
      this._gearEffects.push(gearEffect);
      if (this._onGearPreview) {
        console.log('[GearSystem.snipe] Calling _onGearPreview with duration:', effectDuration);
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
      if (this._onLineSpawn) this._onLineSpawn(line);

      // Deal damage if hit a player
      if (targetSid) {
        this._onSnipeHit(shooterId, targetSid, GEAR_REGISTRY.sniper.damage);
        console.log(`[Sniper] ${shooterId} hit ${targetSid} for ${GEAR_REGISTRY.sniper.damage} damage`);
      }

      return { success: !!targetSid, targetSid };
    } catch (err) {
      console.error('[GearSystem.executePendingSnipe] Error:', err);
      return { success: false };
    }
  }

  /**
   * Update active lines, gear effects, and pending snipes (called each tick).
   * @returns {Array} Array of ready snipes to execute
   */
  tick() {
    const now = Date.now();
    
    // Clean up expired lines and effects
    this._lines = this._lines.filter(line => !line.isExpired(now));
    this._gearEffects = this._gearEffects.filter(effect => !effect.isExpired(now));
    
    // Find snipes that are ready to execute
    const readySnipes = this._pendingSnipes.filter(p => p.isReady(now));
    this._pendingSnipes = this._pendingSnipes.filter(p => !p.isReady(now));
    
    return readySnipes;  // Return ready snipes for execution
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
