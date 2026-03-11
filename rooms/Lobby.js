'use strict';

const { Room }   = require('colyseus');
const mongoose   = require('mongoose');
const jwt        = require('jsonwebtoken');
const CFG        = require('../config');
const User = require('../models/User');

class Lobby extends Room {
  async onJoin(client, opts = {}) {
    if (opts.token) {
      try {
        const { userId } = jwt.verify(opts.token, CFG.JWT_SECRET);
        client._userId = userId;
        await User.findByIdAndUpdate(userId, { status: 'Online' });
      } catch {}
    }
  }

  async onLeave(client, consented) {
    if (client._userId) {
      await User.findByIdAndUpdate(client._userId, { status: 'Offline' });
    }
  }

  onDispose() {}
}

module.exports = { Lobby };