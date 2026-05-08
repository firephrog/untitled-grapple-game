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

struct DamageEntry {
    std::string playerId;
    int         damage;
};

/// Manages all live bomb bodies and their TTL-based detonation.
/// Mirrors BombSystem.js exactly.
class BombSystem {
public:
    /// Called when a bomb detonates.
    /// Provides centre position; caller resolves blast physics.
    using ExplodeCb = std::function<void(
        const std::string& bombId,
        float cx, float cy, float cz,
        const std::string& ownerId)>;

    explicit BombSystem(ExplodeCb cb) : _onExplode(std::move(cb)) {}

    /// Spawn a new bomb. Returns its stable string ID.
    std::string spawn(physics::RapierWorld& world,
                      float x, float y, float z,
                      float ix, float iy, float iz,
                      const std::string& ownerId,
                      const std::string& skinId);

    /// Tick all live bombs; detonate expired ones.
    void tick(physics::RapierWorld& world);

    /// Iterate live bombs: cb(id, px, py, pz, rx, ry, rz, rw, skinId).
    void forEachLive(
        physics::RapierWorld& world,
        const std::function<void(const std::string&,
                                 float,float,float,
                                 float,float,float,float,
                                 const std::string&)>& cb) const;

    /// Resolve explosion: apply impulse to all bodies in BLAST_RADIUS,
    /// return damage list for players in DAMAGE_RADIUS.
    static std::vector<DamageEntry> resolveExplosion(
        physics::RapierWorld&              world,
        const std::vector<uint64_t>&       allBodyIds,
        const std::unordered_map<uint64_t,std::string>& bodyToPlayer,
        float cx, float cy, float cz,
        const std::string& ownerId,
        const std::unordered_map<std::string,uint64_t>& playerToBody);

    void clear(physics::RapierWorld& world);

private:
    struct BombEntry {
        uint64_t    bodyId;
        std::string ownerId;
        std::string skinId;
        TimePoint   spawnTime;
    };

    std::unordered_map<std::string, BombEntry> _bombs;
    ExplodeCb _onExplode;
    uint64_t  _nextBombSeq = 0;
};

} // namespace systems
