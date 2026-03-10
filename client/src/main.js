// ============================================================
//  CLIENT MAIN.JS 
// ============================================================

import * as THREE                from 'three';
import { GLTFLoader }            from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls }   from './PointerLockControls.js';
import RAPIER                    from '@dimforge/rapier3d-compat';
import Colyseus                  from 'colyseus.js';

import { initBackground, hideBackground, showBackground } from './background.js';

// ── Auth ─────────────────────────────────────────────────────
const API_BASE = location.protocol === 'https:'
  ? `https://${location.hostname}`
  : `http://${location.hostname}:3000`;

function getUser() {
  try { return JSON.parse(localStorage.getItem('auth_user')); }
  catch { return null; }
}


document.addEventListener('pointerlockerror', () => {
  console.error('Pointer lock failed');
  document.getElementById('lockOverlay').classList.add('visible');
});


async function fetchAndDisplayStats(token) {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) { showAuthOverlay(); return; }

    const user = await res.json();
    
    const pColor = user.prefixColor || '#ffffff';
    const uColor = user.usernameColor || '#ffffff';

    const displayNameHTML = `
      ${user.userPrefix ? `<span style="color: ${user.prefixColor || '#00ffcc'}">[${user.userPrefix}]</span> ` : ''}
      <span style="color: ${user.usernameColor || '#ffffff'}">${user.username}</span>
    `.trim();

    document.getElementById('stat-user').innerHTML = `your user: ${displayNameHTML}`;
    
    document.getElementById('stat-wins').textContent   = `games won: ${user.wins ?? 0}`;
    document.getElementById('stat-deaths').textContent = `times died: ${user.deaths ?? 0}`;
  } catch { showAuthOverlay(); }
}

function showAuthOverlay() {
  document.getElementById('menu').style.display = 'none';
  const overlay = document.createElement('div');
  overlay.id = 'authOverlay';
  overlay.className = 'overlay';
  overlay.style.zIndex = '200';
  overlay.innerHTML = `
    <div class="MainUI" style="width:340px;">
      <div class="title-bar">
        <div class="controls">
          <span class="control none"></span>
          <span class="control none"></span>
          <span class="control none"></span>
        </div>
        <div class="menu-title" id="authTitle">sign in</div>
      </div>
      <div style="display:flex;width:100%;border-bottom:1px solid rgba(255,255,255,0.08);">
        <button id="tabLogin"  class="btn" style="flex:1;border-radius:0;letter-spacing:1px;">sign in</button>
        <button id="tabSignup" class="btn btn-outline" style="flex:1;border-radius:0;letter-spacing:1px;">register</button>
      </div>
      <div style="padding:24px 32px 32px;display:flex;flex-direction:column;gap:16px;width:100%;">
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:11px;color:#aaa;letter-spacing:1.5px;font-family:'Space Mono',monospace;">username</label>
          <input id="authUser" type="text" placeholder="your_username"
            style="padding:10px 16px;font-size:14px;font-family:'Space Mono',monospace;background:rgba(30,30,40,0.8);color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:6px;width:100%;outline:none;letter-spacing:1px;" />
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:11px;color:#aaa;letter-spacing:1.5px;font-family:'Space Mono',monospace;">password</label>
          <input id="authPass" type="password" placeholder="••••••••"
            style="padding:10px 16px;font-size:14px;font-family:'Space Mono',monospace;background:rgba(30,30,40,0.8);color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:6px;width:100%;outline:none;letter-spacing:1px;" />
        </div>
        <div id="authEmailWrap" style="display:none;flex-direction:column;gap:6px;">
          <label style="font-size:11px;color:#aaa;letter-spacing:1.5px;font-family:'Space Mono',monospace;">recovery email <span style="font-size:10px;color:#555;">(optional)</span></label>
          <input id="authEmail" type="email" placeholder="you@example.com"
            style="padding:10px 16px;font-size:14px;font-family:'Space Mono',monospace;background:rgba(30,30,40,0.8);color:#fff;border:1px solid rgba(255,255,255,0.12);border-radius:6px;width:100%;outline:none;letter-spacing:1px;" />
        </div>
        <div id="authStatus" style="font-size:12px;min-height:16px;font-family:'Space Mono',monospace;color:#ff4444;"></div>
        <button id="authSubmit" class="btn" style="width:100%;">sign in</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let authMode = 'login';

  const switchTab = (mode) => {
    authMode = mode;
    document.getElementById('authTitle').textContent       = mode === 'login' ? 'sign in' : 'register';
    document.getElementById('authSubmit').textContent      = mode === 'login' ? 'sign in' : 'create account';
    document.getElementById('authEmailWrap').style.display = mode === 'signup' ? 'flex' : 'none';
    document.getElementById('authStatus').textContent      = '';
    document.getElementById('tabLogin').className  = mode === 'login'  ? 'btn' : 'btn btn-outline';
    document.getElementById('tabSignup').className = mode === 'signup' ? 'btn' : 'btn btn-outline';
  };

  const submit = async () => {
    const username = document.getElementById('authUser').value.trim();
    const password = document.getElementById('authPass').value;
    const email    = document.getElementById('authEmail').value.trim();
    const statusEl = document.getElementById('authStatus');
    const btn      = document.getElementById('authSubmit');
    if (!username || !password) { statusEl.textContent = 'username and password are required.'; return; }
    btn.disabled = true; btn.textContent = '...'; statusEl.textContent = '';
    try {
      const body = { username, password };
      if (authMode === 'signup' && email) body.email = email;
      const res  = await fetch(`${API_BASE}/auth/${authMode === 'login' ? 'login' : 'signup'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'something went wrong.');
      localStorage.setItem('auth_user', JSON.stringify({ username: data.username, token: data.token }));
      document.removeEventListener('keydown', onEnter);
      overlay.remove();
      document.getElementById('menu').style.display = 'flex';
      fetchAndDisplayStats(data.token);
    } catch (err) {
      statusEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = authMode === 'login' ? 'sign in' : 'create account';
    }
  };

  const onEnter = (e) => { if (e.key === 'Enter') submit(); };
  document.addEventListener('keydown', onEnter);
  document.getElementById('tabLogin').addEventListener('click',  () => switchTab('login'));
  document.getElementById('tabSignup').addEventListener('click', () => switchTab('signup'));
  document.getElementById('authSubmit').addEventListener('click', submit);
}

