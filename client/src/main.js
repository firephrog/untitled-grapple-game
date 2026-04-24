// ============================================================
//  CLIENT MAIN.JS  –  Colyseus + Rapier3D + Three.js
// ============================================================

import * as THREE                from 'three';
import { GLTFLoader }            from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls }   from './PointerLockControls.js';
import RAPIER                    from '@dimforge/rapier3d-compat';
import Colyseus                  from 'colyseus.js';

import { initBackground, hideBackground, showBackground } from './background.js';
import { SkinManager, HookManager, BombManager } from './SkinManager.js';
import { Nametags } from './Nametags.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';
import { getRankFromElo, formatRankDisplay } from './RankingUtils.js';


// ── Auth ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const API_BASE = location.protocol === 'https:'
  ? `https://${location.hostname}`
  : `http://${location.hostname}:3000`;

// Make API_BASE available globally for SkinManager and other modules
window.API_BASE = API_BASE;

// Helper to extract userId from JWT token
function getUserIdFromToken(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.userId;
  } catch (e) {
    console.warn('Failed to decode token:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPER FUNCTIONS – defined early before they're called
// ─────────────────────────────────────────────────────────────────────────────

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loadingScreen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
  }
}

function showMenu()        { 
  const menuEl = document.getElementById('menu');
  if (!menuEl) {
    console.error('[showMenu] Menu element not found');
    return;
  }
  hideLoadingScreen();  // Hide loading screen when showing menu
  menuEl.style.display = 'flex';
  menuEl.style.visibility = 'visible';
  menuEl.style.opacity = '1';
  menuEl.style.pointerEvents = 'auto';
  showBackground();  // Show background behind menu
  if (typeof renderer !== 'undefined' && renderer.domElement) {
    renderer.domElement.style.display = 'none'; 
    renderer.domElement.style.pointerEvents = 'none';
  }
  initializeGearCards();  // Initialize gear cards when menu is shown
}

function hideMenu()        { 
  const menuEl = document.getElementById('menu');
  if (menuEl) menuEl.style.display = 'none'; 
}

function showWaiting()     { 
  document.getElementById('versusMenu').style.display = 'none';
  document.getElementById('waitingRoom').style.display = 'flex'; 
}

function showGame()        { 
  hideMenu();
  hideBackground();  // Hide background canvas so game is visible
  // Hide all UI overlays
  const screenIds = ['versusMenu', 'waitingRoom', 'mapVote', 'rankedMenu', 'rankedQueue', 'rankedCountdown'];
  screenIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (typeof renderer !== 'undefined' && renderer.domElement) {
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.visibility = 'visible';
    renderer.domElement.style.opacity = '1';
    renderer.domElement.style.pointerEvents = 'auto';
    renderer.domElement.style.zIndex = '50';  // Ensure it's above everything
  }
  document.getElementById('hud').style.display = 'block'; 
}

function showMapVote()     { document.getElementById('mapVote').style.display = 'flex'; }
function hideMapVote()     { document.getElementById('mapVote').style.display = 'none'; }

function showResults(won)  {
  document.getElementById('resultTitle').textContent = won ? 'you won' : 'you lost';
  document.getElementById('resultTitle').style.color = won ? '#00ff88' : '#ff4444';
  document.getElementById('resultSub').textContent   = won ? 'opponent eliminated' : 'you were eliminated';
  document.getElementById('page-results').style.display = 'flex';
}

// ── Scope vignette drawing function ────────────────────────────────────────────
function drawScopeVignette(canvas, ctx, progress) {
  if (!ctx) return;
  
  // Get canvas dimensions
  const width = canvas.width;
  const height = canvas.height;
  
  // Set canvas size to match window if needed
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Calculate center and circle properties
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.max(width, height) * 0.5;  // Large circle for the vignette
  const scopeRadius = maxRadius * defaultScopeRadius;
  
  // Animate the scope circle growing in - clamp to full size
  const currentScopeRadius = scopeRadius * Math.min(progress * 1.5, 1);
  
  // Draw black vignette overlay with circular cutout
  // Draw outer black rectangle - fully black outside the scope circle
  ctx.fillStyle = `rgba(0, 0, 0, 1)`;
  ctx.fillRect(0, 0, width, height);
  
  // Clear the circular scope area
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, currentScopeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  
  // Draw scope circle border (crosshair style) - always visible at full opacity
  ctx.strokeStyle = `rgba(0, 255, 0, 0.6)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, currentScopeRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Draw crosshair in the center
  const crosshairSize = 30;
  const crosshairThickness = 2;
  ctx.strokeStyle = `rgba(0, 255, 0, 0.7)`;
  ctx.lineWidth = crosshairThickness;
  
  // Vertical line
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - crosshairSize);
  ctx.lineTo(centerX, centerY + crosshairSize);
  ctx.stroke();
  
  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(centerX - crosshairSize, centerY);
  ctx.lineTo(centerX + crosshairSize, centerY);
  ctx.stroke();
  
  // Draw small center dot
  ctx.fillStyle = `rgba(0, 255, 0, 0.8)`;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ── State variables ─────────────────────────────────────────────────────────────
let room        = null;
let myId        = null;
let oppId       = null;
let isHost      = false;
let presenceRoom = null;
let currentRoomCode = null;
let notifications = new Set(); // Track notification IDs to avoid duplicates
let gameStarted = false;

// Ranked mode state
let rankedMode = false;
let isInRankedQueue = false;
let playerElo = 100;
let queueUpdateInterval = null;

// Game message state
let _pendingSkinInfo = null;
let _pendingNametagInfo = null;

// Loaders (initialized in init())
let gltfLoader = null;
let skinMgr = null;
let hookMgr = null;
let bombMgr = null;
let nametags = null;
let playerMeshMap = null;

// Game functions (defined in init())
let loadMapGLB = null;
let buildClientWorld = null;
let perfMonitor = null;
let gBombSkins = {};

// ── Gear effects tracking ────────────────────────────────
const activeGearEffects = new Map();  // shooterId → { model, shooterId, initialOffset, startTime, duration }

// ── Sniper scope effect tracking ─────────────────────────
let activeScopeEffect = null;  // { startTime, duration, originalFov } or null
const defaultScopeRadius = 0.35;  // Circle radius as fraction of screen
const scopeZoomFov = 30;  // Zoomed in FOV for sniper (default is 75)

// ── Ranked mode functions ────────────────────────────────────────────────────────

async function updateRankedStats() {
  const authUser = getUser();
  if (!authUser) return;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authUser.token}` }
    });
    const user = await res.json();
    
    playerElo = user.elo || 100;
    const rankInfo = getRankFromElo(playerElo);
    
    // Update the ranked menu display
    document.getElementById('playerRankName').textContent = rankInfo.name;
    document.getElementById('playerRankName').style.color = rankInfo.color;
    document.getElementById('playerElo').textContent = rankInfo.elo;
  } catch (err) {
    console.error('[updateRankedStats] Failed:', err);
  }
}

