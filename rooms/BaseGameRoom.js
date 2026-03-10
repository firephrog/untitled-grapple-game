'use strict';

// ── rooms/BaseGameRoom.js ─────────────────────────────────────────────────────
// All game logic lives here. Subclasses handle matchmaking concerns only.
//
// Phase flow:
//   'waiting'  → both players join
//   'voting'   → map vote (VOTE_TIMEOUT_MS to submit, then resolves)
//   'playing'  → physics loop running
//   'ended'    → game over, room closes after 5s
// ─────────────────────────────────────────────────────────────────────────────

const { Room }           = require('colyseus');
const { RoomState, PlayerState, BombState } = require('../schema');
const { PhysicsWorld, RAPIER_READY }        = require('../game/PhysicsWorld');
const { applyMovement }  = require('../game/PlayerController');
const { GrappleSystem }  = require('../game/GrappleSystem');
const { BombSystem }     = require('../game/BombSystem');
const { MAP_LIST, getMap, resolveVotes } = require('../maps');
const CFG                = require('../config');

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

    // Vote phase state — server only, never sent to clients until resolved
    this._votes    = new Map();   // sid → mapId string
    this._voteTimer = null;

    // Physics and bombs are created AFTER the vote resolves
    this._physics = null;
    this._bombs   = null;

    // Messages that are always valid
    this.onMessage('vote', (c, d) => this._handleVote(c, d));
    this.onMessage('ping', (c, d) => c.send('pong', { t: d.t }));

    // Game messages registered once voting is done (in _beginGame)
  }

  onJoin(client) {
    const isFirst = this.clients.length === 1;

    // Input state (needed before game starts so no null checks later)
    this._input.set(client.sessionId, {
      inputs:  { w: false, a: false, s: false, d: false, space: false },
      camDir:  { x: 0, y: 0, z: -1 },
      lastSeq: 0,
    });

    // Schema entry
    const ps = new PlayerState();
    ps.health = CFG.START_HEALTH;
    this.state.players.set(client.sessionId, ps);

    client.send('init', { myId: client.sessionId, isHost: isFirst });

    // Both players present → start the vote phase
    if (this.clients.length === this.maxClients) {
      this._startVotePhase();
    }
  }

  onLeave(client) {
    if (this._physics) {
      const body = this._bodies.get(client.sessionId);
      if (body) this._physics.removeBody(body);
    }
    this._bodies.delete(client.sessionId);
    this._grapples.delete(client.sessionId);
    this._input.delete(client.sessionId);
    this._votes.delete(client.sessionId);
    this.state.players.delete(client.sessionId);

    if (this.state.phase === 'playing') {
      this.broadcast('opponentDisconnected');
    }
  }

  // ── Vote phase ───────────────────────────────────────────────
  //
  // How it works:
  //   1. Server sends 'mapVote' with the full map list so clients
  //      can render the picker without needing to hard-code anything.
  //   2. Each client sends back 'vote' with their chosen mapId.
  //   3. As soon as BOTH votes arrive, resolveVotes() picks the map.
  //   4. If only one (or zero) votes arrive within VOTE_TIMEOUT_MS,
  //      the clock fires and resolves with whatever is there.
  //   5. Server broadcasts 'mapChosen' and calls _beginGame(map).

  _startVotePhase() {
    this.state.phase = 'voting';

    // Send the map list so the client can build the UI dynamically.
    // Clients don't need the block data — just id/name/description.
    this.broadcast('mapVote', { maps: MAP_LIST, timeoutMs: VOTE_TIMEOUT_MS });

    // Auto-resolve after timeout in case a player never votes
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

    // Resolve immediately once all connected players have voted
    if (this._votes.size === this.clients.length) {
      this._resolveVotes();
    }
  }

  _resolveVotes() {
    // Guard: only resolve once
    if (this.state.phase !== 'voting') return;

    // Cancel the timeout if votes came in early
    if (this._voteTimer) {
      this._voteTimer.clear();
      this._voteTimer = null;
    }

    // Pull out the two votes (may be undefined if a player never voted)
    const [sidA, sidB] = [...this.clients.map(c => c.sessionId)];
    const voteA = this._votes.get(sidA);
    const voteB = this._votes.get(sidB);

    // resolveVotes handles all cases: same, different, missing
    const mapId = resolveVotes(voteA, voteB);
    const map   = getMap(mapId);

    console.log(`[Room ${this.roomId}] Map resolved: ${mapId} (votes: ${voteA}, ${voteB})`);

    // Tell both clients which map was chosen BEFORE starting the game,
    // so they can load assets / show a "loading..." screen if needed.
    this.broadcast('mapChosen', { mapId: map.id, mapName: map.name });

    // Small delay so clients have time to process mapChosen before game messages start
    this.clock.setTimeout(() => this._beginGame(map), 500);
  }

  // ── Begin game (called after vote resolves) ──────────────────

  _beginGame(map) {
    // Build physics world from the chosen map
    this._physics = new PhysicsWorld(map);

    // Bomb system
    this._bombs = new BombSystem(this._physics, (id, pos, ownerId) => {
      this._handleExplosion(id, pos, ownerId);
    });


    // Create player bodies at map spawn points
    const sessions = this.clients.map(c => c.sessionId);
    sessions.forEach((sid, index) => {
      const body = this._physics.createPlayerBody(index);
      this._bodies.set(sid, body);
      this._grapples.set(sid, new GrappleSystem());
    });

    // Tell each client which files to load.
    // glb        → Three.js loads the visual mesh
    // collision  → client Rapier loads the same trimesh as the server
    // spawnPoints→ so client body spawns at the right position
    this.broadcast('loadMap', {
      glb:         map.glb,
      collision:   map.collision,
      spawnPoints: map.spawnPoints,
    });

    // Register game message handlers now that physics exists
    this.onMessage('input',     (c, d) => this._handleInput(c, d));
    this.onMessage('grapple',   (c)    => this._handleGrapple(c));
    this.onMessage('spawnBomb', (c, d) => this._handleSpawnBomb(c, d));



    // Start the 60Hz physics loop
    this.setSimulationInterval(() => this._tick(), 1000 / CFG.TICK_RATE);

    this._startGame();
  }

  // ── Game flow ────────────────────────────────────────────────

  _startGame() {
    this.state.phase = 'playing';
    const ids = this.clients.map(c => c.sessionId);
    this.broadcast('gameStart', { hostId: ids[0], guestId: ids[1] });
  }

  _endGame(winnerId, loserId) {
    this.state.phase = 'ended';
    this.broadcast('gameEnd', { winner: winnerId, loser: loserId });
    this.onGameEnd(winnerId, loserId);
    this.clock.setTimeout(() => this.disconnect(), 5000);
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