// ── Boot: check auth before showing menu ─────────────────────
const _savedUser = getUser();
if (!_savedUser) {
  showAuthOverlay();
} else {
  fetchAndDisplayStats(_savedUser.token);
}
initBackground();
showBackground();


async function init() {
  await RAPIER.init();

const isSecure   = location.protocol === 'https:';
const SERVER_URL = isSecure
  ? `wss://${location.hostname}`        
  : `ws://${location.hostname}:3000`;  
const colyseus   = new Colyseus.Client(SERVER_URL);

// ── Three.js scene ─────────────────────────────────────────
const scene    = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
const camera   = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled  = true;

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping      = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.DirectionalLight(0xffffff, 2));
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// floor visual only (physics handled server-side and in client world)
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
scene.add(floor);

// crosshair
const chGeo = new THREE.BufferGeometry();
chGeo.setAttribute('position', new THREE.Float32BufferAttribute(
  [-0.001,0,0, 0.001,0,0, 0,-0.001,0, 0,0.001,0], 3));
const crosshair = new THREE.LineSegments(
  chGeo, new THREE.LineBasicMaterial({ color:0xffffff, depthTest:false }));
crosshair.renderOrder = 999;
crosshair.position.z = -0.1;
camera.add(crosshair);
scene.add(camera);

// ──  Game state ──────────────────────────────────────────────
let room        = null;
let myId        = null;
let oppId       = null;
let isHost      = false;
// ── Page helpers ─────────────────────────────────────────────
function showMenu()        { document.getElementById('menu').style.display = 'flex'; }
function hideMenu()        { document.getElementById('menu').style.display = 'none'; }
function showWaiting()     { document.getElementById('versusMenu').style.display = 'none';
                             document.getElementById('waitingRoom').style.display = 'flex'; }
function showGame()        { hideMenu();
                             document.getElementById('waitingRoom').style.display = 'none';
                             document.getElementById('hud').style.display = 'block'; }
function showMapVote()     { document.getElementById('mapVote').style.display = 'flex'; }
function hideMapVote()     { document.getElementById('mapVote').style.display = 'none'; }
function showResults(won)  {
  document.getElementById('resultTitle').textContent = won ? 'you won' : 'you lost';
  document.getElementById('resultTitle').style.color = won ? '#00ff88' : '#ff4444';
  document.getElementById('resultSub').textContent   = won ? 'opponent eliminated' : 'you were eliminated';
  document.getElementById('page-results').style.display = 'flex';
}

let gameStarted = false;

// Results buttons
document.getElementById('playAgainBtn').onclick = () => {
  location.reload();
  showBackground();
}
document.getElementById('menuBtn').onclick      = () => {
  location.reload();
  showBackground();
}

// ── Menu screen and others ──────────────────────────────────────────────

//randomize splash text

const splashTextList = [
  'I ran out of ideas',
  'burgerburgerburgerburgerburgerburger',
  'virtual real upright inverted',
  'Use code pear in the Fortnite item shop',
  'Also try Minecraft!',
  'Also try Terraria!',
  'no',
] 

