// ── client/src/SkinManager.js ─────────────────────────────────────────────────
// Manages player skin meshes in the Three.js scene.
//
// Responsibilities:
//   - Load GLB skin files (with caching so the same GLB is never fetched twice)
//   - Swap a player's visible mesh between skins on demand
//   - Rotate each skin mesh to match the owning player's camera yaw
//   - Dispose of old meshes/geometries/materials to avoid memory leaks
//
// Usage inside main.js:
//
//   import { SkinManager } from './SkinManager.js';
//   const skinMgr = new SkinManager(scene, gltfLoader);
//
//   // When 'skinInfo' arrives from the server:
//   room.onMessage('skinInfo', async (data) => {
//     await skinMgr.assignSkin(myId,  data[myId],  true);   // true = local player
//     await skinMgr.assignSkin(oppId, data[oppId], false);
//   });
//
//   // Every frame in animate():
//   skinMgr.setPosition(myId,  p.x, p.y, p.z);
//   skinMgr.setRotationY(myId, camera.rotation.y);          // local player yaw
//
//   skinMgr.setPosition(oppId,  interp.x, interp.y, interp.z);
//   skinMgr.setRotationY(oppId, oppYaw);    // server sends this (see note below)
//
// ── Opponent yaw note ─────────────────────────────────────────────────────────
// The server doesn't track yaw yet. Two practical options:
//   A) Add a `yaw` field to the input message and echo it back in PlayerState —
//      cheapest, already synced with inputs.
//   B) Derive yaw client-side from the opponent's velocity direction each frame.
//      Works without any schema changes:
//
//        const v = oppState.velocity;
//        if (Math.abs(v.x) + Math.abs(v.z) > 0.5) {
//          oppYaw = Math.atan2(v.x, v.z);
//        }
//        skinMgr.setRotationY(oppId, oppYaw);
//
//   Option B is implemented at the bottom of this file as a helper:
//     SkinManager.yawFromVelocity(vx, vz, fallback)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

export class SkinManager {
  /**
   * @param {THREE.Scene}  scene
   * @param {GLTFLoader}   gltfLoader  same instance used for maps
   */
  constructor(scene, gltfLoader) {
    this._scene   = scene;
    this._loader  = gltfLoader;

    // sessionId → { root: THREE.Group, eyeOffset: number, isLocal: boolean }
    this._players = new Map();

    // glbPath → Promise<THREE.Group>  (template, never added to scene directly)
    this._cache   = new Map();
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Assign (or re-assign) a skin to a player session.
   * Removes and disposes any previously assigned mesh first.
   *
   * @param {string}  sessionId
   * @param {{ skinId, glb, scale, eyeOffset }} skinData
   * @param {boolean} isLocal  true = local player (mesh hidden, first-person)
   * @returns {Promise<THREE.Group>}
   */
  async assignSkin(sessionId, skinData, isLocal = false) {
    this._removeMesh(sessionId);

    const root = await this._loadSkinMesh(skinData);

    // Local player mesh stays invisible — we're in first-person.
    // It still exists so grapple rope anchors work correctly.
    if (isLocal) root.visible = false;

    this._scene.add(root);
    this._players.set(sessionId, {
      root,
      eyeOffset: skinData.eyeOffset ?? 1.0,
      isLocal,
    });

    return root;
  }

  /**
   * Update the world-space XZ position of a player's mesh.
   * Call every frame.
   */
  setPosition(sessionId, x, y, z) {
    const entry = this._players.get(sessionId);
    if (entry) entry.root.position.set(x, y, z);
  }

  /**
   * Rotate the skin mesh around Y to match the player's camera yaw.
   * Call every frame with camera.rotation.y for the local player,
   * or a derived yaw for the opponent (see SkinManager.yawFromVelocity).
   *
   * @param {string} sessionId
   * @param {number} yaw  radians, same convention as THREE camera rotation Y
   */
  setRotationY(sessionId, yaw) {
    const entry = this._players.get(sessionId);
    if (entry) entry.root.rotation.y = yaw;
  }

  /**
   * Returns the eye-height offset for a player (used to position the camera).
   */
  getEyeOffset(sessionId) {
    return this._players.get(sessionId)?.eyeOffset ?? 1.0;
  }

  /**
   * Returns the root Group for a player (use as grapple rope anchor, etc.)
   */
  getRoot(sessionId) {
    return this._players.get(sessionId)?.root ?? null;
  }

  /**
   * Fully remove a player's mesh and free GPU memory.
   */
  removePlayer(sessionId) {
    this._removeMesh(sessionId);
    this._players.delete(sessionId);
  }

  /**
   * Remove all tracked players (call on game end / room leave).
   */
  removeAll() {
    for (const sid of [...this._players.keys()]) {
      this._removeMesh(sid);
    }
    this._players.clear();
  }

  // ── Static helpers ────────────────────────────────────────────

  /**
   * Derive a yaw angle (radians) from a velocity vector.
   * Use this to rotate the opponent skin without a dedicated yaw field:
   *
   *   oppYaw = SkinManager.yawFromVelocity(oppState.velocity.x,
   *                                         oppState.velocity.z, oppYaw);
   *   skinMgr.setRotationY(oppId, oppYaw);
   *
   * @param {number} vx
   * @param {number} vz
   * @param {number} fallback  previous yaw — returned unchanged when speed is low
   * @param {number} [threshold=0.5]  min horizontal speed to update
   */
  static yawFromVelocity(vx, vz, fallback, threshold = 0.5) {
    if (Math.abs(vx) + Math.abs(vz) < threshold) return fallback;
    return Math.atan2(vx, vz);
  }

  // ── Internal ──────────────────────────────────────────────────

  async _loadSkinMesh(skinData) {
    if (!skinData.glb) return this._makeSphereRoot(skinData.scale ?? 1.0);

    if (!this._cache.has(skinData.glb)) {
      this._cache.set(skinData.glb, this._fetchGLB(skinData.glb));
    }

    const template = await this._cache.get(skinData.glb);
    return this._cloneGLB(template, skinData.scale ?? 1.0);
  }

  _fetchGLB(glbPath) {
    return new Promise((resolve) => {
      this._loader.load(
        glbPath,
        (gltf) => {
          gltf.scene.traverse(obj => {
            if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
          });
          resolve(gltf.scene);
        },
        undefined,
        (err) => {
          console.warn(`[SkinManager] GLB load failed: ${glbPath}`, err);
          resolve(null);   // fall back to sphere in _cloneGLB
        }
      );
    });
  }

  _cloneGLB(template, scale) {
    if (!template) return this._makeSphereRoot(scale);

    const clone = template.clone(true);
    clone.scale.setScalar(scale);
    clone.traverse(obj => {
      if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
    });
    return clone;
  }

  _makeSphereRoot(scale) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1 * scale),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    const root = new THREE.Group();
    root.add(mesh);
    return root;
  }

  _removeMesh(sessionId) {
    const entry = this._players.get(sessionId);
    if (!entry) return;
    this._scene.remove(entry.root);
    entry.root.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => m?.dispose());
      }
    });
  }
}
