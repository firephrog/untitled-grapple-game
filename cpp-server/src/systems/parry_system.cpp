#include "parry_system.hpp"
#include "../config.hpp"
#include <algorithm>

namespace systems {

bool ParrySystem::activate()
{
    if (_hasParried) {
        auto now = Clock::now();
        float elapsed = std::chrono::duration<float, std::milli>(
            now - _lastParryTime).count();
        if (elapsed < Config::PARRY_COOLDOWN_MS) return false;
    }

    _active      = true;
    _activatedAt = Clock::now();
    _lastParryTime = _activatedAt;
    _hasParried  = true;
    return true;
}

bool ParrySystem::isAttackBlocked() const
{
    if (!_active) return false;
    float elapsed = std::chrono::duration<float, std::milli>(
        Clock::now() - _activatedAt).count();
    return elapsed < Config::PARRY_WINDOW_MS;
}

void ParrySystem::deactivate() { _active = false; }

float ParrySystem::cooldownRemainingMs() const
{
    if (!_hasParried) return 0.0f;
    float elapsed = std::chrono::duration<float, std::milli>(
        Clock::now() - _lastParryTime).count();
    return std::max(0.0f, Config::PARRY_COOLDOWN_MS - elapsed);
}

} // namespace systems