const randomIndex = Math.floor(Math.random() * splashTextList.length);
const randomSplash = splashTextList[randomIndex];

const splashText = document.querySelector('.splashText');

splashText.textContent = randomSplash;

async function databaseSave(info) {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return console.warn('databaseSave: not logged in');

  const res = await fetch(`${API_BASE}/api/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authUser.token}`
    },
    body: JSON.stringify({ data: info })
  });

  const json = await res.json();
}

function applySettings() {
  const fov = parseInt(document.getElementById('fov').value);
  const sensitivity = parseFloat(document.getElementById('sensitivity').value) / 10;
  const invertY = document.getElementById('invertY').checked;
  const showHints = document.getElementById('showInputs').checked;
  const showSpeed = document.getElementById('showSpeed').checked;
  const showPing = document.getElementById('showPing').checked;
  
  controls.pointerSpeed = sensitivity;
  controls.invertYAxis = invertY;
  camera.fov = fov;

  if (showHints == false) { document.getElementById('controls-hint').style.display = 'none'; } else { document.getElementById('controls-hint').style.display = 'block'; }
  if (showSpeed == false) { document.getElementById('velocity').style.display = 'none'; } else { document.getElementById('velocity').style.display = 'block'; }
  if (showPing == false) { document.getElementById('ping').style.display = 'none'; } else { document.getElementById('ping').style.display = 'block'; }

  camera.updateProjectionMatrix();
}


document.getElementById('saveBtn').addEventListener('click', () => {
  const settings = {
    graphics: {
      fov:      parseInt(document.getElementById('fov').value),
      showFps:  document.getElementById('showFps').checked,
    },
    interface: {
      showPing:   document.getElementById('showPing').checked,
      showSpeed:  document.getElementById('showSpeed').checked,
      showInputs: document.getElementById('showInputs').checked,
    },
    mouse: {
      sensitivity: parseFloat((document.getElementById('sensitivity').value / 10).toFixed(1)),
      invertY:     document.getElementById('invertY').checked,
    },
    keybinds: { ...window.keybinds },
  };

  applySettings();
  databaseSave({ settings })
})


document.addEventListener('click', () => {
  if (gameStarted && !controls.isLocked) {
    try {
      controls.lock();
    } catch(e) {
      console.warn('lock failed:', e);
    }
  }
});

let pingMs = 0;


// ── Client physics world (client side of SSR) ──────────────────
let cWorld = null;   
let cBody  = null;  

async function buildClientWorld(collisionPath, spawnX, spawnY, spawnZ) {
  cWorld = new RAPIER.World({ x: 0, y: -25, z: 0 });

  // Load the same collision JSON the server uses
  try {
    const res  = await fetch(collisionPath);
    const data = await res.json();

    const vertices = new Float32Array(data.vertices);
    const indices  = new Uint32Array(data.indices);

    const body = cWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    cWorld.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), body);
  } catch (e) {
    console.error('[Client physics] Failed to load collision JSON:', e);
    // Fallback flat ground so the game still runs
    const g = cWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0));
    cWorld.createCollider(RAPIER.ColliderDesc.cuboid(50, 2, 50), g);
  }

  // Player body at spawn point (matches server spawn)
  cBody = cWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY, spawnZ)
      .lockRotations()
      .setLinearDamping(0.1)
  );
  cWorld.createCollider(RAPIER.ColliderDesc.ball(1), cBody);
}

// ── Grounded check ──────────────────
function clientGrounded() {
  if (!cBody || !cWorld) return false;
  const vel = cBody.linvel();
  if (vel.y > 0.5) return false;
  const pos = cBody.translation();
  const ray = new RAPIER.Ray(
    { x: pos.x, y: pos.y - 0.5, z: pos.z },
    { x: 0,     y: -1,          z: 0     }
  );
  return cWorld.castRay(ray, 0.6, false) !== null;
}

function applyInput(inputs, camDir) {
  const len = Math.sqrt(camDir.x**2 + camDir.z**2);
  const fx  = len > 0 ? camDir.x / len : 0;
  const fz  = len > 0 ? camDir.z / len : 0;
  const sx  = -fz, sz = fx;

  let vx = 0, vz = 0;
  if (inputs.w) { vx+=fx; vz+=fz; }
  if (inputs.s) { vx-=fx; vz-=fz; }
  if (inputs.d) { vx+=sx; vz+=sz; }
  if (inputs.a) { vx-=sx; vz-=sz; }

  const vel = cBody.linvel();
  if (inputs.space && clientGrounded()) {
    cBody.setLinvel({ x:vel.x, y:15, z:vel.z }, true);
  }

  const vel2   = cBody.linvel();
  const moving = inputs.w || inputs.s || inputs.a || inputs.d;
  if (moving) {
    cBody.setLinvel({ x:vx*12, y:vel2.y, z:vz*12 }, true);
  } else {
    cBody.setLinvel({ x:vel2.x*0.8, y:vel2.y, z:vel2.z*0.8 }, true);
  }
}

