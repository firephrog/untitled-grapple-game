'use strict';
/**
 * gRPC client wrapper for the C++ game server.
 *
 * Exposes promise-based unary helpers and a factory for the bidirectional
 * RoomStream used by each room proxy.
 */
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.join(__dirname, '../cpp-server/proto/game.proto');

const pkgDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase:    true,
  longs:       String,
  enums:       String,
  defaults:    true,
  oneofs:      true,
});

const proto = grpc.loadPackageDefinition(pkgDef).game;

class GrpcClient {
  constructor(address) {
    this._address = address || process.env.CPP_SERVER_ADDR || '127.0.0.1:50051';
    this._client  = new proto.GameService(
      this._address,
      grpc.credentials.createInsecure(),
    );
    this._maxUnaryRetries = Number(process.env.GRPC_UNARY_RETRIES || 10);
    this._retryDelayMs = Number(process.env.GRPC_UNARY_RETRY_DELAY_MS || 250);
  }

  // ── unary helpers ──────────────────────────────────────────────────────────

  _call(method, req) {
    const attempt = (left) => new Promise((resolve, reject) => {
      this._client[method](req, (err, resp) => {
        if (!err) return resolve(resp);

        // Startup race hardening: C++ may still be binding when Node creates a room.
        if (err.code === grpc.status.UNAVAILABLE && left > 0) {
          return setTimeout(() => {
            attempt(left - 1).then(resolve).catch(reject);
          }, this._retryDelayMs);
        }

        reject(err);
      });
    });

    return attempt(this._maxUnaryRetries);
  }

  createRoom(roomId, mode)         { return this._call('CreateRoom',   { room_id: roomId, mode }); }
  destroyRoom(roomId)               { return this._call('DestroyRoom',  { room_id: roomId }); }
  addPlayer(roomId, playerInfo)     { return this._call('AddPlayer',    { room_id: roomId, ...playerInfo }); }
  removePlayer(roomId, playerId)    { return this._call('RemovePlayer', { room_id: roomId, player_id: playerId }); }
  beginGame(roomId, mapId, mapFile) { return this._call('BeginGame',    { room_id: roomId, map_id: mapId, map_file: mapFile }); }

  // ── bidirectional stream ───────────────────────────────────────────────────

  /**
   * Open a bidirectional RoomStream.
   *
   * @param {string}   roomId   Room to subscribe to.
   * @param {Function} onMsg    Called with each RoomServerMessage from the server.
   * @returns {{ send(msg): void, close(): void }}
   */
  openRoomStream(roomId, onMsg) {
    const stream = this._client.RoomStream();

    stream.on('data',  onMsg);
    stream.on('error', (err) => {
      console.error(`[GrpcClient] RoomStream error for ${roomId}:`, err.message);
    });
    stream.on('end', () => {
      console.log(`[GrpcClient] RoomStream ended for ${roomId}`);
    });

    return {
      /**
       * Send a RoomClientMessage to the C++ server.
       * @param {object} msg – plain object matching RoomClientMessage proto.
       */
      send(msg) {
        try { stream.write(msg); }
        catch (e) { /* stream may be closing */ }
      },
      close() {
        try { stream.end(); }
        catch (e) { /* already closed */ }
      },
    };
  }
}

const _instances = new Map();

function _resolveAddress(role) {
  if (role === 'ffa') {
    return process.env.FFA_CPP_SERVER_ADDR || process.env.CPP_SERVER_ADDR || '127.0.0.1:50051';
  }
  return process.env.CPP_SERVER_ADDR || '127.0.0.1:50051';
}

function getGrpcClient(role = 'default') {
  const key = role || 'default';
  if (!_instances.has(key)) {
    _instances.set(key, new GrpcClient(_resolveAddress(role)));
  }
  return _instances.get(key);
}

module.exports = { GrpcClient, getGrpcClient };