async function joinRankedQueue() {
  const authUser = getUser();
  if (!authUser) return;

  rankedMode = true;
  isInRankedQueue = true;
  
  // Hide all UI screens that shouldn't be visible during queue
  document.getElementById('page-results').style.display = 'none';
  document.getElementById('rankedMenu').style.display = 'none';
  document.getElementById('versusMenu').style.display = 'none';
  document.getElementById('rankedQueue').style.display = 'flex';

  try {
    // Fetch user ELO
    await updateRankedStats();
    
    // Join ranked queue  
    room = await colyseus.joinOrCreate('ranked', {
      token: authUser.token,
      ratingMin: Math.max(0, playerElo - 500),
      ratingMax: playerElo + 500,
    });
    myId = room.sessionId;

    // ── Register all game message handlers for ranked mode ──────

    // Register particles handler EARLY - before any gear effects
    room.onMessage('particles', (data) => {
      const { position, type, count } = data;
      if (window.spawnParticles) {
        window.spawnParticles(position, type, count);
      }
    });

    // Ping/pong for latency
    setInterval(() => {
      room.send('ping', { t: Date.now() });
    }, 1000);

    room.onMessage('pong', ({ t }) => {
      const el = document.getElementById('ping');
      if (el) el.textContent = (Date.now() - t) + ' ms';
    });

    // Init message (sent before match starts)
    room.onMessage('init', (data) => {
      myId   = data.myId;
      isHost = data.isHost;
    });

    // Map chosen (for non-ranked mode, but also sent in ranked for consistency)
    room.onMessage('mapChosen', ({ mapId, mapName, skyColor }) => {
      // Hide ALL UI screens (don't show waitingRoom for ranked)
      document.getElementById('rankedQueue').style.display = 'none';
      document.getElementById('rankedMenu').style.display = 'none';
      document.getElementById('versusMenu').style.display = 'none';
      document.getElementById('waitingRoom').style.display = 'none';
      if (skyColor && typeof scene !== 'undefined' && scene) {
        scene.background = new THREE.Color(skyColor);
      }
    });

    // Load map (visual + physics)
    room.onMessage('loadMap', async ({ glb, collision, spawnPoints }) => {
      try {
        // Check if loadMapGLB is defined (may be inside init())
        if (!window.loadMapGLB) {
          console.error('[Ranked loadMap] loadMapGLB not available');
          return;
        }
        await window.loadMapGLB(glb);
        const spawnIndex = isHost ? 0 : 1;
        const spawn      = spawnPoints[spawnIndex] || { x: 0, y: 5, z: 0 };
        if (!window.buildClientWorld) {
          console.error('[Ranked loadMap] buildClientWorld not available');
          return;
        }
        await window.buildClientWorld(collision, spawn.x, spawn.y, spawn.z);
      } catch (e) {
        console.error('[Ranked loadMap] Error:', e, 'glb:', glb);
      }
    });

    // Skin info (opponent skins)
    room.onMessage('skinInfo', (data) => {
      _pendingSkinInfo = data;
    });

    // Nametag info
    room.onMessage('nametagInfo', (data) => {
      _pendingNametagInfo = data;
      if (window.nametags) {
        window.nametags.register(data);
      }
    });

    // Ranked-specific: countdown before match
    room.onMessage('countdownStart', handleCountdown);

    // Game start (load skins, enable input, lock pointer)
    room.onMessage('gameStart', async (data) => {
      try {
        disableInputDuringCountdown(false);
        
        oppId = myId === data.hostId ? data.guestId : data.hostId;

        if (_pendingSkinInfo && window.skinMgr) {
          const oppSkinData = _pendingSkinInfo[oppId];
          if (oppSkinData) {
            await window.skinMgr.assignSkin(oppId, oppSkinData, false);
            const oppMesh = window.skinMgr.getRoot(oppId);
            if (oppMesh && window.playerMeshMap) {
              window.playerMeshMap.set(oppId, oppMesh);
            }
            if (window.hookMgr) {
              window.hookMgr.assignHook(oppId, oppSkinData.grapple, false);
            }
          }
          _pendingSkinInfo = null;
        }

        const authUserData = JSON.parse(localStorage.getItem('auth_user'));
        if (authUserData && window.skinMgr && window.hookMgr) {
          // Load own skins
          fetch(`${API_BASE}/api/skins/player/${authUserData.username}`)
            .then(r => r.json())
            .then(d => {
              if (window.hookMgr && typeof camera !== 'undefined' && camera) {
                window.hookMgr.assignHook('local', d.grapple, true);
                window.hookMgr.setCamera('local', camera);
              }
            })
            .catch(err => console.warn('[Ranked gameStart] Failed to load own skins:', err));

          // Load opponent's skins
          fetch(`${API_BASE}/api/users-by-id/${oppId}`)
            .then(r => r.json())
            .then(oppData => {
              if (!oppData?.username) return;
              return fetch(`${API_BASE}/api/skins/load-opponent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: oppData.username })
              });
            })
            .then(r => r?.json())
            .catch(err => console.warn('[Ranked gameStart] Failed to load opponent skins:', err));
        }

        showGame();
        gameStarted = true;
        
        if (typeof keys !== 'undefined' && keys) {
          keys.w = false;
          keys.a = false;
          keys.s = false;
          keys.d = false;
          keys.space = false;
        }
        if (typeof prevSpaceState !== 'undefined') {
          prevSpaceState = false;
        }
        
        if (typeof controls !== 'undefined' && controls) {
          setTimeout(() => {
            try {
              controls.lock();
            } catch (err) {
              console.warn('[Ranked gameStart] Pointer lock failed:', err.message);
            }
          }, 100);  // Slight delay to ensure game is ready
        }
      } catch (e) {
        console.error('[Ranked gameStart]', e);
      }
    });

    // Bomb exploded
    room.onMessage('bombExploded', (data) => {
      if (typeof bombMgr !== 'undefined' && bombMgr && bombMgr._bombs?.has(data.id)) {
        bombMgr.removeBomb(data.id);
      }
      if (typeof Explosion !== 'undefined') {
        explosions.push(new Explosion(data.position));
      }
    });

    // Player hit (health update)
    room.onMessage('playerHit', (data) => {
      const isMe = data.playerId === myId;
      const numId = isMe ? 'health'     : 'opponentHP';
      const barId = isMe ? 'myHpFill'  : 'oppHpFill';
      const el    = document.getElementById(numId);
      const fill  = document.getElementById(barId);
      if (!el) return;
      const newHP = data.currentHealth !== undefined ? data.currentHealth : Math.max(0, parseInt(el.textContent) - data.damage);
      el.textContent = newHP;
      if (fill) fill.style.width = newHP + '%';
      if (isMe) {
        renderer.domElement.style.outline = '5px solid red';
        setTimeout(() => { renderer.domElement.style.outline = ''; }, 200);
      }
    });

    // Sniper line visual (beam)
    room.onMessage('sniperLine', (data) => {
      let start = new THREE.Vector3(data.start.x, data.start.y, data.start.z);
      const end = new THREE.Vector3(data.end.x, data.end.y, data.end.z);
      if (data.direction) {
        const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(dir, up).normalize();
        start.addScaledVector(right, 0.5);
      }
      const SNIPER_RADIUS = 0.08;
      const SNIPER_SEGMENTS = 3;
      const distance = start.distanceTo(end);
      // Create cylinder geometry with proper distance
      const geometry = new THREE.CylinderGeometry(SNIPER_RADIUS, SNIPER_RADIUS, distance, SNIPER_SEGMENTS);
      geometry.rotateX(Math.PI / 2);  // Rotate 90 degrees so cylinder points along Z-axis
      const material = new THREE.MeshBasicMaterial({ color: 0xff6600, depthWrite: true, transparent: true, opacity: 1.0 });
      const cylinder = new THREE.Mesh(geometry, material);
      cylinder.position.copy(start).add(end).divideScalar(2);
      cylinder.lookAt(end);
      scene.add(cylinder);
      setTimeout(() => scene.remove(cylinder), 1000);
    });

    // Gear effect (mace, shield, etc)
    room.onMessage('gearEffect', (data) => {
      const { gearName, shooterId, position, direction, duration } = data;
      const effectDuration = duration || 2000;
      
      // Start scope effect if this is the local player using sniper
      if (gearName === 'sniper' && shooterId === myId && camera) {
        const previewDuration = 2000;  // 2 seconds - stays zoomed until bullet travels
        activeScopeEffect = {
          startTime: Date.now(),
          duration: previewDuration,
          originalFov: camera.fov
        };
      }
      
      // Check if gltfLoader is available
      if (!window.gltfLoader) {
        console.error('[gearEffect] gltfLoader not available');
        return;
      }
      
      if (gearName === 'mace') {
        const maceGlbPath = '/gear/mace.glb';
        window.gltfLoader.load(maceGlbPath, (gltf) => {
          const model = gltf.scene.clone();
          model.position.set(position.x, position.y, position.z);
          scene.add(model);
          setupGearEffectAnimation(model, shooterId, position, effectDuration);
        }, undefined, (error) => {
          console.warn(`[gearEffect] Failed to load ${maceGlbPath}, using procedural model:`, error);
          const geometry = new THREE.SphereGeometry(0.5, 8, 8);
          const material = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
          const model = new THREE.Mesh(geometry, material);
          model.position.set(position.x, position.y, position.z);
          scene.add(model);
          setupGearEffectAnimation(model, shooterId, position, effectDuration);
        });
      } else {
        const gearGlbPath = `/gear/${gearName}.glb`;
        window.gltfLoader.load(gearGlbPath, (gltf) => {
          const model = gltf.scene.clone();
          model.position.set(position.x, position.y, position.z);
          scene.add(model);
          setupGearEffectAnimation(model, shooterId, position, effectDuration);
        }, undefined, (error) => {
          console.warn(`[gearEffect] Failed to load ${gearGlbPath}, using procedural model:`, error);
          const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
          const material = new THREE.MeshPhongMaterial({ color: 0xffff00 });
          const model = new THREE.Mesh(geometry, material);
          model.position.set(position.x, position.y, position.z);
          scene.add(model);
          setupGearEffectAnimation(model, shooterId, position, effectDuration);
        });
      }
      
      function setupGearEffectAnimation(model, shooterId, position, duration) {
        // Ensure we have a valid duration
        const finalDuration = Math.max(duration || 3000, 3000);
        const startTime = Date.now();
        
        // Calculate initial offset from shooter's position
        let initialOffset = new THREE.Vector3();
        const shooterStateAtStart = room.state.players.get(shooterId);
        
        if (shooterStateAtStart && shooterStateAtStart.position) {
          initialOffset.set(
            position.x - shooterStateAtStart.position.x,
            position.y - shooterStateAtStart.position.y,
            position.z - shooterStateAtStart.position.z
          );
        }
        
        // Initialize current position for smooth interpolation
        const currentPosition = new THREE.Vector3();
        currentPosition.copy(model.position);
        
        // Store the initial rotation quaternion so we can preserve pitch
        const initialRotation = new THREE.Quaternion();
        initialRotation.copy(model.quaternion);
        
        // Determine animation type based on model
        let animationType = 'gear';
        if (position.z > 100) animationType = 'sniper'; // Rough check for sniper gear
        
        // Register this effect for frame-by-frame updates (use the shared module-level map)
        const effect = { model, shooterId, initialOffset, startTime, duration: finalDuration, animationType, currentPosition, initialRotation };
        activeGearEffects.set(shooterId, effect);
        
        // Handle cleanup after duration
        const cleanupTimeout = setTimeout(() => {
          activeGearEffects.delete(shooterId);
          if (scene && model) {
            scene.remove(model);
          }
        }, finalDuration);
      }
    });

    // Parry success
    room.onMessage('parrySuccess', (data) => {
      addInGameNotification('+ PARRY', 3000);
    });

    // Player left
    room.onMessage('playerLeft', (data) => {
    });

    // Game end
    room.onMessage('gameEnd', async (data) => {
      try {
        if (typeof controls !== 'undefined' && controls && controls.isLocked) {
          controls.unlock();
        }
        gameStarted = false;
        
        if (typeof keys !== 'undefined' && keys) {
          keys.w = false;
          keys.a = false;
          keys.s = false;
          keys.d = false;
          keys.space = false;
          prevSpaceState = false;
        }
        
        if (typeof skinMgr !== 'undefined' && skinMgr) skinMgr.removeAll();
        if (typeof hookMgr !== 'undefined' && hookMgr) hookMgr.removeAll();
        if (typeof bombMgr !== 'undefined' && bombMgr) bombMgr.removeAll();
        if (typeof nametags !== 'undefined' && nametags) nametags.dispose();
        if (typeof playerMeshMap !== 'undefined' && playerMeshMap) playerMeshMap.clear();

        const authUser = JSON.parse(localStorage.getItem('auth_user'));
        const myDbId = authUser ? getUserIdFromToken(authUser.token) : null;
        const won = data.winner === myDbId;

        const resultTitle = document.getElementById('resultTitle');
        if (resultTitle) {
          resultTitle.textContent = won ? 'you won' : 'you lost';
          resultTitle.style.color = won ? '#00ff88' : '#ff4444';
        }

        const resultSub = document.getElementById('resultSub');
        if (resultSub) {
          resultSub.innerHTML = won ? 'opponent eliminated' : 'you were eliminated';
          if (rankedMode && data.eloChange !== undefined) {
            const eloText = data.eloChange > 0 ? `+${data.eloChange}` : `${data.eloChange}`;
            const eloColor = data.eloChange > 0 ? '#00ff88' : '#ff4444';
            const rank = getRankFromElo(data.newElo);
            resultSub.innerHTML += `<br><span style="color:${eloColor}; font-family:'Space Mono',monospace; font-size:14px;">ELO: ${eloText} → ${rank.elo}</span>`;
          }
        }

        showResults(won);
        
        if (rankedMode) {
          setTimeout(() => updateRankedStats(), 500);
        }
      } catch (e) {
        console.error('[Ranked gameEnd]', e);
      }
    });

    // Update queue count every 2 seconds
    queueUpdateInterval = setInterval(async () => {
      const countEl = document.getElementById('queueCount');
      if (countEl) {
        countEl.textContent = 'searching for opponent...';
      }
    }, 2000);

  } catch (err) {
    console.error('[joinRankedQueue] Failed:', err);
    rankedMode = false;
    isInRankedQueue = false;
    
    let errorMsg = 'Failed to join queue. Try again.';
    if (err.message?.includes('same account')) {
      errorMsg = 'Cannot queue with the same account in ranked mode.';
    }
    
    document.getElementById('rankedErrorMsg').textContent = errorMsg;
    document.getElementById('rankedQueue').style.display = 'none';
    document.getElementById('rankedMenu').style.display = 'flex';
  }
}

function cancelRankedQueue() {
  rankedMode = false;
  isInRankedQueue = false;
  
  if (queueUpdateInterval) {
    clearInterval(queueUpdateInterval);
    queueUpdateInterval = null;
  }
  
  if (room) {
    room.leave();
    room = null;
  }
  
  document.getElementById('rankedQueue').style.display = 'none';
  document.getElementById('rankedMenu').style.display = 'flex';
  document.getElementById('menu').style.display = 'flex';
}

function resetRankedGame() {
  // Clean up all game state before requeuing
  gameStarted = false;
  
  // Hide results screen
  document.getElementById('page-results').style.display = 'none';
  
  // Leave current room
  if (room) {
    room.leave();
    room = null;
  }
  
  // Clear all game object managers
  if (typeof skinMgr !== 'undefined' && skinMgr) skinMgr.removeAll();
  if (typeof hookMgr !== 'undefined' && hookMgr) hookMgr.removeAll();
  if (typeof bombMgr !== 'undefined' && bombMgr) bombMgr.removeAll();
  if (typeof nametags !== 'undefined' && nametags) nametags.dispose();
  if (typeof playerMeshMap !== 'undefined' && playerMeshMap) playerMeshMap.clear();
  if (typeof activeGearEffects !== 'undefined' && activeGearEffects) activeGearEffects.clear();
  
  // Clear scope effect
  if (typeof activeScopeEffect !== 'undefined') {
    activeScopeEffect = null;
    const vignetteCanvas = document.getElementById('scopeVignette');
    if (vignetteCanvas) {
      vignetteCanvas.classList.remove('active');
    }
  }
  
  // Clear all active explosions
  if (typeof explosions !== 'undefined') {
    explosions.length = 0;
  }
  
  // Reset key states
  if (typeof keys !== 'undefined' && keys) {
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    keys.space = false;
    prevSpaceState = false;
  }
  
  // Unlock pointer if locked
  if (typeof controls !== 'undefined' && controls && controls.isLocked) {
    controls.unlock();
  }
}


function handleCountdown(data) {
  isInRankedQueue = false;
  
  if (queueUpdateInterval) {
    clearInterval(queueUpdateInterval);
    queueUpdateInterval = null;
  }
  
  // Hide ALL UI screens completely
  document.getElementById('rankedQueue').style.display = 'none';
  document.getElementById('rankedMenu').style.display = 'none';
  document.getElementById('versusMenu').style.display = 'none';
  document.getElementById('waitingRoom').style.display = 'none';
  document.getElementById('menu').style.display = 'none';
  
  // Show countdown
  const countdownEl = document.getElementById('rankedCountdown');
  countdownEl.style.display = 'flex';
  countdownEl.classList.add('show');
  
  // Get players data for display
  const myPlayerData = data.players[myId];
  const oppPlayerData = Object.values(data.players).find(p => p.sessionId !== myId);
  
  if (myPlayerData && oppPlayerData) {
    // Fetch player names and ELO from server
    fetchCountdownPlayerInfo(myId, 1);
    fetchCountdownPlayerInfo(oppPlayerData.sessionId, 2);
  }
  
  // Start countdown
  let secondsLeft = 3;
  document.getElementById('countdownNumber').textContent = secondsLeft;
  
  const countdownInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      document.getElementById('countdownNumber').textContent = secondsLeft;
    } else {
      clearInterval(countdownInterval);
      // Countdown finished, hide countdown overlay
      countdownEl.classList.remove('show');
      countdownEl.style.display = 'none';
    }
  }, 1000);
  
  // Disable all input during countdown
  disableInputDuringCountdown(true);
}

async function fetchCountdownPlayerInfo(sessionId, playerNumber) {
  try {
    const userIdMatch = sessionId.match(/^[a-f0-9]{24}$/i);
    if (!userIdMatch) {
      // Try to get from room state
      const playerState = room.state.players.get(sessionId);
      if (playerState) {
        const rankInfo = getRankFromElo(playerState.elo || 100);
        document.getElementById(`player${playerNumber}Elo`).textContent = `${rankInfo.elo} ELO`;
        document.getElementById(`player${playerNumber}Rank`).textContent = rankInfo.name;
        document.getElementById(`player${playerNumber}Rank`).style.color = rankInfo.color;
      }
      return;
    }

    // Fetch user info
    const res = await fetch(`${API_BASE}/api/users-by-id/${sessionId}`);
    if (!res.ok) return;
    
    const user = await res.json();
    document.getElementById(`player${playerNumber}Name`).textContent = user.username || 'Player ' + playerNumber;
    
    const rankInfo = getRankFromElo(user.elo || 100);
    document.getElementById(`player${playerNumber}Rank`).textContent = rankInfo.name;
    document.getElementById(`player${playerNumber}Rank`).style.color = rankInfo.color;
    document.getElementById(`player${playerNumber}Elo`).textContent = `${rankInfo.elo} ELO`;
  } catch (err) {
    console.warn(`[fetchCountdownPlayerInfo] Failed for player ${playerNumber}:`, err);
  }
}

function disableInputDuringCountdown(disable) {
  // Disable keyboard/mouse input
  if (disable) {
    document.addEventListener('keydown', blockInputHandler, true);
    document.addEventListener('mousedown', blockInputHandler, true);
  } else {
    document.removeEventListener('keydown', blockInputHandler, true);
    document.removeEventListener('mousedown', blockInputHandler, true);
  }
}

function blockInputHandler(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Expose functions to global scope for HTML onclick handlers
window.joinRankedQueue = joinRankedQueue;
window.cancelRankedQueue = cancelRankedQueue;

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

    const fullRankedRank = `<span style="color: ${getRankFromElo(user.elo ?? 100).color}">${getRankFromElo(user.elo ?? 100).name}</span>`;

    document.getElementById('stat-user').innerHTML = `your user: ${displayNameHTML}`;
    
    document.getElementById('stat-wins').textContent   = `games won: ${user.wins ?? 0}`;
    document.getElementById('stat-deaths').textContent = `times died: ${user.deaths ?? 0}`;

    document.getElementById('stat-rank').innerHTML = `ranked rank: ${fullRankedRank}`;
    document.getElementById('stat-elo').textContent = `ranked ELO: ${user.elo ?? 100}`;
  } catch { showAuthOverlay(); }
}

function showAuthOverlay() {
  hideLoadingScreen();  // Hide loading screen when showing auth
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
      hideLoadingScreen();  // Hide loading screen after successful login
      document.getElementById('menu').style.display = 'flex';
      window.location.reload();
      fetchAndDisplayStats(data.token);
      
      // Refresh cosmetics UI after login
      refreshCosmeticsUI().catch(err => console.error('[Login] Cosmetics refresh error:', err));
      
      // Preload user's unlocked skins on login
      fetch(`${API_BASE}/api/skins/preload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${data.token}` }
      })
      .then(r => r.json())
      .catch(err => console.warn('[Login] Failed to preload skins:', err));
      
      // Load and cache user settings after login
      fetch(`${API_BASE}/auth/me`, {
        headers: { 'Authorization': `Bearer ${data.token}` }
      })
      .then(r => r.json())
      .then(user => {
        if (user.settings) {
          // Update gameSettings with loaded values
          Object.assign(gameSettings.graphics, user.settings.graphics || {});
          Object.assign(gameSettings.interface, user.settings.interface || {});
          Object.assign(gameSettings.mouse, user.settings.mouse || {});
          Object.assign(window.keybinds, user.settings.keybinds || {});
          
          // Cache the settings
          try {
            localStorage.setItem('cached_settings', JSON.stringify(user.settings));
          } catch (e) {
            console.warn('Failed to cache settings after login:', e);
          }
          
          // Wait for applySettings to be available (game to initialize)
          let retryCount = 0;
          const maxRetries = 150; // 15 seconds with 100ms intervals
          const applySettingsWhenReady = () => {
            retryCount++;
            if (window.applySettings && window.controls && window.camera) {
              const result = window.applySettings();
              // Also reconnect to presence room to ensure websocket works
              if (window.joinPresence) {
                window.joinPresence().catch(e => console.error('[Login] Failed to reconnect presence:', e));
              }
            } else if (retryCount >= maxRetries) {
              console.error('[Login] ✗ Game failed to initialize after 15 seconds, giving up');
            } else {
              setTimeout(applySettingsWhenReady, 100);
            }
          };
          applySettingsWhenReady();
        }
      })
      .catch(e => console.error('[Login] Failed to load settings after login:', e));
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

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL RENDERING STATE – declared here so they're accessible everywhere
// ─────────────────────────────────────────────────────────────────────────────
let scene    = null;
let camera   = null;
let renderer = null;
let controls = null;

// Check authentication and initialize background first
const _savedUser = getUser();

// Initialize background before showing menus
initBackground();
showBackground();

// Now handle auth state
if (!_savedUser) {
  showAuthOverlay();
} else {
  fetchAndDisplayStats(_savedUser.token);
  // Wait a bit to ensure DOM is ready, then show menu
  setTimeout(() => {
    const menuEl = document.getElementById('menu');
    if (menuEl) {
      showMenu();
    } else {
      console.error('[Init] Menu element not found!');
    }
  }, 100);
}

// Update ranked stats when ranked menu is shown
const rankedMenuEl = document.getElementById('rankedMenu');
if (rankedMenuEl) {
  const rankedMenuObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'style' && rankedMenuEl.style.display !== 'none') {
        updateRankedStats();
      }
    });
  });
  
  rankedMenuObserver.observe(rankedMenuEl, { attributes: true, attributeFilter: ['style'] });
}


async function init() {
  await RAPIER.init();

const isSecure   = location.protocol === 'https:';
const SERVER_URL = isSecure
  ? `wss://${location.hostname}`        // Cloudflare/prod: no port, WSS
  : `ws://${location.hostname}:3000`;   // local dev: plain WS on 3000
const colyseus   = new Colyseus.Client(SERVER_URL);

// Three.js scene ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
scene    = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
camera   = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);

// High resolution rendering: use device pixel ratio for crisp visuals
const dpr = window.devicePixelRatio || 1;
const targetDpr = Math.min(dpr, 2.0);  // Full device resolution, capped at 2.0 for performance
renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(targetDpr);
renderer.setSize(innerWidth, innerHeight);

// Optimize shadow rendering
renderer.shadowMap.enabled  = true;
renderer.shadowMap.type = THREE.PCFShadowMap;  // Faster than PCFSoftShadowMap
renderer.shadowMap.resolution = 512;  // Reduced from default 2048

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping      = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

// Style the game canvas: hidden initially, z-index below menus
renderer.domElement.id = 'gameCanvas';
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '50';  // Above background (0) but below menus (1000)
renderer.domElement.style.display = 'none';
renderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(renderer.domElement);

// Store default lights for fallback when maps have no lights
let dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.shadow.mapSize.width = 512;
dirLight.shadow.mapSize.height = 512;
dirLight.shadow.camera.far = 100;
scene.add(dirLight);
const defaultAmbientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(defaultAmbientLight);
const DEFAULT_LIGHTS = [dirLight, defaultAmbientLight];  // Reference to default lights

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
floor.receiveShadow = true;
floor.castShadow = false;  // Fallback floor doesn't need to cast shadows
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

// ── Game state ────────────────────────────────────────────────────────────────────────────────────────────────
// State variables moved to top of file (before ranked functions that use them)

// Results buttons
document.getElementById('playAgainBtn').onclick = () => {
  const btn = document.getElementById('playAgainBtn');
  if (rankedMode) {
    btn.textContent = 'requeue';
    // Completely reset game state before requeuing
    resetRankedGame();
    // Re-enter ranked queue
    joinRankedQueue();
  } else {
    btn.textContent = 'rematch';
    if (room) {
      // For 1v1, send rematch
      room.send('rematch', {});
    }
  }
}
document.getElementById('menuBtn').onclick      = () => {
  rankedMode = false;
  isInRankedQueue = false;
  location.reload();
  showBackground();
}

// Debug: Track versusMenu visibility changes
const versusMenuEl = document.getElementById('versusMenu');
if (versusMenuEl) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.attributeName === 'style') {
      }
    });
  });
  observer.observe(versusMenuEl, { attributes: true, attributeFilter: ['style'] });
}

// Debug: Track waitingRoom visibility changes
const waitingRoomEl = document.getElementById('waitingRoom');
if (waitingRoomEl) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.attributeName === 'style') {
      }
    });
  });
  observer.observe(waitingRoomEl, { attributes: true, attributeFilter: ['style'] });
}

