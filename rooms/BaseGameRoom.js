'use strict';
/**
 * BaseGameRoom  (1v1 modes: private / matchmaking / ranked)
 *
 * Thin WebSocket proxy to the C++ game server.
 * Auth, skin loading, and DB writes stay in Node.js.
 * All game simulation (physics, systems, tick) runs in C++.
 */
const { Room }  = require('colyseus');
const jwt       = require('jsonwebtoken');
const { JWT_SECRET, PRIVATE_MAX_CLIENTS } = require('../config');
const User      = require('../models/User');
const { getSkin, getGrapple, getBombSkin } = require('../skins');
const { getGrpcClient }      = require('../game/GrpcClient');
const { getRedisGameBridge } = require('../game/RedisGameBridge');
const { MAP_LIST, getMap, resolveVotes, mapFilePath } = require('../maps');
const { RoomState, PlayerState, BombState } = require('../schema');
const { writeDiagnostic } = require('../lib/DiagnosticsLogger');

const ROOM_PATCH_HZ = Math.max(1, Number(process.env.ROOM_PATCH_HZ || 60));
const ROOM_PATCH_MIN_INTERVAL_MS = 1000 / ROOM_PATCH_HZ;
const PING_GAP_SPIKE_MS = Math.max(250, Number(process.env.PING_GAP_SPIKE_MS || 2500));
const SNAPSHOT_PROC_SPIKE_MS = Math.max(1, Number(process.env.SNAPSHOT_PROC_SPIKE_MS || 12));
const STATE_GAP_SPIKE_MS = Math.max(80, Number(process.env.STATE_GAP_SPIKE_MS || 220));
const VERBOSE_PING_LOG = process.env.ROOM_VERBOSE_PING_LOG === '1';

