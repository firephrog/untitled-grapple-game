// ── client/src/Nametags.js ───────────────────────────────────────────────────
// Usage:
//   import { Nametags } from './Nametags.js';
//   const nametags = new Nametags(scene);
//
//   // When a 'playerInfo' message arrives from the room:
//   nametags.register(info);          // { sessionId, username, userPrefix,
//                                     //   prefixColor, usernameColor }
//
//   // For FFA mode, set health on players:
//   nametags.setHealth(sessionId, currentHP, maxHP);
//
//   // Every animation frame (after player mesh positions are updated):
//   nametags.update(playerMeshMap, mySessionId, camera);
//   // playerMeshMap: Map<sessionId, THREE.Object3D>
//
//   // On cleanup:
//   nametags.dispose();
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

// ── Canvas rendering ─────────────────────────────────────────────────────────

const CANVAS_W    = 512;   // texture width  (power-of-2 for old GPUs)
const CANVAS_H    = 128;   // texture height
const SPRITE_SCALE_X = 3.2;  // world-space width of the sprite quad
const SPRITE_SCALE_Y = 0.8;  // world-space height
const VERTICAL_OFFSET = 2.6; // units above mesh origin (player radius = 1)
const HP_BAR_CANVAS_W = 256;  // HP bar texture width
const HP_BAR_CANVAS_H = 32;   // HP bar texture height

/**
 * Draw the nametag onto an offscreen canvas and return a THREE.CanvasTexture.
 * The canvas is reused across updates to avoid excessive GC pressure.
 */
function buildTexture(canvas, ctx, info) {
  // Clear
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Background pill — semi-transparent dark
  const pad = 12;
  const h   = CANVAS_H;
  const w   = CANVAS_W;
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle   = '#111118';
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, 5);
  ctx.fill();
  ctx.restore();

  // Text layout
  const cx    = w / 2;
  const cy    = h / 2 + 2; // slight downward nudge for visual centering
  const hasPrefix = info.userPrefix && info.userPrefix.trim().length > 0;

  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';

  if (hasPrefix) {
    // Measure both parts so we can centre them together
    const prefixText = `[${info.userPrefix}]`;
    const nameText   = info.username;

    ctx.font = 'bold 42px "Space Mono", monospace, sans-serif';
    const prefixW = ctx.measureText(prefixText + ' ').width;
    ctx.font = 'bold 44px "Space Grotesk", sans-serif';
    const nameW = ctx.measureText(nameText).width;

    const totalW  = prefixW + nameW;
    let   startX  = cx - totalW / 2;

    // Draw prefix
    ctx.font        = 'bold 42px "Space Mono", monospace, sans-serif';
    ctx.fillStyle   = info.prefixColor || '#aaaaaa';
    ctx.globalAlpha = 0.95;
    ctx.textAlign   = 'left';
    ctx.fillText(prefixText + ' ', startX, cy);

    // Draw username
    ctx.font        = 'bold 44px "Space Grotesk", sans-serif';
    ctx.fillStyle   = info.usernameColor || '#ffffff';
    ctx.fillText(nameText, startX + prefixW, cy);
  } else {
    // Username only — centred
    ctx.font        = 'bold 44px "Space Grotesk", sans-serif';
    ctx.fillStyle   = info.usernameColor || '#ffffff';
    ctx.globalAlpha = 0.95;
    ctx.fillText(info.username, cx, cy);
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw an HP bar onto a canvas.
 */
function buildHPBarTexture(canvas, ctx, health, maxHealth) {
  // Clear
  ctx.clearRect(0, 0, HP_BAR_CANVAS_W, HP_BAR_CANVAS_H);

  const pad = 4;
  const barW = HP_BAR_CANVAS_W - pad * 2;
  const barH = HP_BAR_CANVAS_H - pad * 2;
  const healthPercent = Math.max(0, Math.min(100, (health / maxHealth) * 100));

  // Background (dark)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(pad, pad, barW, barH);

  // Border
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, barW, barH);

  // Health bar (green to red gradient)
  const fillWidth = (barW * healthPercent) / 100;
  const hue = (healthPercent / 100) * 120;  // 0-120 degrees (green to red)
  ctx.fillStyle = `hsl(${hue}, 100%, 40%)`;
  ctx.fillRect(pad, pad, fillWidth, barH);

  // Health text
  ctx.font = 'bold 16px "Space Mono", monospace, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.floor(health)}/${maxHealth}`, HP_BAR_CANVAS_W / 2, HP_BAR_CANVAS_H / 2);
}

/** Minimal canvas roundRect helper (works before the native API is universal). */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Nametags class ────────────────────────────────────────────────────────────

