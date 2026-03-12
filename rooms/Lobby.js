'use strict';

const { Room }   = require('colyseus');
const mongoose   = require('mongoose');
const jwt        = require('jsonwebtoken');
const CFG        = require('../config');
const User = require('../models/User');

let lobbyInstance = null;

class Lobby extends Room {
  onCreate() {
    this._userSessions = new Map();
    lobbyInstance = this; // store reference
  }

  async onJoin(client, opts = {}) {
    if (opts.token) {
      try {
        const { userId } = jwt.verify(opts.token, CFG.JWT_SECRET);
        client._userId = userId;
        this._userSessions.set(userId.toString(), client);
        await User.findByIdAndUpdate(userId, { status: 'Online' });
      } catch {}
    }
  }

  async onLeave(client, consented) {
    if (client._userId) {
      this._userSessions.delete(client._userId.toString()); // ← missing
      await User.findByIdAndUpdate(client._userId, { status: 'Offline' });
    }
  }

  notifyUser(userId, type, data) {
    const client = this._userSessions.get(userId);
    if (client) client.send(type, data);
  }

  onDispose() {}
}

module.exports = { Lobby, getLobby: () => lobbyInstance };