class BaseGameRoom extends Room {
  onCreate(options) {
    this.maxClients   = options.maxClients || PRIVATE_MAX_CLIENTS;
    this._grpc        = getGrpcClient(options.mode === 'ffa' ? 'ffa' : 'pvp');
    this._bridge      = getRedisGameBridge();
    this.setState(new RoomState());
    this._stream      = null;
    this._votes       = new Map();
    this._rematches   = new Set();
    this._skinData    = new Map();
    this._playerNames = new Map();
    this._dbIds       = new Map();  // sessionId → MongoDB user _id string
    this._camYaw      = new Map();  // sessionId → latest cam yaw (radians)
    this._camPitch    = new Map();  // sessionId → latest cam pitch (radians)
    this._mode        = options.mode || 'private';
    this._matchStarted = false;
    this._matchResolved = false;
    this._pingCount   = 0;     // total pings received
    this._snapProcMs  = 0;     // cumulative ms in _applyStateSnapshot, reset every 10 pings
    this._snapCount   = 0;     // gRPC snapshots processed, reset every 10 pings
    this._lastPingAt  = new Map();
    this._lastPatchAtMs = 0;
    this._lastStateMsgAtMs = 0;

    // Disable the timer-based patch loop — we call broadcastPatch() manually
    // immediately after each gRPC state update, so clients get it with zero
    // extra wait instead of up to 50ms of phase-mismatch delay.
    this.setPatchRate(0);

    this._grpc.createRoom(this.roomId, this._mode)
      .then(r => { if (!r.ok) console.error('[BaseGameRoom] createRoom failed:', r.error); })
      .catch(e  => console.error('[BaseGameRoom] createRoom error:', e));

    this.onMessage('vote',    (c, d) => this._handleVote(c, d));
    this.onMessage('rematch', (c)    => this._handleRematch(c));
    this.onMessage('ping', (c, d) => {
      const _t0 = process.hrtime.bigint();
      c.send('pong', { t: d?.t });
      const handlerUs = Number(process.hrtime.bigint() - _t0) / 1e3;
      const now = Date.now();
      const prev = this._lastPingAt.get(c.sessionId) || now;
      const gapMs = now - prev;
      this._lastPingAt.set(c.sessionId, now);

      if (gapMs > PING_GAP_SPIKE_MS) {
        writeDiagnostic('ping_spike', {
          roomId: this.roomId,
          sessionId: c.sessionId,
          gapMs,
          clients: this.clients.length,
          mode: this._mode,
        });
      }

      this._pingCount++;
      if (VERBOSE_PING_LOG && this._pingCount % 10 === 0) {
        const avgSnapMs = this._snapCount
          ? (this._snapProcMs / this._snapCount).toFixed(2)
          : '—';
        console.log(
          `[Room ${this.roomId}] Ping#${this._pingCount} | ` +
          `pong dispatch: ${handlerUs.toFixed(1)}µs | ` +
          `gRPC snaps (last 10s): ${this._snapCount} | ` +
          `avg snap proc: ${avgSnapMs}ms | ` +
          `total snap CPU: ${this._snapProcMs.toFixed(2)}ms | ` +
          `clients: ${this.clients.length}`
        );
        this._snapProcMs = 0;
        this._snapCount  = 0;
      }
    });

    // All gameplay inputs are forwarded directly to C++ via gRPC stream.
    // Input: map client field names to proto field names.
    this.onMessage('input', (client, data) => {
      if (!this._stream || !data) return;
      const d = data.inputs || data;
      const cd = data.camDir || {};
      const cp = data.camPos || data.cam_pos || {};
      // Derive yaw/pitch from camDir vector so C++ grapple direction is correct
      const yaw   = Math.atan2(cd.x || 0, -(cd.z || 0));
      const pitch = Math.asin(Math.max(-1, Math.min(1, cd.y || 0)));
      const inputMsg = {
        room_id: this.roomId, player_id: client.sessionId,
        input: {
          seq:       data.seq   || 0,
          forward:   !!(d.w),
          backward:  !!(d.s),
          left:      !!(d.a),
          right:     !!(d.d),
          jump:      !!(d.space),
          cam_yaw:   yaw,
          cam_pitch: pitch,
        }
      };
      if (Number.isFinite(cp.x) && Number.isFinite(cp.y) && Number.isFinite(cp.z)) {
        inputMsg.input.cam_pos = { x: cp.x, y: cp.y, z: cp.z };
      }
      this._stream.send(inputMsg);
      // Cache latest cam yaw/pitch for grapple direction
      this._camYaw.set(client.sessionId,   yaw);
      this._camPitch.set(client.sessionId, pitch);
    });

    this.onMessage('grapple', (client) => {
      if (!this._stream) return;
      // Pass the last known cam orientation inside an input message first,
      // then send the grapple action so C++ uses the correct direction.
      this._stream.send({
        room_id: this.roomId, player_id: client.sessionId,
        grapple: {}
      });
    });

    this.onMessage('spawnBomb', (client, data) => {
      if (!this._stream || !data) return;
      this._stream.send({
        room_id: this.roomId, player_id: client.sessionId,
        spawn_bomb: {
          position: { x: data.position?.x || 0, y: data.position?.y || 0, z: data.position?.z || 0 },
          impulse:  { x: data.impulse?.x  || 0, y: data.impulse?.y  || 0, z: data.impulse?.z  || 0 },
        }
      });
    });

    this.onMessage('useGear', (client, data) => {
      if (!this._stream || !data) return;
      this._stream.send({
        room_id: this.roomId, player_id: client.sessionId,
        use_gear: {
          gear_type: data.gearName   || data.gear_type || '',
          cam_pos:   data.cameraPos  || data.cam_pos   || { x:0, y:0, z:0 },
          cam_dir:   data.cameraDir  || data.cam_dir   || { x:0, y:0, z:0 },
        }
      });
    });

    this.onMessage('parry', (client) => {
      if (!this._stream) return;
      this._stream.send({ room_id: this.roomId, player_id: client.sessionId, parry: {} });
    });
  }

