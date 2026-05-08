#pragma once
// Game constants – mirrors config.js exactly.

namespace Config {

// Server
inline constexpr int    GRPC_PORT          = 50051;
inline constexpr int    TICK_RATE          = 100;  // 100 Hz → 10 ms ticks
inline constexpr float  DT                 = 1.0f / TICK_RATE;
inline constexpr int    PATCH_RATE_TICKS   = 1;    // broadcast every tick → 10 ms

// Physics
inline constexpr float  GRAVITY            = -25.0f;
inline constexpr float  PLAYER_RADIUS      = 1.0f;
inline constexpr float  PLAYER_MASS        = 1.0f;
inline constexpr float  WALK_SPEED         = 25.0f;
inline constexpr float  JUMP_VEL           = 10.0f;
inline constexpr float  LINEAR_DAMPING     = 0.2f;
inline constexpr float  VOID_Y             = -200.0f;
inline constexpr int    START_HEALTH       = 100;

// Grapple
inline constexpr float  GRAPPLE_SPEED      = 120.0f;
inline constexpr float  GRAPPLE_MAX        = 120.0f;
inline constexpr float  REEL_SPEED         = 30.0f;
inline constexpr float  GRAPPLE_PULL_SPEED = 35.0f;
inline constexpr float  GRAPPLE_PULL_SNAP  = 0.25f;
inline constexpr float  GRAPPLE_PULL_ZONE  = 2.5f;
inline constexpr float  MIN_ROPE_LEN       = 1.0f;
inline constexpr float  GRAPPLE_STRAFE     = 8.0f;
inline constexpr float  GRAPPLE_MAX_VEL    = 60.0f;

// Bomb
inline constexpr float  BOMB_RADIUS        = 0.5f;
inline constexpr float  BOMB_TTL_MS        = 500.0f;
inline constexpr float  BOMB_SPAWN_CD_MS   = 3000.0f;
inline constexpr float  BLAST_RADIUS       = 75.0f;
inline constexpr float  BLAST_STRENGTH     = 25.0f;
inline constexpr float  DAMAGE_RADIUS      = 25.0f;
inline constexpr int    BOMB_DAMAGE        = 40;

// Parry
inline constexpr float  PARRY_WINDOW_MS    = 2000.0f;
inline constexpr float  PARRY_COOLDOWN_MS  = 2000.0f;

// Gear
inline constexpr float  SNIPER_COOLDOWN_MS = 15000.0f;
inline constexpr float  MACE_COOLDOWN_MS   = 10000.0f;
inline constexpr float  SNIPER_PREVIEW_MS  = 2000.0f;
inline constexpr float  SNIPER_POST_MS     = 1000.0f;
inline constexpr float  MACE_CHARGE_MS     = 3000.0f;
inline constexpr int    SNIPER_DAMAGE      = 50;
inline constexpr float  MACE_AOE_RADIUS    = 6.0f;
inline constexpr float  SNIPER_SKIP_DIST   = 2.0f;

// ELO
inline constexpr int    RANKED_K_HIGH      = 16;
inline constexpr int    RANKED_K_LOW       = 8;
inline constexpr int    RANKED_ELO_THRESH  = 1600;

// Map
inline constexpr int    BLOCK_COUNT        = 30;

} // namespace Config
