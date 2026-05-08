'use strict';
/**
 * RedisGameBridge
 *
 * Subscribes to game:event:<roomId> channels published by the C++ server
 * so that multiple Node.js processes (or extra consumers like analytics) can
 * react to game events without going through gRPC.
 *
 * Usage:
 *   const bridge = new RedisGameBridge();
 *   bridge.subscribeRoom('room-123', (type, data) => { ... });
 *   bridge.unsubscribeRoom('room-123');
 */
const Redis = require('ioredis');

class RedisGameBridge {
  constructor(options) {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const retryBaseMs = parseInt(process.env.REDIS_RETRY_BASE_MS || '500', 10);
    const retryCapMs = parseInt(process.env.REDIS_RETRY_CAP_MS || '10000', 10);
    this._sub = new Redis({
      host,
      port,
      lazyConnect: true,
      // Pub/sub clients should not fail queued commands with a max retry cap.
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * retryBaseMs, retryCapMs),
      ...options,
    });
    this._callbacks = new Map(); // roomId → [callbacks]

    // Suppress unhandled error events — Redis will retry automatically.
    this._sub.on('error', (err) => {
      if (process.env.REDIS_VERBOSE) {
        console.warn('[RedisGameBridge] connection error (will retry):', err.message);
      }
    });

    this._sub.on('message', (channel, message) => {
      // channel format: "game:event:<roomId>"
      const parts   = channel.split(':');
      const roomId  = parts.slice(2).join(':');
      const cbs     = this._callbacks.get(roomId);
      if (!cbs) return;
      try {
        const parsed = JSON.parse(message);
        for (const cb of cbs) cb(parsed.type, parsed.data);
      } catch (e) {
        console.error('[RedisGameBridge] malformed event:', e.message);
      }
    });
  }

  async connect() {
    await this._sub.connect();
  }

  /**
   * Subscribe a callback to game events for a room.
   * Multiple callbacks per room are supported.
   */
  subscribeRoom(roomId, callback) {
    if (!this._callbacks.has(roomId)) {
      this._callbacks.set(roomId, []);
      this._sub.subscribe(`game:event:${roomId}`);
    }
    this._callbacks.get(roomId).push(callback);
  }

  /** Remove all callbacks for a room and unsubscribe from Redis. */
  unsubscribeRoom(roomId) {
    this._callbacks.delete(roomId);
    this._sub.unsubscribe(`game:event:${roomId}`);
  }

  /**
   * Subscribe to room-end events (game:end:<roomId>) for ELO updates.
   * Node.js rooms call this to get a one-shot notification when the game ends.
   */
  onGameEnd(roomId, callback) {
    const channel = `game:end:${roomId}`;
    const handler = (ch, msg) => {
      if (ch !== channel) return;
      this._sub.removeListener('message', handler);
      this._sub.unsubscribe(channel);
      try { callback(JSON.parse(msg)); }
      catch (e) { console.error('[RedisGameBridge] onGameEnd parse error:', e); }
    };
    this._sub.on('message', handler);
    this._sub.subscribe(channel);
  }

  disconnect() {
    this._sub.disconnect();
  }
}

let _instance = null;
function getRedisGameBridge() {
  if (!_instance) _instance = new RedisGameBridge();
  return _instance;
}

module.exports = { RedisGameBridge, getRedisGameBridge };
