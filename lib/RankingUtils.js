'use strict';

/**
 * Rank tiers based on ELO
 * No rank: 0-200
 * Bronze: 200-400
 * Gold: 400-700
 * Diamond: 700-1000
 * Platinum: 1000-1500
 * Champion: 1500+
 */
const RANK_TIERS = [
  { min: 0,    max: 200,  name: 'No Rank',  color: '#888888' },
  { min: 200,  max: 400,  name: 'Bronze',   color: '#CD7F32' },
  { min: 400,  max: 700,  name: 'Gold',     color: '#FFD700' },
  { min: 700,  max: 1000, name: 'Diamond',  color: '#00FFFF' },
  { min: 1000, max: 1500, name: 'Platinum', color: '#E5E4E2' },
  { min: 1500, max: Infinity, name: 'Champion', color: '#FF4500' },
];

/**
 * Get rank info from ELO
 * @param {number} elo - Player's current ELO
 * @returns {Object} { name, color, elo, min, max }
 */
function getRankFromElo(elo) {
  const tier = RANK_TIERS.find(t => elo >= t.min && elo < t.max);
  if (!tier) {
    // Should not happen, but fallback to Champion
    return { name: 'Champion', color: '#FF4500', elo, min: 1500, max: Infinity };
  }
  return {
    name: tier.name,
    color: tier.color,
    elo: Math.floor(elo),
    min: tier.min,
    max: tier.max === Infinity ? 1500 : tier.max,
  };
}

/**
 * Calculate ELO change using standard Elo formula
 * K factor varies based on player's current ELO
 * 
 * @param {number} currentElo - Player's current ELO
 * @param {number} opponentElo - Opponent's ELO
 * @param {boolean} won - Whether the player won
 * @param {Object} kFactors - { high: K for low ELO, threshold: threshold ELO, low: K for high ELO }
 * @returns {number} ELO change (can be negative)
 */
function calculateEloChange(currentElo, opponentElo, won, kFactors = {}) {
  const K_HIGH = kFactors.high ?? 16;      // K factor for ELO < threshold
  const K_LOW = kFactors.low ?? 8;         // K factor for ELO >= threshold
  const THRESHOLD = kFactors.threshold ?? 1600;

  // Select K factor based on current ELO
  const K = currentElo < THRESHOLD ? K_HIGH : K_LOW;

  // Expected win rate using standard Elo formula
  const expected = 1 / (1 + Math.pow(10, (opponentElo - currentElo) / 400));

  // Actual result (1 for win, 0 for loss)
  const actual = won ? 1 : 0;

  // Calculate change
  const change = Math.round(K * (actual - expected));

  return change;
}

/**
 * Calculate new ELO after a match
 * Ranks cannot go backwards (one-way progression)
 * 
 * @param {number} currentElo - Player's current ELO before match
 * @param {number} opponentElo - Opponent's ELO
 * @param {boolean} won - Whether the player won
 * @param {Object} kFactors - ELO config
 * @returns {number} New ELO (cannot be lower than current rank minimum)
 */
function calculateNewElo(currentElo, opponentElo, won, kFactors = {}) {
  const change = calculateEloChange(currentElo, opponentElo, won, kFactors);

  // If losing, check if we're at a rank boundary
  if (change < 0) {
    const currentRank = getRankFromElo(currentElo);
    const minForCurrentRank = currentRank.min;

    // Cannot drop below current rank's minimum
    const newElo = Math.max(currentElo + change, minForCurrentRank);
    return newElo;
  }

  // Wins always increase ELO
  const newElo = currentElo + change;
  return newElo;
}

module.exports = {
  RANK_TIERS,
  getRankFromElo,
  calculateEloChange,
  calculateNewElo,
};
