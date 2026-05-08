'use strict';

// Static gear definitions shared between routes and client config.
// Game simulation (snipe/mace execution) is handled by the C++ server.

const GEAR_REGISTRY = {
  sniper: {
    name: 'Sniper',
    description: 'High-damage hitscan weapon with 2-second preview',
    rarity: 'high-skill',
    damage: 50,
    cooldown: 15000,
    image: '/gear/sniper_thumb.png',
    glb: '/gear/sniper.glb',
    previewDuration: 2000,
    postFireDuration: 1000,
    scale: 1.0,
  },
  mace: {
    name: 'Mace',
    description: "Heavy melee weapon, dealing AOE damage proportional to the user's current speed. Three second charge-up",
    rarity: 'ultra-high-skill',
    damage: 10,
    cooldown: 10000,
    image: '/gear/mace_thumb.png',
    glb: '/gear/mace.glb',
    previewDuration: 500,
    postFireDuration: 1000,
    scale: 10.0,
    aoeRadius: 6.0,
    aoeScaleWithVelocity: true,
  },
};

module.exports = { GEAR_REGISTRY };