  async onJoin(client, options) {
    let decoded;
    try { decoded = jwt.verify(options?.token, JWT_SECRET); }
    catch { client.leave(4001); return; }

    const user = await User.findById(decoded.userId)
      .select('username equippedSkin equippedGrapple equippedGear userPrefix prefixColor usernameColor skins');
    if (!user) { client.leave(4002); return; }

    const skinId      = _equippedId(user.skins?.player)   || user.equippedSkin   || 'default';
    const grappleId   = _equippedId(user.skins?.grapples) || user.equippedGrapple || 'default';
    const bombSkinId  = _equippedId(user.skins?.bombs)    || 'default';
    const gear        = user.equippedGear || 'sniper';

    const skinDef    = getSkin(skinId);
    const grappleDef = getGrapple(grappleId);
    const bombDef    = getBombSkin(bombSkinId);

    this._skinData.set(client.sessionId, { skinId, skinDef, grappleId, grappleDef, bombSkinId, bombDef, gear });
    this._playerNames.set(client.sessionId, {
      username:      user.username,
      userPrefix:    user.userPrefix    || '',
      prefixColor:   user.prefixColor   || '#00ffcc',
      usernameColor: user.usernameColor || '#ffffff',
    });

    client._userId  = decoded.userId;
    client._decoded = decoded;
    this._dbIds.set(client.sessionId, String(decoded.userId));

    await User.findByIdAndUpdate(decoded.userId, { status: 'In Game' });

    await this._grpc.addPlayer(this.roomId, {
      player_id:    client.sessionId,
      user_db_id:   decoded.userId,
      skin_id:      skinId,
      grapple_id:   grappleId,
      bomb_skin_id: bombSkinId,
      gear,
      spawn_index:  this.clients.length - 1,
    }).catch(e => console.warn('[BaseGameRoom] addPlayer gRPC error (C++ server down?):', e.message));

    client.send('init', {
      sessionId: client.sessionId,
      myId:      client.sessionId,
      isHost:    this.clients[0]?.sessionId === client.sessionId,
      username:  user.username,
    });

    if (!this._stream) this._openStream();
    if (this.clients.length >= this.maxClients) this._startVotePhase();
  }

  async onLeave(client) {
    const leaverSid = client.sessionId;
    const shouldForfeitOnLeave = (
      this._mode === 'ranked' &&
      this._matchStarted &&
      !this._matchResolved
    );

    if (shouldForfeitOnLeave) {
      const winnerClient = this.clients.find(c => c.sessionId !== leaverSid);
      if (winnerClient) {
        const winnerSid = winnerClient.sessionId;
        this._matchResolved = true;
        this._matchStarted = false;

        // Score disconnect as a forfeit before cleaning room-local session data.
        await this.onGameEnd(winnerSid, leaverSid)
          .catch(e => console.error('[BaseGameRoom] ranked forfeit ELO update error:', e));

        this.broadcast('gameEnd', {
          winner: this._getDbId(winnerSid),
          loser: this._getDbId(leaverSid),
          reason: 'disconnectForfeit',
        });

        // Force both sides out to avoid any stale post-forfeit room state.
        winnerClient.send('opponentDisconnected', { reason: 'opponentRefreshedForfeit' });
        setTimeout(() => {
          try { winnerClient.leave(4012); } catch {}
        }, 100);

        this.lock();
      }
    }

    await this._grpc.removePlayer(this.roomId, client.sessionId).catch(() => {});
    if (client._userId)
      await User.findByIdAndUpdate(client._userId, { status: 'Online' }).catch(() => {});
    this._skinData.delete(client.sessionId);
    this._playerNames.delete(client.sessionId);
    this._votes.delete(client.sessionId);
    this._rematches.delete(client.sessionId);
    this._dbIds.delete(client.sessionId);
    this._camYaw.delete(client.sessionId);
    this._camPitch.delete(client.sessionId);
  }

  onDispose() {
    this._stream?.close();
    this._stream = null;
    this._grpc.destroyRoom(this.roomId).catch(() => {});
    this._bridge.unsubscribeRoom(this.roomId);
  }

  // ── gRPC stream ────────────────────────────────────────────────────────────

  _openStream() {
    this._stream = this._grpc.openRoomStream(this.roomId, (msg) => {
      this._onServerMessage(msg);
    });
    // Send an identifying first message so C++ knows which room this stream is.
    this._stream.send({ room_id: this.roomId, player_id: '__gateway__' });
  }

  _onServerMessage(msg) {
    if (msg.payload === 'state') {
      const now = Date.now();
      if (this._lastStateMsgAtMs > 0) {
        const gapMs = now - this._lastStateMsgAtMs;
        if (gapMs > STATE_GAP_SPIKE_MS) {
          writeDiagnostic('state_gap_spike', {
            roomId: this.roomId,
            gapMs,
            clients: this.clients.length,
            mode: this._mode,
          });
        }
      }
      this._lastStateMsgAtMs = now;

      const snap = msg.state;
      this._applyStateSnapshot(snap);
      // Prevent over-patching at high authoritative tick rates.
      if (now - this._lastPatchAtMs >= ROOM_PATCH_MIN_INTERVAL_MS) {
        this.broadcastPatch();
        this._lastPatchAtMs = now;
      }
    } else if (msg.payload === 'event') {
      let data = {};
      try { data = JSON.parse(msg.event.json_payload); } catch {}
      this._handleGameEvent(msg.event.type, data);
    }
  }

