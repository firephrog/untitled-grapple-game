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
        spawnPoints: [
            { x: -10, y: 2, z: 0 },  // inside the map (map runs -22.9 to +22.9 on X/Z)
            { x:  10, y: 2, z: 0 },

        ],
    },
    stonelands: {
        id:             'stonelands',
        name:           'Stonelands',
        description:    'Void and rocks',
        glb:            '/maps/stonelands.glb',
        collision:      '/maps/stonelands.collision.json',
        spawnPoints: [
          { x: 0, y: 2, z: -50 },
          { x: 0, y: 2, z: 40 },
        ],
    },
    // Add more maps here,
}

function getMap(id)    { return MAPS[id] || MAPS.default; }
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