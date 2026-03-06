'use strict';

// ── rooms/PrivateRoom.js ─────────────────────────────────────────────────────
// Invite-code 1v1 room. Generates a short 6-character join code stored as
// room metadata so clients never have to show the full Colyseus UUID.
// ─────────────────────────────────────────────────────────────────────────────

const { BaseGameRoom } = require('./BaseGameRoom');

function generateShortCode() {
  // 6 uppercase chars, excluding ambiguous chars (0/O, 1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

class PrivateRoom extends BaseGameRoom {
  async onCreate(opts = {}) {
    await super.onCreate(opts);
    this.maxClients = 2;

    // Short code stored in metadata — clients filter rooms by it
    const shortCode = generateShortCode();
    await this.setMetadata({ shortCode });
    console.log(`[PrivateRoom] Created with code: ${shortCode}`);
  }

  onJoin(client, opts = {}) {
    console.log('Client joined the room');
    const isFirst = this.clients.length === 1;
    const result  = super.onJoin(client, opts);

    // Send short code to the host immediately so they can display it
    if (isFirst) {
      client.send('roomCode', this.metadata.shortCode);
    }

    return result;
  }

  onLeave(client, consented) {
    return super.onLeave(client, consented);
  }

  onGameEnd(winnerId, loserId) {
    console.log(`[PrivateRoom ${this.metadata?.shortCode}] Winner: ${winnerId}`);
  }
}

module.exports = { PrivateRoom, generateShortCode };