  _applyStateSnapshot(snap) {
    if (!snap) return;
    const _t0 = Date.now();

    // ── Players ──────────────────────────────────────────────
    const incomingIds = new Set();
    for (const p of (snap.players || [])) {
      const id = p.player_id;
      if (!id) continue;
      incomingIds.add(id);

      let ps = this.state.players.get(id);
      if (!ps) {
        ps = new PlayerState();
        this.state.players.set(id, ps);
      }

      // Dirty-check every field: Colyseus only encodes changed fields into the
      // binary patch, but the dirty-flag setter still runs on every assignment.
      // Skipping unchanged writes keeps the patch small and reduces CPU overhead.
      const pos = p.position || {};
      const px = pos.x ?? 0, py = pos.y ?? 0, pz = pos.z ?? 0;
      if (ps.position.x !== px) ps.position.x = px;
      if (ps.position.y !== py) ps.position.y = py;
      if (ps.position.z !== pz) ps.position.z = pz;

      const vel = p.velocity || {};
      const vx = vel.x ?? 0, vy = vel.y ?? 0, vz = vel.z ?? 0;
      if (ps.velocity.x !== vx) ps.velocity.x = vx;
      if (ps.velocity.y !== vy) ps.velocity.y = vy;
      if (ps.velocity.z !== vz) ps.velocity.z = vz;

      const hp  = p.health   ?? ps.health;
      const alive = p.alive ?? ps.alive;
      const seq = p.last_seq ?? ps.lastSeq;
      if (ps.health  !== hp)  ps.health  = hp;
      if (ps.alive   !== alive) ps.alive = alive;
      if (ps.lastSeq !== seq) ps.lastSeq = seq;

      // Only write grapple anchor when active; stale values don't matter
      // because clients skip rendering the hook when active=false.
      const ga = !!p.grapple_active;
      if (ps.grapple.active !== ga) ps.grapple.active = ga;
      if (ga) {
        const gp = p.grapple_pos || {};
        const hx = gp.x ?? 0, hy = gp.y ?? 0, hz = gp.z ?? 0;
        if (ps.grapple.hx !== hx) ps.grapple.hx = hx;
        if (ps.grapple.hy !== hy) ps.grapple.hy = hy;
        if (ps.grapple.hz !== hz) ps.grapple.hz = hz;
      }
    }
    // Remove players that left
    for (const id of this.state.players.keys()) {
      if (!incomingIds.has(id)) this.state.players.delete(id);
    }

    // ── Bombs ─────────────────────────────────────────────────
    const incomingBombs = new Set();
    for (const b of (snap.bombs || [])) {
      const id = b.id;
      if (!id) continue;
      incomingBombs.add(id);

      let bs = this.state.bombs.get(id);
      if (!bs) {
        bs = new BombState(id, b.skin || 'default');
        this.state.bombs.set(id, bs);
      }

      const bp = b.pos || {};
      const bpx = bp.x ?? 0, bpy = bp.y ?? 0, bpz = bp.z ?? 0;
      if (bs.px !== bpx) bs.px = bpx;
      if (bs.py !== bpy) bs.py = bpy;
      if (bs.pz !== bpz) bs.pz = bpz;

      const br = b.rot || {};
      const rx = br.x ?? 0, ry = br.y ?? 0, rz = br.z ?? 0, rw = br.w ?? 1;
      if (bs.rx !== rx) bs.rx = rx;
      if (bs.ry !== ry) bs.ry = ry;
      if (bs.rz !== rz) bs.rz = rz;
      if (bs.rw !== rw) bs.rw = rw;
    }
    for (const id of this.state.bombs.keys()) {
      if (!incomingBombs.has(id)) this.state.bombs.delete(id);
    }

    if (snap.phase) this.state.phase = snap.phase;

    const elapsedMs = Date.now() - _t0;
    this._snapProcMs += elapsedMs;
    this._snapCount++;

    if (elapsedMs > SNAPSHOT_PROC_SPIKE_MS) {
      writeDiagnostic('snapshot_proc_spike', {
        roomId: this.roomId,
        elapsedMs,
        players: this.state.players.size,
        bombs: this.state.bombs.size,
        mode: this._mode,
      });
    }
  }

