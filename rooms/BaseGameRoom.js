'use strict';

// ── rooms/BaseGameRoom.js ─────────────────────────────────────────────────────
// All game logic lives here. Subclasses handle matchmaking concerns only.
//
// Phase flow:
//   'waiting'  → both players join
//   'voting'   → map vote (VOTE_TIMEOUT_MS to submit, then resolves)
//   'playing'  → physics loop running
//   'ended'    → game over, room closes after 5s
//
// Skin system additions:
//   - Each client's equipped skin is fetched from MongoDB when they join.
//   - After voting resolves, before 'gameStart', the server sends each client
//     a 'skinInfo' message containing BOTH players' skin data so the client
//     can pre-load GLB files before rendering begins.
// ─────────────────────────────────────────────────────────────────────────────

const { Room }           = require('colyseus');
const { RoomState, PlayerState, BombState } = require('../schema');
const { PhysicsWorld, RAPIER_READY }        = require('../game/PhysicsWorld');
const { applyMovement }  = require('../game/PlayerController');
const { GrappleSystem }  = require('../game/GrappleSystem');
const { BombSystem }     = require('../game/BombSystem');
const { MAP_LIST, getMap, resolveVotes } = require('../maps');
const { getSkin, getGrapple }        = require('../skins');
const CFG                = require('../config');

const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');

// How long to wait for votes before auto-resolving (ms)
const VOTE_TIMEOUT_MS = 30_000;

class BaseGameRoom extends Room {

  // ── Lifecycle ────────────────────────────────────────────────

  async onCreate(opts = {}) {
    await RAPIER_READY;

    this.maxClients = CFG.PRIVATE_MAX_CLIENTS;
    this.setState(new RoomState());
    this.setPatchRate(CFG.PATCH_RATE_MS);

    // Per-session server-side data
    this._input    = new Map();   // sid → { inputs, camDir, lastSeq }
    this._bodies   = new Map();   // sid → RAPIER.RigidBody
    this._grapples = new Map();   // sid → GrappleSystem

    // Skin data fetched at join time: sid → { skinId, glb, scale, eyeOffset }
    this._skins    = new Map();

    // Player nametag info: sid → { username, userPrefix, prefixColor, usernameColor }
    this._playerNames = new Map();

    // Vote phase state — server only, never sent to clients until resolved
    this._votes    = new Map();   // sid → mapId string
    this._voteTimer = null;

    // Rematch votes after game ends
    this._rematches = new Map(); // sid → boolean
    this._rematchTimer = null;

    // Physics and bombs are created AFTER the vote resolves
    this._physics = null;
    this._bombs   = null;

    // Messages that are always valid
    this.onMessage('vote', (c, d) => this._handleVote(c, d));
    this.onMessage('ping', (c, d) => c.send('pong', { t: d.t }));
    this.onMessage('rematch', (c, d) => this._handleRematch(c, d));

    // Game messages registered once voting is done (in _beginGame)
  }

  async onJoin(client, opts = {}) {
    const isFirst = this.clients.length === 1;

    let skinData = { skinId: 'default', glb: null, scale: 1.0, eyeOffset: 1.0, grapple: { image: null, scale: 0.6, color: 0x00ffff } };
    let nametagInfo = { sessionId: client.sessionId, username: 'Player', userPrefix: '', prefixColor: '#00ffcc', usernameColor: '#ffffff' };
    
    if (opts.token) {
      try {
        const { userId } = jwt.verify(opts.token, CFG.JWT_SECRET);
        client._userId = userId;

        const { unlockGrapple } = require('../routes/skins');

        const { unlockSkin } = require('../routes/skins');
        await unlockSkin(userId, 'cube');
        await unlockGrapple(userId, 'cyan');
        await User.findByIdAndUpdate(userId, { status: 'In Game' });

        const user = await User.findById(userId).select('equippedSkin unlockedSkins equippedGrapple unlockedGrapples username userPrefix prefixColor usernameColor');
        if (user) {
          const equippedId      = user.equippedSkin || 'default';
          const owned           = user.unlockedSkins || [];
          const effectiveSkinId = owned.includes(equippedId) ? equippedId : 'default';
          const skin            = getSkin(effectiveSkinId);
          const grappleId  = user.equippedGrapple || 'default';
          const ownedG     = user.unlockedGrapples || [];
          const effectiveGrappleId = ownedG.includes(grappleId) ? grappleId : 'default';
          const grappleDef = getGrapple(effectiveGrappleId);

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
          };

          nametagInfo = {
            sessionId: client.sessionId,
            username: user.username || 'Player',
            userPrefix: user.userPrefix || '',
            prefixColor: user.prefixColor || '#00ffcc',
            usernameColor: user.usernameColor || '#ffffff',
          };
        }
      } catch (e) { console.error('[onJoin] skin error:', e); }
    }
    this._skins.set(client.sessionId, skinData);
    this._playerNames.set(client.sessionId, nametagInfo);

