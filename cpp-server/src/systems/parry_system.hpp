#pragma once
#include <chrono>

namespace systems {

using Clock     = std::chrono::steady_clock;
using TimePoint = Clock::time_point;

/// Per-player parry state machine.
/// Mirrors ParrySystem.js exactly.
class ParrySystem {
public:
    /// Attempt to activate parry. Returns true if not on cooldown.
    bool activate();

    /// True if parry window is currently active and not yet expired.
    bool isAttackBlocked() const;

    /// Deactivate parry early (unused in current JS version, kept for symmetry).
    void deactivate();

    float cooldownRemainingMs() const;

private:
    bool      _active        = false;
    TimePoint _activatedAt;
    TimePoint _lastParryTime;
    bool      _hasParried    = false;
};

} // namespace systems
