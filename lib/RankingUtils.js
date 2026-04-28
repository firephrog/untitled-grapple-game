'use strict';


const RANK_TIERS = [
  { min: 0,    max: 125,  name: 'No Rank',  color: '#888888' },
  { min: 125,  max: 200,  name: 'Bronze',   color: '#CD7F32' },
  { min: 200,  max: 400,  name: 'Silver',   color: '#C0C0C0' },
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
  const kHigh = kFactors.high ?? 16;     
  const kLow = kFactors.low ?? 8;       
  const threshold = kFactors.threshold ?? 1600;

  // Select K factor based on elo
  const K = currentElo < threshold ? kHigh : kLow;

  // Use expected winrate
  const expected = 1 / (1 + Math.pow(10, (opponentElo - currentElo) / 400));

  // Result
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

  // Check rank boundaries
  if (change < 0) {
    const currentRank = getRankFromElo(currentElo);
    const minForCurrentRank = currentRank.min;

    const newElo = Math.max(currentElo + change, minForCurrentRank);
    return newElo;
  }

  // Increase elo
  const newElo = currentElo + change;
  return newElo;
}

module.exports = {
  RANK_TIERS,
  getRankFromElo,
  calculateEloChange,
  calculateNewElo,
};