// ── Reconciliation ───────────────────
const pending = [];   
let   lastAck = 0;


const localGrapple = {};

function reconcile(serverPos, serverVel, ackSeq) {
  // Drop inputs the server has already processed
  while (pending.length > 0 && pending[0].seq <= ackSeq) pending.shift();
  lastAck = ackSeq;

  const dx = serverPos.x - cBody.translation().x;
  const dy = serverPos.y - cBody.translation().y;
  const dz = serverPos.z - cBody.translation().z;
  const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);

  if (d < 0.15) return;   // negligible – ignore

  if (d >= 3.0) {

    cBody.setTranslation({ x:serverPos.x, y:serverPos.y, z:serverPos.z }, true);
    cBody.setLinvel(     { x:serverVel.x, y:serverVel.y, z:serverVel.z }, true);
    for (const inp of pending) {
      applyInput(inp.inputs, inp.camDir);
      cWorld.step();
    }
  } else {

    const k = Math.min(d * 0.15, 0.4);
    const p = cBody.translation();
    cBody.setTranslation({
      x: p.x + dx*k, y: p.y + dy*k, z: p.z + dz*k
    }, true);
    const v = cBody.linvel();
    cBody.setLinvel({
      x: v.x + (serverVel.x - v.x)*0.1,
      y: v.y + (serverVel.y - v.y)*0.1,
      z: v.z + (serverVel.z - v.z)*0.1
    }, true);
  }
}

// ── 8. Opponent interpolation ─────────────────────────────────
const oppBuffer   = [];         // { time, position }
const INTERP_DELAY = 100;       // ms behind real-time

function pushOppSnap(pos) {
  oppBuffer.push({ time: performance.now(), position: { ...pos } });
  if (oppBuffer.length > 30) oppBuffer.shift();
}

function interpolateOpp() {
  if (!oppMesh || oppBuffer.length < 2) return;
  const rt = performance.now() - INTERP_DELAY;
  while (oppBuffer.length >= 2 && oppBuffer[1].time <= rt) oppBuffer.shift();
  if (oppBuffer.length < 2) return;
  const a = oppBuffer[0], b = oppBuffer[1];
  let t = (rt - a.time) / (b.time - a.time);
  t = Math.max(0, Math.min(1, t));
  oppMesh.position.set(
    a.position.x + (b.position.x - a.position.x) * t,
    a.position.y + (b.position.y - a.position.y) * t,
    a.position.z + (b.position.z - a.position.z) * t
  );
}

// ── 9. Scene objects ──────────────────────────────────────────
// ── GLB map loading ──────────────────────────────────────────
// Three.js loads the .glb file and adds the full scene graph directly.
// Materials, colors, and geometry all come from Blender automatically.
// We keep a reference so we can remove the map on room change.

const gltfLoader = new GLTFLoader();
let   currentMapRoot = null;   // the THREE.Group added to scene

async function loadMapGLB(glbPath) {
  // Remove previous map if any
  if (currentMapRoot) {
    scene.remove(currentMapRoot);
    currentMapRoot.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        // material can be an array
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => m.dispose());
      }
    });
    currentMapRoot = null;
  }

  try {
    const gltf = await gltfLoader.loadAsync(glbPath);
    currentMapRoot = gltf.scene;

    // If the GLB was NOT exported with +Y Up from Blender, uncomment this line:
    // currentMapRoot.rotation.x = -Math.PI / 2;
    // If it WAS exported with +Y Up, leave it commented out.

    // Enable shadows on every mesh in the loaded scene
    currentMapRoot.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow    = true;
        obj.receiveShadow = true;
      }
    });

    scene.add(currentMapRoot);

    // Hide the default floor plane — the GLB has its own floor
    floor.visible = false;

  } catch (err) {
    console.error(`[Client] Failed to load map GLB: ${glbPath}`, err);
  }
}

function makeSphere(color) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1),
    new THREE.MeshStandardMaterial({ color })
  );
}

let myMesh  = null;
let oppMesh = null;

// ── grapple visuals ───────────────────────────────────────────
function makeHook(color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.3),
    new THREE.MeshBasicMaterial({ color })
  );
  m.visible = false;
  scene.add(m);
  return m;
}

