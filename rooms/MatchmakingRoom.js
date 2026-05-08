'use strict';
/**
 * MatchmakingRoom  – extends BaseGameRoom with ELO tracking.
 *
 * Game logic runs in C++. ELO is calculated here in Node.js after C++
 * signals gameEnd via the gRPC stream.
 */
const BaseGameRoom = require('./BaseGameRoom');
const jwt          = require('jsonwebtoken');
const { JWT_SECRET, MATCHMAKING_MAX_CLIENTS } = require('../config');
const User         = require('../models/User');
const { calculateNewElo } = require('../lib/RankingUtils');

class MatchmakingRoom extends BaseGameRoom {
  onCreate(options) {
    super.onCreate({
      ...options,
      maxClients: MATCHMAKING_MAX_CLIENTS,
      mode: options?.mode || 'matchmaking',
    });
    this._ratingMin    = options.filterBy?.ratingMin ?? 0;
    this._ratingMax    = options.filterBy?.ratingMax ?? 99999;
    this._playerRatings = new Map();  // sessionId → elo
    this._playerDbIds   = new Map();  // sessionId → MongoDB _id
  }

  async onJoin(client, options) {
    // Decode early to enforce same-account duplicate prevention
    let decoded;
    try { decoded = jwt.verify(options?.token, JWT_SECRET); }
    catch { client.leave(4001); return; }

    const accountId = String(decoded?.userId ?? decoded?.id ?? '');
    if (!accountId) { client.leave(4001); return; }

    // Block the same account joining twice
    for (const [sid, dbId] of this._playerDbIds)
      if (String(dbId) === accountId) { client.leave(4003); return; }

    const user = await User.findById(accountId).select('elo');
    if (user) this._playerRatings.set(client.sessionId, user.elo ?? 1000);

    await super.onJoin(client, options);
    this._playerDbIds.set(client.sessionId, accountId);
  }

  async onLeave(client, consented) {
    await super.onLeave(client, consented);
    this._playerRatings.delete(client.sessionId);
    this._playerDbIds.delete(client.sessionId);
  }

  /**
   * Called by BaseGameRoom when C++ emits gameEnd.
   * winnerId / loserId are WebSocket session IDs.
   */
  async onGameEnd(winnerId, loserId) {
    const winnerElo = this._playerRatings.get(winnerId) ?? 1000;
    const loserElo  = this._playerRatings.get(loserId)  ?? 1000;

    const { RANKED_K_FACTOR_HIGH, RANKED_K_FACTOR_LOW, RANKED_ELO_THRESHOLD } = require('../config');
    const kWinner = winnerElo >= RANKED_ELO_THRESHOLD ? RANKED_K_FACTOR_HIGH : RANKED_K_FACTOR_LOW;
    const kLoser  = loserElo  >= RANKED_ELO_THRESHOLD ? RANKED_K_FACTOR_HIGH : RANKED_K_FACTOR_LOW;

    const { newWinnerElo, newLoserElo } = calculateNewElo(winnerElo, loserElo, kWinner, kLoser);

    const winnerDbId = this._playerDbIds.get(winnerId);
    const loserDbId  = this._playerDbIds.get(loserId);

    await Promise.all([
      winnerDbId && User.findByIdAndUpdate(winnerDbId, { elo: newWinnerElo, $inc: { wins:   1 } }),
      loserDbId  && User.findByIdAndUpdate(loserDbId,  { elo: newLoserElo,  $inc: { deaths: 1 } }),
    ]).catch(e => console.error('[MatchmakingRoom] ELO update error:', e));
  }
}

module.exports = MatchmakingRoom;
