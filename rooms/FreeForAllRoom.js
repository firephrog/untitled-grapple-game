'use strict';
/**
 * FreeForAllRoom  (up to 25 players, hourly map rotation)
 *
 * Thin proxy: all game simulation is in C++.
 * Node.js handles join/leave DB ops, skin loading, map rotation scheduling,
 * and relaying messages between WebSocket clients and the C++ gRPC server.
 */
const BaseGameRoom = require('./BaseGameRoom');
const User         = require('../models/User');
const { getSkin, getGrapple, getBombSkin } = require('../skins');
const { FFA_MAP_LIST, getFFAMap, randomFFAMapId, mapFilePath } = require('../maps');

const FFA_MAX_CLIENTS    = 25;
const MAP_ROTATION_MS    = 60 * 60 * 1000;   // 1 hour
const MAP_ROTATION_WARN  = 10_000;            // warn 10 s before rotation

class FreeForAllRoom extends BaseGameRoom {
  onCreate(options) {
    super.onCreate({ ...options, mode: 'ffa', maxClients: FFA_MAX_CLIENTS });
    this._rotationTimer = null;
    this._initFFA();
  }

  _initFFA() {
    const mapId = randomFFAMapId();
    const map   = getFFAMap(mapId);
    this._currentMap = map;
    // Begin game immediately (no vote phase for FFA)
    this._grpc.beginGame(this.roomId, map.id, mapFilePath(map.id))
      .then(r => {
        if (!r.ok) console.error('[FreeForAllRoom] beginGame failed:', r.error);
        else       this._scheduleMapRotation();
      })
      .catch(e => console.error('[FreeForAllRoom] beginGame error:', e));
  }

  // No vote phase for FFA
  _startVotePhase() {}

  // ── map rotation ───────────────────────────────────────────────────────────

  _scheduleMapRotation() {
    this._rotationTimer = setTimeout(() => {
      this.broadcast('mapRotationWarning', { secsRemaining: 10 });
      setTimeout(() => this._rotateMap(), MAP_ROTATION_WARN);
    }, MAP_ROTATION_MS - MAP_ROTATION_WARN);
  }

  _rotateMap() {
    const mapId = randomFFAMapId();
    const map   = getFFAMap(mapId);
    this._currentMap = map;

    this._grpc.beginGame(this.roomId, map.id, mapFilePath(map.id))
      .then((r) => {
        if (!r?.ok) {
          console.error('[FreeForAllRoom] rotate beginGame failed:', r?.error || 'unknown error');
          this._scheduleMapRotation();
          return;
        }
        this.broadcast('mapRotated', { mapId: map.id });
        this.broadcast('loadMap',    { glb: map.glb, collision: map.collision, spawnPoints: map.spawnPoints });
        this._scheduleMapRotation();
      })
      .catch((e) => {
        console.error('[FreeForAllRoom] rotate beginGame error:', e.message || e);
        this._scheduleMapRotation();
      });
  }

  // ── join / leave ───────────────────────────────────────────────────────────

  async onJoin(client, options) {
    await super.onJoin(client, options);
    const joinedName = this._playerNames.get(client.sessionId)?.username || 'A player';
    // If the game is already running, send current state to the new player
    if (this._currentMap) {
      client.send('loadMap', {
        glb:         this._currentMap.glb,
        collision:   this._currentMap.collision,
        spawnPoints: this._currentMap.spawnPoints,
      });

      // Send skin and nametag info for all existing players to the new joiner.
      // Send these BEFORE gameStart so the gameStart handler finds them in _pendingSkinInfo.
      const skinMapForNew    = {};
      const nametagMapForNew = {};
      for (const other of this.clients) {
        if (other.sessionId === client.sessionId) continue;
        const sd = this._skinData.get(other.sessionId);
        const nd = this._playerNames.get(other.sessionId);
        if (sd) {
          skinMapForNew[other.sessionId] = {
            ...sd.skinDef,
            grapple:    sd.grappleDef,
            bombSkinId: sd.bombSkinId,
            gear:       sd.gear,
          };
        }
        if (nd) nametagMapForNew[other.sessionId] = { sessionId: other.sessionId, ...nd };
      }
      if (Object.keys(skinMapForNew).length > 0)    client.send('skinInfo',          skinMapForNew);
      if (Object.keys(nametagMapForNew).length > 0) client.send('nametagInfoMulti',  nametagMapForNew);

      // C++ fires 'gameStart' during beginGame(), before any gRPC stream is open,
      // so FFA clients always miss it. Re-send it individually to each joiner.
      client.send('gameStart', { phase: 'playing' });

      // Broadcast the new player's skin and nametag info to all existing players.
      const sd = this._skinData.get(client.sessionId);
      const nd = this._playerNames.get(client.sessionId);
      if (sd) {
        this.broadcast('skinInfo', {
          [client.sessionId]: {
            ...sd.skinDef,
            grapple:    sd.grappleDef,
            bombSkinId: sd.bombSkinId,
            gear:       sd.gear,
          },
        }, { except: client });
      }
      if (nd) {
        this.broadcast('nametagInfoMulti', {
          [client.sessionId]: { sessionId: client.sessionId, ...nd },
        }, { except: client });
      }
    }
    this.broadcast('notification', {
      message: `[FFA] ${joinedName} joined the match`,
      duration: 3000,
      variant: 'join',
    });
    this.broadcast('playerCountUpdate', { count: this.clients.length });
  }

  async onLeave(client, consented) {
    await super.onLeave(client, consented);
    this.broadcast('playerCountUpdate', { count: this.clients.length });
    if (this.clients.length === 0) this.disconnect();
  }

  onDispose() {
    if (this._rotationTimer) clearTimeout(this._rotationTimer);
    super.onDispose();
  }

  // FFA has no ELO; game-end events just relay what C++ says.
  onGameEnd() {}
}

module.exports = FreeForAllRoom;