// Rope implemented as a thin CylinderGeometry instead of THREE.Line.
// THREE.Line uses the GPU line primitive which is always 1px wide and
// disappears when viewed edge-on — a known WebGL limitation with no fix.
// A cylinder has real geometry so it renders correctly from every angle.
const ROPE_RADIUS   = 0.04;  // world-space thickness of rope
const ROPE_SEGMENTS = 4;     // radial segments — 4 is enough, keeps tri count low

function makeRopeLine(color) {
  const geo  = new THREE.CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, 1, ROPE_SEGMENTS);
  const mat  = new THREE.MeshBasicMaterial({ color, depthWrite: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = true;  // explicitly visible — pivot controls show/hide
  const pivot = new THREE.Object3D();
  pivot.add(mesh);
  pivot.visible    = false;
  pivot._ropeMesh  = mesh;
  scene.add(pivot);
  return pivot;
}

// _tmp vectors reused every frame to avoid allocations
const _ropeMid = new THREE.Vector3();
const _ropeDir = new THREE.Vector3();
const _ropeUp  = new THREE.Vector3(0, 1, 0);
const _ropeQ   = new THREE.Quaternion();

// Rope origin — a fixed point just in front of the camera.
// Using camera.position directly (plus tiny forward offset so it's not
// inside the near clip plane) means the rope base never shakes because
// it moves exactly with the camera with zero lag.
const _camForward = new THREE.Vector3();
const barrelPos   = new THREE.Vector3();

function updateBarrelPos() {
  camera.getWorldDirection(_camForward);
  
  // get camera right vector
  const right = new THREE.Vector3();
  right.crossVectors(_camForward, camera.up).normalize();
  
  barrelPos.copy(camera.position)
    .addScaledVector(_camForward, 0.5)
    .addScaledVector(right, 0.15); // nudge right
}

function updateRope(pivot, a, b) {
  const ax = a.x, ay = a.y, az = a.z;
  const bx = b.x, by = b.y, bz = b.z;

  pivot.position.set((ax+bx)*0.5, (ay+by)*0.5, (az+bz)*0.5);

  _ropeDir.set(bx-ax, by-ay, bz-az);
  const length = _ropeDir.length();
  if (length < 0.001) return;
  _ropeDir.divideScalar(length);

  // setFromUnitVectors fails when vectors are exactly parallel (dot = -1).
  // In that case (straight up or down shot) use a 180° rotation around X.
  const dot = _ropeUp.dot(_ropeDir);
  if (dot > 0.9999) {
    _ropeQ.identity();
  } else if (dot < -0.9999) {
    _ropeQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    _ropeQ.setFromUnitVectors(_ropeUp, _ropeDir);
  }

  pivot.quaternion.copy(_ropeQ);
  pivot._ropeMesh.scale.y = length;
}

const myHook  = makeHook(0x00ffff);  const myRope  = makeRopeLine(0x00ffff);
const oppHook = makeHook(0xff00ff);  const oppRope = makeRopeLine(0xff00ff);

// ── bombs ─────────────────────────────────────────────────────
const bombMeshes = new Map();

// ── explosions ────────────────────────────────────────────────
const explosions = [];
class Explosion {
  constructor(pos) {
    this.N   = 250;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(this.N * 3);
    this.vel  = [];
    for (let i = 0; i < this.N; i++) {
      arr[i*3]=pos.x; arr[i*3+1]=pos.y; arr[i*3+2]=pos.z;
      this.vel.push({
        x:(Math.random()-0.5),
        y:(Math.random()-0.5),
        z:(Math.random()-0.5)
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.mat  = new THREE.PointsMaterial({
      color:0xffaa00, size:0.1,
      transparent:true, opacity:1,
      blending:THREE.AdditiveBlending
    });
    this.pts  = new THREE.Points(geo, this.mat);
    scene.add(this.pts);
    this.alive = true;
  }
  update() {
    if (!this.alive) return;
    const arr = this.pts.geometry.attributes.position.array;
    this.mat.opacity -= 0.02;
    for (let i = 0; i < this.N; i++) {
      arr[i*3]   += this.vel[i].x;
      arr[i*3+1] += this.vel[i].y;
      arr[i*3+2] += this.vel[i].z;
      this.vel[i].y -= 0.005;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    if (this.mat.opacity <= 0) {
      scene.remove(this.pts);
      this.pts.geometry.dispose();
      this.mat.dispose();
      this.alive = false;
    }
  }
}

// ── 10. Input ─────────────────────────────────────────────────
const controls    = new PointerLockControls(camera, renderer.domElement);
const keys        = { w:false, a:false, s:false, d:false, space:false };
let   seq         = 0;
let   lastSpawn   = 0;

document.addEventListener('keydown', e => {
  if (e.code === keybinds.fwd)   keys.w     = true;
  if (e.code === keybinds.back)  keys.s     = true;
  if (e.code === keybinds.left)  keys.a     = true;
  if (e.code === keybinds.right) keys.d     = true;
  if (e.code === keybinds.jump)  keys.space = true;

  if (e.code === window.keybinds.grapple && gameStarted && room) {
    room.send('grapple');
  }

  if (e.code === window.keybinds.bomb && gameStarted && room) {
    const now = performance.now();
    if (now - lastSpawn >= 3000) { shootBomb(); lastSpawn = now; }
  }
});
document.addEventListener('keyup', e => {
  if (e.code === window.keybinds.fwd)   keys.w     = false;
  if (e.code === window.keybinds.back)  keys.s     = false;
  if (e.code === window.keybinds.left)  keys.a     = false;
  if (e.code === window.keybinds.right) keys.d     = false;
  if (e.code === window.keybinds.jump)  keys.space = false;
});

// Show/hide the click-to-play overlay when pointer lock is released mid-game
controls.addEventListener('unlock', () => {
  if (gameStarted) document.getElementById('lockOverlay').classList.add('visible');
});
controls.addEventListener('lock', () => {
  document.getElementById('lockOverlay').classList.remove('visible');
});

function shootBomb() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const pos = camera.position.clone().add(dir.clone().multiplyScalar(2));
  room.send('spawnBomb', {
    position: { x:pos.x, y:pos.y, z:pos.z },
    impulse:  { x:dir.x*15, y:dir.y*15, z:dir.z*15 }
  });

  // Cooldown indicator
  const readyEl = document.getElementById('bombReady');
  if (readyEl) {
    readyEl.textContent = 'cooldown';
    readyEl.style.color = '#555';
    let remaining = 3;
    const countdown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdown);
        readyEl.textContent = 'ready';
        readyEl.style.color = '#ffaa00';
      } else {
        readyEl.textContent = remaining + 's';
      }
    }, 1000);
  }
}

