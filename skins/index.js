'use strict';

// ── skins/index.js ────────────────────────────────────────────────────────────

// ── Player skins ──────────────────────────────────────────────
const SKINS = {
  default: {
    id:          'default',
    name:        'Default',
    description: 'The classic sphere.',
    glb:         null,
    scale:       1.0,
    eyeOffset:   1.0,
  },
  cube: {
    id:          'cube',
    name:        'Cube',
    description: "[Developer] phrog's preferred testing skin",
    glb:         '/skins/cube.glb',
    scale:       1.0,
    eyeOffset:   1.0,
    thumbnail:   '/skins/cube_thumb.jpg',
  },
  ghost: {
    id:          'ghost',
    name:        'Ghost',
    description: 'Spooky.',
    glb:         '/skins/ghost.glb',
    scale:       1.1,
    eyeOffset:   1.2,
  },
  robot: {
    id:          'robot',
    name:        'Robot',
    description: 'Beep boop.',
    glb:         '/skins/robot.glb',
    scale:       0.9,
    eyeOffset:   1.0,
  },
};

// ── Grapple skins ─────────────────────────────────────────────
// image: PNG with transparency, placed in client/static/skins/
//        Two planes are crossed at 90° using this image.
//        Recommended: 128x128 or 256x256 PNG.
// scale: hook cross size in world units
// color: rope cylinder hex color
const GRAPPLES = {
  default: {
    id:    'default',
    name:  'Default',
    image: null,         // null = plain box fallback
    scale: 0.6,
    color: 0x00ffff,
  },
  cyan: {
    id:    'cyan',
    name:  'Cyan',
    image: '/skins/grapple_cyan.png',
    localImage: '/skins/grapple_cyan_local.png',
    scale: 0.8,
    color: 0x28364f,
  },
  ghost: {
    id:    'ghost',
    name:  'Ghost',
    image: '/skins/grapple_ghost.png',
    scale: 0.7,
    color: 0xaaffee,
  },
  fire: {
    id:    'fire',
    name:  'Fire',
    image: '/skins/grapple_fire.png',
    scale: 0.6,
    color: 0xff4400,
  },
  // Add more grapple skins here
};

const TITLES = {
  player: {
    id:          'player',
    name:        'Player',
    prefixColor: '#b3b3b3',
    userColor:   '#ffffff',
    description: "Standard issue title",
  },
  tester: {
    id:         'tester',
    name:       'Tester',
    prefixColor:'#35f0ae',
    usernameColor:'#10c4ga',
    description:"Given to people who test the game"
  },
  developer: {
    id:          'developer',
    name:        'Developer',
    prefixColor: '#ba2323',
    userColor:   '#e8a92a',
    description: "phrog's own title. If you contribute enough code you can possibly recieve it",
  },
}

// ── Helpers ───────────────────────────────────────────────────

function getSkin(id)    { return SKINS[id]    || SKINS.default; }
function getGrapple(id) { return GRAPPLES[id] || GRAPPLES.default; }
function getTitle(id)   { return TITLES[id]   || TITLES.player; }

const TITLE_LIST   = Object.values(TITLES).map(({ id, prefix, prefixColor, userColor }) => ({ id, prefix, prefixColor, userColor}))
const SKIN_LIST    = Object.values(SKINS).map(({ id, name, description, glb, thumbnail }) => ({ id, name, description, glb, thumbnail }));
const GRAPPLE_LIST = Object.values(GRAPPLES).map(({ id, name, image }) => ({ id, name, image }));

module.exports = { SKINS, GRAPPLES, SKIN_LIST, GRAPPLE_LIST, getSkin, getGrapple };