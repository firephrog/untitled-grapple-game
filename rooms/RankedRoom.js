'use strict';
/**
 * RankedRoom  – extends MatchmakingRoom.
 *
 * Skips map voting; picks a random map, broadcasts countdown, then starts.
 * C++ handles all simulation. ELO + DB writes happen in Node.js after game-end.
 */
const MatchmakingRoom = require('./MatchmakingRoom');
const { randomMapId, mapFilePath, getMap } = require('../maps');

const RANKED_COUNTDOWN_MS = 3000;

class RankedRoom extends MatchmakingRoom {
  onCreate(options) {
    super.onCreate({ ...options, mode: 'ranked' });
  }

  // Override: skip vote phase, go straight to countdown.
  _startVotePhase() {
    const mapId = randomMapId();
    const map   = getMap(mapId);
    console.log(`[RankedRoom ${this.roomId}] _startVotePhase: mapId=${mapId} map.id=${map.id} clients=${this.clients.length}`);
    this.broadcast('mapChosen', { mapId, mapName: map.name, skyColor: map.skyColor });
    setTimeout(() => this._startCountdown(map), 500);
  }

  _startCountdown(map) {
    if (this.clients.length < this.maxClients) {
      console.log(`[RankedRoom ${this.roomId}] _startCountdown aborted: clients=${this.clients.length}/${this.maxClients}`);
      return;
    }

    const players = {};
    for (const c of this.clients) {
      players[c.sessionId] = {
        sessionId: c.sessionId,
        userId: this._dbIds.get(c.sessionId) || null,
        username: this._playerNames.get(c.sessionId)?.username,
        elo: this._playerRatings?.get(c.sessionId) ?? 1000,
      };
    }
    console.log(`[RankedRoom ${this.roomId}] _startCountdown: map.id=${map.id} players=${JSON.stringify(Object.keys(players))}`);

    this.broadcast('countdownStart', { durationMs: RANKED_COUNTDOWN_MS, players });

    setTimeout(() => this._beginGame(map), RANKED_COUNTDOWN_MS);
  }

  async _beginGame(map) {
    if (this.clients.length < this.maxClients) {
      console.log(`[RankedRoom ${this.roomId}] _beginGame aborted: clients=${this.clients.length}/${this.maxClients}`);
      return;
    }
    return super._beginGame(map);
  }

  /**
   * ELO update emits an enriched gameEnd event with eloChange.
   * Extends MatchmakingRoom's onGameEnd which writes to DB.
   */
  async onGameEnd(winnerId, loserId) {
    const winnerElo = this._playerRatings?.get(winnerId) ?? 1000;
    const loserElo  = this._playerRatings?.get(loserId)  ?? 1000;

    await super.onGameEnd(winnerId, loserId);

    const { calculateNewElo } = require('../lib/RankingUtils');
    const { RANKED_K_FACTOR_HIGH, RANKED_K_FACTOR_LOW, RANKED_ELO_THRESHOLD } = require('../config');
    const kW = winnerElo >= RANKED_ELO_THRESHOLD ? RANKED_K_FACTOR_HIGH : RANKED_K_FACTOR_LOW;
    const kL = loserElo  >= RANKED_ELO_THRESHOLD ? RANKED_K_FACTOR_HIGH : RANKED_K_FACTOR_LOW;
    const { newWinnerElo } = calculateNewElo(winnerElo, loserElo, kW, kL);
    const eloChange = newWinnerElo - winnerElo;

    this.broadcast('rankedEloUpdate', { winnerId, eloChange, newElo: newWinnerElo });
  }
}

module.exports = RankedRoom;