// ── 11. Colyseus room setup ───────────────────────────────────
function setupRoom(r) {
  room = r;
  myId = room.sessionId;

  // start pinging once we have a room
  setInterval(() => {
    room.send('ping', { t: Date.now() });
  }, 1000);

  room.onMessage('pong', ({ t }) => {
    const el = document.getElementById('ping');
    if (el) el.textContent = (Date.now() - t) + ' ms';
  });

  // ── One-time messages ──────────────────────────────────────
  room.onMessage('loadMap', async ({ glb, collision, spawnPoints }) => {
    // Load visual mesh
    await loadMapGLB(glb);

    // Build client physics world from same collision JSON as server
    // spawnPoints[0] = host, spawnPoints[1] = guest
    const spawnIndex = isHost ? 0 : 1;
    const spawn      = spawnPoints[spawnIndex] || { x: 0, y: 5, z: 0 };
    await buildClientWorld(collision, spawn.x, spawn.y, spawn.z);
  });

  room.onMessage('init', (data) => {
    myId   = data.myId;
    isHost = data.isHost;
  });

  // ── Map vote messages ────────────────────────────────────────
  //
  // 'mapVote'   → server sends the map list and timeout, we show the picker
  // 'mapChosen' → server has resolved all votes, we hide the picker and
  //               store the chosen map id so we can load geometry when
  //               'blocks' arrives
  //
  // The vote UI is purely cosmetic on the client — the server is the
  // authority. Even if you skip voting the server picks for you.

  room.onMessage('mapVote', ({ maps, timeoutMs }) => {
    showMapVotePicker(maps, timeoutMs, (chosenId) => {
      room.send('vote', { mapId: chosenId });
    });
  });

  room.onMessage('mapChosen', ({ mapId, mapName }) => {
    hideMapVotePicker();
    // Show lobby while map loads
    const title = document.getElementById('waitingTitle');
    if (title) title.textContent = `loading ${mapName}...`;
    showWaiting();
  });

  room.onMessage('gameStart', (data) => {
    oppId = myId === data.hostId ? data.guestId : data.hostId;

    myMesh  = makeSphere(0x00ff00); scene.add(myMesh);
    oppMesh = makeSphere(0xff0000); scene.add(oppMesh);

    showGame();
    gameStarted = true;
    controls.lock();
    hideBackground();
  });

  room.onMessage('bombExploded', (data) => {
    if (bombMeshes.has(data.id)) {
      const m = bombMeshes.get(data.id);
      scene.remove(m); m.geometry.dispose(); m.material.dispose();
      bombMeshes.delete(data.id);
    }
    explosions.push(new Explosion(data.position));
  });

  room.onMessage('playerHit', (data) => {
    const isMe = data.playerId === myId;
    const numId = isMe ? 'health'     : 'opponentHP';
    const barId = isMe ? 'myHpFill'  : 'oppHpFill';
    const el    = document.getElementById(numId);
    const fill  = document.getElementById(barId);
    if (!el) return;
    const newHP = Math.max(0, parseInt(el.textContent) - data.damage);
    el.textContent = newHP;
    if (fill) fill.style.width = newHP + '%';
    if (isMe) {
      renderer.domElement.style.outline = '5px solid red';
      setTimeout(() => { renderer.domElement.style.outline = ''; }, 200);
    }
  });

  room.onMessage('gameEnd', (data) => {
    if (controls.isLocked) controls.unlock();
    gameStarted = false;

    const won = data.winner === myId;

    // Populate results page then show it
    const resultTitle = document.getElementById('resultTitle');
    if (resultTitle) {
      resultTitle.textContent = won ? 'you won' : 'you lost';
      resultTitle.style.color = won ? '#00ff88' : '#ff4444';
    }
    const resultSub = document.getElementById('resultSub');
    if (resultSub) resultSub.textContent = won ? 'opponent eliminated' : 'you were eliminated';

    showResults(won);
  });

  room.onMessage('opponentDisconnected', () => {
    alert('Opponent disconnected!');
    location.reload();
  });
}

