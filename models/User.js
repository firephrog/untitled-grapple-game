'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:      { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 32, match: /^[a-zA-Z0-9_]+$/ },
  passwordHash:  { type: String, required: true },
  email:         { type: String, default: null },
  wins:          { type: Number, default: 0 },
  deaths:        { type: Number, default: 0 },
  status:        { type: String, default: 'Offline' },
  userPrefix:    { type: String, default: 'Player' },
  usernameColor: { type: String, default: '#ffffff' },
  prefixColor:   { type: String, default: '#b3b3b3' },
  settings:      { type: Object, default: {} },
  friends:       { type: Object, default: {} },
  friendRequests:{ type: Object, default: {} },
  lastSeen:      { type: Date,   default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

