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
    glb:         '/skins/players/cube.glb',
    scale:       1.0,
    eyeOffset:   1.0,
    thumbnail:   '/skins/players/cube_thumb.jpg',
  },
  ghost: {
    id:          'ghost',
    name:        'Ghost',
    description: 'Spooky.',
    glb:         null,  // File not found, uses fallback sphere
    scale:       1.1,
    eyeOffset:   1.2,
  },
  robot: {
    id:          'robot',
    name:        'Robot',
    description: 'Beep boop.',
    glb:         null,  // File not found, uses fallback sphere
    scale:       0.9,
    eyeOffset:   1.0,
  },
  missingTexture: {
    id:          'missingTexture',
    name:        'Missing Texture',
    description: '"Click FIX to Fix Problem" Given to you by [Developer] phrog when you discover a bug',
    glb:         '/skins/players/missingTexture.glb',
    thumbnail:   '/skins/players/missingTexture_thumb.png',
    scale:       1.0,
    eyeOffset:   1.0,
  },
  // Add more player skins her
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
    image: '/skins/grapples/grapple_default.png',
    localImage: '/skins/grapples/grapple_default_local.png',         // fall back to default
    scale: 0.6,
    color: 0xffffff,
    description: "The standard grapple skin."
  },
  cyan: {
    id:    'cyan',
    name:  'Cyan',
    image: '/skins/grapples/grapple_cyan.png',
    localImage: '/skins/grapples/grapple_cyan_local.png',
    scale: 0.8,
    color: 0x28364f,
    description: "A cyan grapple skin."
  },
  ghost: {
    id:    'ghost',
    name:  'Ghost',
    image: '/skins/grapples/grapple_ghost.png',
    scale: 0.7,
    color: 0xaaffee,
  },
  fire: {
    id:    'fire',
    name:  'Fire',
    image: '/skins/grapples/grapple_fire.png',
    scale: 0.6,
    color: 0xff4400,
  },
  cheese: {
    id:    'cheese',
    name:  'Cheese Hook',
    image: '/skins/grapples/grapple_cheese.png',
    localImage: '/skins/grapples/grapple_cheese_local.png',
    scale: 0.6,
    color: 0xffcc00,
    description: "its cheese."
  },
  // Add more grapple skins here
};

// ── Bomb skins ────────────────────────────────────────────────
// Base fallback is a sphere. Skins can override with GLB models.
const BOMB_SKINS = {
  default: {
    id:          'default',
    name:        'Classic',
    description: 'The classic bomb sphere.',
    glb:         null,  // null = fallback to sphere
    scale:       1.0,
  },
  c4: {
    id:          'c4',
    name:        'C4',
    description: 'A military-grade plastic explosive, used for demolition. Get this skin after 100 deaths.',
    thumbnail: '/skins/c4_local.png',
    glb:         '/skins/bombs/c4.glb',
    scale:       1.0,
  },
  // Add more bomb skins here
};

const TITLES = {
  //standard
  player: {
    id:          'player',
    name:        'Player',
    prefixColor: '#b3b3b3',
    usernameColor:   '#ffffff',
    description: "Standard issue title",
  },
  sweat: {
    id:          'sweat',
    name:        'Sweat',
    prefixColor: '#c7211a',
    usernameColor:'#7a1c18',
    description: 'Go touch some grass. Get this by getting 50 wins',
  },
  champion: {
    id:            'champion',
    name:          'Champion',
    prefixColor:   '#fa9e52',
    usernameColor: '#a07236',
    description:   'You should really consider touching grass. Get this by getting 250 wins',
  },
  chosenone: {
    id:            'chosenone',
    name:          'The Chosen One',
    prefixColor:   '#fff8ac',
    usernameColor: '#000000',
    description:   'Get this title by beating [Developer] phrog in a 1v1 25 times. It is entirely up to him if you get this.',
  },
  //staff
  tester: {
    id:         'tester',
    name:       'Tester',
    prefixColor:'#35f0ae',
    usernameColor: '#25ca90',
    description:"Given to people who test the game",
  },
  mapdesign: {
    id:         'mapdesign',
    name:       'Map Designer',
    prefixColor:'#00ffc3',
    usernameColor:'#07dbaa',
    description:'Given to people who design maps. Currently: Mihoi, HELLO',
  },
  developer: {
    id:          'developer',
    name:        'Developer',
    prefixColor: '#ba2323',
    usernameColor:   '#e8a92a',
    description: "phrog's own title. If you contribute enough code you can possibly recieve it",
  },
  //special titles
  investor: {
    id:          'investor',
    name:        'Investor',
    prefixColor: '#fff568',
    usernameColor:   '#f8ea22',
    description: 'W Leo. Given to people who donated to the creation of this game.',
  },
}

// ── Helpers ───────────────────────────────────────────────────

function getSkin(id)    { return SKINS[id]    || SKINS.default; }
function getGrapple(id) { return GRAPPLES[id] || GRAPPLES.default; }
function getBombSkin(id) { return BOMB_SKINS[id] || BOMB_SKINS.default; }
function getTitle(id)   { return TITLES[id]   || TITLES.player; }

const TITLE_LIST    = Object.values(TITLES).map(({ id, name, prefixColor, usernameColor, description }) => ({ id, name, prefixColor, usernameColor, description }));
const SKIN_LIST     = Object.values(SKINS).map(({ id, name, description, glb, thumbnail }) => ({ id, name, description, glb, thumbnail }));
const GRAPPLE_LIST  = Object.values(GRAPPLES).map(({ id, name, image, scale, color, description }) => ({ id, name, image, scale, color, description }));
const BOMB_SKIN_LIST = Object.values(BOMB_SKINS).map(({ id, name, description, glb, scale }) => ({ id, name, description, glb, scale }));

module.exports = { SKINS, GRAPPLES, BOMB_SKINS, TITLES, SKIN_LIST, GRAPPLE_LIST, BOMB_SKIN_LIST, TITLE_LIST, getSkin, getGrapple, getBombSkin, getTitle };