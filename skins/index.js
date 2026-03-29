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
    description: 'Very boxy.',
    glb:         '/skins/cube.glb',
    scale:       1.0,
    eyeOffset:   1.0,
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
    color: 0x00cfff,
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

// ── Helpers ───────────────────────────────────────────────────

function getSkin(id)    { return SKINS[id]    || SKINS.default; }
function getGrapple(id) { return GRAPPLES[id] || GRAPPLES.default; }

const SKIN_LIST    = Object.values(SKINS).map(({ id, name, description, glb }) => ({ id, name, description, glb }));
const GRAPPLE_LIST = Object.values(GRAPPLES).map(({ id, name, image }) => ({ id, name, image }));

module.exports = { SKINS, GRAPPLES, SKIN_LIST, GRAPPLE_LIST, getSkin, getGrapple };