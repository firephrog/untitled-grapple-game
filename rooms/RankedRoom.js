'use strict';

// ── rooms/RankedRoom.js ────────────────────────────────────────────────────
// Ranked game room - inherits from BaseGameRoom but skips map voting.
// Automatically selects a random map and starts the countdown immediately
// after both players join.
// ──────────────────────────────────────────────────────────────────────────

const { MatchmakingRoom } = require('./MatchmakingRoom');
const { getMap, randomMapId } = require('../maps');
const CFG = require('../config');

class RankedRoom extends MatchmakingRoom {

  // Override to skip voting phase and go straight to countdown
  async onJoin(client, opts = {}) {
    // Call parent onJoin (handles skin loading, player state, same-account check, and voting phase)
    await super.onJoin(client, opts);
  }

  // Override voting phase to use random map instead
  _startVotePhase() {
    // For ranked mode, we don't vote - just pick a random map
    const mapId = randomMapId();
    const map = getMap(mapId);
    
    // Store the chosen map for _beginGameFromCountdown to use
    this._chosenMapId = mapId;
    

    
    this.broadcast('mapChosen', { mapId: map.id, mapName: map.name, skyColor: map.skyColor });
    
    // Wait 500ms then start countdown
    this.clock.setTimeout(() => this._startRankedCountdown(), 500);
  }

  // Start 3-second countdown before game begins
  _startRankedCountdown() {
    if (this.state.phase !== 'waiting') return;
    
    this.state.phase = 'countdown';
    const countdownMs = CFG.RANKED_COUNTDOWN_MS;
    

    
    // Send countdown message with spawn data for both players
    this.broadcast('countdownStart', { 
      durationMs: countdownMs,
      players: this._getCountdownPlayerData(),
    });
    
    // After countdown, start the game
    this.clock.setTimeout(() => this._beginGameFromCountdown(), countdownMs);
  }

  // Get player data for countdown screen
  _getCountdownPlayerData() {
    const result = {};
    
    for (const [sessionId, ps] of this.state.players.entries()) {
      const client = this.clients.find(c => c.sessionId === sessionId);
      if (!client || !client._userId) continue;
      
      // Find player spawn location (should be set in physics)
      const body = this._bodies?.get(sessionId);
      const spawnPos = body ? { x: body.translation().x, y: body.translation().y, z: body.translation().z } : null;
      
      result[sessionId] = {
        sessionId,
        health: ps.health,
        spawnPos,
      };
    }
    
    return result;
  }

  // Begin game after countdown (same as normal _beginGame but used here)
  async _beginGameFromCountdown() {
    if (this.state.phase !== 'countdown') return;

    // Get the map that was chosen earlier
    const mapId = this._chosenMapId || 'default';
    const map = getMap(mapId);

    await this._beginGame(map);
  }

  // Override to store chosen map for later
  async _beginGame(map) {
    this._chosenMapId = map.id;
    return super._beginGame(map);
  }

  // Override _endGame to send ELO data
  async _endGame(winnerId, loserId) {
    const { calculateNewElo } = require('../lib/RankingUtils');
    const User = require('../models/User');

    this.state.phase = 'ended';
    
    // Convert session IDs to database user IDs
    const winnerClient = this.clients.find(c => c.sessionId === winnerId);
    const loserClient = this.clients.find(c => c.sessionId === loserId);
    const winnerDbId = winnerClient?._userId;
    const loserDbId = loserClient?._userId;

    // Get current ELOs before update
    const winnerData = this._playerRatings.get(winnerId);
    const loserData = this._playerRatings.get(loserId);
    
    let newWinnerElo = winnerData?.elo || 100;
    let newLoserElo = loserData?.elo || 100;
    let winnerEloChange = 0;
    let loserEloChange = 0;

    if (winnerData && loserData) {
      // Calculate new ELOs
      newWinnerElo = calculateNewElo(winnerData.elo, loserData.elo, true, {
        high: CFG.RANKED_K_FACTOR_HIGH,
        low: CFG.RANKED_K_FACTOR_LOW,
        threshold: CFG.RANKED_ELO_THRESHOLD,
      });
      newLoserElo = calculateNewElo(loserData.elo, winnerData.elo, false, {
        high: CFG.RANKED_K_FACTOR_HIGH,
        low: CFG.RANKED_K_FACTOR_LOW,
        threshold: CFG.RANKED_ELO_THRESHOLD,
      });

      winnerEloChange = newWinnerElo - winnerData.elo;
      loserEloChange = newLoserElo - loserData.elo;
    }
    
    // Update stats and ELO asynchronously
    if (winnerDbId && loserDbId) {
      (async () => {
        try {
          await User.findByIdAndUpdate(winnerDbId, { $inc: { wins: 1 }, $set: { elo: newWinnerElo } });
          
          await User.findByIdAndUpdate(loserDbId, { $inc: { deaths: 1 }, $set: { elo: newLoserElo } });
          
          // Check and unlock any earned rewards for both players
          const { checkAndUnlockRewards } = require('../routes/skins');
          const winnerUnlocks = await checkAndUnlockRewards(winnerDbId);
          const loserUnlocks = await checkAndUnlockRewards(loserDbId);
          
          // Send updated unlock info to clients
          if (winnerUnlocks.length > 0 || loserUnlocks.length > 0) {
            this.broadcast('unlocksNotification', {
              winnerUnlocks,
              loserUnlocks,
            });
          }
        } catch (e) {
          console.error('Error updating player stats/unlocks:', e);
        }
      })();
    }

    // Send gameEnd with ELO data for ranked mode
    this.broadcast('gameEnd', { 
      winner: winnerDbId, 
      loser: loserDbId,
      eloChange: winnerDbId === winnerClient?._userId ? winnerEloChange : loserEloChange,
      newElo: winnerDbId === winnerClient?._userId ? newWinnerElo : newLoserElo,
    });
    
    // NOTE: Do NOT call this.onGameEnd() here - RankedRoom handles ELO updates
    // directly, and calling onGameEnd would trigger MatchmakingRoom's ELO update
    // with stale data, causing race conditions.
    
    // Clear rematch votes and start timeout
    this._rematches.clear();
    if (this._rematchTimer) this._rematchTimer.clear();
    this._rematchTimer = this.clock.setTimeout(() => {
      this.disconnect();
    }, 30000); // 30 second timeout for rematch decision
  }
}

module.exports = { RankedRoom };
