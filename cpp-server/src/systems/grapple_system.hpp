#pragma once
#include "../physics/rapier_world.hpp"
#include "player_controller.hpp"
#include <string>

namespace systems {

/// Per-player grapple hook state machine.
/// States: IDLE → SHOOTING → STUCK → REELING → IDLE
///
/// Mirrors GrappleSystem.js exactly.
class GrappleSystem {
public:
    GrappleSystem() = default;

    /// Toggle: IDLE→SHOOTING, STUCK→REELING, otherwise cancel.
    void activate(physics::RapierWorld& world,
                  uint64_t              bodyId,
                  float camDirX, float camDirY, float camDirZ,
                  float eyeOffsetY = 1.5f);

    /// Advance hook physics by one tick. Call before the physics step.
    void tick(physics::RapierWorld& world,
              uint64_t              bodyId,
              float dt);

    /// Hard-cancel (e.g. player died / left room).
    void reset(physics::RapierWorld& world, uint64_t bodyId);

    GrappleStatus status() const { return _status; }

    /// Hook world position (valid while SHOOTING / STUCK / REELING).
    float hookX() const { return _hx; }
    float hookY() const { return _hy; }
    float hookZ() const { return _hz; }

    bool  active() const { return _status != GrappleStatus::IDLE; }

private:
    void _tickShooting(physics::RapierWorld& world, uint64_t bodyId, float dt);
    void _tickConstraint(physics::RapierWorld& world, uint64_t bodyId, float dt);

    GrappleStatus _status    = GrappleStatus::IDLE;
    float         _hx        = 0.0f;
    float         _hy        = 0.0f;
    float         _hz        = 0.0f;
    float         _dx        = 0.0f;  // shoot direction
    float         _dy        = 0.0f;
    float         _dz        = 0.0f;
    float         _ropeLen   = 0.0f;
    float         _travelled = 0.0f;
};

} // namespace systems
