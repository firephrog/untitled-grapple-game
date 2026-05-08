#pragma once
#include "../physics/rapier_world.hpp"

namespace systems {

/// Input snapshot for one player for one tick.
struct PlayerInput {
    int   seq      = 0;
    bool  forward  = false;
    bool  backward = false;
    bool  left     = false;
    bool  right    = false;
    bool  jump     = false;
    float camYaw   = 0.0f;   // radians
    float camPitch = 0.0f;
    float camX     = 0.0f;
    float camY     = 0.0f;
    float camZ     = 0.0f;
};

enum class GrappleStatus { IDLE, SHOOTING, STUCK, REELING };

/// Apply WASD/jump movement to a physics body.
/// Mirrors PlayerController.js exactly.
void applyMovement(physics::RapierWorld& world,
                   uint64_t              bodyId,
                   const PlayerInput&    input,
                   bool                  grounded,
                   GrappleStatus         grappleStatus);

} // namespace systems
