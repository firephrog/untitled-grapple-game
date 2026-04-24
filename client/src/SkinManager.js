// ── client/src/SkinManager.js ─────────────────────────────────────────────────
// Manages the skins, used for customization.
//
// SkinManager  — GLB skin models, position, yaw rotation
// HookManager  — X-cross sprite hooks + colored rope, one per player
// BombManager  — bomb meshes with optional skins
//
// runUnlockCheck — Sends a request to the server, to check if the player has unlocked a skin. If they have, returns the unlocked skins. This is used for the unlock notification.
//
// Both follow the same pattern:
//   assign*(id, data)          called once when skinInfo arrives
//   update*(id, ...)           called every frame in animate()
//   removeAll()                called on game end
//
// Usage in main.js:
//
//   import { SkinManager, HookManager } from './SkinManager.js';
//   const skinMgr = new SkinManager(scene, gltfLoader);
//   const hookMgr = new HookManager(scene);
//
//   // gameStart handler:
//   await skinMgr.assignSkin(oppId, oppSkinData, false);
//   hookMgr.assignHook('local', mySkinData.grapple);
//   hookMgr.assignHook(oppId,   oppSkinData.grapple);
//
//   // animate():
//   skinMgr.setPosition(oppId, x, y, z);
//   skinMgr.setRotationY(oppId, oppYaw);
//   hookMgr.update('local', barrelPos, hookPos, ms.grapple.active);
//   hookMgr.update(oppId,   oppRoot.position, hookWorld, os.grapple.active);
//
//   // game end:
//   skinMgr.removeAll();
//   hookMgr.removeAll();
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

// ── Shared texture cache (across all HookManager instances) ───
const _texCache = new Map();
function _loadTex(path) {
  if (_texCache.has(path)) return _texCache.get(path);
  // Add cache busting to prevent stale texture loads
  const pathWithCache = `${path}?v=${Date.now()}`;
  const t = new THREE.TextureLoader().load(pathWithCache);
  t.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(path, t);
  return t;
}

// ── Reusable math (never allocated per-frame) ─────────────────
const _dir   = new THREE.Vector3();
const _up    = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const _fwd   = new THREE.Vector3(0, 0, 1);
const _q     = new THREE.Quaternion();

const ROPE_RADIUS = 0.04;
const ROPE_SEGS   = 4;

// ═══════════════════════════════════════════════════════════════
//  SkinManager — player GLB meshes
// ═══════════════════════════════════════════════════════════════
export class SkinManager {
  constructor(scene, gltfLoader) {
    this._scene   = scene;
    this._loader  = gltfLoader;
    this._players = new Map();  // id → { root, eyeOffset, isLocal }
    this._cache   = new Map();  // glbPath → Promise<Group>
  }

  // ── Public ───────────────────────────────────────────────────

  async assignSkin(sessionId, skinData, isLocal = false) {
    this._removeMesh(sessionId);
    const root = await this._loadSkinMesh(skinData);
    if (isLocal) root.visible = false;
    this._scene.add(root);
    this._players.set(sessionId, { root, eyeOffset: skinData.eyeOffset ?? 1.0, isLocal });
    return root;
  }

  setPosition(sessionId, x, y, z) {
    this._players.get(sessionId)?.root.position.set(x, y, z);
  }

  setRotationY(sessionId, yaw) {
    const e = this._players.get(sessionId);
    if (e) e.root.rotation.y = yaw;
  }

  getEyeOffset(sessionId) { return this._players.get(sessionId)?.eyeOffset ?? 1.0; }
  getRoot(sessionId)      { return this._players.get(sessionId)?.root ?? null; }

  removePlayer(sessionId) { this._removeMesh(sessionId); this._players.delete(sessionId); }

  removeAll() {
    for (const sid of [...this._players.keys()]) this._removeMesh(sid);
    this._players.clear();
  }

  static yawFromVelocity(vx, vz, fallback, threshold = 0.01) {
    if (Math.abs(vx) + Math.abs(vz) < threshold) return fallback;
    return Math.atan2(vx, vz);
  }

  // ── Internal ─────────────────────────────────────────────────

  async _loadSkinMesh(skinData) {
    if (!skinData.glb) return this._makeSphereRoot(skinData.scale ?? 1.0);
    if (!this._cache.has(skinData.glb)) this._cache.set(skinData.glb, this._fetchGLB(skinData.glb));
    return this._cloneGLB(await this._cache.get(skinData.glb), skinData.scale ?? 1.0);
  }

