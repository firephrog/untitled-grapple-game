#pragma once
#include "../physics/rapier_world.hpp"

#include <chrono>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace systems {

using Clock     = std::chrono::steady_clock;
using TimePoint = Clock::time_point;

struct PlayerEntry {
    std::string playerId;
    uint64_t    bodyId;
};

/// Gear weapons: sniper (hitscan with 2 s preview delay) and
/// mace (AOE with 3 s charge, velocity-scaled damage).
///
/// Mirrors GearSystem.js exactly.
class GearSystem {
public:
    // ── callbacks ─────────────────────────────────────────────────────────────

    using SnipeHitCb   = std::function<void(
        const std::string& shooterId,
        const std::string& targetId,
        int                damage)>;

    using AoeDamageCb  = std::function<void(
        const std::string& shooterId,
        const std::string& targetId,
        int                damage)>;

    using PreviewCb    = std::function<void(
        const std::string& playerId,
        const std::string& gearType,
        float px, float py, float pz,
        float dx, float dy, float dz,
        float durationSec)>;

    using LineCb       = std::function<void(
        float fx, float fy, float fz,
        float tx, float ty, float tz)>;

    using ParticlesCb  = std::function<void(
        float px, float py, float pz,
        const std::string& type,
        int count)>;

    GearSystem(SnipeHitCb   onSnipeHit,
               AoeDamageCb  onAoeDamage,
               PreviewCb    onPreview,
               LineCb       onLine,
               ParticlesCb  onParticles)
        : _onSnipeHit(std::move(onSnipeHit))
        , _onAoeDamage(std::move(onAoeDamage))
        , _onPreview(std::move(onPreview))
        , _onLine(std::move(onLine))
        , _onParticles(std::move(onParticles))
    {}

    // ── actions ───────────────────────────────────────────────────────────────

    void snipe(const std::string& shooterId,
               float camX, float camY, float camZ,
               float dirX, float dirY, float dirZ,
               const std::vector<PlayerEntry>& players);

    void mace(const std::string& shooterId,
              uint64_t           shooterBodyId,
              physics::RapierWorld& world,
              const std::vector<PlayerEntry>& players);

    // ── tick ──────────────────────────────────────────────────────────────────

    /// Execute any gear whose preview/charge delay has elapsed.
    void tick(physics::RapierWorld& world);

    /// Update the aim direction and origin of any pending snipe for this player so the
    /// shot fires from where they are standing when it executes, not at press-time.
    void updatePendingDirection(const std::string& shooterId,
                                float cx, float cy, float cz,
                                float dx, float dy, float dz);

    // ── per-player cooldown tracking ──────────────────────────────────────────

    bool canSnipe(const std::string& playerId) const;
    bool canMace (const std::string& playerId) const;

    void resetCooldowns();

private:
    struct PendingSnipe {
        std::string          shooterId;
        float                camX, camY, camZ;
        float                dirX, dirY, dirZ;
        std::vector<PlayerEntry> players;
        TimePoint            execAt;
    };

    struct PendingMace {
        std::string          shooterId;
        uint64_t             shooterBodyId;
        std::vector<PlayerEntry> players;
        TimePoint            execAt;
    };

    void _executeSnipe(physics::RapierWorld& world, const PendingSnipe& s);
    void _executeMace (physics::RapierWorld& world, const PendingMace&  m);

    std::vector<PendingSnipe> _snipes;
    std::vector<PendingMace>  _maces;

    std::unordered_map<std::string, TimePoint> _snipeCooldown;
    std::unordered_map<std::string, TimePoint> _maceCooldown;

    SnipeHitCb  _onSnipeHit;
    AoeDamageCb _onAoeDamage;
    PreviewCb   _onPreview;
    LineCb      _onLine;
    ParticlesCb _onParticles;
};

} // namespace systems
