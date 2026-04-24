/**
 * Client-side ranking utilities
 * Mirrors the server-side RankingUtils for consistent rank calculations
 */

const RANK_TIERS = [
  { min: 0,    max: 200,  name: 'No Rank',  color: '#888888' },
  { min: 200,  max: 400,  name: 'Bronze',   color: '#CD7F32' },
  { min: 400,  max: 700,  name: 'Gold',     color: '#FFD700' },
  { min: 700,  max: 1000, name: 'Diamond',  color: '#00FFFF' },
  { min: 1000, max: 1500, name: 'Platinum', color: '#E5E4E2' },
  { min: 1500, max: Infinity, name: 'Champion', color: '#FF4500' },
];

export function getRankFromElo(elo) {
  const tier = RANK_TIERS.find(t => elo >= t.min && elo < t.max);
  if (!tier) {
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

export function formatRankDisplay(elo) {
  const rank = getRankFromElo(elo);
  return {
    name: rank.name,
    color: rank.color,
    elo: rank.elo,
  };
}