  _fetchGLB(path) {
    return new Promise(resolve => {
      // Extract skin ID from path (e.g., "/skins/cube.glb" -> "cube")
      const skinId = path.split('/').pop().replace('.glb', '');
      // Add cache busting query parameter with current timestamp
      const apiUrl = `${window.API_BASE}/api/skins/download/player/${skinId}?v=${Date.now()}`;
      this._loader.load(apiUrl, gltf => {
        gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
        resolve(gltf.scene);
      }, undefined, err => { console.warn('[SkinManager] GLB failed:', path, err); resolve(null); });
    });
  }

  _cloneGLB(template, scale) {
    if (!template) return this._makeSphereRoot(scale);
    const clone = template.clone(true);
    clone.scale.setScalar(scale);
    clone.rotation.y = Math.PI;
    clone.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return clone;
  }

  _makeSphereRoot(scale) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1 * scale, 16, 16),  // Reduced from default 32x32 to 16x16
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    m.castShadow = m.receiveShadow = true;
    const g = new THREE.Group(); g.add(m); return g;
  }

  _removeMesh(sessionId) {
    const e = this._players.get(sessionId);
    if (!e) return;
    this._scene.remove(e.root);
    e.root.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose());
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  HookManager — grapple hook sprites + rope, same API shape
// ═══════════════════════════════════════════════════════════════
export class HookManager {
  constructor(scene) {
    this._scene = scene;
    this._hooks = new Map();  // id → { hookPivot, ropePivot, ropeMesh }
  }

  // ── Public ───────────────────────────────────────────────────

  /**
   * Assign a grapple skin. Call once when skinInfo arrives.
   * @param {string} id              sessionId or 'local'
   * @param {{ image, scale, color }} grappleData  from skinData.grapple
   */
  setCamera(id, camera) {
    const h = this._hooks.get(id);
    if (h) h._camera = camera;
  }

  assignHook(id, grappleData = {}, isLocal = false) {
    this._removeHook(id);
    const { image = null, scale = 0.6, color = 0x00ffff } = grappleData;

    const hookPivot = new THREE.Group();
    hookPivot.visible = false;

    if (image) {
      const tex = isLocal
        ? _loadTex(grappleData.localImage || image)
        : _loadTex(image);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.05,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const geo = new THREE.PlaneGeometry(scale, scale);

      if (isLocal) {
        // Single plane, always faces the camera via billboard in update()
        const plane = new THREE.Mesh(geo, mat);
        hookPivot.add(plane);
        hookPivot._isBillboard = true;  // flag so update() knows to billboard it
      } else {
        // X cross for opponent
        const planeA = new THREE.Mesh(geo, mat);
        const planeB = new THREE.Mesh(geo, mat);
        planeB.rotation.x = Math.PI / 2;
        planeA.rotation.y = Math.PI / 2;
        planeA.rotation.z = Math.PI / 2;
        hookPivot.add(planeA, planeB);
        hookPivot._isBillboard = false;
      }
    } else {
      hookPivot.add(new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshBasicMaterial({ color })
      ));
      hookPivot._isBillboard = false;
    }

    this._scene.add(hookPivot);

    const ropeMesh  = new THREE.Mesh(
      new THREE.CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, 1, ROPE_SEGS),
      new THREE.MeshBasicMaterial({ color, depthWrite: true })
    );
    const ropePivot = new THREE.Object3D();
    ropePivot.add(ropeMesh);
    ropePivot.visible = false;
    this._scene.add(ropePivot);

    this._hooks.set(id, { hookPivot, ropePivot, ropeMesh, _camera: null });

  }

  /**
   * Update hook + rope every frame.
   * @param {string}      id
   * @param {{ x,y,z }}   fromPos   rope start (barrelPos or player world pos)
   * @param {{ x,y,z }}   toPos     hook anchor world pos
   * @param {boolean}     isActive
   */
  update(id, fromPos, toPos, isActive) {
    const h = this._hooks.get(id);
    if (!h) return;

    h.hookPivot.visible = isActive;
    h.ropePivot.visible = isActive;
    if (!isActive) return;

    const ax = fromPos.x, ay = fromPos.y, az = fromPos.z;
    const bx = toPos.x,   by = toPos.y,   bz = toPos.z;

    // Rope
    h.ropePivot.position.set((ax+bx)*0.5, (ay+by)*0.5, (az+bz)*0.5);
    _dir.set(bx-ax, by-ay, bz-az);
    const len = _dir.length();
    if (len > 0.001) {
      _dir.divideScalar(len);
      const dot = _up.dot(_dir);
      if      (dot >  0.9999) _q.identity();
      else if (dot < -0.9999) _q.setFromAxisAngle(_right, Math.PI);
      else                    _q.setFromUnitVectors(_up, _dir);
      h.ropePivot.quaternion.copy(_q);
      h.ropeMesh.scale.y = len;
    }

    // Hook position
    h.hookPivot.position.set(bx, by, bz);

    // Billboard for local, rope-direction for opponent
    if (h.hookPivot._isBillboard && h._camera) {
      h.hookPivot.quaternion.copy(h._camera.quaternion);
    } else if (len > 0.001) {
      const fx = ax-bx, fy = ay-by, fz = az-bz;
      const fl = Math.sqrt(fx*fx + fy*fy + fz*fz);
      _dir.set(fx/fl, fy/fl, fz/fl);
      _q.setFromUnitVectors(_fwd, _dir);
      h.hookPivot.quaternion.copy(_q);
    }
  }

  removeHook(id) { this._removeHook(id); this._hooks.delete(id); }

  removeAll() {
    for (const id of [...this._hooks.keys()]) this._removeHook(id);
    this._hooks.clear();
  }

  // ── Internal ─────────────────────────────────────────────────

  _removeHook(id) {
    const h = this._hooks.get(id);
    if (!h) return;
    this._scene.remove(h.hookPivot);
    this._scene.remove(h.ropePivot);
    h.hookPivot.traverse(o => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); } });
    h.ropeMesh.geometry?.dispose();
    h.ropeMesh.material?.dispose();
  }
}

