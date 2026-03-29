// ── client/src/Nametags.js ───────────────────────────────────────────────────
// Usage:
//   import { Nametags } from './Nametags.js';
//   const nametags = new Nametags(scene);
//
//   // When a 'playerInfo' message arrives from the room:
//   nametags.register(info);          // { sessionId, username, userPrefix,
//                                     //   prefixColor, usernameColor }
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
    // sessionId → { info, sprite, canvas, ctx, texture }
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
      // Update existing entry — redraw the texture
      const entry = this._entries.get(info.sessionId);
      entry.info = info;
      buildTexture(entry.canvas, entry.ctx, info);
      entry.texture.needsUpdate = true;
      return;
    }

    // Build canvas + texture
    const canvas  = document.createElement('canvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx     = canvas.getContext('2d');
    buildTexture(canvas, ctx, info);

    const texture  = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter; // avoids mipmap shimmer
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map:         texture,
      transparent: true,
      depthWrite:  false,  // don't occlude geometry behind it
      depthTest:   true,
      sizeAttenuation: true, // shrink with distance (perspective feel)
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(SPRITE_SCALE_X, SPRITE_SCALE_Y, 1);
    sprite.visible = false; // hidden until the mesh position is known
    sprite.renderOrder = 1; // draw after opaque geometry

    this._scene.add(sprite);

    this._entries.set(info.sessionId, { info, sprite, canvas, ctx, texture });
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
        continue;
      }

      entry.sprite.visible = true;

      // Position above the mesh
      entry.sprite.position.set(
        mesh.position.x,
        mesh.position.y + VERTICAL_OFFSET,
        mesh.position.z,
      );

      // THREE.Sprite auto-billboards in camera space — no manual quaternion needed.
      // We just keep the position synced.
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
    entry.sprite.material.dispose();
    entry.texture.dispose();
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