  // Returns the MongoDB user ID string for a session ID (or the session ID as fallback)
  _getDbId(sessionId) {
    return this._dbIds.get(sessionId) || sessionId;
  }

  _handleGameEvent(type, data) {
    switch (type) {
      case 'gameStart': {
        this._matchStarted = true;
        this._matchResolved = false;
        // C++ only sends { phase:"playing" }. Inject both player session IDs
        // and their DB IDs so clients can render opponents and load skins.
        const clientIds = this.clients.map(c => c.sessionId);
        const enriched = {
          ...data,
          hostId:   clientIds[0],
          guestId:  clientIds[1] || null,
          hostDbId: this._getDbId(clientIds[0]),
          guestDbId: clientIds[1] ? this._getDbId(clientIds[1]) : null,
        };
        this.broadcast('gameStart', enriched);
        break;
      }
      case 'gameEnd': {
        this._matchStarted = false;
        this._matchResolved = true;
        // Remap session IDs to DB user IDs so clients can compare with their own DB ID
        const enrichedEnd = { ...data };
        if (data.winner) enrichedEnd.winner = this._getDbId(data.winner);
        if (data.loser)  enrichedEnd.loser  = this._getDbId(data.loser);
        // Ranked rooms should not be reused as an implicit queue after a match ends.
        // Players must explicitly leave and requeue to be matched again.
        if (this._mode === 'ranked') {
          this.lock();
        }
        this.broadcast('gameEnd', enrichedEnd);
        // onGameEnd expects session IDs for in-room maps (ratings/dbIds by session).
        this.onGameEnd(data.winner, data.loser);
        break;
      }
      case 'playerHit': {
        // C++ sends: { targetId, sourceId, damage, newHealth }
        // Client expects: { playerId, damage, currentHealth }
        this.broadcast('playerHit', {
          playerId:      data.targetId,
          sourceId:      data.sourceId,
          damage:        data.damage,
          currentHealth: data.newHealth,
        });
        break;
      }
      case 'bombExploded': {
        // C++ may send pos as either [x,y,z] or {x,y,z} depending on producer.
        // Normalize to the object shape expected by clients.
        const rawPos = data.pos ?? data.position;
        const pos = Array.isArray(rawPos)
          ? { x: rawPos[0], y: rawPos[1], z: rawPos[2] }
          : (rawPos || {});
        this.broadcast('bombExploded', {
          id:       data.id,
          position: {
            x: Number(pos.x) || 0,
            y: Number(pos.y) || 0,
            z: Number(pos.z) || 0,
          },
          ownerId:  data.ownerId,
        });
        break;
      }
      case 'parryActivated':     this.broadcast('parryActivated',data); break;
      case 'attackParried':      this.broadcast('parrySuccess',  data); break;
      case 'gearPreview': {
        // C++ sends: { playerId, gearType, pos:[x,y,z], dir:[x,y,z], durationSec }
        // Client expects: { gearName, shooterId, position:{x,y,z}, direction:{x,y,z}, duration(ms) }
        const p = data.pos || [];
        const d = data.dir || [];
        this.broadcast('gearEffect', {
          gearName:  data.gearType,
          shooterId: data.playerId,
          position:  { x: p[0]||0, y: p[1]||0, z: p[2]||0 },
          direction: { x: d[0]||0, y: d[1]||0, z: d[2]||0 },
          duration:  (data.durationSec || 2) * 1000,
        });
        break;
      }
      case 'snipeLine': {
        // C++ sends: { from:[x,y,z], to:[x,y,z] } (or object vectors in some builds)
        // Client expects: { start:{x,y,z}, end:{x,y,z} }
        const fv = data.from || {};
        const tv = data.to   || {};
        const f = Array.isArray(fv) ? { x: fv[0], y: fv[1], z: fv[2] } : fv;
        const t = Array.isArray(tv) ? { x: tv[0], y: tv[1], z: tv[2] } : tv;
        this.broadcast('sniperLine', {
          start: { x: f.x || 0, y: f.y || 0, z: f.z || 0 },
          end:   { x: t.x || 0, y: t.y || 0, z: t.z || 0 },
        });
        break;
      }
      case 'particles': {
        const pv = data.pos || data.position || {};
        const p = Array.isArray(pv) ? { x: pv[0], y: pv[1], z: pv[2] } : pv;
        this.broadcast('particles', {
          position: { x: p.x || 0, y: p.y || 0, z: p.z || 0 },
          type: data.type || 'impact',
          count: data.count || 12,
        });
        break;
      }
      case 'playerDisconnected': this.broadcast('opponentDisconnected', data); break;
      case 'rematchStart':       this.broadcast('rematchStart',  data); break;
      case 'playerDied':         this.broadcast('playerDied',    data); break;
      default:                   this.broadcast(type,            data); break;
    }
  }

