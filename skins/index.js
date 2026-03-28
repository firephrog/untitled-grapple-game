'use strict';

// ── skins/index.js ────────────────────────────────────────────────────────────
// Central registry of every skin available in the game.
//
// Each skin entry:
//   id          - unique string key, stored in MongoDB
//   name        - display name shown in the UI
//   description - flavour text
//   glb         - path under /public/skins/  (null = procedural sphere fallback)
//   scale       - uniform THREE.js scale applied to the loaded GLB root
//   eyeOffset   - how far above body origin the camera sits (tune per model)
//
// Unlocking is handled entirely in server code via unlockSkin(userId, skinId).
// No price or unlock-type logic lives here — add skins freely.
// ─────────────────────────────────────────────────────────────────────────────

const SKINS = {

  default: {
    id:          'default',
    name:        'Default',
    description: 'The classic sphere.',
    glb:         null,   // procedural sphere fallback
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

  // Add more skins here — drop the GLB in public/skins/ and register it.
};

// ── Helpers ───────────────────────────────────────────────────

/** Return full skin object, falling back to default for unknown ids. */
function getSkin(id) {
  return SKINS[id] || SKINS.default;
}

/** Catalogue safe to send to the client. */
const SKIN_LIST = Object.values(SKINS).map(({ id, name, description, glb }) => ({
  id, name, description, glb,
}));

module.exports = { SKINS, SKIN_LIST, getSkin };
