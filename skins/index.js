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
  missingTexture: {
    id:          'missingTexture',
    name:        'Missing Texture',
    description: '"Click FIX to Fix Problem" Given to you by [Developer] phrog when you discover a bug',
    glb:         '/skins/missingTextureSkin.glb',
    thumbnail:   '/skins/missingTextureSkin_thunb.png',
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
    image: '/skins/grapple_default.png',
    localImage: '/skins/grapple_default_local.png',         // fall back to defaault
    scale: 0.6,
    color: 0xffffff,
    description: "The standard grapple skin."
  },
  cyan: {
    id:    'cyan',
    name:  'Cyan',
    image: '/skins/grapple_cyan.png',
    localImage: '/skins/grapple_cyan_local.png',
    scale: 0.8,
    color: 0x28364f,
    description: "A cyan grapple skin."
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
  cheese: {
    id:    'cheese',
    name:  'Cheese Hook',
    image: '/skins/grapple_cheese.png',
    localImage: '/skins/grapple_cheese_local.png',
    scale: 0.6,
    color: 0xffcc00,
    description: "its cheese."
  },
  // Add more grapple skins here
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
    prefixColor: 'c7211a',
    usernameColor:'7a1c18',
    description: 'Go touch some grass. Get this by getting 50 wins',
  },
  champion: {
    id:            'champion',
    name:          'Champion',
    prefixColor:   '',
    usernameColor: '',
    description:   'You should really consider touching grass. Get this by getting 250 wins',
  },
  chosenone: {
  },
  //staff
  tester: {
    id:         'tester',
    name:       'Tester',
    prefixColor:'#35f0ae',
    usernameColor:'#10c4ga',
    description:"Given to people who test the game,
  },
  mapdesign: {
    id:         'mapdesign',
    name:       'Map Designer',
    prefixColor:'00ffc3',
    usernameColor:'07dbaa',
    description:'Given to people who design maps. Currently: Mihoi, HELLO',
  },
  developer: {
    id:          'developer',
    name:        'Developer',
    prefixColor: '#ba2323',
    usernameColor:   '#e8a92a',
    description: "phrog's own title. If you contribute enough code you can possibly recieve it",
  },
}

// ── Helpers ───────────────────────────────────────────────────

function getSkin(id)    { return SKINS[id]    || SKINS.default; }
function getGrapple(id) { return GRAPPLES[id] || GRAPPLES.default; }
function getTitle(id)   { return TITLES[id]   || TITLES.player; }

const TITLE_LIST   = Object.values(TITLES).map(({ id, name, prefixColor, usernameColor, description }) => ({ id, name, prefixColor, usernameColor, description }));
const SKIN_LIST    = Object.values(SKINS).map(({ id, name, description, glb, thumbnail }) => ({ id, name, description, glb, thumbnail }));
const GRAPPLE_LIST = Object.values(GRAPPLES).map(({ id, name, image, scale, color, description }) => ({ id, name, image, scale, color, description }));

module.exports = { SKINS, GRAPPLES, TITLES, SKIN_LIST, GRAPPLE_LIST, TITLE_LIST, getSkin, getGrapple, getTitle };