  // ── vote phase ─────────────────────────────────────────────────────────────

  _startVotePhase() {
    this.broadcast('mapVote', { maps: MAP_LIST, timeoutMs: 30_000 });
    this._voteTimeout = setTimeout(() => this._resolveVotes(), 30_000);
  }

  _handleVote(client, data) {
    this._votes.set(client.sessionId, data?.mapId);
    if (this._votes.size >= this.clients.length) {
      clearTimeout(this._voteTimeout);
      this._resolveVotes();
    }
  }

  _resolveVotes() {
    const [voteA, voteB] = [...this._votes.values()];
    const mapId = resolveVotes(voteA, voteB);
    const map   = getMap(mapId);
    this.broadcast('mapChosen', { mapId: map.id, mapName: map.name, skyColor: map.skyColor });
    setTimeout(() => this._beginGame(map), 500);
  }

  async _beginGame(map) {
    let fsPath;
    try { fsPath = mapFilePath(map.id); } catch(e) { console.error(`[BaseGameRoom ${this.roomId}] mapFilePath threw:`, e.message); return; }
    console.log(`[BaseGameRoom ${this.roomId}] _beginGame: map.id=${map.id} fsPath=${fsPath}`);
    const res = await this._grpc.beginGame(this.roomId, map.id, fsPath).catch(e => ({ ok: false, error: e.message }));
    console.log(`[BaseGameRoom ${this.roomId}] beginGame gRPC result: ok=${res.ok} error=${res.error || '(none)'}`);
    if (!res.ok) { console.error(`[BaseGameRoom ${this.roomId}] beginGame failed:`, res.error); return; }

    this.broadcast('loadMap', {
      glb: map.glb,
      collision: map.collision,
      spawnPoints: map.spawnPoints,
      skyColor: map.skyColor,
    });

    // Send skin and nametag data to each client.
    // skinInfo format: { [sessionId]: { ...skinDef, grapple: grappleDef, bombSkinId, gear } }
    // nametagInfo format: { sessionId, username, userPrefix, prefixColor, usernameColor }
    for (const client of this.clients) {
      const skinMap = {};
      for (const other of this.clients) {
        if (other.sessionId === client.sessionId) continue;
        const sd = this._skinData.get(other.sessionId);
        if (sd) {
          skinMap[other.sessionId] = {
            ...sd.skinDef,
            grapple:    sd.grappleDef,
            bombSkinId: sd.bombSkinId,
            gear:       sd.gear,
          };
        }
      }
      client.send('skinInfo', skinMap);

      for (const other of this.clients) {
        if (other.sessionId === client.sessionId) continue;
        const nd = this._playerNames.get(other.sessionId);
        if (nd) client.send('nametagInfo', { sessionId: other.sessionId, ...nd });
      }
    }
  }

  // ── rematch ────────────────────────────────────────────────────────────────

  _handleRematch(client) {
    this._rematches.add(client.sessionId);
    if (this._rematches.size >= this.clients.length) {
      this._rematches.clear();
      this._stream?.send({ room_id: this.roomId, player_id: client.sessionId, rematch: {} });
    }
  }

  // ── hook for subclasses ────────────────────────────────────────────────────

  onGameEnd(winnerId, loserId) {}
}

function _equippedId(skinsMap) {
  if (!skinsMap) return null;
  for (const [id, data] of Object.entries(skinsMap))
    if (data.equipped) return id;
  return null;
}

module.exports = BaseGameRoom;