export class Nametags {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene   = scene;
    // sessionId → { info, sprite, canvas, ctx, texture, hpCanvas, hpCtx, hpTexture, hpSprite, health, maxHealth }
    this._entries = new Map();
  }

  /**
   * Register (or update) display info for a player session.
   * Safe to call multiple times for the same session.
   *
   * @param {{ sessionId, username, userPrefix, prefixColor, usernameColor }} info
   */
  register(info) {
    if (!info || !info.sessionId) return;

    if (this._entries.has(info.sessionId)) {
      // Update existing entry — redraw the texture only if info changed
      const entry = this._entries.get(info.sessionId);
      const infoChanged = 
        entry.info.username !== info.username ||
        entry.info.userPrefix !== info.userPrefix ||
        entry.info.prefixColor !== info.prefixColor ||
        entry.info.usernameColor !== info.usernameColor;
      
      if (infoChanged) {
        entry.info = info;
        buildTexture(entry.canvas, entry.ctx, info);
        entry.texture.needsUpdate = true;
      }
      return;
    }

    // Build canvas + texture for nametag
    const canvas  = document.createElement('canvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx     = canvas.getContext('2d');
    buildTexture(canvas, ctx, info);

    const texture  = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map:         texture,
      transparent: true,
      depthWrite:  false,
      depthTest:   true,
      sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(SPRITE_SCALE_X, SPRITE_SCALE_Y, 1);
    sprite.visible = false;
    sprite.renderOrder = 1;
    this._scene.add(sprite);

    // Build canvas + texture for HP bar
    const hpCanvas = document.createElement('canvas');
    hpCanvas.width = HP_BAR_CANVAS_W;
    hpCanvas.height = HP_BAR_CANVAS_H;
    const hpCtx = hpCanvas.getContext('2d');
    buildHPBarTexture(hpCanvas, hpCtx, 100, 100);

    const hpTexture = new THREE.CanvasTexture(hpCanvas);
    hpTexture.minFilter = THREE.LinearFilter;
    hpTexture.magFilter = THREE.LinearFilter;

    const hpMaterial = new THREE.SpriteMaterial({
      map:         hpTexture,
      transparent: true,
      depthWrite:  false,
      depthTest:   true,
      sizeAttenuation: true,
    });

    const hpSprite = new THREE.Sprite(hpMaterial);
    hpSprite.scale.set(SPRITE_SCALE_X * 0.6, SPRITE_SCALE_Y * 0.4, 1);
    hpSprite.visible = false;
    hpSprite.renderOrder = 1;
    this._scene.add(hpSprite);

    this._entries.set(info.sessionId, { 
      info, sprite, canvas, ctx, texture,
      hpCanvas, hpCtx, hpTexture, hpSprite,
      health: 100, maxHealth: 100
    });
  }

  /**
   * Update health for a player (FFA mode).
   * @param {string} sessionId
   * @param {number} currentHealth
   * @param {number} maxHealth
   */
  setHealth(sessionId, currentHealth, maxHealth) {
    const entry = this._entries.get(sessionId);
    if (!entry) return;

    if (entry.health !== currentHealth || entry.maxHealth !== maxHealth) {
      entry.health = currentHealth;
      entry.maxHealth = maxHealth;
      buildHPBarTexture(entry.hpCanvas, entry.hpCtx, currentHealth, maxHealth);
      entry.hpTexture.needsUpdate = true;
    }
  }

  /**
   * Call once per frame after player mesh positions have been updated.
   *
   * @param {Map<string, THREE.Object3D>} meshMap   sessionId → mesh
   * @param {string}                      myId      own session (hide own tag)
   * @param {THREE.Camera}                camera    for billboard orientation
   */
  update(meshMap, myId, camera) {
    for (const [sid, entry] of this._entries) {
      const mesh = meshMap.get(sid);

      // Hide if: own player, or mesh not yet spawned
      if (sid === myId || !mesh) {
        entry.sprite.visible = false;
        entry.hpSprite.visible = false;
        continue;
      }

      entry.sprite.visible = true;
      // HP bars only show in FFA mode
      entry.hpSprite.visible = (entry.health !== undefined) && (window.isFFA === true);

      // Position above the mesh
      entry.sprite.position.set(
        mesh.position.x,
        mesh.position.y + VERTICAL_OFFSET,
        mesh.position.z,
      );

      // Position HP bar below nametag
      entry.hpSprite.position.set(
        mesh.position.x,
        mesh.position.y + VERTICAL_OFFSET - 0.7,
        mesh.position.z,
      );
    }
  }

  /**
   * Remove a specific player's nametag (e.g. on disconnect).
   * @param {string} sessionId
   */
  remove(sessionId) {
    const entry = this._entries.get(sessionId);
    if (!entry) return;
    this._scene.remove(entry.sprite);
    this._scene.remove(entry.hpSprite);
    entry.sprite.material.dispose();
    entry.texture.dispose();
    entry.hpSprite.material.dispose();
    entry.hpTexture.dispose();
    this._entries.delete(sessionId);
  }

  /**
   * Dispose all nametags and free GPU resources.
   */
  dispose() {
    for (const sid of [...this._entries.keys()]) {
      this.remove(sid);
    }
  }
}