// Menu ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

//randomize splash text

const splashTextList = [
  'I ran out of ideas',
  'burgerburgerburgerburgerburgerburger',
  'virtual real upright inverted',
  'Use code pear in the Fortnite item shop',
  'Also try Minecraft!',
  'Also try Terraria!',
  'no',
  'Garry Egghead is the best (he told me to add)',
  'Cheese is delicious',
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
  
  // Read from gameSettings directly instead of DOM elements
  const fov = gameSettings.graphics.fov || 75;
  const sensitivity = gameSettings.mouse.sensitivity || 0.5;
  const invertY = gameSettings.mouse.invertY || false;
  const showHints = gameSettings.interface.showInputs !== false;
  const showSpeed = gameSettings.interface.showSpeed !== false;
  const showPing = gameSettings.interface.showPing !== false;


  if (!controls) {
    console.error('[applySettings] FAILED: controls not initialized! Type:', typeof controls);
    return false;
  }
  if (!camera) {
    console.error('[applySettings] FAILED: camera not initialized! Type:', typeof camera);
    return false;
  }

  try {
    controls.pointerSpeed = sensitivity;
    
    controls.invertYAxis = invertY;
    
    camera.fov = fov;

    // UI visibility updates with verification
    const hintsEl = document.getElementById('controls-hint');
    if (hintsEl) {
      hintsEl.style.display = showHints ? 'block' : 'none';
    } else {
      console.warn('[applySettings] controls-hint element not found');
    }
    
    const velocityEl = document.getElementById('velocity');
    if (velocityEl) {
      velocityEl.style.display = showSpeed ? 'block' : 'none';
    } else {
      console.warn('[applySettings] velocity element not found');
    }
    
    const pingEl = document.getElementById('ping');
    if (pingEl) {
      pingEl.style.display = showPing ? 'block' : 'none';
    } else {
      console.warn('[applySettings] ping element not found');
    }

    camera.updateProjectionMatrix();
    return true;
  } catch (err) {
    console.error('[applySettings] EXCEPTION during apply:', err);
    return false;
  }
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

  // Update gameSettings from form values
  Object.assign(gameSettings.graphics, settings.graphics);
  Object.assign(gameSettings.interface, settings.interface);
  Object.assign(gameSettings.mouse, settings.mouse);

  // Cache settings in localStorage as backup
  try {
    localStorage.setItem('cached_settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to cache settings in localStorage:', e);
  }

  const applied = applySettings();
  if (applied) {
    // Close the settings menu after applying
    const settingsPanel = document.getElementById('panel-settings');
    if (settingsPanel) {
      settingsPanel.style.display = 'none';
    }
  } else {
    console.warn('[Save] Settings were not applied successfully');
  }
  databaseSave({ settings })
})

// Wrap displayStoredSettings to ensure settings are applied after loading
if (window.displayStoredSettings) {
  const originalDisplay = window.displayStoredSettings;
  window.displayStoredSettings = function() {
    originalDisplay.call(this);
    applySettings();
  };
}

// Expose applySettings globally for presenceRoom reconnect
window.applySettingsGlobal = applySettings;

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

//friend request

async function sendFriendRequest(username) {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return { error: 'Not logged in' }

  try {
    const res = await fetch(`${API_BASE}/api/users/${username}/friend-request`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authUser.token}` }
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error };
    return { ok: true };
  } catch (err) {
    return { error: 'Network error.' };
  }
}

document.querySelector('.add-friend-bar .btn-sm').addEventListener('click', async () => {
  const input = document.querySelector('.add-friend-input');
  const username = input.value.trim();
  if (!username) return;

  const result = await sendFriendRequest(username);
  if (result.error) {
    input.placeholder = result.error;
    input.value = '';
  } else {
    input.value = '';
    input.placeholder = 'request sent!';
  }

  setTimeout(() => input.placeholder = 'add by user /', 2000);
});

//display friend requests

async function displayFriendRequests(requests) {
  const container = document.getElementById('friends-pending');
  container.innerHTML = '<div class="friend-section-label" style="color:#555;">loading...</div>';

  const entries = Object.entries(requests);
  if (entries.length === 0) { container.innerHTML = ''; return; }

  // fetch all at once
  const users = await Promise.all(
    entries.map(([userId, username]) =>
      fetch(`${API_BASE}/api/users/${username}`).then(r => r.json())
    )
  );

  container.innerHTML = '';
  entries.forEach(([userId, username], i) => {
    const user        = users[i];
    const status      = user.status === 'Online'  ? 'online'
                      : user.status === 'In Game' ? 'in-game'
                      : 'offline';
    const prefix      = user.userPrefix;
    const prefixColor = user.prefixColor;
    const userColor   = user.usernameColor;
    const initials    = username.slice(0, 2).toUpperCase();

    container.insertAdjacentHTML('beforeend', `
      <div class="friend-row" id="request-${userId}">
        <div class="f-avatar">${initials}<div class="status-dot ${status}"></div></div>
        <div class="friend-info">
          <div class="friend-name">
            <span style="color:${prefixColor}">[${prefix}]</span>
            <span style="color:${userColor}">${username}</span>
          </div>
          <div class="friend-status-text">Sent you a request</div>
        </div>
        <div style="display:flex; gap:5px;">
          <div class="friend-action-btn" title="accept" style="opacity:1;" onclick="acceptRequest('${userId}', '${username}')">✓</div>
          <div class="friend-action-btn" title="decline" style="opacity:1; color:#ff5f56;" onclick="declineRequest('${userId}')">✕</div>
        </div>
      </div>
    `);
  });
}

async function displayFriends(friends) {
  const onlineContainer  = document.getElementById('online-friends');
  const offlineContainer = document.getElementById('offline-friends');

  onlineContainer.innerHTML  = '<div class="friend-section-label" style="color:#555;">loading...</div>';
  offlineContainer.innerHTML = '';

  const entries = Object.keys(friends); // ← just usernames now
  if (entries.length === 0) { onlineContainer.innerHTML = ''; return; }

  const users = await Promise.all(
    entries.map(username =>
      fetch(`${API_BASE}/api/users/${username}`).then(r => r.json())
    )
  );

  onlineContainer.innerHTML  = '';
  offlineContainer.innerHTML = '';

  entries.forEach((username, i) => {
    const user        = users[i];
    const status      = user.status === 'Online'  ? 'online'
                      : user.status === 'In Game' ? 'in-game'
                      : 'offline';
    const statusText  = user.status === 'In Game' ? 'in game · 1v1'
                      : user.status === 'Online'  ? 'online · in lobby'
                      : 'offline';
    const initials    = username.slice(0, 2).toUpperCase();

    const html = `
      <div class="friend-row" id="friend-${username}" onclick="openChat('${username}')" oncontextmenu="event.preventDefault(); showFriendContextMenu(event, '${username}')">
        <div class="f-avatar">${initials}<div class="status-dot ${status}"></div></div>
        <div class="friend-info">
          <div class="friend-name">
            <span style="color:${user.prefixColor}">[${user.userPrefix}]</span>
            <span style="color:${user.usernameColor}">${username}</span>
          </div>
          <div class="friend-status-text ${status}">${statusText}</div>
        </div>
        <div class="friend-actions">
          <div class="friend-action-btn" title="message" onclick="event.stopPropagation(); openChat('${username}')">💬</div>
        </div>
      </div>
    `;

    if (status === 'offline') offlineContainer.insertAdjacentHTML('beforeend', html);
    else onlineContainer.insertAdjacentHTML('beforeend', html);
  });
}

async function loadFriendRequests() {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return;

  const res  = await fetch(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${authUser.token}` }
  });
  const user = await res.json();
  
  const requests = user.friends?.requests || {};
  displayFriendRequests(requests);
}

// Context menu for friend actions
function showFriendContextMenu(event, username) {
  
  // Remove any existing context menu
  const existing = document.getElementById('friend-context-menu');
  if (existing) existing.remove();
  
  // Create context menu
  const menu = document.createElement('div');
  menu.id = 'friend-context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${event.clientX}px;
    top: ${event.clientY}px;
    background: rgba(30, 30, 40, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    z-index: 10000;
    min-width: 140px;
    backdrop-filter: blur(6px);
  `;
  
  menu.innerHTML = `
    <div style="padding: 8px 0;">
      <div onclick="unfriend('${username}')" style="padding: 10px 16px; cursor: pointer; color: #ff5f56; font-size: 14px; transition: background 0.15s;" onmouseover="this.style.background = 'rgba(255, 95, 86, 0.2)'" onmouseout="this.style.background = 'transparent'">
        Unfriend
      </div>
    </div>
  `;
  
  document.body.appendChild(menu);
  
  // Close menu when clicking elsewhere
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// Remove a friend with confirmation
async function unfriend(username) {
  
  // Close context menu
  const menu = document.getElementById('friend-context-menu');
  if (menu) menu.remove();
  
  // Show confirmation dialog
  const confirmed = confirm(`Are you sure you want to unfriend ${username}?`);
  if (!confirmed) {
    return;
  }
  
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) {
    console.error('[Friends] Not logged in');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/api/friends/remove`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${authUser.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ friendUsername: username })
    });
    
    const data = await res.json();
    if (!res.ok) {
      console.error('[Friends] Failed to unfriend:', data.error);
      alert(`Failed to unfriend: ${data.error || 'Unknown error'}`);
      return;
    }
    
    // Remove the friend row with animation
    const friendRow = document.getElementById(`friend-${username}`);
    if (friendRow) {
      friendRow.style.transition = 'opacity 0.2s';
      friendRow.style.opacity = '0';
      setTimeout(() => {
        friendRow.remove();
      }, 200);
    }
    
    // Refresh friends list to ensure consistency
    await loadFriends();
    
  } catch (e) {
    console.error('[Friends] Error unfriending:', e);
    alert('Failed to unfriend. Please try again.');
  }
}

// Expose unfriend globally for context menu onclick
window.unfriend = unfriend;

async function loadFriends() {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return;

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { 'Authorization': `Bearer ${authUser.token}` }
  });
  const user = await res.json();

  const friends = user.friends?.list || {};
  displayFriends(friends);
}

async function displayInviteFriends(friends) {
  const container = document.querySelector('#waitingRoom .MainUI:last-child .friend-list');
  if (!container) return;
  
  container.innerHTML = '';

  const entries = Object.keys(friends);
  if (entries.length === 0) {
    container.innerHTML = '<div class="friend-section-label" style="color:#555; padding:14px;">no friends to invite</div>';
    return;
  }

  const users = await Promise.all(
    entries.map(username =>
      fetch(`${API_BASE}/api/users/${username}`).then(r => r.json())
    )
  );

  entries.forEach((username, i) => {
    const user        = users[i];
    const status      = user.status === 'Online'  ? 'online'
                      : user.status === 'In Game' ? 'in-game'
                      : 'offline';
    const initials    = username.slice(0, 2).toUpperCase();

    const html = `
      <div class="friend-row" style="padding:7px 10px;">
        <div class="f-avatar">${initials}<div class="status-dot ${status}"></div></div>
        <div class="friend-info">
          <div class="friend-name">
            <span style="color:${user.prefixColor}">[${user.userPrefix}]</span>
            <span style="color:${user.usernameColor}">${username}</span>
          </div>
        </div>
        <div class="friend-actions" style="opacity:1;">
          <div class="friend-action-btn" title="invite" onclick="sendInvite('${username}')">→</div>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', html);
  });
}

async function sendInvite(friendUsername) {
  if (!currentRoomCode) {
    console.error('No room code available');
    return;
  }

  const inviteMessage = `[CLICK TO JOIN] 1v1 Match with code: '${currentRoomCode}'`;
  
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  try {
    await fetch(`${API_BASE}/api/users/${friendUsername}/messages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${authUser.token}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ text: inviteMessage })
    });
  } catch (e) {
    console.error('Failed to send invite:', e);
  }
}

async function joinInvite(code) {
  // Close chat menu and friends menu
  document.getElementById('chatMenu').style.display = 'none';
  
  // Close the friends/menu area
  const friendsList = document.getElementById('friends-list');
  if (friendsList) friendsList.style.display = 'none';
  const onlineFriends = document.getElementById('online-friends');
  if (onlineFriends) onlineFriends.style.display = 'none';
  const offlineFriends = document.getElementById('offline-friends');
  if (offlineFriends) offlineFriends.style.display = 'none';
  
  document.getElementById('menu').style.display = 'none';
  // Don't show versusMenu - just silently fill in code and join
  
  // Fill in code and attempt join
  document.getElementById('codeInput').value = code.toUpperCase();
  
  // Give it a moment to render, then click join
  setTimeout(() => {
    document.getElementById('joinBtn').click();
  }, 100);
}

loadFriendRequests();
loadFriends();

document.getElementById('friendsMenuBtn').addEventListener('click', () => {
  loadFriendRequests();
  loadFriends();
})

// Refresh friends when any friend action button is clicked
try {
  document.querySelector('.friend-action-btn')?.addEventListener('click', () => {
    loadFriendRequests();
    loadFriends();
  });
} catch (e) {
}

// ── Chat ─────────────────────────────────────────────────────
let activeChatUser = null;
let messageState = {
  skip: 0,
  limit: 20,
  total: 0,
  isLoading: false
};

async function openChat(username) {
  activeChatUser = username;
  messageState = { skip: 0, limit: 20, total: 0, isLoading: false };

  // Clear messages immediately
  const scroll = document.getElementById('msgScroll');
  scroll.innerHTML = '<div style="text-align:center;color:#555;font-size:11px;font-family:\'Space Mono\',monospace;margin:auto;padding-top:20px;">loading...</div>';

  // fetch their profile for display info
  const res  = await fetch(`${API_BASE}/api/users/${username}`);
  const user = await res.json();

  const status      = user.status === 'Online'  ? 'online'
                    : user.status === 'In Game' ? 'in-game'
                    : 'offline';
  const statusText  = user.status === 'In Game' ? '● in game · 1v1'
                    : user.status === 'Online'  ? '● online · in lobby'
                    : '● offline';
  const initials    = username.slice(0, 2).toUpperCase();

  // update header
  const av = document.getElementById('chatHeaderAvatar');
  av.textContent   = initials;
  av.style.background = 'rgba(60,80,120,0.7)';

  document.getElementById('chatHeaderName').innerHTML = `
    <span style="color:${user.prefixColor}">[${user.userPrefix}]</span>
    <span style="color:${user.usernameColor}">${username}</span>
  `;
  document.getElementById('chatMenuTitle').textContent = username;

  const st = document.getElementById('chatHeaderStatus');
  st.textContent = statusText;
  st.style.color = status === 'online'  ? '#00cc6a'
                 : status === 'in-game' ? '#cc8800'
                 : '#666';

  document.getElementById('chatMenu').style.display = 'flex';
  document.getElementById('msgInput').focus();

  await renderMessages(username, true);
}