// ── 12. UI buttons ────────────────────────────────────────────
// ── Map vote UI ──────────────────────────────────────────────
//
// showMapVotePicker builds the grid of map cards dynamically from
// the list the server sent — so adding a new map to maps/index.js
// automatically appears in the UI with zero client changes.
//
// A countdown timer runs client-side purely for display.  The server
// has its own authoritative timer, so desync between them is fine.

let _voteCountdownInterval = null;
let _selectedMapId = null;

function showMapVotePicker(maps, timeoutMs, onConfirm) {
  const overlay     = document.getElementById('mapVote');
  const grid        = document.getElementById('mapGrid');
  const timerEl     = document.getElementById('voteTimer');
  const statusEl    = document.getElementById('voteStatus');
  const confirmBtn  = document.getElementById('confirmVoteBtn');

  // Build map cards from server-provided list
  grid.innerHTML = '';
  maps.forEach(map => {
    const card = document.createElement('div');
    card.className   = 'map-card';
    card.dataset.id  = map.id;
    card.innerHTML   = `
      <div class="map-name">${map.name}</div>
      <div class="map-desc">${map.description}</div>
    `;
    card.addEventListener('click', () => {
      // Deselect all, select this one
      grid.querySelectorAll('.map-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _selectedMapId = map.id;
      confirmBtn.disabled = false;
      statusEl.textContent = '';
    });
    grid.appendChild(card);
  });

  // Confirm button sends the vote and locks the UI
  confirmBtn.disabled = true;
  confirmBtn.onclick = () => {
    if (!_selectedMapId) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'voted!';
    statusEl.textContent = 'waiting for opponent...';
    onConfirm(_selectedMapId);
  };

  // Countdown timer (display only — server resolves authoritatively)
  let remaining = Math.ceil(timeoutMs / 1000);
  timerEl.textContent = `${remaining}s remaining`;
  _voteCountdownInterval = setInterval(() => {
    remaining--;
    timerEl.textContent = remaining > 0 ? `${remaining}s remaining` : 'resolving...';
    if (remaining <= 0) clearInterval(_voteCountdownInterval);
  }, 1000);

  showMapVote();
}

function hideMapVotePicker() {
  clearInterval(_voteCountdownInterval);
  hideMapVote();
  _selectedMapId = null;
  document.getElementById('confirmVoteBtn').textContent = 'confirm';
  document.getElementById('voteStatus').textContent = '';
}

document.getElementById('hostBtn').onclick = async () => {
  try {
    const r = await colyseus.create('private');
    setupRoom(r);

    // Server sends us the short code via message once metadata is ready
    r.onMessage('roomCode', (code) => {
      document.getElementById('joinCodeDisplay').textContent = code;
    });

    showWaiting();
  } catch (e) {
    console.error('Failed to create room:', e);
    const el = document.getElementById('errorMsg');
    if (el) { el.textContent = 'Failed to create room'; setTimeout(()=>el.textContent='',3000); }
  }
};

document.getElementById('joinBtn').onclick = async () => {
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  if (!code) return;
  const errEl = document.getElementById('errorMsg');
  try {
    // Resolve short code → full Colyseus room ID
    const res  = await fetch('/find-room', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (errEl) { errEl.textContent = data.error || 'Room not found'; setTimeout(()=>errEl.textContent='',3000); }
      return;
    }
    const r = await colyseus.joinById(data.roomId);
    setupRoom(r);
  } catch (e) {
    console.error('Failed to join room:', e);
    if (errEl) { errEl.textContent = 'Failed to join room'; setTimeout(()=>errEl.textContent='',3000); }
  }
};

document.getElementById('codeInput')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

applySettings();

// ── 13. Main loop ─────────────────────────────────────────────
const FT   = 1 / 60;
let   acc  = 0;
let   last = performance.now();
let   lastPingTime = Date.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt  = Math.min((now - last) / 1000, 0.1);
  last = now;


  // ── Client prediction ──────────────────────────────────────
  if (gameStarted && controls.isLocked && cWorld && cBody) {
    acc += dt;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const cd = { x:camDir.x, y:camDir.y, z:camDir.z };

    while (acc >= FT) {
      const inp = {
        seq: seq++,
        inputs: { w:keys.w, a:keys.a, s:keys.s, d:keys.d, space:keys.space },
        camDir: cd
      };

      pending.push(inp);
      if (pending.length > 120) pending.shift();  // safety cap

      applyInput(inp.inputs, inp.camDir);
      cWorld.step();

      room.send('input', { seq:inp.seq, inputs:inp.inputs, camDir:inp.camDir });

      acc -= FT;
    }

    // ── Reconcile against server state (Colyseus auto-patches) ──
    if (room && myId) {
      const sp = room.state.players.get(myId);
      if (sp) {
        reconcile(sp.position, sp.velocity, sp.lastSeq);
        lastPingTime = Date.now(); // proxy for ping update
      }
    }

    // ── Camera & my mesh ──────────────────────────────────────
    const p = cBody.translation();
    camera.position.set(p.x, p.y + 1, p.z);
    if (myMesh) myMesh.position.set(p.x, p.y, p.z);

    updateBarrelPos();

    // ── HUD: speed ────────────────────────────────────────────
    const v   = cBody.linvel();
    const spd = Math.sqrt(v.x**2 + v.y**2 + v.z**2);
    const vel = document.getElementById('velocity');
    if (vel) vel.textContent = spd.toFixed(2);
  }

  // ── Opponent interpolation ─────────────────────────────────
  if (gameStarted && room && oppId) {
    const os = room.state.players.get(oppId);
    if (os) pushOppSnap(os.position);
    interpolateOpp();

    // Opponent grapple visuals
    if (os && oppMesh) {
      const active = os.grapple.active;
      oppHook.visible = active;
      oppRope.visible = active;
      if (active) {
        oppHook.position.set(os.grapple.hx, os.grapple.hy, os.grapple.hz);
        // Pass raw world coords — not oppHook.position which is local to the mesh
        const oppHookWorld = { x: os.grapple.hx, y: os.grapple.hy, z: os.grapple.hz };
        updateRope(oppRope, oppMesh.position, oppHookWorld);
      }
    }
  }

  // ── My grapple visuals (server-authoritative only) ───────────
  if (gameStarted && room && myId) {
    const ms = room.state.players.get(myId);
    if (!ms) return;

    if (ms.grapple.active) {
      const hookPos = { x: ms.grapple.hx, y: ms.grapple.hy, z: ms.grapple.hz };
      myHook.visible = true; 
      myHook.position.set(hookPos.x, hookPos.y, hookPos.z);
      myRope.visible = true;
      updateRope(myRope, barrelPos, hookPos); // barrelPos is camera-relative, feels perfect
    } else {
      myHook.visible = false;
      myRope.visible = false;
    }
  }

  // ── Bombs (from Colyseus state) ────────────────────────────
  if (gameStarted && room) {
    const liveIds = new Set();
    room.state.bombs.forEach((bs, id) => {
      liveIds.add(id);
      if (!bombMeshes.has(id)) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.5),
          new THREE.MeshStandardMaterial({ color:0x808080 })
        );
        scene.add(m);
        bombMeshes.set(id, m);
      }
      const m = bombMeshes.get(id);
      m.position.set(bs.px, bs.py, bs.pz);
      m.quaternion.set(bs.rx, bs.ry, bs.rz, bs.rw);
    });
    for (const [id, m] of bombMeshes) {
      if (!liveIds.has(id)) {
        scene.remove(m); m.geometry.dispose(); m.material.dispose();
        bombMeshes.delete(id);
      }
    }
  }

  // ── Explosions ─────────────────────────────────────────────
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].update();
    if (!explosions[i].alive) explosions.splice(i, 1);
  }


  renderer.render(scene, camera);
}
animate();

// ── Resize ────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

} // end init()
init().catch(console.error);
