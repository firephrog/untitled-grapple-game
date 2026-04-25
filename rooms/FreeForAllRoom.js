'use strict';

// ── rooms/FreeForAllRoom.js ──────────────────────────────────────────────────────
// Free for All multiplayer game mode.
// 
// Features:
//   - Up to 25 players in a large arena
//   - GLB-based arenas with 5 spawn locations
//   - Hourly map rotation with 10-second warning
//   - Respawn/exit death menu
//   - No voting phase - maps rotate automatically
//   - HP bars for all players
// ─────────────────────────────────────────────────────────────────────────────

const { Room }           = require('colyseus');
const { RoomState, PlayerState, BombState } = require('../schema');
const { PhysicsWorld, RAPIER_READY }        = require('../game/PhysicsWorld');
const { applyMovement }  = require('../game/PlayerController');
const { GrappleSystem }  = require('../game/GrappleSystem');
const { BombSystem }     = require('../game/BombSystem');
const { GearSystem }     = require('../game/GearSystem');
const ParrySystem        = require('../game/ParrySystem');
const { FFA_MAPS, getFFAMap, randomFFAMapId } = require('../maps');
const { getSkin, getGrapple, getBombSkin }        = require('../skins');
const { checkAndUnlockRewards }      = require('../routes/skins');
const CFG                = require('../config');

const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');

// FFA specific constants
const FFP_MAX_PLAYERS = 25;
const MAP_ROTATION_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour
const MAP_WARNING_TIME_MS = 10 * 1000;  // 10 seconds before rotation

class FreeForAllRoom extends Room {

  // ── Lifecycle ────────────────────────────────────────────────

  async onCreate(opts = {}) {
    await RAPIER_READY;

    this.maxClients = FFP_MAX_PLAYERS;
    this.setState(new RoomState());
    this.setPatchRate(CFG.PATCH_RATE_MS);

    // Per-session server-side data
    this._input    = new Map();   // sid → { inputs, camDir, lastSeq }
    this._bodies   = new Map();   // sid → RAPIER.RigidBody
    this._grapples = new Map();   // sid → GrappleSystem
    this._grappleLastInput = new Map();
    this._parries  = new Map();   // sid → ParrySystem

    // Skin data fetched at join time
    this._skins    = new Map();   // sid → { skinId, glb, scale, eyeOffset }

    // Player nametag info
    this._playerNames = new Map();

    // Player database IDs for stats tracking
    this._playerUserIds = new Map();  // sid → userId

    // Alive/dead status
    this._alive = new Map();  // sid → boolean

    // Physics and bombs
    this._physics = null;
    this._bombs   = null;
    
    // Frame counter
    this._tickCount = 0;

    // Current map
    this._currentMap = null;
    this._mapRotationTimer = null;
    this._mapWarningTimer = null;

    // Messages
    this.onMessage('ping', (c, d) => c.send('pong', { t: d.t }));
    this.onMessage('requestRespawn', (c) => this._handleRespawnRequest(c));
    this.onMessage('requestExit', (c) => this._handleExitRequest(c));

    // Start game immediately (no voting phase)
    this._initializeFFAGame();
  }

  async _initializeFFAGame() {
    console.log('[FFA _initializeFFAGame] Initializing FFA game, current clients:', this.clients.length);
    // Choose random FFA map
    this._currentMap = getFFAMap(randomFFAMapId());
    console.log('[FFA _initializeFFAGame] Selected map:', this._currentMap.id);
    
    // Start game with this map
    await this._beginFFAGame(this._currentMap);

    // Schedule hourly map rotations
    this._scheduleMapRotation();
  }