async function renderMessages(username, isInitial = false) {
  const scroll = document.getElementById('msgScroll');
  
  if (isInitial) {
    scroll.innerHTML = '<div style="text-align:center;color:#555;font-size:11px;font-family:\'Space Mono\',monospace;margin:auto;padding-top:20px;">loading...</div>';
  }

  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  messageState.isLoading = true;
  
  const res = await fetch(
    `${API_BASE}/api/users/${username}/messages?limit=${messageState.limit}&skip=${messageState.skip}`,
    { headers: { 'Authorization': `Bearer ${authUser.token}` } }
  );
  const data = await res.json();
  messageState.isLoading = false;
  
  const messages = data.messages || [];
  messageState.total = data.total || 0;

  if (isInitial) {
    scroll.innerHTML = '';

    if (messages.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#555;font-size:11px;font-family:"Space Mono",monospace;margin:auto;padding-top:20px;';
      empty.textContent = 'no messages yet';
      scroll.appendChild(empty);
      _attachScrollListener();
      return;
    }

    messages.forEach(m => _renderMessage(m, authUser.username, scroll));
    scroll.scrollTop = scroll.scrollHeight;
    _attachScrollListener();
  } else {
    // Prepend older messages at top
    const container = scroll.firstChild;
    messages.reverse().forEach(m => {
      const elem = _createMessageElement(m, authUser.username);
      scroll.insertBefore(elem, container);
    });
  }
}

function _renderMessage(m, currentUser, container) {
  container.appendChild(_createMessageElement(m, currentUser));
}

function _createMessageElement(m, currentUser) {
  const mine = m.from === currentUser;
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (mine ? 'mine' : 'theirs');
  
  if (m.text.includes('[CLICK TO JOIN]') && !mine) {
    const codeMatch = m.text.match(/code: '([^']+)'/);
    const code = codeMatch ? codeMatch[1] : '';
    wrap.innerHTML = `<div class="msg-bubble" style="cursor:pointer; background:rgba(0,255,136,0.15); border:1px solid rgba(0,255,136,0.3);" onclick="joinInvite('${code}')" title="Click to join">${m.text}</div><div class="msg-time">${time}</div>`;
  } else {
    wrap.innerHTML = `<div class="msg-bubble">${m.text}</div><div class="msg-time">${time}</div>`;
  }
  return wrap;
}

function _attachScrollListener() {
  const scroll = document.getElementById('msgScroll');
  scroll.onscroll = async () => {
    // Load more when scrolled to top
    if (scroll.scrollTop === 0 && messageState.skip + messageState.limit < messageState.total && !messageState.isLoading) {
      const prevHeight = scroll.scrollHeight;
      messageState.skip += messageState.limit;
      await renderMessages(activeChatUser, false);
      // Adjust scroll to prevent jumping
      scroll.scrollTop = scroll.scrollHeight - prevHeight;
    }
  };
}



async function sendMessage() {
  const input    = document.getElementById('msgInput');
  const text     = input.value.trim();
  if (!text || !activeChatUser) return;

  input.value    = '';
  input.disabled = true;

  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  await fetch(`${API_BASE}/api/users/${activeChatUser}/messages`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${authUser.token}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ text })
  });

  input.disabled = false;
  input.focus();
  // Reset to show latest messages after send
  messageState = { skip: 0, limit: 20, total: 0, isLoading: false };
  await renderMessages(activeChatUser, true);
}

document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.querySelector('.send-btn').addEventListener('click', sendMessage);

// Wrapper for acceptRequest to also refresh the friends menu
async function acceptRequest(userId, username) {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/friends/accept`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${authUser.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requesterId: userId, requesterUsername: username })
    });
    
    const data = await res.json();
    if (!res.ok) {
      console.error('[Friends] Failed to accept request:', data.error);
      return;
    }
    await loadFriendRequests();
    await loadFriends();
  } catch (e) {
    console.error('[Friends] Failed to accept request:', e);
  }
}

// Wrapper for declineRequest
async function declineRequest(userId) {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/friends/decline`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${authUser.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requesterId: userId })
    });
    
    const data = await res.json();
    if (!res.ok) {
      console.error('[Friends] Failed to decline request:', data.error);
      return;
    }
    await loadFriendRequests();
  } catch (e) {
    console.error('[Friends] Failed to decline request:', e);
  }
}

// expose to HTML onclick handlers
window.openChat = openChat;
window.acceptRequest = acceptRequest;
window.declineRequest = declineRequest;
window.sendInvite = sendInvite;
window.joinInvite = joinInvite;
window.showFriendContextMenu = showFriendContextMenu;

function showMessageNotification(fromUsername) {
  // find the friend row and add a dot or badge
  const row = document.getElementById(`friend-${fromUsername}`);
  if (row && !row.querySelector('.notif-dot')) {
    const dot = document.createElement('div');
    dot.className = 'notif-dot';
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#00ff88;flex-shrink:0;';
    row.appendChild(dot);
  }
}

function addNotification(type, username, message, duration = 5000) {
  // Create unique ID for this notification (simple hash to reduce collisions)
  const notifId = `${type}-${username}-${message.length}-${Math.random().toString(36).substr(2, 9)}`;
  
  const container = document.querySelector('.notificationContent');
  if (!container) return;
  
  const notifEl = document.createElement('div');
  notifEl.id = `notif-${notifId}`;
  notifEl.style.cssText = 'padding:8px 10px; margin:4px 0; background:rgba(0,0,0,0.3); border-left:3px solid #00ff88; padding-left:10px; word-break:break-word; font-size: 12px;';
  notifEl.textContent = message;
  
  container.insertAdjacentElement('afterbegin', notifEl);
  
  // Auto-remove after duration
  setTimeout(() => {
    notifEl.remove();
  }, duration);
}

function updateNotificationsDisplay() {
  const container = document.querySelector('.notificationContent');
  if (!container) return;
  // Container will be updated by addNotification
}

/**
 * Add an in-game notification (appears during gameplay)
 * @param {string} message - The notification message
 * @param {number} duration - How long to show (ms), default 3000
 */
function addInGameNotification(message, duration = 3000) {
  const container = document.querySelector('.inGameNotifications .notificationContent');
  if (!container) {
    console.warn('[addInGameNotification] Container not found');
    return;
  }

  const notifId = `ingame-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const notifEl = document.createElement('div');
  notifEl.id = notifId;
  notifEl.style.cssText = 'padding:8px 10px; margin:4px 0; background:rgba(0,255,136,0.2); border-left:3px solid #ffe600; color:#00ff88; word-break:break-word; font-size: 12px; animation: slideIn 0.3s ease-out;';
  notifEl.textContent = message;
  
  container.insertAdjacentElement('afterbegin', notifEl);
  
  // Show the notifications container if it was hidden
  const notificationsDiv = document.querySelector('.inGameNotifications');
  if (notificationsDiv) {
    notificationsDiv.style.opacity = '1';
    notificationsDiv.style.pointerEvents = 'auto';
  }

  // Auto-remove after duration
  setTimeout(() => {
    const el = document.getElementById(notifId);
    if (el) el.remove();
    
    // Hide container if no more notifications
    if (container.children.length === 0 || container.querySelectorAll('[id^="ingame-"]').length === 0) {
      setTimeout(() => {
        if (container.querySelectorAll('[id^="ingame-"]').length === 0 && notificationsDiv) {
          notificationsDiv.style.opacity = '0';
          notificationsDiv.style.pointerEvents = 'none';
        }
      }, 1000);  // Wait 1s after all notifications are gone before hiding
    }
  }, duration);
}

function updateNotificationsDisplay() {
  const container = document.querySelector('.notificationContent');
  if (!container) return;
  // Container will be updated by addNotification
}

// ── Skin card system ────────────────────────────────────────────────────────────
// Store bomb skins globally so they can be accessed when bombs spawn during gameplay
let gBombSkins = {};

async function forEachUnlockedSkin(skinCallback, grappleCallback, bombCallback) {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) {
    console.warn('[forEachUnlockedSkin] No auth user found');
    return;
  }
  const res  = await fetch(`${API_BASE}/api/skins`, {
    headers: { Authorization: `Bearer ${authUser.token}` }
  });
  if (!res.ok) {
    console.error('[forEachUnlockedSkin] API error:', res.status);
    return;
  }
  const { skins, unlockedSkins, equippedSkin, grapples, unlockedGrapples, equippedGrapple, bombs, unlockedBombs, equippedBomb } = await res.json();


  // Store bomb skins for gameplay use
  gBombSkins = {};
  for (const bomb of bombs) {
    gBombSkins[bomb.id] = bomb;
  }

  for (const skin of skins) {
    skinCallback(skin, unlockedSkins.includes(skin.id), skin.id === equippedSkin);
  }

  if (grappleCallback) {
    for (const grapple of grapples) {
      grappleCallback(grapple, unlockedGrapples.includes(grapple.id), grapple.id === equippedGrapple);
    }
  }

  if (bombCallback) {
    for (const bomb of bombs) {
      bombCallback(bomb, unlockedBombs.includes(bomb.id), bomb.id === equippedBomb);
    }
  }
}

/**
 * Generic card factory - prevents code duplication
 * Creates a skin/grapple/bomb card with standard layout and event handling
 * @param {Object} item - The item data (skin, grapple, or bomb)
 * @param {string} containerId - ID of the container to append to
 * @param {string} equipEndpoint - API endpoint to equip this item
 * @param {string} paramName - Parameter name for the equip endpoint
 * @param {boolean} unlocked - Whether the item is unlocked
 * @param {boolean} equipped - Whether the item is equipped
 */
function createSkinCard(item, unlocked, equipped, containerId, equipEndpoint, paramName) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`[createSkinCard] Container not found: ${containerId}`);
    return;
  }

  const card = document.createElement('div');
  card.className = 'skin-card';
  card.style.background = `linear-gradient(to left, rgba(0,0,0,0.7), transparent), url(${item.thumbnail}) center/cover`;

  if (!unlocked) {
    const lock = document.createElement('div');
    lock.className = 'skin-lock';
    lock.innerHTML = '<span style="font-size:12px;color:#fff;">locked</span>';
    card.appendChild(lock);
  } else {
    card.innerHTML = `<h2>${item.name}</h2> <p style="font-size: 12px; color: #dde">${item.description}</p>`;
    card.addEventListener('click', async () => {
      const authUser = JSON.parse(localStorage.getItem('auth_user'));
      if (!authUser) return;

      const body = {};
      body[paramName] = item.id;

      await fetch(`${API_BASE}${equipEndpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authUser.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      // Update UI - remove selection from all cards in this container
      container.querySelectorAll('.skin-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      // Update preview
      if (typeof previewSystem !== 'undefined') {
        previewSystem.updatePreview().catch(e => console.error('[Preview Update]', e));
      }
    });
  }

  if (equipped) {
    card.classList.add('selected');
  }
  container.appendChild(card);
}

// Wrapper functions for backward compatibility and cleaner calls
function createPlayerSkinCard(skin, unlocked, equipped) {
  createSkinCard(skin, unlocked, equipped, 'panel-skinCards', '/api/skins/equip', 'skinId');
}

function createGrappleCard(grapple, unlocked, equipped) {
  createSkinCard(grapple, unlocked, equipped, 'panel-grappleSkinCards', '/api/skins/equip-grapple', 'grappleId');
}

function createBombCard(bomb, unlocked, equipped) {
  createSkinCard(bomb, unlocked, equipped, 'panel-bombSkinCards', '/api/skins/equip-bomb', 'bombSkinId');
}

forEachUnlockedSkin(createPlayerSkinCard, createGrappleCard, createBombCard);

//load title cards

function forEachTitleCard(titleCallback) {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) {
    console.warn('[forEachTitleCard] No auth user found');
    return Promise.resolve();
  }
  return fetch(`${API_BASE}/api/titles`, {
    headers: { Authorization: `Bearer ${authUser.token}` }
  })
  .then(res => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  })
  .then(({ titles, unlockedTitles, equippedTitle }) => {
    for (const title of titles) {
      titleCallback(title, unlockedTitles.includes(title.id), title.name === equippedTitle);
    }
  })
  .catch(err => console.error('[forEachTitleCard] Error:', err));
}

function createTitleCard(title, unlocked, equipped) {
  const container = document.getElementById('titleCardsUnlocked');
  const containerLocked = document.getElementById('titleCardsLocked');
  const card = document.createElement('div');
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  card.className = 'title-row';
  
  if (!unlocked) {
    card.classList.add('locked');
    card.innerHTML = `<span style="color:${title.prefixColor};">[${title.name}] <span style="color:${title.usernameColor};">${authUser.username}</span></span> <div class="title-description">${title.description} You do not own this title.</div>`;
    containerLocked.appendChild(card);
  } else {
    card.innerHTML = `<span style="color:${title.prefixColor};">[${title.name}] <span style="color:${title.usernameColor};">${authUser.username}</span></span> <div class="title-description">${title.description}</div>`;
    card.addEventListener('click', async () => {
      await fetch(`${API_BASE}/api/titles/equip`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${JSON.parse(localStorage.getItem('auth_user')).token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ titleId: title.id })
      });
      // update UI
      document.querySelectorAll('.title-row').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      fetchAndDisplayStats(authUser.token); // to update title display in stats
      // Update preview
      if (typeof previewSystem !== 'undefined') {
        previewSystem.updatePreview().catch(e => console.error('[Preview Update]', e));
      }
    });
    container.appendChild(card);
  }
  if (equipped) {
    card.classList.add('selected');
  }

}

forEachTitleCard(createTitleCard);

// ── GEAR SYSTEM ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Gear items list - fetched from server via /api/gear
let gearItems = [];

/**
 * Fetch gear data from server
 */
async function loadGearData() {
  try {
    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    if (!authUser) return;

    const res = await fetch(`${API_BASE}/api/gear`, {
      headers: { Authorization: `Bearer ${authUser.token}` }
    });

    if (!res.ok) {
      console.error('[loadGearData] Failed to fetch gear:', res.statusText);
      return;
    }

    const data = await res.json();
    gearItems = data.gear;
  } catch (err) {
    console.error('[loadGearData] Error:', err);
  }
}

function createGearCard(gear) {
  const card = document.createElement('div');
  card.className = `gear-card${gear.equipped ? ' selected' : ''}`;
  card.innerHTML = `
    <div class="gear-card-header">${gear.name}</div>
    <div class="gear-card-info">${gear.description}</div>
    <div class="gear-card-footer">
      <span style="color: ${{'low-skill': '#888', 'medium-skill': '#4488ff', 'high-skill': '#cc44ff', 'ultra-high-skill': '#ffaa00'}[gear.rarity]}">${gear.rarity}</span>
    </div>
  `;
  card.onclick = () => equipGear(gear.id, card);
  
  // Add scroll on hover for cards at the end
  card.addEventListener('mouseenter', () => {
    const container = card.parentElement;
    const allCards = container.querySelectorAll('.gear-card');
    const isLastCard = card === allCards[allCards.length - 1];
    
    if (isLastCard) {
      // Scroll to show the expanded card (120px base + 160px expansion = 280px total)
      const scrollAmount = (card.offsetLeft + 280) - container.clientWidth + 12;
      container.scrollLeft = Math.max(0, scrollAmount);
    }
  });
  
  return card;
}

