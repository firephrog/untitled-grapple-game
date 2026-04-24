'use strict';

/**
 * ── SkinCache.js ────────────────────────────────────────────────────────────
 * Server-side skin caching system
 * 
 * Tracks which skins are loaded in memory to avoid repeated disk reads
 * Loads skins on-demand (player skins on login, opponent skin on match start)
 * Unloads opponent skins when not needed to free memory
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

class SkinCache {
  constructor() {
    this._cache = new Map();  // skinId → Buffer (GLB file data)
    this._skinsDir = path.join(__dirname, '..', 'skins', 'models');
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Get a skin GLB file (cached or loaded from disk)
   * @param {string} skinId - Skin ID (e.g., 'default', 'cube', 'metallic')
   * @param {string} type - Skin type: 'player', 'grapple', 'bomb'
   * @returns {Buffer|null} GLB file buffer or null if not found
   */
  getSkin(skinId, type = 'player') {
    const cacheKey = `${type}:${skinId}`;
    
    // Check cache first
    if (this._cache.has(cacheKey)) {
      this._hits++;
      return this._cache.get(cacheKey);
    }

    // Load from disk
    const filePath = this._getSkinFilePath(skinId, type);
    if (!fs.existsSync(filePath)) {
      console.warn(`[SkinCache] Skin not found: ${cacheKey} at ${filePath}`);
      return null;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      this._cache.set(cacheKey, buffer);
      this._misses++;
      return buffer;
    } catch (err) {
      console.error(`[SkinCache] Failed to load ${cacheKey}:`, err.message);
      return null;
    }
  }

  /**
   * Preload multiple skins for a user (called on login)
   * @param {Array<string>} skinIds - Array of skin IDs to preload
   * @param {string} type - Skin type: 'player', 'grapple', 'bomb'
   */
  preloadSkins(skinIds, type = 'player') {
    if (!Array.isArray(skinIds)) return;
    
    let loaded = 0;
    for (const skinId of skinIds) {
      if (this.getSkin(skinId, type)) {
        loaded++;
      }
    }
  }

  /**
   * Unload a skin from cache to free memory
   * @param {string} skinId - Skin ID
   * @param {string} type - Skin type
   */
  unloadSkin(skinId, type = 'player') {
    const cacheKey = `${type}:${skinId}`;
    if (this._cache.has(cacheKey)) {
      const buffer = this._cache.get(cacheKey);
      this._cache.delete(cacheKey);
    }
  }

  /**
   * Unload multiple skins
   * @param {Array<string>} skinIds - Array of skin IDs
   * @param {string} type - Skin type
   */
  unloadSkins(skinIds, type = 'player') {
    if (!Array.isArray(skinIds)) return;
    for (const skinId of skinIds) {
      this.unloadSkin(skinId, type);
    }
  }

  /**
   * Clear all cached skins
   */
  clear() {
    const memBefore = this._getMemUsage();
    this._cache.clear();
    const memAfter = this._getMemUsage();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cached: this._cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0 ? (this._hits / (this._hits + this._misses) * 100).toFixed(1) : 0,
      memoryUsage: (this._getMemUsage() / 1024 / 1024).toFixed(2),
    };
  }

  // ── Internal ──────────────────────────────────────────────────

  _getSkinFilePath(skinId, type) {
    // For now, all skins are in skins/models directory
    // In the future, could organize as: skins/models/players/, skins/models/grapples/, etc.
    const filePath = path.join(this._skinsDir, `${skinId}.glb`);
    return filePath;
  }

  _getMemUsage() {
    let total = 0;
    for (const buffer of this._cache.values()) {
      total += buffer.length;
    }
    return total;
  }
}

module.exports = new SkinCache();