    this._input.set(client.sessionId, {
      inputs:  { w: false, a: false, s: false, d: false, space: false },
      camDir:  { x: 0, y: 0, z: -1 },
      lastSeq: 0,
    });

    const ps = new PlayerState();
    ps.health = CFG.START_HEALTH;
    this.state.players.set(client.sessionId, ps);

    client.send('init', { myId: client.sessionId, isHost: isFirst });

    if (this.clients.length === this.maxClients) {
      this._startVotePhase();
    }
  }

  async onLeave(client, consented) {
    if (client._userId) {
      await User.findByIdAndUpdate(client._userId, { status: 'Online' });
    }
    if (this._physics) {
      const body = this._bodies.get(client.sessionId);
      if (body) this._physics.removeBody(body);
    }
    this._bodies.delete(client.sessionId);
    this._grapples.delete(client.sessionId);
    this._input.delete(client.sessionId);
    this._votes.delete(client.sessionId);
    this._rematches.delete(client.sessionId);
    this._skins.delete(client.sessionId);
    this._playerNames.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    if (this.state.phase === 'playing') {
      this.broadcast('opponentDisconnected');
    } else if (this.state.phase === 'ended') {
      // Disconnect the room if someone leaves during results screen
      if (this._rematchTimer) {
        this._rematchTimer.clear();
        this._rematchTimer = null;
      }
      this.disconnect();
    }
  }

  // ── Vote phase ───────────────────────────────────────────────

  _startVotePhase() {
    this.state.phase = 'voting';
    this.broadcast('mapVote', { maps: MAP_LIST, timeoutMs: VOTE_TIMEOUT_MS });
    this._voteTimer = this.clock.setTimeout(
      () => this._resolveVotes(),
      VOTE_TIMEOUT_MS
    );
  }

  _handleVote(client, data) {
    if (this.state.phase !== 'voting') return;
    const mapId = typeof data.mapId === 'string' ? data.mapId : null;
    this._votes.set(client.sessionId, mapId);
    console.log(`[Room ${this.roomId}] Vote from ${client.sessionId}: ${mapId}`);
    if (this._votes.size === this.clients.length) {
      this._resolveVotes();
    }
  }

  _resolveVotes() {
    if (this.state.phase !== 'voting') return;
    if (this._voteTimer) { this._voteTimer.clear(); this._voteTimer = null; }

    const [sidA, sidB] = [...this.clients.map(c => c.sessionId)];
    const voteA = this._votes.get(sidA);
    const voteB = this._votes.get(sidB);
    const mapId = resolveVotes(voteA, voteB);
    const map   = getMap(mapId);

    console.log(`[Room ${this.roomId}] Map resolved: ${mapId}`);
    this.broadcast('mapChosen', { mapId: map.id, mapName: map.name });
    this.clock.setTimeout(() => this._beginGame(map), 500);
  }

  // ── Begin game ───────────────────────────────────────────────

  async _beginGame(map) {
    // Refresh skin data from database before starting the game
    for (const client of this.clients) {
      try {
        if (client._userId) {
          const user = await User.findById(client._userId).select('equippedSkin unlockedSkins equippedGrapple unlockedGrapples');
          if (user) {
            const equippedId      = user.equippedSkin || 'default';
            const owned           = user.unlockedSkins || [];
            const effectiveSkinId = owned.includes(equippedId) ? equippedId : 'default';
            const skin            = getSkin(effectiveSkinId);
            const grappleId  = user.equippedGrapple || 'default';
            const ownedG     = user.unlockedGrapples || [];
            const effectiveGrappleId = ownedG.includes(grappleId) ? grappleId : 'default';
            const grappleDef = getGrapple(effectiveGrappleId);

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
            });
          }
        }
      } catch (e) {
        console.error('[_beginGame] Failed to refresh skin:', e);
      }
    }

    this._physics = new PhysicsWorld(map);

    this._bombs = new BombSystem(this._physics, (id, pos, ownerId) => {
      this._handleExplosion(id, pos, ownerId);
    });

    const sessions = this.clients.map(c => c.sessionId);
    sessions.forEach((sid, index) => {
      const body = this._physics.createPlayerBody(index);
      this._bodies.set(sid, body);
      this._grapples.set(sid, new GrappleSystem());
    });

    // ── Send map load payload ──────────────────────────────────
    this.broadcast('loadMap', {
      glb:         map.glb,
      collision:   map.collision,
      spawnPoints: map.spawnPoints,
    });

    // ── Send skin info to each player ──────────────────────────
    // Each client receives their OWN skin and their OPPONENT's skin.
    // This lets the client pre-load both GLBs before gameStart fires.
    for (const client of this.clients) {
      const oppSid  = this._getOpponentId(client.sessionId);
      const oppSkin = (oppSid && this._skins.get(oppSid)) || { skinId: 'default', glb: null, scale: 1.0, eyeOffset: 1.0 };

      client.send('skinInfo', {
        [oppSid]: oppSkin,
      });
    }

    // Register game message handlers
    this.onMessage('input',     (c, d) => this._handleInput(c, d));
    this.onMessage('grapple',   (c)    => this._handleGrapple(c));
    this.onMessage('spawnBomb', (c, d) => this._handleSpawnBomb(c, d));

    this.setSimulationInterval(() => this._tick(), 1000 / CFG.TICK_RATE);
    this._startGame();
  }

  // ── Game flow ────────────────────────────────────────────────

  _startGame() {
    this.state.phase = 'playing';
    const ids = this.clients.map(c => c.sessionId);
    
    // Send nametag info to each player about their opponent
    for (const client of this.clients) {
      const oppId = this._getOpponentId(client.sessionId);
      if (oppId) {
        const oppNametagInfo = this._playerNames.get(oppId);
        if (oppNametagInfo) {
          client.send('nametagInfo', oppNametagInfo);
        }
      }
    }
    
    this.broadcast('gameStart', { hostId: ids[0], guestId: ids[1] });
  }

  _endGame(winnerId, loserId) {
    this.state.phase = 'ended';
    this.broadcast('gameEnd', { winner: winnerId, loser: loserId });
    this.onGameEnd(winnerId, loserId);
    
    // Clear rematch votes and start timeout
    this._rematches.clear();
    if (this._rematchTimer) this._rematchTimer.clear();
    this._rematchTimer = this.clock.setTimeout(() => {
      this.disconnect();
    }, 30000); // 30 second timeout for rematch decision
  }

  onGameEnd(winnerId, loserId) { /* hook for subclasses */ }

  // ── Message handlers ─────────────────────────────────────────

  _handleInput(client, data) {
    const pi = this._input.get(client.sessionId);
    if (!pi) return;
    pi.inputs  = data.inputs;
    pi.camDir  = data.camDir;
    pi.lastSeq = data.seq;
  }

  _handleGrapple(client) {
    const sid     = client.sessionId;
    const grapple = this._grapples.get(sid);
    const body    = this._bodies.get(sid);
    const pi      = this._input.get(sid);
    if (!grapple || !body || !pi) return;
    grapple.activate(body, pi.camDir);
  }

  _handleSpawnBomb(client, data) {
    const id = this._bombs.spawn(data.position, data.impulse, client.sessionId);
    this.state.bombs.set(id, new BombState(id));
  }

  _handleRematch(client, data) {
    if (this.state.phase !== 'ended') return;
    
    this._rematches.set(client.sessionId, true);
    console.log(`[Room ${this.roomId}] Rematch vote from ${client.sessionId}. Votes: ${this._rematches.size}/${this.clients.length}`);
    
    // If both players voted for rematch, start a new game
    if (this._rematches.size === this.clients.length) {
      if (this._rematchTimer) {
        this._rematchTimer.clear();
        this._rematchTimer = null;
      }
      this._resetForRematch();
    }
  }

  async _resetForRematch() {
    // Refresh skin data from database before rematch
    for (const client of this.clients) {
      try {
        if (client._userId) {
          const user = await User.findById(client._userId).select('equippedSkin unlockedSkins equippedGrapple unlockedGrapples');
          if (user) {
            const equippedId      = user.equippedSkin || 'default';
            const owned           = user.unlockedSkins || [];
            const effectiveSkinId = owned.includes(equippedId) ? equippedId : 'default';
            const skin            = getSkin(effectiveSkinId);
            const grappleId  = user.equippedGrapple || 'default';
            const ownedG     = user.unlockedGrapples || [];
            const effectiveGrappleId = ownedG.includes(grappleId) ? grappleId : 'default';
            const grappleDef = getGrapple(effectiveGrappleId);

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
            });
          }
        }
      } catch (e) {
        console.error('[_resetForRematch] Failed to refresh skin:', e);
      }
    }

    // Reset phase and clear old state
    this.state.phase = 'playing';
    this._rematches.clear();

    // Reset player health and positions
    const sessions = [...this.clients.map(c => c.sessionId)];
    sessions.forEach((sid, index) => {
      const ps = this.state.players.get(sid);
      if (ps) {
        ps.health = CFG.START_HEALTH;
        const body = this._bodies.get(sid);
        if (body) {
          const spawnPoint = this._physics.getSpawnPoint(index);
          body.setTranslation({ x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    });

    // Clear bombs from physics and state
    this._bombs.clear(this._physics);
    this.state.bombs.clear();

    // Reset grapple systems
    for (const [sid, grapple] of this._grapples) {
      grapple.reset();
    }

    // Reload the map for clients
    const map = this._physics.map;
    this.broadcast('loadMap', {
      glb:         map.glb,
      collision:   map.collision,
      spawnPoints: map.spawnPoints,
    });

    // Resend skin info to each player
    for (const client of this.clients) {
      const oppSid  = this._getOpponentId(client.sessionId);
      const oppSkin = (oppSid && this._skins.get(oppSid)) || { skinId: 'default', glb: null, scale: 1.0, eyeOffset: 1.0 };

      client.send('skinInfo', {
        [oppSid]: oppSkin,
      });
    }

    // Tell clients to reset UI and prepare for new game
    this.broadcast('rematchStart');
  }

  // ── Physics tick (60 Hz) ─────────────────────────────────────

  _tick() {
    if (this.state.phase !== 'playing') return;

    for (const [sid, body] of this._bodies) {
      const pi      = this._input.get(sid);
      const grapple = this._grapples.get(sid);
      if (!pi || !grapple) continue;

      const grounded = this._physics.isGrounded(body);
      applyMovement(body, pi.inputs, pi.camDir, grounded, grapple.status, 1 / CFG.TICK_RATE);
      grapple.tick(body, this._physics);
    }

    this._physics.step();

    for (const [sid, body] of this._bodies) {
      const pos = body.translation();
      const vel = body.linvel();
      const pi  = this._input.get(sid);
      const g   = this._grapples.get(sid);
      const ps  = this.state.players.get(sid);
      if (!ps || !pi) continue;

      ps.position.x = pos.x; ps.position.y = pos.y; ps.position.z = pos.z;
      ps.velocity.x = vel.x; ps.velocity.y = vel.y; ps.velocity.z = vel.z;
      ps.lastSeq    = pi.lastSeq;

      if (g) {
        ps.grapple.active = g.isActive;
        if (g.isActive && g.hookPos) {
          ps.grapple.hx = g.hookPos.x;
          ps.grapple.hy = g.hookPos.y;
          ps.grapple.hz = g.hookPos.z;
        }
      }

      if (pos.y < CFG.VOID_Y) {
        const otherId = this._getOpponentId(sid);
        this._endGame(otherId, sid);
        return;
      }
    }

    const detonated = this._bombs.tick();
    for (const id of detonated) this.state.bombs.delete(id);

    this._bombs.forEachLive((id, pos, rot) => {
      const bs = this.state.bombs.get(id);
      if (!bs) return;
      bs.px = pos.x; bs.py = pos.y; bs.pz = pos.z;
      bs.rx = rot.x; bs.ry = rot.y; bs.rz = rot.z; bs.rw = rot.w;
    });
  }

  // ── Explosion ────────────────────────────────────────────────

  _handleExplosion(bombId, center, ownerId) {
    this.broadcast('bombExploded', {
      id:       bombId,
      position: { x: center.x, y: center.y, z: center.z },
    });

    const allBodies     = [...this._bodies.values()];
    const playerEntries = [...this._bodies.entries()].map(([sid, body]) => ({ sid, body }));
    const hits          = BombSystem.resolveExplosion(center, allBodies, playerEntries, ownerId);

    for (const { sid, damage } of hits) {
      const ps = this.state.players.get(sid);
      if (!ps) continue;
      ps.health = Math.max(0, ps.health - damage);
      this.broadcast('playerHit', { playerId: sid, damage, by: ownerId });
      if (ps.health <= 0) {
        this._endGame(ownerId, sid);
        return;
      }
    }
  }

  // ── Utility ──────────────────────────────────────────────────

  _getOpponentId(sid) {
    for (const c of this.clients) {
      if (c.sessionId !== sid) return c.sessionId;
    }
    return null;
  }
}

module.exports = { BaseGameRoom };