  _scheduleMapRotation() {
    if (this._mapRotationTimer) {
      this._mapRotationTimer.clear();
      this._mapRotationTimer = null;
    }
    if (this._mapWarningTimer) {
      this._mapWarningTimer.clear();
      this._mapWarningTimer = null;
    }

    // Set up warning 10 seconds before rotation
    this._mapWarningTimer = this.clock.setTimeout(() => {
      this.broadcast('mapRotationWarning', { 
        timeRemainingMs: MAP_WARNING_TIME_MS 
      });
      this.addInGameNotification('[MAP ROTATION] Changing map in 10 seconds');
    }, MAP_ROTATION_INTERVAL_MS - MAP_WARNING_TIME_MS);

    // Set up actual rotation
    this._mapRotationTimer = this.clock.setTimeout(() => {
      this._rotateMap();
    }, MAP_ROTATION_INTERVAL_MS);
  }

  async _rotateMap() {
    // Choose new map
    const newMap = getFFAMap(randomFFAMapId());
    this._currentMap = newMap;

    // Kick all players with notification about new map
    for (const client of this.clients) {
      client.send('mapRotated', { mapId: newMap.id, mapName: newMap.name });
    }

    // Disconnect and recreate room with new map (or reload map in-place)
    // For now, we'll reload the map for all players
    this.broadcast('loadMap', {
      glb:         newMap.glb,
      spawnPoints: newMap.spawnPoints,
    });

    // Respawn all living players at random spawn points
    for (const [sessionId, ps] of this.state.players.entries()) {
      if (ps.health > 0) {
        const spawnPoint = this._getRandomSpawnPoint();
        const body = this._bodies.get(sessionId);
        if (body) {
          body.setTranslation({ x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }

    // Reschedule next rotation
    this._scheduleMapRotation();
  }

  async onJoin(client, opts = {}) {
    // Load player skin and name
    let skinData = { skinId: 'default', glb: null, scale: 1.0, eyeOffset: 1.0, grapple: { image: null, scale: 0.6, color: 0x00ffff } };
    let nametagInfo = { sessionId: client.sessionId, username: 'Player', userPrefix: '', prefixColor: '#00ffcc', usernameColor: '#ffffff' };
    
    if (opts.token) {
      try {
        const { userId } = jwt.verify(opts.token, CFG.JWT_SECRET);
        client._userId = userId;
        this._playerUserIds.set(client.sessionId, userId);

        const { unlockGrapple, unlockSkin } = require('../routes/skins');
        await unlockSkin(userId, 'cube');
        await unlockGrapple(userId, 'cyan');
        await User.findByIdAndUpdate(userId, { status: 'In Game' });

        const user = await User.findById(userId).select('skins username userPrefix prefixColor usernameColor');
        if (user) {
          // Find equipped player skin
          let equippedId = 'default';
          if (user.skins?.player) {
            for (const [id, data] of Object.entries(user.skins.player)) {
              if (data.equipped) { equippedId = id; break; }
            }
          }
          const skin = getSkin(equippedId);

          // Find equipped grapple
          let grappleId = 'default';
          if (user.skins?.grapples) {
            for (const [id, data] of Object.entries(user.skins.grapples)) {
              if (data.equipped) { grappleId = id; break; }
            }
          }
          const grappleDef = getGrapple(grappleId);

          // Find equipped bomb skin
          let bombSkinId = 'default';
          if (user.skins?.bombs) {
            for (const [id, data] of Object.entries(user.skins.bombs)) {
              if (data.equipped) { bombSkinId = id; break; }
            }
          }
          const bombSkinDef = getBombSkin(bombSkinId);

          skinData = {
            skinId:    skin.id,
            glb:       skin.glb,
            scale:     skin.scale,
            eyeOffset: skin.eyeOffset,
            grapple: {
              image: grappleDef.image,
              localImage: grappleDef.localImage,
              scale: grappleDef.scale,
              color: grappleDef.color,
            },
            bombSkinId: bombSkinId,
            bombSkin: {
              id: bombSkinDef.id,
              glb: bombSkinDef.glb,
              scale: bombSkinDef.scale,
            },
          };

          nametagInfo = {
            sessionId: client.sessionId,
            username: user.username || 'Player',
            userPrefix: user.userPrefix || '',
            prefixColor: user.prefixColor || '#00ffcc',
            usernameColor: user.usernameColor || '#ffffff',
          };
        }
      } catch (e) { console.error('[FFA onJoin] skin error:', e); }
    }

    this._skins.set(client.sessionId, skinData);
    this._playerNames.set(client.sessionId, nametagInfo);
    this._alive.set(client.sessionId, true);

    this._input.set(client.sessionId, {
      inputs:  { w: false, a: false, s: false, d: false, space: false },
      camDir:  { x: 0, y: 0, z: -1 },
      lastSeq: 0,
    });

    const ps = new PlayerState();
    ps.health = CFG.START_HEALTH;
    ps.bombSkinId = skinData.bombSkinId || 'default';
    this.state.players.set(client.sessionId, ps);

    // If game is already started, create physics body for this new player
    if (this.state.phase === 'playing' && this._physics) {
      console.log('[FFA onJoin] Game already started, creating physics body for new player');
      const spawnPoint = this._getRandomSpawnPoint();
      const randomSpawnIndex = Math.floor(Math.random() * this._currentMap.spawnPoints.length);
      const body = this._physics.createPlayerBody(randomSpawnIndex);
      body.setTranslation({ x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z }, true);
      this._bodies.set(client.sessionId, body);
      this._grapples.set(client.sessionId, new GrappleSystem());
      this._parries.set(client.sessionId, new ParrySystem());
      
      // Set initial position in state
      ps.position.x = spawnPoint.x;
      ps.position.y = spawnPoint.y;
      ps.position.z = spawnPoint.z;
    }

    // Send init with current player count and map info
    client.send('init', { 
      myId: client.sessionId, 
      mode: 'ffa',
      playerCount: this.clients.length - 1,  // -1 because we just added them
      currentMap: this._currentMap,
    });

    // Broadcast updated player count to all clients
    this.broadcast('playerCountUpdate', { count: this.clients.length });
    
    // If game is already started, send game state to the newly joined player
    console.log('[FFA onJoin] Player joined. Current phase:', this.state.phase);
    if (this.state.phase === 'playing') {
      console.log('[FFA onJoin] Game already started, sending game state to new player');
      
      // Send map load payload
      client.send('loadMap', {
        glb:         this._currentMap.glb,
        collision:   this._currentMap.collision,
        spawnPoints: this._currentMap.spawnPoints,
      });
      
      // Send skin info for all other players
      const skinMap = {};
      for (const otherClient of this.clients) {
        if (otherClient.sessionId !== client.sessionId) {
          const otherSkin = this._skins.get(otherClient.sessionId) || { skinId: 'default', glb: null, scale: 1.0, eyeOffset: 1.0 };
          skinMap[otherClient.sessionId] = otherSkin;
        }
      }
      if (Object.keys(skinMap).length > 0) {
        client.send('skinInfo', skinMap);
      }
      
      // Send nametag info for all other players
      const nametags = {};
      for (const otherClient of this.clients) {
        if (otherClient.sessionId !== client.sessionId) {
          const nametagInfo = this._playerNames.get(otherClient.sessionId);
          if (nametagInfo) {
            nametags[otherClient.sessionId] = nametagInfo;
          }
        }
      }
      if (Object.keys(nametags).length > 0) {
        client.send('nametagInfoMulti', nametags);
      }
      
      // Send gameStart message
      console.log('[FFA onJoin] Sending gameStart to new player');
      client.send('gameStart', { mode: 'ffa' });
      
      // Broadcast new player's skin to existing players
      const newPlayerSkin = this._skins.get(client.sessionId);
      if (newPlayerSkin) {
        this.broadcast('skinInfo', { [client.sessionId]: newPlayerSkin }, { except: client });
      }
      
      // Broadcast new player's nametag to existing players
      const newPlayerNametag = this._playerNames.get(client.sessionId);
      if (newPlayerNametag) {
        this.broadcast('nametagInfoMulti', { [client.sessionId]: newPlayerNametag }, { except: client });
      }
    }
  }

  async onLeave(client, consented) {
    if (client._userId) {
      await User.findByIdAndUpdate(client._userId, { status: 'Online' });
    }

    // Remove from physics world
    if (this._physics) {
      const body = this._bodies.get(client.sessionId);
      if (body) this._physics.removeBody(body);
    }

    // Clean up server-side data
    this._bodies.delete(client.sessionId);
    this._grapples.delete(client.sessionId);
    this._grappleLastInput.delete(client.sessionId);
    this._input.delete(client.sessionId);
    this._skins.delete(client.sessionId);
    this._playerNames.delete(client.sessionId);
    this._playerUserIds.delete(client.sessionId);
    this._alive.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    // Broadcast updated player count
    if (this.clients.length > 0) {
      this.broadcast('playerCountUpdate', { count: this.clients.length });
    } else {
      // Room is empty - disconnect it
      this.disconnect();
    }
  }

  // ── Game initialization ──────────────────────────────────────

  async _beginFFAGame(map) {
    console.log('[FFA _beginGame] Starting game with map:', map.id, 'with', this.clients.length, 'clients');
    if (!map) {
      console.error('[FFA _beginGame] No map provided');
      return;
    }

    // Load skin data from database for all players
    for (const client of this.clients) {
      try {
        if (client._userId) {
          const user = await User.findById(client._userId).select('skins');
          if (user) {
            // Find equipped player skin
            let equippedId = 'default';
            if (user.skins?.player) {
              for (const [id, data] of Object.entries(user.skins.player)) {
                if (data.equipped) { equippedId = id; break; }
              }
            }
            const skin = getSkin(equippedId);

            // Find equipped grapple
            let grappleId = 'default';
            if (user.skins?.grapples) {
              for (const [id, data] of Object.entries(user.skins.grapples)) {
                if (data.equipped) { grappleId = id; break; }
              }
            }
            const grappleDef = getGrapple(grappleId);

            // Find equipped bomb skin
            let bombSkinId = 'default';
            if (user.skins?.bombs) {
              for (const [id, data] of Object.entries(user.skins.bombs)) {
                if (data.equipped) { bombSkinId = id; break; }
              }
            }
            const bombSkinDef = getBombSkin(bombSkinId);

            this._skins.set(client.sessionId, {
              skinId:    skin.id,
              glb:       skin.glb,
              scale:     skin.scale,
              eyeOffset: skin.eyeOffset,
              grapple: {
                image: grappleDef.image,
                localImage: grappleDef.localImage,
                scale: grappleDef.scale,
                color: grappleDef.color,
              },
              bombSkinId: bombSkinId,
              bombSkin: {
                id: bombSkinDef.id,
                glb: bombSkinDef.glb,
                scale: bombSkinDef.scale,
              },
            });

            const ps = this.state.players.get(client.sessionId);
            if (ps) {
              ps.bombSkinId = bombSkinId;
            }
          }
        }
      } catch (e) {
        console.error('[FFA _beginGame] Failed to refresh skin:', e);
      }
    }

    // Create physics world
    this._physics = new PhysicsWorld(map);

    // Create bomb system
    this._bombs = new BombSystem(this._physics, (id, pos, ownerId) => {
      this._handleExplosion(id, pos, ownerId);
    });

    // Create gear system
    this._gear = new GearSystem(
      this._physics,
      (shooterId, targetId, damage) => this._handleSnipeHit(shooterId, targetId, damage),
      (line) => this._broadcastLine(line),
      (effect) => this._broadcastGearEffect(effect),
      (shooterId, targetId, damage) => this._handleAoeDamage(shooterId, targetId, damage),
      (position, type, count) => this._broadcastParticles(position, type, count)
    );

    // Create player bodies at spawn points
    const sessions = this.clients.map(c => c.sessionId);
    sessions.forEach((sid, index) => {
      const spawnIndex = index % map.spawnPoints.length;
      const body = this._physics.createPlayerBody(spawnIndex);
      this._bodies.set(sid, body);
      this._grapples.set(sid, new GrappleSystem());
      this._parries.set(sid, new ParrySystem());
    });

    // Send map load payload with collision data
    console.log('[FFA _beginGame] Broadcasting loadMap');
    this.broadcast('loadMap', {
      glb:         map.glb,
      collision:   map.collision,
      spawnPoints: map.spawnPoints,
    });

    // Send skin info to each player
    for (const client of this.clients) {
      const skinMap = {};
      for (const otherClient of this.clients) {
        if (otherClient.sessionId !== client.sessionId) {
          const otherSkin = this._skins.get(otherClient.sessionId) || { skinId: 'default', glb: null, scale: 1.0, eyeOffset: 1.0 };
          skinMap[otherClient.sessionId] = otherSkin;
        }
      }
      client.send('skinInfo', skinMap);
    }

    // Register game message handlers
    this.onMessage('input',     (c, d) => this._handleInput(c, d));
    this.onMessage('grapple',   (c, d) => this._handleGrapple(c, d));
    this.onMessage('spawnBomb', (c, d) => this._handleSpawnBomb(c, d));
    this.onMessage('parry',     (c)    => this._handleParry(c));
    this.onMessage('useGear',   (c, d) => this._handleUseGear(c, d));

    // Send nametag info for all players
    for (const client of this.clients) {
      const nametags = {};
      for (const otherClient of this.clients) {
        if (otherClient.sessionId !== client.sessionId) {
          const nametagInfo = this._playerNames.get(otherClient.sessionId);
          if (nametagInfo) {
            nametags[otherClient.sessionId] = nametagInfo;
          }
        }
      }
      if (Object.keys(nametags).length > 0) {
        client.send('nametagInfoMulti', nametags);
      }
    }

    console.log('[FFA _beginGame] Broadcasting gameStart to', this.clients.length, 'clients');
    this.state.phase = 'playing';
    this.broadcast('gameStart', { mode: 'ffa' });

    // Start simulation loop
    console.log('[FFA _beginGame] Starting simulation loop');
    this.setSimulationInterval(() => this._tick(), 1000 / CFG.TICK_RATE);
  }

  // ── Respawn / Death ──────────────────────────────────────────

  _scheduleRespawn(sid) {
    // Player will rejoin instead of respawning in place
    // Death message already sent, client will show respawn menu
  }

  _handleRespawnRequest(client) {
    if (this._alive.get(client.sessionId)) return;  // Already alive

    this._alive.set(client.sessionId, true);

    const ps = this.state.players.get(client.sessionId);
    if (ps) {
      ps.health = CFG.START_HEALTH;
    }

    // Respawn at random spawn point
    const spawnPoint = this._getRandomSpawnPoint();
    const body = this._bodies.get(client.sessionId);
    if (body) {
      body.setTranslation({ x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    client.send('respawned', { spawnPoint });
    this.broadcast('playerRespawned', { playerId: client.sessionId });
  }

  _handleExitRequest(client) {
    // Player is exiting to menu - just kick them from room
    // They'll refresh the page on the client side
    client.leave();
  }

  _getRandomSpawnPoint() {
    const map = this._currentMap;
    if (!map || !map.spawnPoints || map.spawnPoints.length === 0) {
      return { x: 0, y: 5, z: 0 };  // Fallback
    }
    const randomIndex = Math.floor(Math.random() * map.spawnPoints.length);
    return map.spawnPoints[randomIndex];
  }

  // ── Game loop ────────────────────────────────────────────────

  _tick() {
    this._tickCount++;

    // Handle input from all players
    for (const [sid, input] of this._input.entries()) {
      const body = this._bodies.get(sid);
      if (!body || !this._alive.get(sid)) continue;

      const gameInput = input.inputs;
      const camDir = input.camDir;

      // Determine if grounded and grapple status
      const grounded = this._physics.isGrounded(body);
      const grapple = this._grapples.get(sid);
      const grappleStatus = grapple?.status || 'IDLE';

      // Apply movement
      applyMovement(body, gameInput, camDir, grounded, grappleStatus);
    }

    // Step physics
    if (this._physics) {
      this._physics.step();
    }

    // Update player states from physics bodies
    for (const [sid, body] of this._bodies.entries()) {
      if (!this._alive.get(sid)) continue;

      const ps = this.state.players.get(sid);
      if (!ps || !body) continue;

      const pos = body.translation();
      ps.position.x = pos.x;
      ps.position.y = pos.y;
      ps.position.z = pos.z;

      const vel = body.linvel();
      ps.velocity.x = vel.x;
      ps.velocity.y = vel.y;
      ps.velocity.z = vel.z;

      // Check void death (fell below y = -20)
      if (pos.y < -100) {
        this._alive.set(sid, false);
        ps.health = 0;
        
        // Remove dead player from room
        const deadClient = this.clients.find(c => c.sessionId === sid);
        if (deadClient) {
          deadClient.send('playerDead', { canRespawn: true, killerId: null, killerName: 'The Void' });
          // Schedule client removal after brief delay
          setTimeout(() => deadClient.leave(), 500);
        }
        
        this.broadcast('playerDied', { playerId: sid, killerId: null, killerName: 'The Void' });
      }
    }

    // Update grapples
    for (const [sid, grapple] of this._grapples.entries()) {
      if (!this._alive.get(sid)) continue;
      const body = this._bodies.get(sid);
      if (!body) continue;
      grapple.tick(body, this._physics);
      
      // Update grapple state for clients to render
      const ps = this.state.players.get(sid);
      if (ps && ps.grapple) {
        ps.grapple.active = grapple.isActive;
        if (grapple.hookPos) {
          ps.grapple.hx = grapple.hookPos.x;
          ps.grapple.hy = grapple.hookPos.y;
          ps.grapple.hz = grapple.hookPos.z;
        }
      }
    }

    // Update bombs
    if (this._bombs) {
      const detonated = this._bombs.tick();
      
      this._bombs.forEachLive((id, pos, rot) => {
        if (!this.state.bombs.has(id)) {
          // Get the owner's bomb skin ID
          const bomb = this._bombs._bombs.get(id);
          const ownerSessionId = bomb ? bomb.owner : null;
          const ownerSkin = ownerSessionId ? this._skins.get(ownerSessionId) : null;
          const bombSkinId = ownerSkin?.bombSkinId || 'default';
          const bs = new BombState(id, bombSkinId);
          // Initialize with physics position to prevent rendering at origin before first broadcast
          bs.px = pos.x;
          bs.py = pos.y;
          bs.pz = pos.z;
          bs.rx = rot.x;
          bs.ry = rot.y;
          bs.rz = rot.z;
          bs.rw = rot.w;
          this.state.bombs.set(id, bs);
        } else {
          const bs = this.state.bombs.get(id);
          bs.px = pos.x;
          bs.py = pos.y;
          bs.pz = pos.z;
          bs.rx = rot.x;
          bs.ry = rot.y;
          bs.rz = rot.z;
          bs.rw = rot.w;
        }
      });

      // Remove destroyed bombs from state
      for (const bombId of detonated) {
        this.state.bombs.delete(bombId);
      }
    }

    // Update gear system (process pending snipes/maces)
    if (this._gear) {
      const { readySnipes, readyMaces } = this._gear.tick();
      
      // Execute ready snipes
      for (const pending of readySnipes) {
        const shooterBody = this._bodies.get(pending.shooterId);
        const shooterInput = this._input.get(pending.shooterId);
        if (shooterBody && shooterInput) {
          this._gear.executePendingSnipe(pending, shooterBody, shooterInput);
        }
      }
      
      // Execute ready maces
      for (const pending of readyMaces) {
        this._gear.executePendingMace(pending);
      }
    }
  }

  // ── Input handling ───────────────────────────────────────────

  _handleInput(client, data) {
    if (this.state.phase !== 'playing') return;

    const input = this._input.get(client.sessionId);
    if (!input) return;

    input.inputs = data.inputs || input.inputs;
    input.camDir = data.camDir || input.camDir;
    input.lastSeq = data.seq || input.lastSeq;
  }

  _handleGrapple(client, data) {
    console.log('[FFA _handleGrapple] Received grapple from', client.sessionId, 'data:', data, 'phase:', this.state.phase, 'alive:', this._alive.get(client.sessionId));
    if (this.state.phase !== 'playing' || !this._alive.get(client.sessionId)) {
      return;
    }

    const grapple = this._grapples.get(client.sessionId);
    const body = this._bodies.get(client.sessionId);
    if (!grapple || !body) {
      return;
    }

    const skinData = this._skins.get(client.sessionId);
    const eyeOffset = skinData?.eyeOffset || 1.0;
    const camDir = data?.camDir || { x: 0, y: 0, z: -1 };

    this._grappleLastInput.set(client.sessionId, this._tickCount);
    grapple.activate(body, camDir, eyeOffset);
  }

  _handleSpawnBomb(client, data) {
    if (this.state.phase !== 'playing' || !this._alive.get(client.sessionId)) {
      return;
    }

    const body = this._bodies.get(client.sessionId);
    if (!body || !this._bombs) {
      return;
    }

    // Validate position exists and has numbers
    if (!data || !data.position || typeof data.position.x !== 'number' || typeof data.position.y !== 'number' || typeof data.position.z !== 'number') {
      return;
    }

    const ps = this.state.players.get(client.sessionId);
    const bombId = this._bombs.spawn(
      data.position,
      { x: data.impulse.x || 0, y: data.impulse.y || 0, z: data.impulse.z || 0 },
      client.sessionId
    );

    this.broadcast('bombSpawned', { 
      bombId, 
      position: { x: data.position.x, y: data.position.y, z: data.position.z },
      ownerId: client.sessionId,
    });
  }

  _handleParry(client) {
    if (this.state.phase !== 'playing' || !this._alive.get(client.sessionId)) return;

    const parry = this._parries.get(client.sessionId);
    if (!parry) return;

    parry.activate();
  }

  _handleUseGear(client, data) {
    if (this.state.phase !== 'playing' || !this._alive.get(client.sessionId)) {
      return;
    }

    const body = this._bodies.get(client.sessionId);
    if (!body || !this._gear) {
      return;
    }

    const gearName = data?.gearName;

    // Get shooter input for camera direction
    const shooterInput = this._input.get(client.sessionId);
    const camDir = shooterInput?.camDir || { x: 0, y: 0, z: -1 };

    // Get shooter eye offset
    const shooterSkinData = this._skins.get(client.sessionId);
    const eyeOffset = shooterSkinData?.eyeOffset || 1.0;

    // Get camera position (body position + eye offset up)
    const bodyPos = body.translation();
    const cameraPos = { x: bodyPos.x, y: bodyPos.y + eyeOffset, z: bodyPos.z };

    // Get all player bodies for raycast/AOE calculation
    const allBodies = Array.from(this._bodies.values());
    const playerEntries = Array.from(this._bodies.entries()).map(([sid, b]) => ({ sid, body: b }));

    if (gearName === 'sniper') {
      this._gear.snipe(body, cameraPos, camDir, allBodies, playerEntries, client.sessionId, eyeOffset);
    } else if (gearName === 'mace') {
      this._gear.mace(body, playerEntries, client.sessionId);
    } else {
      console.warn('[FFA _handleUseGear] Unknown gear:', gearName);
    }
  }

  _getRandomSpawnPoint() {
    if (!this._currentMap || !this._currentMap.spawnPoints || this._currentMap.spawnPoints.length === 0) {
      return { x: 0, y: 5, z: 0 }; // Fallback spawn
    }
    const spawnIndex = Math.floor(Math.random() * this._currentMap.spawnPoints.length);
    return this._currentMap.spawnPoints[spawnIndex];
  }

  _handleExplosion(bombId, pos, ownerId) {
    this.broadcast('bombExploded', { id: bombId, position: pos });

    // Get all player bodies for knockback calculation
    const playerEntries = Array.from(this._bodies.entries()).map(([sid, body]) => ({ sid, body }));

    // Apply knockback and get hit players
    const hitPlayers = BombSystem.resolveExplosion(
      pos,
      Array.from(this._bodies.values()),
      playerEntries,
      ownerId
    );

    // Apply damage to hit players
    for (const { sid, damage } of hitPlayers) {
      if (sid !== ownerId && this._alive.get(sid)) {
        this._applyDamage(sid, ownerId, damage);
      }
    }
  }

  _handleSnipeHit(shooterId, targetId, damage) {
    this._applyDamage(targetId, shooterId, damage);
  }

  _handleAoeDamage(shooterId, targetId, damage) {
    this._applyDamage(targetId, shooterId, damage);
  }

  _applyDamage(targetId, shooterId, damage) {
    const ps = this.state.players.get(targetId);
    if (!ps) return;

    ps.health = Math.max(0, ps.health - damage);

    this.broadcast('playerHit', {
      playerId: targetId,
      damage: damage,
      currentHealth: ps.health,
      shooterId: shooterId,
    });

    // Check if target died
    if (ps.health <= 0) {
      this._alive.set(targetId, false);
      
      const targetClient = this.clients.find(c => c.sessionId === targetId);
      if (targetClient) {
        targetClient.send('playerDead', { canRespawn: true, killerId: shooterId });
        this.broadcast('playerDied', { playerId: targetId, killerId: shooterId });
        
        // Schedule client removal after brief delay to allow death message to send
        setTimeout(() => targetClient.leave(), 500);
      }

      // Update stats
      const shooterUserId = this._playerUserIds.get(shooterId);
      const targetUserId = this._playerUserIds.get(targetId);
      if (shooterUserId && targetUserId) {
        (async () => {
          try {
            await User.findByIdAndUpdate(shooterUserId, { $inc: { kills: 1 } });
            await User.findByIdAndUpdate(targetUserId, { $inc: { deaths: 1 } });
          } catch (e) {
            console.error('[FFA] Failed to update stats:', e);
          }
        })();
      }
    }
  }

  _broadcastLine(line) {
    // Explicitly construct plain object to ensure serialization
    const lineData = {
      startPos: line.startPos || { x: 0, y: 0, z: 0 },
      endPos: line.endPos || { x: 0, y: 0, z: 0 },
      direction: line.direction || { x: 0, y: 0, z: 1 },
      duration: line.duration || 3000,
    };
    this.broadcast('sniperLine', lineData);
  }

  _broadcastGearEffect(effect) {
    // Explicitly construct plain object to ensure all properties are sent
    const effectData = {
      gearName: effect.gearName,
      shooterId: effect.shooterId,
      position: effect.position || { x: 0, y: 0, z: 0 },
      rotation: effect.rotation || { x: 0, y: 0, z: 0, w: 1 },
      direction: effect.direction || { x: 0, y: 0, z: 1 },
      duration: effect.duration || 3000,
    };
    this.broadcast('gearEffect', effectData);
  }

  _broadcastParticles(position, type, count) {
    this.broadcast('particles', { position, type, count });
  }

  addInGameNotification(message) {
    this.broadcast('notification', { message, duration: 5000 });
  }
}

module.exports = { FreeForAllRoom };
