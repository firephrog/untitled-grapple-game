'use strict';

// ── rooms/MatchmakingRoom.js ─────────────────────────────────────────────────
// Ranked matchmaking room. Players are placed here automatically by the
// Colyseus matchmaker (filterBy / sortBy options on the client joinOrCreate call).
//
// Implements full ELO ranking system with one-way rank progression.
// ─────────────────────────────────────────────────────────────────────────────

const { BaseGameRoom } = require('./BaseGameRoom');
const { calculateNewElo } = require('../lib/RankingUtils');
const User = require('../models/User');
const CFG = require('../config');
const jwt = require('jsonwebtoken');

class MatchmakingRoom extends BaseGameRoom {

  async onCreate(opts = {}) {
    await super.onCreate(opts);
    
    // Set correct maxClients for matchmaking rooms
    this.maxClients = CFG.MATCHMAKING_MAX_CLIENTS;

    // Store rating range this room accepts (set by matchmaker)
    this._ratingMin = opts.ratingMin ?? 0;
    this._ratingMax = opts.ratingMax ?? 9999;

    // Map of sessionId → { userId, rating } for the two players this match
    this._playerRatings = new Map();
  }

  async onJoin(client, opts = {}) {
    // Extract userId from token BEFORE checking client._userId
    // (BaseGameRoom.onJoin won't be called until after super.onJoin, so we need to do it here)
    if (opts.token && !client._userId) {
      try {
        const { userId } = jwt.verify(opts.token, CFG.JWT_SECRET);
        client._userId = userId;
      } catch (e) {
        console.error('[MatchmakingRoom] Failed to verify token:', e.message);
      }
    }
    
    // Prevent same account from joining twice
    if (client._userId) {
      for (const existingClient of this.clients) {
        if (existingClient._userId === client._userId && existingClient.sessionId !== client.sessionId) {
          console.warn(`[MatchmakingRoom ${this.roomId}] Same account attempted to join twice: ${client._userId}`);
          throw new Error('Cannot join with the same account twice');
        }
      }
    }
    
    // Fetch player ELO from database
    if (client._userId) {
      try {
        const user = await User.findById(client._userId).select('elo');
        if (user) {
          this._playerRatings.set(client.sessionId, {
            userId: client._userId,
            elo: user.elo || 100,
          });
        }
      } catch (err) {
        console.error('[MatchmakingRoom] Failed to fetch user ELO:', err);
        this._playerRatings.set(client.sessionId, {
          userId: client._userId,
          elo: 100,  // Default ELO
        });
      }
    }

    return super.onJoin(client, opts);
  }

  onLeave(client, consented) {
    this._playerRatings.delete(client.sessionId);
    return super.onLeave(client, consented);
  }

  async onGameEnd(winnerId, loserId) {

    const winnerData = this._playerRatings.get(winnerId);
    const loserData = this._playerRatings.get(loserId);

    if (!winnerData || !loserData) {
      console.error('[MatchmakingRoom] Missing player data for ELO update');
      return;
    }

    try {
      const winnerElo = winnerData.elo;
      const loserElo = loserData.elo;

      // Calculate new ELOs using proper formula with one-way rank progression
      const newWinnerElo = calculateNewElo(winnerElo, loserElo, true, {
        high: CFG.RANKED_K_FACTOR_HIGH,
        low: CFG.RANKED_K_FACTOR_LOW,
        threshold: CFG.RANKED_ELO_THRESHOLD,
      });
      const newLoserElo = calculateNewElo(loserElo, winnerElo, false, {
        high: CFG.RANKED_K_FACTOR_HIGH,
        low: CFG.RANKED_K_FACTOR_LOW,
        threshold: CFG.RANKED_ELO_THRESHOLD,
      });

      // Update database
      await User.findByIdAndUpdate(winnerData.userId, { elo: newWinnerElo });
      await User.findByIdAndUpdate(loserData.userId, { elo: newLoserElo });

    } catch (err) {
      console.error('[MatchmakingRoom] Failed to update ELOs:', err);
    }
  }
}

module.exports = { MatchmakingRoom };