function equipGear(gearId, cardElement) {
  // Remove previous selection
  document.querySelectorAll('.gear-card').forEach(card => card.classList.remove('selected'));
  // Add selection to clicked card
  cardElement.classList.add('selected');
  
  // Mark gear as equipped in the array
  gearItems.forEach(gear => {
    gear.equipped = (gear.id === gearId);
  });
  
  // Send to server: POST /api/gear/equip with gearId
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (authUser) {
    fetch(`${API_BASE}/api/gear/equip`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authUser.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ gearId })
    }).catch(err => console.error('[equipGear] Error:', err));
  }
}

function initializeGearCards() {
  const container = document.getElementById('gearCardsContainer');
  if (!container || gearItems.length === 0) return;
  
  // Clear existing cards
  container.innerHTML = '';
  gearItems.forEach(gear => {
    container.appendChild(createGearCard(gear));
  });
    
    // Add horizontal scroll with mouse wheel
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      container.scrollLeft += e.deltaY > 0 ? 50 : -50;
    });
}

// Initialize gear cards on page load
async function initGearOnLoad() {
  await loadGearData();
  initializeGearCards();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGearOnLoad);
} else {
  initGearOnLoad();
}

// ── Refresh cosmetics UI (called after login) ───────────────────────────────────────
async function refreshCosmeticsUI() {
  try {
    // Clear existing cards
    const panelSkins = document.getElementById('panel-skinCards');
    const panelGrapples = document.getElementById('panel-grappleSkinCards');
    const panelBombs = document.getElementById('panel-bombSkinCards');
    const titleUnlocked = document.getElementById('titleCardsUnlocked');
    const titleLocked = document.getElementById('titleCardsLocked');
    
    if (panelSkins) panelSkins.innerHTML = '';
    if (panelGrapples) panelGrapples.innerHTML = '';
    if (panelBombs) panelBombs.innerHTML = '';
    if (titleUnlocked) titleUnlocked.innerHTML = '';
    if (titleLocked) titleLocked.innerHTML = '';
    
    // Reload and display cosmetics
    await forEachUnlockedSkin(createPlayerSkinCard, createGrappleCard, createBombCard);
    await forEachTitleCard(createTitleCard);
    
    // Refresh gear cards
    await loadGearData();
    initializeGearCards();
    
    // Wait for preview system to be initialized before updating
    if (typeof previewSystem !== 'undefined') {
      let retries = 0;
      const maxRetries = 50; // 5 seconds max wait
      const waitForPreviewInit = () => {
        retries++;
        if (previewSystem.isInitialized) {
          previewSystem.updatePreview().catch(e => console.error('[Preview Update after cosmetics refresh]', e));
        } else if (retries < maxRetries) {
          setTimeout(waitForPreviewInit, 100);
        } else {
          console.warn('[refreshCosmeticsUI] Preview system took too long to initialize');
        }
      };
      waitForPreviewInit();
    }
    
  } catch (err) {
    console.error('[refreshCosmeticsUI] Error:', err);
  }
}

// ── PLAYER PREVIEW SYSTEM ───────────────────────────────────────────────────────────────────────────────────────────────────────

class PlayerPreviewSystem {
  constructor() {
    this.previewScene = null;
    this.previewCamera = null;
    this.previewRenderer = null;
    this.previewSkinMgr = null;
    this.previewNametags = null;
    this.previewHookMgr = null;
    this.previewPlayerData = null;
    this.buttonRenderer = null;
    this.animationFrameId = null;
    this.resizeHandler = null;
    this._resizeObserver = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    
    try {
      // Wait for layout to be calculated
      await new Promise(resolve => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', resolve, { once: true });
        }
      });
      
      // Small delay to ensure layout is computed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Initialize main preview canvas
      const previewCanvas = document.getElementById('previewCanvas');
      if (previewCanvas) {
        // Get display size
        const displayWidth = previewCanvas.clientWidth || 400;
        const displayHeight = previewCanvas.clientHeight || 440;
        
        // Set canvas resolution attributes to match display size
        previewCanvas.width = displayWidth;
        previewCanvas.height = displayHeight;
        
        this.previewScene = new THREE.Scene();
        this.previewScene.background = new THREE.Color(0x686565);
        
        this.previewCamera = new THREE.PerspectiveCamera(
          40,
          displayWidth / displayHeight,
          0.1,
          1000
        );
        this.previewCamera.position.set(0, 4, 7);
        this.previewCamera.lookAt(0, 1, 0);
        this.previewCamera.updateProjectionMatrix();
        
        this.previewRenderer = new THREE.WebGLRenderer({ 
          canvas: previewCanvas, 
          antialias: true, 
          alpha: false,
          preserveDrawingBuffer: false
        });
        this.previewRenderer.setSize(displayWidth, displayHeight);
        this.previewRenderer.setPixelRatio(window.devicePixelRatio);
        this.previewRenderer.shadowMap.enabled = true;
        
        // Add lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.previewScene.add(ambientLight);
        
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 5, 5);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        this.previewScene.add(dirLight);
        
