'use strict';

//Maps registry
//Defines maps and everything

const MAPS = {

    default: {
        id:             'test',
        name:           'test map',
        description:    'Map used for testing the maps system',
        glb:            '/maps/testMap1.glb',
        collision:      '/maps/testMap1.collision.json',
        skyColor:       0x87CEEB,  // Light sky blue
        spawnPoints: [
            { x: -10, y: 2, z: 0 },  // inside the map (map runs -22.9 to +22.9 on X/Z)
            { x:  10, y: 2, z: 0 },

        ],
    },
    stonelands: {
        id:             'stonelands',
        name:           'Stonelands',
        description:    'Void and rocks credit: Mihoi',
        glb:            '/maps/stonelands.glb',
        collision:      '/maps/stonelands.collision.json',
        skyColor:       0x1a1a2e,  // Dark void
        spawnPoints: [
          { x: 0, y: 2, z: -50 },
          { x: 0, y: 2, z: 40 },
        ],
    },
    orbit: {
        id:             'orbit',
        name:           'Orbit',
        description:    'Space. Credit: Jaeha',
        glb:            '/maps/orbit.glb',
        collision:      '/maps/orbit.collision.json',
        skyColor:       0x0a0e27,  // Deep space
        spawnPoints: [
          { x: 5.8, y: 26.6, z: 20 },
          { x: -20.8, y: 27, z: -57 },
        ],
    }
    // Add more maps here,
}

function getMap(id)    { 
  const map = MAPS[id] || MAPS.default;
  return {
    ...map,
    skyColor: map.skyColor || 0x87CEEB  // Default to light sky blue if not set
  };
}
function randomMapId() {
  const ids = Object.keys(MAPS);
  return ids[Math.floor(Math.random() * ids.length)];
}

function resolveVotes(voteA, voteB) {
  const a = MAPS[voteA] ? voteA : null;
  const b = MAPS[voteB] ? voteB : null;
  if (!a && !b) return randomMapId();
  if (!a)       return b;
  if (!b)       return a;
  if (a === b)  return a;
  return Math.random() < 0.5 ? a : b;
}

const MAP_LIST = Object.values(MAPS).map(({ id, name, description }) => ({
  id, name, description,
}));

module.exports = { MAPS, MAP_LIST, getMap, randomMapId, resolveVotes };