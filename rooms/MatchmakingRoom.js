'use strict';

// ── rooms/MatchmakingRoom.js ─────────────────────────────────────────────────
// Ranked matchmaking room.  Players are placed here automatically by the
// Colyseus matchmaker (filterBy / sortBy options on the client joinOrCreate call).
//
// CURRENT STATE: Stub — game logic is fully inherited from BaseGameRoom.
//
// TODO when implementing matchmaking:
//   1. Add a `rating` field to RoomState schema (int16)
//   2. Store player ratings in onCreate metadata
//   3. Override onGameEnd() to call your rating service (Elo, Glicko-2, etc.)
//   4. Use filterBy to match players by skill bracket
//   5. Add a ready-check countdown before _startGame()
//
// Client usage (when ready):
//   const room = await client.joinOrCreate('matchmaking', { rating: myRating });
// ─────────────────────────────────────────────────────────────────────────────

const { BaseGameRoom } = require('./BaseGameRoom');

// ── Placeholder rating service ───────────────────────────────────────────────
// Replace with a real DB call (Postgres, Redis, etc.) when you're ready.
const RatingService = {
  async getRating(sessionId) {
    // TODO: look up player rating from your database
    return 1000;  // default starting Elo
  },

  async updateRatings(winnerId, loserId, winnerRating, loserRating) {
    // TODO: Elo / Glicko-2 update + persist to DB
    const K = 32;
    const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    const newWinner = Math.round(winnerRating + K * (1 - expected));
    const newLoser  = Math.round(loserRating  + K * (0 - (1 - expected)));
    console.log(`[Rating] ${winnerId}: ${winnerRating} → ${newWinner}`);
    console.log(`[Rating] ${loserId}:  ${loserRating}  → ${newLoser}`);
    return { newWinner, newLoser };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

class MatchmakingRoom extends BaseGameRoom {

  async onCreate(opts = {}) {
    await super.onCreate(opts);

    // Store rating range this room accepts (set by matchmaker)
    this._ratingMin = opts.ratingMin ?? 0;
    this._ratingMax = opts.ratingMax ?? 9999;

    // Map of sessionId → rating for the two players this match
    this._playerRatings = new Map();
  }

  async onJoin(client, opts = {}) {
    // Fetch player rating before they fully join
    // (In production, validate against a signed JWT instead of trusting opts.rating)
    const rating = await RatingService.getrating(client.sessionId)
      .catch(() => 1000);
    this._playerRatings.set(client.sessionId, rating);

    return super.onJoin(client, opts);
  }

  onLeave(client, consented) {
    this._playerRatings.delete(client.sessionId);
    return super.onLeave(client, consented);
  }

  async onGameEnd(winnerId, loserId) {
    console.log(`[MatchmakingRoom ${this.roomId}] Game over. Winner: ${winnerId}`);

    const winnerRating = this._playerRatings.get(winnerId) ?? 1000;
    const loserRating  = this._playerRatings.get(loserId)  ?? 1000;

    try {
      await RatingService.updateRatings(winnerId, loserId, winnerRating, loserRating);
    } catch (err) {
      console.error('[MatchmakingRoom] Failed to update ratings:', err);
    }
  }
}

module.exports = { MatchmakingRoom };