export class BombManager {
  constructor(scene, gltfLoader) {
    this._scene   = scene;
    this._loader  = gltfLoader;
    this._bombs   = new Map();  // bombId → { root, bombSkinData }
    this._cache   = new Map();  // glbPath → Promise<Group>
  }

  // ── Public ───────────────────────────────────────────────────

  async assignBomb(bombId, bombSkinData) {
    this._removeBomb(bombId);
    const root = await this._loadBombMesh(bombSkinData);
    this._scene.add(root);
    this._bombs.set(bombId, { root, bombSkinData });
    return root;
  }

  setPosition(bombId, x, y, z) {
    const entry = this._bombs.get(bombId);
    if (entry) entry.root.position.set(x, y, z);
  }

  setRotation(bombId, quaternion) {
    const entry = this._bombs.get(bombId);
    if (entry) entry.root.quaternion.copy(quaternion);
  }

  removeBomb(bombId) {
    this._removeBomb(bombId);
    this._bombs.delete(bombId);
  }

  removeAll() {
    for (const bombId of [...this._bombs.keys()]) this._removeBomb(bombId);
    this._bombs.clear();
  }

  // ── Internal ─────────────────────────────────────────────────

  async _loadBombMesh(bombSkinData) {
    if (!bombSkinData.glb) return this._makeSphereRoot(bombSkinData.scale ?? 1.0);
    if (!this._cache.has(bombSkinData.glb)) {
      this._cache.set(bombSkinData.glb, this._fetchGLB(bombSkinData.glb));
    }
    return this._cloneGLB(await this._cache.get(bombSkinData.glb), bombSkinData.scale ?? 1.0);
  }

  _fetchGLB(path) {
    return new Promise(resolve => {
      // Extract bomb skin ID from path (e.g., "/skins/bomb_metallic.glb" -> "bomb_metallic")
      const skinId = path.split('/').pop().replace('.glb', '');
      // Add cache busting query parameter with current timestamp
      const apiUrl = `${window.API_BASE}/api/skins/download/bomb/${skinId}?v=${Date.now()}`;
      this._loader.load(apiUrl, gltf => {
        gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
        resolve(gltf.scene);
      }, undefined, err => { console.warn('[BombManager] GLB failed:', path, err); resolve(null); });
    });
  }

  _cloneGLB(template, scale) {
    if (!template) return this._makeSphereRoot(scale);
    const clone = template.clone(true);
    clone.scale.setScalar(scale);
    clone.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return clone;
  }

  _makeSphereRoot(scale) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.5 * scale, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 })
    );
    m.castShadow = m.receiveShadow = true;
    const g = new THREE.Group(); g.add(m); return g;
  }

  _removeBomb(bombId) {
    const entry = this._bombs.get(bombId);
    if (!entry) return;
    this._scene.remove(entry.root);
    entry.root.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose());
      }
    });
  }
}


// runUnlockCheck — Sends a request to the server, to check if the player has unlocked a skin. If they have, returns the unlocked skins. This is used for the unlock notification.
export async function runUnlockCheck() {
  try {
    const response = await fetch(`${window.API_BASE}/api/skins/unlock-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.unlockedSkins || [];
  }
  catch (err) {
    console.warn('Unlock check failed:', err);
    return [];
  }
}