        // Add floor
        const floorGeom = new THREE.PlaneGeometry(20, 20);
        const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x686767) });
        const floorMesh = new THREE.Mesh(floorGeom, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.y = -1.5;
        floorMesh.receiveShadow = true;
        this.previewScene.add(floorMesh);
        
        // Initialize managers
        this.previewSkinMgr = new SkinManager(this.previewScene, gltfLoader);
        this.previewHookMgr = new HookManager(this.previewScene);
        this.previewNametags = new Nametags(this.previewScene);
      }
      
      // Initialize button canvas preview
      const buttonCanvas = document.getElementById('customizationButtonCanvas');
      if (buttonCanvas) {
        const btnDisplayWidth = buttonCanvas.clientWidth || 120;
        const btnDisplayHeight = buttonCanvas.clientHeight || 120;
        
        // Set canvas resolution attributes
        buttonCanvas.width = btnDisplayWidth;
        buttonCanvas.height = btnDisplayHeight;
        
        this.buttonRenderer = new THREE.WebGLRenderer({ 
          canvas: buttonCanvas, 
          antialias: true, 
          alpha: false,
          preserveDrawingBuffer: false
        });
        this.buttonRenderer.setSize(btnDisplayWidth, btnDisplayHeight);
        this.buttonRenderer.setPixelRatio(window.devicePixelRatio);
      }
      
      // Handle window resize
      const handleResize = () => {
        this.resizeCanvases();
      };
      window.addEventListener('resize', handleResize);
      
      this.resizeHandler = handleResize;
      
      // Also use ResizeObserver to track preview container size changes
      const previewContainer = document.querySelector('.preview');
      const buttonContainer = document.querySelector('.playerIcon');
      if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(() => {
          this.resizeCanvases();
        });
        if (previewContainer) {
          resizeObserver.observe(previewContainer);
        }
        if (buttonContainer) {
          resizeObserver.observe(buttonContainer);
        }
        this._resizeObserver = resizeObserver;
      }
      
      this.isInitialized = true;
      this.resizeCanvases();  // Ensure correct sizing after init
      await this.updatePreview();
      this.startAnimation();
    } catch (e) {
      console.error('[PlayerPreviewSystem] Initialization failed:', e);
    }
  }

  async updatePreview() {
    try {
      const authUser = JSON.parse(localStorage.getItem('auth_user'));
      if (!authUser) return;
      
      // Fetch player data
      const res = await fetch(`${API_BASE}/api/skins`, {
        headers: { Authorization: `Bearer ${authUser.token}` }
      });
      const data = await res.json();
      
      // Get equipped items
      const equippedSkinId = data.equippedSkin;
      const equippedGrappleId = data.equippedGrapple;
      
      if (!equippedSkinId || !equippedGrappleId) return;
      
      // Get skin and grapple data
      const { skins, grapples } = data;
      const skinData = skins.find(s => s.id === equippedSkinId);
      const grappleData = grapples.find(g => g.id === equippedGrappleId);
      
      if (!skinData || !grappleData) return;
      
      // Build full skin data object
      this.previewPlayerData = {
        glb: skinData.glb,
        scale: skinData.scale || 1.0,
        eyeOffset: skinData.eyeOffset || 1.0,
        grapple: {
          image: grappleData.image,
          localImage: grappleData.localImage,
          scale: grappleData.scale || 1.0,
          color: grappleData.color || 0x00ffff,
        },
      };
      
      // Load skin
      if (this.previewSkinMgr) {
        await this.previewSkinMgr.assignSkin('preview-player', this.previewPlayerData, false);
        this.previewSkinMgr.setPosition('preview-player', 0, 0, 0);
      }
      
      // Load grapple
      if (this.previewHookMgr) {
        this.previewHookMgr.assignHook('preview-player', this.previewPlayerData.grapple, false);
      }
      
      // Setup nametag - fetch colors from auth/me (same as stats viewer)
      const res2 = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${authUser.token}` }
      });
      const userData = await res2.json();
      
      if (this.previewNametags) {
        // Get colors directly from user data (same place as stats viewer)
        const prefixColor = userData.prefixColor || '#ffffff';
        const usernameColor = userData.usernameColor || '#ffffff';
        
        this.previewNametags.register({
          sessionId: 'preview-player',
          username: authUser.username,
          userPrefix: userData.userPrefix || '',
          prefixColor: prefixColor,
          usernameColor: usernameColor,
        });
      }
      
    } catch (e) {
      console.error('[PlayerPreviewSystem] Update failed:', e);
    }
  }

  startAnimation() {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      
      if (this.previewRenderer && this.previewScene && this.previewCamera) {
        // Update nametag positions
        const playerMeshMap = new Map();
        const playerMesh = this.previewSkinMgr?.getRoot('preview-player');
        if (playerMesh) {
          playerMesh.castShadow = true;
          playerMeshMap.set('preview-player', playerMesh);
        }
        
        if (this.previewNametags && playerMeshMap.size > 0) {
          // Pass empty string as myId so the nametag is always visible
          this.previewNametags.update(playerMeshMap, '', this.previewCamera);
          
          // Move nametag lower by adjusting the sprite position
          const entry = this.previewNametags._entries?.get('preview-player');
          if (entry && entry.sprite) {
            entry.sprite.position.y -= 1.2;  // Move down by 1.2 units
          }
        }
        
        // Update grapple - simple position and rotation
        if (this.previewHookMgr && playerMesh) {
          const hook = this.previewHookMgr._hooks?.get('preview-player');
          if (hook) {
            // Set grapple position relative to player
            hook.hookPivot.position.copy(playerMesh.position).add(new THREE.Vector3(-1.2, 0.5, 2));
            // Face the grapple away from the player (180 degrees opposite)
            hook.hookPivot.rotation.copy(playerMesh.rotation);
            hook.hookPivot.rotateOnWorldAxis(new THREE.Vector3(0.25, 1, 0), Math.PI);
            // Scale grapple bigger for preview
            hook.hookPivot.scale.set(1.4, 1.4, 1.4);
            hook.hookPivot.visible = true;
          }
        }
        
        // Face the player forward at a slight angle
        if (playerMesh) {
          playerMesh.rotation.y = -Math.PI / -8;
        }
        
        this.previewRenderer.render(this.previewScene, this.previewCamera);
      }
      
      // Render button preview (same scene, different camera)
      if (this.buttonRenderer && this.previewScene) {
        const buttonCam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
        buttonCam.position.set(0.3, 2, 7);
        buttonCam.lookAt(0.3, 1, 0);
        this.buttonRenderer.render(this.previewScene, buttonCam);
      }
    };
    
    animate();
  }

  // Recalculate canvas display size when container dimensions change (e.g., when menu opens)
  resizeCanvases() {
    // Use requestAnimationFrame to ensure layout is computed
    requestAnimationFrame(() => {
      const previewContainer = document.querySelector('.preview');
      const previewCanvas = document.getElementById('previewCanvas');
      
      if (previewContainer && previewCanvas && this.previewRenderer && this.previewCamera) {
        // Get the preview container's actual dimensions
        const containerRect = previewContainer.getBoundingClientRect();
        let displayWidth = containerRect.width;
        let displayHeight = containerRect.height;
        
        // Account for title bar (approximately 35px)
        const titleBar = previewContainer.querySelector('.title-bar');
        if (titleBar) {
          const titleBarRect = titleBar.getBoundingClientRect();
          displayHeight -= titleBarRect.height;
        } else {
          // Fallback: assume title bar is ~35px
          displayHeight -= 35;
        }
        
        // Use the container width as fallback
        if (displayWidth <= 0) displayWidth = 400;
        if (displayHeight <= 0) displayHeight = 515;
        
        if (displayWidth > 0 && displayHeight > 0) {
          // Update canvas internal resolution
          previewCanvas.width = displayWidth;
          previewCanvas.height = displayHeight;
          
          // Update renderer
          this.previewRenderer.setSize(displayWidth, displayHeight);
          
          // Update camera aspect and projection
          this.previewCamera.aspect = displayWidth / displayHeight;
          this.previewCamera.updateProjectionMatrix();
        }
      }

      const buttonCanvas = document.getElementById('customizationButtonCanvas');
      if (buttonCanvas && this.buttonRenderer) {
        const btnContainer = buttonCanvas.parentElement;
        const btnContainerRect = btnContainer.getBoundingClientRect();
        let btnDisplayWidth = btnContainerRect.width;
        let btnDisplayHeight = btnContainerRect.height;
        
        // Get the gamemode bar if it exists
        const gamemodeBar = btnContainer.querySelector('.gamemode-bar');
        if (gamemodeBar) {
          const gamemodeBarRect = gamemodeBar.getBoundingClientRect();
          btnDisplayHeight -= gamemodeBarRect.height;
        }
        
        // Fallback values
        if (btnDisplayWidth <= 0) btnDisplayWidth = 120;
        if (btnDisplayHeight <= 0) btnDisplayHeight = 120;
        
        if (btnDisplayWidth > 0 && btnDisplayHeight > 0) {
          buttonCanvas.width = btnDisplayWidth;
          buttonCanvas.height = btnDisplayHeight;
          this.buttonRenderer.setSize(btnDisplayWidth, btnDisplayHeight);
        }
      }
    });
  }

  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
    }
    if (this.buttonRenderer) {
      this.buttonRenderer.dispose();
    }
    if (this.previewSkinMgr) {
      this.previewSkinMgr.removeAll();
    }
    if (this.previewNametags) {
      this.previewNametags.dispose();
    }
  }
}

// ── Presence ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function joinPresence() {
  const authUser = JSON.parse(localStorage.getItem('auth_user'));
  if (!authUser) return;
  try {
    presenceRoom = await colyseus.joinOrCreate('lobby', { token: authUser.token });

    // listen for incoming messages - handles both display and notifications
    presenceRoom.onMessage('newMessage', async (data) => {
      const { from, text } = data;
      const authUser = JSON.parse(localStorage.getItem('auth_user'));
      
      if (activeChatUser === from) {
        // If chat is open, append message to the DOM
        const scroll = document.getElementById('msgScroll');
        
        // Remove empty state if it exists
        const empty = scroll.querySelector('div[style*="text-align:center"]');
        if (empty && empty.textContent === 'no messages yet') {
          empty.remove();
        }
        
        // Add the new message to the bottom
        const elem = _createMessageElement(data, authUser.username);
        scroll.appendChild(elem);
        scroll.scrollTop = scroll.scrollHeight;
        
        // Increment total for pagination awareness
        messageState.total += 1;
      } else {
        // If chat is not open, show notification
        if (text.includes('[CLICK TO JOIN]')) {
          addNotification('game-invite', from, `[Game] ${from} has invited you to a 1v1 match`);
        } else {
          addNotification('message', from, `[Message] ${from} - ${text.substring(0, 40)}${text.length > 40 ? '...' : ''}`);
        }
      }
    });

    // listen for friend requests
    presenceRoom.onMessage('friendRequest', async (data) => {
      const { from } = data;
      addNotification('friend-request', from, `[Friend] ${from} sent you a friend request`);
      // Reload friend requests
      await loadFriendRequests();
    });

    // listen for friend request acceptance
    presenceRoom.onMessage('friendAccepted', async (data) => {
      const { from } = data;
      addNotification('friend-accepted', from, `[Friend] Your friend request to ${from} was accepted`);
      // Reload friends list and requests
      await loadFriends();
      await loadFriendRequests();
    });

    window.addEventListener('beforeunload', () => {
      if (presenceRoom) {
        presenceRoom.leave();
      }
    });

  } catch (e) {
    console.warn('Presence room failed:', e);
  }
}

// Initialize presence room and expose it globally for reconnect
if (!window.joinPresence) {
  window.joinPresence = joinPresence;
}
joinPresence();

// ── Client physics ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let cWorld = null;   // RAPIER.World
let cBody  = null;   // RAPIER.RigidBody (our player)
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
  cWorld.createCollider(
  RAPIER.ColliderDesc.capsule(0.5, 0.5).setFriction(0.0),
  cBody

  //REVERT THIS PART BACK IF BROKEN
);
}

// ground checker
// ground checker
function clientGrounded() {
  if (!cBody || !cWorld) return false;
  
  const vel = cBody.linvel();
  
  // 1. STRICTURE VELOCITY CHECK
  // If the player is falling or rising faster than a tiny threshold, 
  // they are NOT grounded. This prevents jumping while falling.
  if (Math.abs(vel.y) > 0.01) return false;

  const pos = cBody.translation();
  
  // 2. TIGHTER RAYCAST
  // Your capsule has a radius of 0.5. 
  // We start the ray 0.5 units below center (at the bottom curve).
  // A distance of 0.6 is too "floaty." Reduce it to 0.52.
  const ray = new RAPIER.Ray(
    { x: pos.x, y: pos.y - 0.5, z: pos.z },
    { x: 0,     y: -1,          z: 0     }
  );
  
  // 0.52 distance means we only trigger if we are within 0.02 units of the floor
  const hit = cWorld.castRay(ray, 0.52, false); 
  return hit !== null;
}

// ──  apply input frame onto client body
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

  const grounded = clientGrounded();
  const vel = cBody.linvel();
  
  if (inputs.space && grounded) {
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


const pending = [];     // { seq, inputs, camDir }
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

// Interpolate the opp
const oppBuffer   = [];         // { time, position }
const INTERP_DELAY = 100;       // ms behind real-time

function pushOppSnap(pos) {
  oppBuffer.push({ time: performance.now(), position: { ...pos } });
  if (oppBuffer.length > 30) oppBuffer.shift();
}

function interpolateOpp() {
  if (oppBuffer.length < 2) return;
  const rt = performance.now() - INTERP_DELAY;
  while (oppBuffer.length >= 2 && oppBuffer[1].time <= rt) oppBuffer.shift();
  if (oppBuffer.length < 2) return;
  const a = oppBuffer[0], b = oppBuffer[1];
  let t = (rt - a.time) / (b.time - a.time);
  t = Math.max(0, Math.min(1, t));
  skinMgr.setPosition(
    oppId,
    a.position.x + (b.position.x - a.position.x) * t,
    a.position.y + (b.position.y - a.position.y) * t,
    a.position.z + (b.position.z - a.position.z) * t
  );
}

// Scene objets
try {
  gltfLoader = new GLTFLoader();
} catch (e) {
  console.error('[Init] Failed to create GLTFLoader:', e);
}
if (!skinMgr && gltfLoader) {
  skinMgr = new SkinManager(scene, gltfLoader);
}
if (!hookMgr) {
  hookMgr = new HookManager(scene);
}
if (!bombMgr && gltfLoader) {
  bombMgr = new BombManager(scene, gltfLoader);
}

//nametags --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const nametags = new Nametags(scene);
const perfMonitor = new PerformanceMonitor(scene, renderer);
const playerMeshMap = new Map();

// Initialize preview system (after gltfLoader is created)
const previewSystem = new PlayerPreviewSystem();
previewSystem.initialize().catch(e => console.error('[Preview Init]', e));

// Load bomb skins into global cache for use during gameplay
forEachUnlockedSkin(()=>{}, ()=>{}, ()=>{}).catch(()=>{});

// Update preview when customization opens
const customizationEl = document.getElementById('customization');
if (customizationEl) {
  const observer = new MutationObserver(() => {
    if (customizationEl.style.display === 'flex') {
      // Resize canvases first, then update preview
      previewSystem.resizeCanvases();
      previewSystem.updatePreview().catch(e => console.error('[Preview Update]', e));
    }
  });
  observer.observe(customizationEl, { attributes: true, attributeFilter: ['style'] });
}  

let oppYaw = 0;
let currentMapRoot = null;        // the THREE.Group added to scene
let currentMapLights = [];        // Track lights from the current map

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

  // Remove lights from previous map
  currentMapLights.forEach(light => scene.remove(light));
  currentMapLights = [];

  try {
    if (!gltfLoader) {
      console.error('[LoadMap] gltfLoader is null, cannot load map');
      throw new Error('gltfLoader not initialized');
    }
    const gltf = await gltfLoader.loadAsync(glbPath);
    currentMapRoot = gltf.scene;

    // Extract and add lights from the GLB file
    let foundLights = false;
    currentMapRoot.traverse(obj => {
      if (obj.isLight) {
        // Clone the light to avoid issues with scene hierarchy
        const clonedLight = obj.clone();
        scene.add(clonedLight);
        currentMapLights.push(clonedLight);
        foundLights = true;
      }
    });

    // If no lights found in GLB, ensure default lights are visible
    if (!foundLights) {
      dirLight.visible = true;
      defaultAmbientLight.visible = true;
      defaultAmbientLight.intensity = 0.5;  // Reset to full intensity
      DEFAULT_LIGHTS.forEach(light => {
        if (!scene.children.includes(light)) {
          scene.add(light);
        }
      });
    } else {
      // Hide directional light when using map lights, but keep ambient light darker
      dirLight.visible = false;
      defaultAmbientLight.visible = true;
      defaultAmbientLight.intensity = 0.2;  // Darker ambient for fill light
    }

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
    // On error, ensure default lights are visible
    DEFAULT_LIGHTS.forEach(light => light.visible = true);
  }
}





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

const ROPE_RADIUS   = 0.04;  // world-space thickness of rope
const ROPE_SEGMENTS = 3;     // Reduced from 4 to 3 - still smooth, better perf

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

const _camForward = new THREE.Vector3();
const barrelPos   = new THREE.Vector3();

function updateBarrelPos() {
  camera.getWorldDirection(_camForward);
  
  // get camera right vector
  const right = new THREE.Vector3();
  right.crossVectors(_camForward, camera.up).normalize();
  
  barrelPos.copy(camera.position)
    .addScaledVector(_camForward, 0.5)
    .addScaledVector(right, 0.5) // nudge right
    .addScaledVector(camera.up, -0.2);
}

function updateRope(pivot, a, b) {
  const ax = a.x, ay = a.y, az = a.z;
  const bx = b.x, by = b.y, bz = b.z;

  pivot.position.set((ax+bx)*0.5, (ay+by)*0.5, (az+bz)*0.5);

  _ropeDir.set(bx-ax, by-ay, bz-az);
  const length = _ropeDir.length();
  if (length < 0.001) return;
  _ropeDir.divideScalar(length);

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


// ── explosions ────────────────────────────────────────────────
const explosions = [];
class Explosion {
  constructor(pos) {
    // Reduce particle count from 250 to 150 - still looks great, 40% fewer particles
    this.N   = 150;
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
      blending:THREE.AdditiveBlending,
      sizeAttenuation:true  // Better perf on lower res displays
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

// ── Particle spawning (shared between ranked and non-ranked) ────────────────────────────────
function spawnParticles(position, type, count) {
  // Create particles for impact effects
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 10;
    const velocity = {
      x: Math.cos(angle) * speed,
      y: 3 + Math.random() * 4,  // Always go up
      z: Math.sin(angle) * speed
    };
    
    // All particles use the same color
    const color = 0x2e2e2e;  // Consistent dark gray
    
    // Create simple particle mesh
    const geo = new THREE.SphereGeometry(0.1, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color });
    const particle = new THREE.Mesh(geo, mat);
    particle.position.set(position.x, position.y, position.z);
    scene.add(particle);
    
    // Store particle with lifetime
    const particleData = {
      mesh: particle,
      position: { x: position.x, y: position.y, z: position.z },
      velocity: velocity,
      lifetime: 1.0,  // seconds
      maxLifetime: 1.0,
      gravity: -9.8
    };
    
    // Update particle each frame and remove when done
    const updateParticle = () => {
      const deltaTime = 1 / 60;  // Assume 60 FPS
      particleData.lifetime -= deltaTime;
      
      if (particleData.lifetime <= 0) {
        scene.remove(particle);
        geo.dispose();
        mat.dispose();
        return true;  // Signal removal
      }
      
      // Update velocity (gravity)
      particleData.velocity.y += particleData.gravity * deltaTime;
      
      // Update position
      particleData.position.x += particleData.velocity.x * deltaTime;
      particleData.position.y += particleData.velocity.y * deltaTime;
      particleData.position.z += particleData.velocity.z * deltaTime;
      
      particle.position.set(
        particleData.position.x,
        particleData.position.y,
        particleData.position.z
      );
      
      // Fade out
      const alpha = particleData.lifetime / particleData.maxLifetime;
      particle.material.opacity = alpha;
      
      return false;
    };
    
    // Add to particle update queue (we'll process this in the animation loop)
    // For now, just add a simple fallback update
    let elapsed = 0;
    const particleInterval = setInterval(() => {
      elapsed += 1 / 60;
      if (updateParticle() || elapsed > 2) {
        clearInterval(particleInterval);
      }
    }, 1000 / 60);
  }
}

function updateGearEffectPosition(effect) {
  const LERP_FACTOR = 0.1;  // Easing factor (0-1, lower = smoother)
  
  // Handle mace animation (rises up over duration)
  if (effect.animationType === 'mace') {
    const elapsed = Date.now() - effect.startTime;
    const progress = Math.min(1, elapsed / effect.duration);  // 0 to 1
    
    const shooterState = room.state.players.get(effect.shooterId);
    if (shooterState && shooterState.position) {
      // Calculate target position (mace rises up from player position)
      const riseHeight = progress * 2.5;  // Rise up to 2.5 meters
      const targetPos = new THREE.Vector3(
        shooterState.position.x,
        shooterState.position.y + 1.5 + riseHeight,
        shooterState.position.z
      );
      
      // Smoothly interpolate position
      effect.currentPosition.lerp(targetPos, LERP_FACTOR);
      effect.model.position.copy(effect.currentPosition);
      
      // Mace rotates with the player
      if (effect.shooterId === myId) {
        // Local player: use camera rotation
        effect.model.quaternion.copy(camera.quaternion);
      } else {
        // Remote player: use their mesh rotation
        const oppMesh = skinMgr.getRoot(effect.shooterId);
        if (oppMesh) {
          effect.model.quaternion.copy(oppMesh.quaternion);
        }
      }
    }
    return;
  }
  
  // Default sniper animation (follows player)
  if (effect.shooterId === myId) {
    // Local player: use camera position
    let velocityOffset = { x: 0, y: 0, z: 0 };
    if (cBody) {
      const vel = cBody.linvel();
      // Get camera forward direction
      const cameraDir = new THREE.Vector3();
      camera.getWorldDirection(cameraDir);
      // Offset model back based on forward velocity (negative direction means back)
      const forwardVel = vel.x * cameraDir.x + vel.y * cameraDir.y + vel.z * cameraDir.z;
      const velocityScale = -0.05; // Model moves back when going forward
      velocityOffset.x = cameraDir.x * forwardVel * velocityScale;
      velocityOffset.y = cameraDir.y * forwardVel * velocityScale;
      velocityOffset.z = cameraDir.z * forwardVel * velocityScale;
    }
    
    // Calculate target position
    const targetPos = new THREE.Vector3(
      camera.position.x + effect.initialOffset.x + velocityOffset.x,
      camera.position.y + effect.initialOffset.y + velocityOffset.y,
      camera.position.z + effect.initialOffset.z + velocityOffset.z
    );
    
    // Smoothly interpolate position
    effect.currentPosition.lerp(targetPos, LERP_FACTOR);
    effect.model.position.copy(effect.currentPosition);
    effect.model.quaternion.copy(camera.quaternion);
  } else {
    // Opponent (or any other player): use networked state
    const shooterState = room.state.players.get(effect.shooterId);
    if (shooterState && shooterState.position) {
      let velocityOffset = { x: 0, y: 0, z: 0 };
      if (shooterState.velocity) {
        // Get player look direction from mesh
        const oppMesh = skinMgr.getRoot(effect.shooterId);
        if (oppMesh) {
          const lookDir = new THREE.Vector3(0, 0, 1).applyQuaternion(oppMesh.quaternion).normalize();
          // Offset model back based on forward velocity
          const forwardVel = shooterState.velocity.x * lookDir.x + shooterState.velocity.y * lookDir.y + shooterState.velocity.z * lookDir.z;
          const velocityScale = -0.05;
          velocityOffset.x = lookDir.x * forwardVel * velocityScale;
          velocityOffset.y = lookDir.y * forwardVel * velocityScale;
          velocityOffset.z = lookDir.z * forwardVel * velocityScale;
        }
      }
      
      // Calculate target position
      const targetPos = new THREE.Vector3(
        shooterState.position.x + effect.initialOffset.x + velocityOffset.x,
        shooterState.position.y + effect.initialOffset.y + velocityOffset.y,
        shooterState.position.z + effect.initialOffset.z + velocityOffset.z
      );
      
      // Smoothly interpolate position
      effect.currentPosition.lerp(targetPos, LERP_FACTOR);
      effect.model.position.copy(effect.currentPosition);
      
      // For sniper gear, preserve the initial rotation (which has correct pitch) but update yaw based on opponent direction
      if (effect.initialRotation) {
        // Start with the initial rotation (has correct pitch and initial direction)
        effect.model.quaternion.copy(effect.initialRotation);
        
        // Extract only the yaw from the opponent's mesh and apply it
        const oppMesh = skinMgr.getRoot(effect.shooterId);
        if (oppMesh) {
          // Get opponent's yaw rotation
          const meshEuler = new THREE.Euler().setFromQuaternion(oppMesh.quaternion, 'YXZ');
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), meshEuler.y);
          
          // Apply the yaw update to preserve pitch from initialRotation
          effect.model.quaternion.multiplyQuaternions(effect.model.quaternion, yawQuat);
        }
      } else {
        // Fallback if initialRotation not set
        const oppMesh = skinMgr.getRoot(effect.shooterId);
        if (oppMesh) {
          effect.model.quaternion.copy(oppMesh.quaternion);
          // Re-apply 180 degree yaw rotation for sniper
          const yawRotation = new THREE.Quaternion();
          yawRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
          effect.model.quaternion.multiplyQuaternions(effect.model.quaternion, yawRotation);
        }
      }
    }
  }
}

// ── Input ─────────────────────────────────────────────────
const controls    = new PointerLockControls(camera, renderer.domElement);
const keys        = { w:false, a:false, s:false, d:false, space:false };
let   seq         = 0;
let   lastSpawn   = 0;
let   lastParry   = 0;
let   lastGear    = 0;
let   spacePressed = false;    // Track if space was just pressed this frame
let   prevSpaceState = false;  // Track space state from previous frame

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

  if (e.code === window.keybinds.parry && gameStarted && room) {
    const now = performance.now();
    if (now - lastParry >= 2000) {
      room.send('parry');
      startParryCooldown();
      lastParry = now;
    }
  }

  if (e.code === window.keybinds.gear && gameStarted && room) {
    const now = performance.now();
    if (now - lastGear >= 2500) {
      useGear();
      lastGear = now;
    }
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

function startParryCooldown() {
  // Cooldown indicator
  const readyEl = document.getElementById('parryReady');
  if (readyEl) {
    readyEl.textContent = 'cooldown';
    readyEl.style.color = '#555';
    let remaining = 2;
    const countdown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdown);
        readyEl.textContent = 'ready';
        readyEl.style.color = '#6699ff';
      } else {
        readyEl.textContent = remaining + 's';
      }
    }, 1000);
  }
}

function useGear() {
  // Get the currently equipped gear (from gearItems array)
  const equippedGear = gearItems.find(g => g.equipped) || gearItems[0];
  if (!equippedGear) {
    console.warn('[useGear] No equipped gear found, gearItems:', gearItems);
    return;
  }
  
  const gearName = equippedGear.id;
  
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  
  // Offset the shot origin to the right, like a barrel
  const right = new THREE.Vector3();
  right.crossVectors(dir, camera.up).normalize();
  
  const pos = new THREE.Vector3();
  pos.copy(camera.position)
    .addScaledVector(dir, 0.5)
    .addScaledVector(right, 0.5);
  
  room.send('useGear', {
    gearName: gearName,
    cameraPos: { x: pos.x, y: pos.y, z: pos.z },
    cameraDir: { x: dir.x, y: dir.y, z: dir.z }
  });

  startGearCooldown();
}

function startGearCooldown() {
  // Cooldown indicator
  const readyEl = document.getElementById('gearReady');
  if (readyEl) {
    readyEl.textContent = 'cooldown';
    readyEl.style.color = '#555';
    let remaining = 2;
    const countdown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdown);
        readyEl.textContent = 'ready';
        readyEl.style.color = '#ffcc00';
      } else {
        readyEl.textContent = remaining + 's';
      }
    }, 1000);
  }
}

// ── Colyseus room setup ───────────────────────────────────
async function setupRoom(r) {
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

    const spawnIndex = isHost ? 0 : 1;
    const spawn      = spawnPoints[spawnIndex] || { x: 0, y: 5, z: 0 };
    await buildClientWorld(collision, spawn.x, spawn.y, spawn.z);
  });

  room.onMessage('init', (data) => {
    myId   = data.myId;
    isHost = data.isHost;
  });


  room.onMessage('mapVote', ({ maps, timeoutMs }) => {
    showMapVotePicker(maps, timeoutMs, (chosenId) => {
      room.send('vote', { mapId: chosenId });
    });
  });

  room.onMessage('mapChosen', ({ mapId, mapName, skyColor }) => {
    hideMapVotePicker();
    // Show lobby while map loads (for versus matches)
    const title = document.getElementById('waitingTitle');
    if (title) title.textContent = `loading ${mapName}...`;
    // Apply map sky color to the renderer
    if (skyColor && scene) {
      scene.background = new THREE.Color(skyColor);
    }
    showWaiting();
  });

  room.onMessage('skinInfo', (data) => {
    _pendingSkinInfo = data;
  });

  room.onMessage('nametagInfo', (data) => {
    _pendingNametagInfo = data;
    nametags.register(data);
  });

  
  room.onMessage('gameStart', async (data) => {
    // Re-enable input if it was disabled during ranked countdown
    disableInputDuringCountdown(false);
    
    oppId = myId === data.hostId ? data.guestId : data.hostId;

    if (_pendingSkinInfo) {
      const oppSkinData = _pendingSkinInfo[oppId];
      if (oppSkinData) {
        await skinMgr.assignSkin(oppId, oppSkinData, false);
        // Add opponent mesh to playerMeshMap for nametag positioning
        const oppMesh = skinMgr.getRoot(oppId);
        if (oppMesh) playerMeshMap.set(oppId, oppMesh);
        hookMgr.assignHook(oppId, oppSkinData.grapple, false);
      }
      _pendingSkinInfo = null;
    }

    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    if (authUser) {
      // Load player's own skins
      fetch(`${API_BASE}/api/skins/player/${authUser.username}`)
        .then(r => r.json())
        .then(d => {
          hookMgr.assignHook('local', d.grapple, true);  // ← true for isLocal
          hookMgr.setCamera('local', camera);             // ← after assignHook
        });
      
      // Load opponent's skins into cache
      // First get opponent username from user ID
      fetch(`${API_BASE}/api/users-by-id/${oppId}`)
        .then(r => {
          if (!r.ok) throw new Error(`Failed to fetch opponent info: ${r.status}`);
          return r.json();
        })
        .then(oppData => {
          if (!oppData?.username) {
            console.warn('[GameStart] Could not get opponent username from response:', oppData);
            return;
          }
          // Load opponent's skins into server cache
          return fetch(`${API_BASE}/api/skins/load-opponent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: oppData.username })
          });
        })
        .then(r => {
          if (!r) return; // Handle earlier return
          if (!r.ok) throw new Error(`Failed to load opponent skins: ${r.status}`);
          return r.json();
        })
        .then(result => {
        })
        .catch(err => console.warn('[GameStart] Failed to load opponent skins:', err));
    }

    showGame();
    gameStarted = true;
    
    // Reset all key states to start with clean slate
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    keys.space = false;
    prevSpaceState = false;
    
    controls.lock();
    hideBackground();
  });

  room.onMessage('bombExploded', (data) => {
    if (bombMgr._bombs.has(data.id)) {
      bombMgr.removeBomb(data.id);
    }
    explosions.push(new Explosion(data.position));
  });

  // spawnParticles is now at module level, available to both ranked and non-ranked modes

  room.onMessage('playerHit', (data) => {
    const isMe = data.playerId === myId;
    const numId = isMe ? 'health'     : 'opponentHP';
    const barId = isMe ? 'myHpFill'  : 'oppHpFill';
    const el    = document.getElementById(numId);
    const fill  = document.getElementById(barId);
    if (!el) return;
    // Use server's current health value from the message
    const newHP = data.currentHealth !== undefined ? data.currentHealth : Math.max(0, parseInt(el.textContent) - data.damage);
    el.textContent = newHP;
    if (fill) fill.style.width = newHP + '%';
    if (isMe) {
      renderer.domElement.style.outline = '5px solid red';
      setTimeout(() => { renderer.domElement.style.outline = ''; }, 200);
    }
  });

  room.onMessage('sniperLine', (data) => {
    let start = new THREE.Vector3(data.start.x, data.start.y, data.start.z);
    const end = new THREE.Vector3(data.end.x, data.end.y, data.end.z);
    
    // Apply right offset to match server-side beam origin (like barrel offset)
    if (data.direction) {
      const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      start.addScaledVector(right, 0.5);  // 0.5 units to the right
    }
    
    // Cylinder parameters (similar to grapple rope)
    const SNIPER_RADIUS = 0.08;
    const SNIPER_SEGMENTS = 3;
    const distance = start.distanceTo(end);
    
    // Create cylinder geometry (height = 1, will be scaled)
    const geometry = new THREE.CylinderGeometry(SNIPER_RADIUS, SNIPER_RADIUS, distance, SNIPER_SEGMENTS);
    const material = new THREE.MeshBasicMaterial({ color: 0xff6600, depthWrite: true, transparent: true, opacity: 1.0 });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Position and orient the cylinder
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(midpoint);
    
    const direction = new THREE.Vector3().subVectors(end, start).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3().crossVectors(up, direction).normalize();
    
    if (axis.length() > 0.001) {
      const angle = Math.acos(Math.max(-1, Math.min(1, up.dot(direction))));
      quaternion.setFromAxisAngle(axis, angle);
    }
    mesh.quaternion.copy(quaternion);
    
    scene.add(mesh);
    
    // Add end caps (spheres)
    const capGeo = new THREE.SphereGeometry(SNIPER_RADIUS * 1.2, 8, 8);
    const capMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 1.0 });
    
    const startCap = new THREE.Mesh(capGeo, capMat.clone());
    startCap.position.copy(start);
    scene.add(startCap);
    
    const endCap = new THREE.Mesh(capGeo, capMat.clone());
    endCap.position.copy(end);
    scene.add(endCap);
    
    // Fade out and remove after duration
    const startTime = Date.now();
    const duration = data.duration || 3000;
    const fadeInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const alpha = Math.max(0, 1 - (elapsed / duration));
      material.opacity = alpha;
      capMat.opacity = alpha;
      if (capMat.clone().opacity <= 0) {
        clearInterval(fadeInterval);
        scene.remove(mesh);
        scene.remove(startCap);
        scene.remove(endCap);
        geometry.dispose();
        capGeo.dispose();
        material.dispose();
      }
    }, 16);
  });

  room.onMessage('gearEffect', (data) => {
    const { gearName, shooterId, position, rotation, duration } = data;
    // Create procedural sniper rifle model (fallback if GLB fails)
    function createSniperModel() {
      const group = new THREE.Group();
      
      // Barrel (long cylinder)
      const barrelGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.0, 16);
      const barrelMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 });
      const barrel = new THREE.Mesh(barrelGeo, barrelMat);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(1.0, 0, 0);
      group.add(barrel);
      
      // Scope (box on top)
      const scopeGeo = new THREE.BoxGeometry(0.15, 0.15, 0.8);
      const scopeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.1 });
      const scope = new THREE.Mesh(scopeGeo, scopeMat);
      scope.position.set(0.5, 0.3, 0);
      group.add(scope);
      
      // Stock (rectangular prism at back)
      const stockGeo = new THREE.BoxGeometry(0.25, 0.25, 0.8);
      const stockMat = new THREE.MeshStandardMaterial({ color: 0x663300, metalness: 0.3, roughness: 0.6 });
      const stock = new THREE.Mesh(stockGeo, stockMat);
      stock.position.set(-0.6, 0, 0);
      group.add(stock);
      
      // Trigger area (small detail)
      const triggerGeo = new THREE.BoxGeometry(0.1, 0.15, 0.05);
      const triggerMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6 });
      const trigger = new THREE.Mesh(triggerGeo, triggerMat);
      trigger.position.set(-0.1, -0.15, 0);
      group.add(trigger);
      
      return group;
    }

    // Create procedural mace model (fallback if OBJ fails)
    function createMaceModel() {
      const group = new THREE.Group();
      
      // Handle (long cylinder)
      const handleGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 16);
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, metalness: 0.3, roughness: 0.7 });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.y = -0.5;
      group.add(handle);
      
      // Head (sphere)
      const headGeo = new THREE.SphereGeometry(0.4, 32, 32);
      const headMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.2 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 0.7;
      head.scale.set(1, 1.2, 1);
      group.add(head);
      
      // Spikes on head
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const spikeGeo = new THREE.ConeGeometry(0.08, 0.5, 8);
        const spikeMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.set(
          Math.cos(angle) * 0.45,
          0.7,
          Math.sin(angle) * 0.45
        );
        spike.lookAt(Math.cos(angle) * 0.6, 1.0, Math.sin(angle) * 0.6);
        group.add(spike);
      }
      
      return group;
    }
    
    let model = null;
    
    // Ensure duration has a sensible default
    const effectDuration = duration || 3000;
    
    if (gearName === 'mace') {
      // Load mace GLB or create procedural model
      const maceGlbPath = '/gear/mace.glb';
      const gltfLoader = new GLTFLoader();
      gltfLoader.load(
        maceGlbPath,
        (gltf) => {
          // GLB loaded successfully
          model = gltf.scene;
          model.position.set(position.x, position.y, position.z);
          model.scale.set(0.5, 0.5, 0.5);
          scene.add(model);
          setupMaceAnimation(model, shooterId, position, effectDuration);
        },
        undefined,
        (error) => {
          // GLB failed, use procedural model
          console.warn(`[gearEffect] Failed to load ${maceGlbPath}, using procedural model:`, error);
          model = createMaceModel();
          model.position.set(position.x, position.y, position.z);
          scene.add(model);
          setupMaceAnimation(model, shooterId, position, effectDuration);
        }
      );
    } else {
      // Default to sniper (GLB model)
      const gearGlbPath = {
        'sniper': '/gear/sniper.glb',
      }[gearName] || '/gear/sniper.glb';
      
      if (!gltfLoader) {
        console.warn('[gearEffect] gltfLoader not available, using procedural model');
        const model = createSniperModel();
        model.position.set(position.x, position.y, position.z);
        scene.add(model);
        setupGearEffectAnimation(model, shooterId, position, effectDuration);
        return;
      }
      gltfLoader.load(
        gearGlbPath,
        (gltf) => {
          // GLB loaded successfully
          model = gltf.scene;
          model.position.set(position.x, position.y, position.z);
          
          // Apply rotation
          const dir = new THREE.Vector3(rotation.x, rotation.y, rotation.z).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const right = new THREE.Vector3().crossVectors(up, dir).normalize();
          const newUp = new THREE.Vector3().crossVectors(dir, right).normalize();
          
          const matrix = new THREE.Matrix4();
          matrix.makeBasis(right, newUp, dir);
          model.quaternion.setFromRotationMatrix(matrix);
          
          // Rotate sniper 180 degrees yaw
          const yawRotation = new THREE.Quaternion();
          yawRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
          model.quaternion.multiplyQuaternions(model.quaternion, yawRotation);
          
          scene.add(model);
          setupGearEffectAnimation(model, shooterId, position, effectDuration);
        },
        undefined,
        (error) => {
          // GLB failed, use procedural model
          console.warn(`[gearEffect] Failed to load ${gearGlbPath}, using procedural model:`, error);
          model = createSniperModel();
          model.position.set(position.x, position.y, position.z);
          
          // Apply rotation
          const dir = new THREE.Vector3(rotation.x, rotation.y, rotation.z).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const right = new THREE.Vector3().crossVectors(up, dir).normalize();
          const newUp = new THREE.Vector3().crossVectors(dir, right).normalize();
          
          const matrix = new THREE.Matrix4();
          matrix.makeBasis(right, newUp, dir);
          model.quaternion.setFromRotationMatrix(matrix);
          
          // Rotate sniper 180 degrees yaw
          const yawRotation = new THREE.Quaternion();
          yawRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
          model.quaternion.multiplyQuaternions(model.quaternion, yawRotation);
          
          scene.add(model);
          setupGearEffectAnimation(model, shooterId, position, effectDuration);
        }
      );
    }
    
    function setupMaceAnimation(model, shooterId, position, duration) {
      const finalDuration = Math.max(duration || 3000, 3000);
      const startTime = Date.now();
      
      // Initialize current position for smooth interpolation
      const currentPosition = new THREE.Vector3();
      currentPosition.copy(model.position);
      
      // Store effect with mace-specific animation data
      const effect = { 
        model, 
        shooterId, 
        startTime, 
        duration: finalDuration,
        animationType: 'mace',  // Mark as mace animation
        currentPosition  // For smooth position interpolation
      };
      activeGearEffects.set(shooterId, effect);
      
      // Handle cleanup after duration
      const cleanupTimeout = setTimeout(() => {
        activeGearEffects.delete(shooterId);
        scene.remove(model);
        model.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }, finalDuration);
    }
    
    function setupGearEffectAnimation(model, shooterId, position, duration) {
      // Ensure we have a valid duration
      const finalDuration = Math.max(duration || 3000, 3000);
      
      const startTime = Date.now();
      
      // Calculate initial offset from shooter's position
      let initialOffset = new THREE.Vector3();
      const shooterStateAtStart = room.state.players.get(shooterId);
      
      if (shooterStateAtStart && shooterStateAtStart.position) {
        initialOffset.set(
          position.x - shooterStateAtStart.position.x,
          position.y - shooterStateAtStart.position.y,
          position.z - shooterStateAtStart.position.z
        );
      }
      
      // Initialize current position for smooth interpolation
      const currentPosition = new THREE.Vector3();
      currentPosition.copy(model.position);
      
      // Register this effect for frame-by-frame updates
      const effect = { model, shooterId, initialOffset, startTime, duration: finalDuration, animationType: 'sniper', currentPosition };
      activeGearEffects.set(shooterId, effect);
      
      // Handle cleanup after duration
      const cleanupTimeout = setTimeout(() => {
        activeGearEffects.delete(shooterId);
        scene.remove(model);
        model.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }, finalDuration);
    }
  });

  room.onMessage('particles', (data) => {
    const { position, type, count } = data;
    
    // Create particles at the given position
    spawnParticles(position, type, count);
  });

  room.onMessage('parrySuccess', (data) => {
    addInGameNotification('+ PARRY', 3000); //ultrakill reference?
  });

  room.onMessage('gameEnd', async (data) => {
    if (controls.isLocked) controls.unlock();
    gameStarted = false;
    
    // Reset all key states to prevent stuck keys
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    keys.space = false;
    prevSpaceState = false;
    
    skinMgr.removeAll(); 
    hookMgr.removeAll();
    bombMgr.removeAll();
    nametags.dispose();
    playerMeshMap.clear();

    // Get current user's database ID from token
    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    const myDbId = authUser ? getUserIdFromToken(authUser.token) : null;
    let oppUsername = 'opponent';
    
    if (!myDbId) {
      console.error('Could not determine user ID from token');
    }
    
    try {
      // Fetch opponent's username and ELO
      const oppId = data.winner === myDbId ? data.loser : data.winner;
      const oppRes = await fetch(`${API_BASE}/api/users-by-id/${oppId}`);
      if (oppRes.ok) {
        const oppData = await oppRes.json();
        oppUsername = oppData.username || 'opponent';
        
        // Unload opponent's skins from cache (if player doesn't have them)
        if (authUser) {
          fetch(`${API_BASE}/api/skins/unload-opponent`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authUser.token}`
            },
            body: JSON.stringify({ username: oppUsername })
          })
          .then(r => r.json())
          .catch(err => console.warn('[GameEnd] Failed to unload opponent skins:', err));
        }
      }
    } catch (e) {
      console.warn('Failed to fetch opponent username:', e);
    }

    const won = data.winner === myDbId;

    const resultTitle = document.getElementById('resultTitle');
    if (resultTitle) {
      resultTitle.textContent = won ? 'you won' : 'you lost';
      resultTitle.style.color = won ? '#00ff88' : '#ff4444';
    }
    const resultSub = document.getElementById('resultSub');
    if (resultSub) {
      resultSub.textContent = won ? 'opponent eliminated' : 'you were eliminated by ' + oppUsername;
      
      // For ranked mode, show ELO changes
      if (rankedMode && data.eloChange !== undefined) {
        const eloChange = data.eloChange;
        const eloText = eloChange > 0 ? `+${eloChange}` : `${eloChange}`;
        const eloColor = eloChange > 0 ? '#00ff88' : '#ff4444';
        const rank = getRankFromElo(data.newElo);
        resultSub.innerHTML += `<br><span style="color:${eloColor}; font-family:'Space Mono',monospace; font-size:14px;">ELO: ${eloText} → ${rank.elo}</span>`;
      }
    }

    showResults(won);
    
    // Update ranked stats if in ranked mode
    if (rankedMode) {
      setTimeout(() => updateRankedStats(), 500);
    }
  });

  room.onMessage('unlocksNotification', (data) => {
    const { winnerUnlocks, loserUnlocks } = data;
    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    const myDbId = authUser ? getUserIdFromToken(authUser.token) : null;
    
    // Determine which unlocks are mine
    let myUnlocks = [];
    if (winnerUnlocks && winnerUnlocks.length > 0) {
      // Check if I'm the winner
      const gameEndMsg = document.getElementById('resultTitle');
      if (gameEndMsg && gameEndMsg.textContent === 'you won') {
        myUnlocks = winnerUnlocks;
      }
    }
    
    if (loserUnlocks && loserUnlocks.length > 0) {
      // Check if I'm the loser
      const gameEndMsg = document.getElementById('resultTitle');
      if (gameEndMsg && gameEndMsg.textContent === 'you lost') {
        myUnlocks = loserUnlocks;
      }
    }
    
    // Display unlock notifications
    if (myUnlocks.length > 0) {
      myUnlocks.forEach(unlock => {
        const msg = `🎉 Unlocked: ${unlock.name} (${unlock.type})`;
        // TODO: Display UI notification for each unlock
      });
    }
  });

  room.onMessage('opponentDisconnected', () => {
    skinMgr.removeAll(); 
    nametags.dispose();
    playerMeshMap.clear();
    alert('Opponent disconnected!');
    location.reload();
  });

  room.onMessage('rematchStart', async () => {
    // Clear scope effect from previous round
    if (activeScopeEffect) {
      activeScopeEffect = null;
      const vignetteCanvas = document.getElementById('scopeVignette');
      if (vignetteCanvas) {
        vignetteCanvas.classList.remove('active');
        vignetteCanvas.getContext('2d').clearRect(0, 0, vignetteCanvas.width, vignetteCanvas.height);
      }
      if (camera) {
        camera.fov = 75;  // Reset to default FOV
        camera.updateProjectionMatrix();
      }
    }

    // Reset all keyboard input to prevent carryover movement from previous match
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    keys.space = false;

    // Recreate opponent skins and grapples
    if (_pendingSkinInfo) {
      const oppSkinData = _pendingSkinInfo[oppId];
      if (oppSkinData) {
        await skinMgr.assignSkin(oppId, oppSkinData, false);
        const oppMesh = skinMgr.getRoot(oppId);
        if (oppMesh) playerMeshMap.set(oppId, oppMesh);
        hookMgr.assignHook(oppId, oppSkinData.grapple, false);
      }
    }

    // Recreate local player's grapple hook
    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    if (authUser) {
      fetch(`${API_BASE}/api/skins/player/${authUser.username}`)
        .then(r => r.json())
        .then(d => {
          hookMgr.assignHook('local', d.grapple, true);  // ← true for isLocal
          hookMgr.setCamera('local', camera);             // ← after assignHook
        })
        .catch(e => console.warn('Failed to fetch local skin during rematch:', e));
    }
    
    // Recreate nametags if we have the info
    if (_pendingNametagInfo) {
      nametags.register(_pendingNametagInfo);
    }
    
    // Hide results screen and reset game state
    document.getElementById('page-results').style.display = 'none';
    showGame();
    gameStarted = true;
    
    // Reset all key presses and forces
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    keys.space = false;
    prevSpaceState = false;
    
    // Reset player body velocity
    if (cBody) {
      cBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    
    controls.lock();
    
    // Clear HUD and reset values
    const health = document.getElementById('health');
    const oppHP = document.getElementById('opponentHP');
    if (health) health.textContent = 100;
    if (oppHP) oppHP.textContent = 100;
    
    const myHpFill = document.getElementById('myHpFill');
    const oppHpFill = document.getElementById('oppHpFill');
    if (myHpFill) myHpFill.style.width = '100%';
    if (oppHpFill) oppHpFill.style.width = '100%';
  });
}


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
    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    const r = await colyseus.create('private', { token: authUser?.token });
    setupRoom(r);
    showWaiting();  // Display the waiting room with code display

    // Server sends us the short code via message once metadata is ready
    r.onMessage('roomCode', async (code) => {
      currentRoomCode = code;
      document.getElementById('joinCodeDisplay').textContent = code;
      
      // Load and display friends for inviting
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { 'Authorization': `Bearer ${authUser.token}` }
      });
      const user = await res.json();
      const friends = user.friends?.list || {};
      await displayInviteFriends(friends);
    });
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
      if (errEl) {
        errEl.textContent = data.error || 'Room not found';
        // Show the join menu so user can try again (but not in ranked mode)
        document.getElementById('waitingRoom').style.display = 'none';
        if (!rankedMode) {
          document.getElementById('versusMenu').style.display = 'flex';
        }
      }
      return;
    }
    const authUser = JSON.parse(localStorage.getItem('auth_user'));
    const r = await colyseus.joinById(data.roomId, { token: authUser?.token });
    // Hide versusMenu and results screen when successfully joining a room
    document.getElementById('versusMenu').style.display = 'none';
    document.getElementById('page-results').style.display = 'none';
    setupRoom(r);
  } catch (e) {
    console.error('Failed to join room:', e);
    if (errEl) {
      errEl.textContent = 'Failed to join room';
      // Show the join menu so user can try again (but not in ranked mode)
      document.getElementById('waitingRoom').style.display = 'none';
      if (!rankedMode) {
        document.getElementById('versusMenu').style.display = 'flex';
      }
    }
  }
};

document.getElementById('codeInput')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

// Expose game objects globally so login handler can access them
window.camera = camera;
window.controls = controls;
window.applySettings = applySettings;
window.gameSettings = gameSettings;
window.colyseus = colyseus;

// ── Main loop ─────────────────────────────────────────────
const FT   = 1 / 60;
let   acc  = 0;
let   last = performance.now();
let   lastPingTime = Date.now();

// FPS Counter
let fpsFrameCount = 0;
let fpsLastTime = performance.now();
let fps = 0;

function updateFPS() {
  fpsFrameCount++;
  const now = performance.now();
  const elapsed = now - fpsLastTime;
  
  if (elapsed >= 1000) {  // Update every 1 second
    fps = Math.round((fpsFrameCount * 1000) / elapsed);
    const fpsEl = document.getElementById('fps-counter');
    if (fpsEl) fpsEl.textContent = fps;
    fpsFrameCount = 0;
    fpsLastTime = now;
  }
}

function animate() {
  requestAnimationFrame(animate);
  updateFPS();

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
      // Detect if space was newly pressed this frame (false → true transition)
      const spaceJustPressed = keys.space && !prevSpaceState;
      prevSpaceState = keys.space; // Update for next frame
      
      const inp = {
        seq: seq++,
        inputs: { w:keys.w, a:keys.a, s:keys.s, d:keys.d, space: spaceJustPressed },
        camDir: cd
      };

      pending.push(inp);
      if (pending.length > 120) pending.shift();  // safety cap

      applyInput(inp.inputs, inp.camDir);
      cWorld.step();

      room.send('input', { seq:inp.seq, inputs:inp.inputs, camDir:inp.camDir });

      acc -= FT;
    }

    // ── Reconcile against server state 
    if (room && myId) {
      const sp = room.state.players.get(myId);
      if (sp) {
        reconcile(sp.position, sp.velocity, sp.lastSeq);
        lastPingTime = Date.now(); // proxy for ping update
      }
    }

    // ── Update active gear effects (snipers) ──────────────────
    for (const effect of activeGearEffects.values()) {
      const elapsed = Date.now() - effect.startTime;
      const progress = elapsed / effect.duration;
      const alpha = Math.max(0, 1 - progress);
      
      updateGearEffectPosition(effect);
      
      // Update opacity
      effect.model.traverse((child) => {
        if (child.material) {
          child.material.transparent = true;
          child.material.opacity = alpha;
        }
      });
    }

    // ── Update sniper scope effect ─────────────────────────────
    if (activeScopeEffect && camera) {
      const elapsed = Date.now() - activeScopeEffect.startTime;
      const progress = elapsed / activeScopeEffect.duration;
      
      if (progress >= 1) {
        // Scope effect expired, restore original FOV and hide vignette
        camera.fov = activeScopeEffect.originalFov;
        camera.updateProjectionMatrix();
        activeScopeEffect = null;
        
        const vignetteCanvas = document.getElementById('scopeVignette');
        if (vignetteCanvas) {
          vignetteCanvas.classList.remove('active');
          vignetteCanvas.getContext('2d').clearRect(0, 0, vignetteCanvas.width, vignetteCanvas.height);
        }
      } else {
        // Scope effect is active - zoom quickly then hold
        const zoomDurationMs = 200;  // Zoom completes in 200ms
        const zoomProgress = Math.min(elapsed / zoomDurationMs, 1);  // Clamp to 1
        
        const targetFov = scopeZoomFov;
        const currentFov = activeScopeEffect.originalFov + (targetFov - activeScopeEffect.originalFov) * zoomProgress;
        camera.fov = currentFov;
        camera.updateProjectionMatrix();
        
        // Update vignette - stay visible for entire duration, don't fade
        const vignetteCanvas = document.getElementById('scopeVignette');
        if (vignetteCanvas) {
          vignetteCanvas.classList.add('active');
          const ctx = vignetteCanvas.getContext('2d');
          drawScopeVignette(vignetteCanvas, ctx, zoomProgress);  // Use zoomProgress not progress
        }
      }
    }

    // ── HUD: speed ────────────────────────────────────────────
    const v   = cBody.linvel();
    const spd = Math.sqrt(v.x**2 + v.y**2 + v.z**2);
    const vel = document.getElementById('velocity');
    if (vel) vel.textContent = spd.toFixed(2);
  }

  // ── Camera positioning (always update when game is started and player body exists)
  if (gameStarted && cBody) {
    const p      = cBody.translation();
    const eyeOff = 1;
    camera.position.set(p.x, p.y + eyeOff, p.z);
    updateBarrelPos();
  }

  // ── Opponent interpolation ─────────────────────────────────
  if (gameStarted && room && oppId) {
    const os = room.state.players.get(oppId);
    if (os) pushOppSnap(os.position);
    interpolateOpp();

    // Opponent grapple visuals
    if (skinMgr && hookMgr) {
      const oppRoot = skinMgr.getRoot(oppId);
      if (os && oppRoot) {
        oppYaw = SkinManager.yawFromVelocity(os.velocity.x, os.velocity.z, oppYaw);
        skinMgr.setRotationY(oppId, oppYaw);
        hookMgr.update(oppId, oppRoot.position,
          { x: os.grapple.hx, y: os.grapple.hy, z: os.grapple.hz },
          os.grapple.active);
      }
    }
  }

  // ── Update nametags ────────────────────────────────────────
  if (gameStarted && playerMeshMap.size > 0) {
    nametags.update(playerMeshMap, myId, camera);
  }

  // ── My grapple visuals ───────────
  if (gameStarted && room && myId && hookMgr) {
    const ms = room.state.players.get(myId);
    if (!ms) return;

    hookMgr.update('local', barrelPos,
      { x: ms.grapple.hx, y: ms.grapple.hy, z: ms.grapple.hz },
      ms.grapple.active);
  }

  // ── Bombs ────────────────────────────
  if (gameStarted && room) {
    const liveIds = new Set();
    room.state.bombs.forEach((bs, id) => {
      liveIds.add(id);
      
      // Check if bomb needs to be created
      if (!bombMgr._bombs.has(id)) {
        const bombSkinId = bs.bombSkinId || 'default';
        // Get the bomb skin definition from our global cache
        const bombSkinDef = gBombSkins[bombSkinId] || { id: 'default', glb: null, scale: 1.0 };
        const bombSkinData = {
          id: bombSkinDef.id,
          glb: bombSkinDef.glb,  // Pass the glb path (e.g., "/skins/bombs/c4.glb")
          scale: bombSkinDef.scale || 1.0,
        };
        
        // Assign bomb (async, but _bombs map is populated immediately)
        bombMgr.assignBomb(id, bombSkinData);
      }
      
      // Update position/rotation (safe to do even if async load is pending)
      const entry = bombMgr._bombs.get(id);
      if (entry && entry.root) {
        entry.root.position.set(bs.px, bs.py, bs.pz);
        entry.root.quaternion.set(bs.rx, bs.ry, bs.rz, bs.rw);
      }
    });
    
    // Clean up bombs that no longer exist
    for (const id of bombMgr._bombs.keys()) {
      if (!liveIds.has(id)) {
        bombMgr.removeBomb(id);
      }
    }
  }

  // ── Explosions ─────────────────────────────────────────────
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].update();
    if (!explosions[i].alive) explosions.splice(i, 1);
  }

  perfMonitor.update();
  renderer.render(scene, camera);
}
animate();

// ── DEBUG: Console functions for development ────────────────────────────────
window.getPlayerPos = function() {
  if (!cBody) {
    return null;
  }
  const pos = cBody.translation();
  console.table({
    x: pos.x.toFixed(4),
    y: pos.y.toFixed(4),
    z: pos.z.toFixed(4)
  });
  return { x: pos.x, y: pos.y, z: pos.z };
};

window.getPlayerVel = function() {
  if (!cBody) {
    return null;
  }
  const vel = cBody.linvel();
  console.table({
    x: vel.x.toFixed(4),
    y: vel.y.toFixed(4),
    z: vel.z.toFixed(4)
  });
  return { x: vel.x, y: vel.y, z: vel.z };
};

// ── Resize ────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── Expose functions and objects globally for ranked mode ────────────────────────────────
window.loadMapGLB = loadMapGLB;
window.buildClientWorld = buildClientWorld;
window.playerMeshMap = playerMeshMap;
window.gltfLoader = gltfLoader;
window.skinMgr = skinMgr;
window.hookMgr = hookMgr;
window.bombMgr = bombMgr;
window.nametags = nametags;
window.gBombSkins = gBombSkins;
window.activeGearEffects = activeGearEffects;
window.spawnParticles = spawnParticles;

} // end init()
init().catch(console.error);