#include "bomb_system.hpp"
#include "../config.hpp"

#include <cmath>
#include <random>
#include <sstream>
#include <iomanip>

namespace systems {

namespace {

std::string makeId(uint64_t seq)
{
    // Simple unique bomb ID: "bomb_<seq>"
    return "bomb_" + std::to_string(seq);
}

float len3(float x, float y, float z)
{
    return std::sqrt(x * x + y * y + z * z);
}

} // anonymous

std::string BombSystem::spawn(physics::RapierWorld& world,
                               float x, float y, float z,
                               float ix, float iy, float iz,
                               const std::string& ownerId,
                               const std::string& skinId)
{
    std::string id = makeId(_nextBombSeq++);
    uint64_t bodyId = world.createBombBody(x, y, z, ix, iy, iz);
    _bombs[id] = { bodyId, ownerId, skinId, Clock::now() };
    return id;
}

void BombSystem::tick(physics::RapierWorld& world)
{
    auto now = Clock::now();
    std::vector<std::string> expired;

    for (auto& [id, entry] : _bombs) {
        float elapsedMs = std::chrono::duration<float, std::milli>(
            now - entry.spawnTime).count();
        if (elapsedMs >= Config::BOMB_TTL_MS) {
            auto pos = world.getPosition(entry.bodyId);
            _onExplode(id, pos.x, pos.y, pos.z, entry.ownerId);
            world.removeBody(entry.bodyId);
            expired.push_back(id);
        }
    }
    for (auto& id : expired) _bombs.erase(id);
}

void BombSystem::forEachLive(
    physics::RapierWorld& world,
    const std::function<void(const std::string&,
                             float,float,float,
                             float,float,float,float,
                             const std::string&)>& cb) const
{
    for (auto& [id, entry] : _bombs) {
        auto pos = world.getPosition(entry.bodyId);
        auto rot = world.getRotation(entry.bodyId);
        cb(id, pos.x, pos.y, pos.z,
              rot.x, rot.y, rot.z, rot.w,
              entry.skinId);
    }
}

std::vector<DamageEntry> BombSystem::resolveExplosion(
    physics::RapierWorld&              world,
    const std::vector<uint64_t>&       allBodyIds,
    const std::unordered_map<uint64_t,std::string>& bodyToPlayer,
    float cx, float cy, float cz,
    const std::string& ownerId,
    const std::unordered_map<std::string,uint64_t>& playerToBody)
{
    // Apply blast impulse to all dynamic bodies in BLAST_RADIUS
    auto hit = world.bodiesInSphere(cx, cy, cz, Config::BLAST_RADIUS);
    for (uint64_t bid : hit) {
        auto pos = world.getPosition(bid);
        float dx = pos.x - cx;
        float dy = pos.y - cy;
        float dz = pos.z - cz;
        float d  = len3(dx, dy, dz);
        if (d < 1e-4f) d = 1e-4f;
        float strength = Config::BLAST_STRENGTH * (1.0f - d / Config::BLAST_RADIUS);
        world.applyImpulse(bid,
            (dx / d) * strength,
            (dy / d) * strength,
            (dz / d) * strength);
    }

    // Compute damage for players in DAMAGE_RADIUS
    std::vector<DamageEntry> damages;
    for (auto& [pid, bodyId] : playerToBody) {
        if (pid == ownerId) continue;  // no self-damage
        auto pos = world.getPosition(bodyId);
        float dx = pos.x - cx;
        float dy = pos.y - cy;
        float dz = pos.z - cz;
        float d  = len3(dx, dy, dz);
        if (d <= Config::DAMAGE_RADIUS) {
            int dmg = static_cast<int>(
                Config::BOMB_DAMAGE * (1.0f - d / Config::DAMAGE_RADIUS));
            damages.push_back({ pid, std::max(1, dmg) });
        }
    }
    return damages;
}

void BombSystem::clear(physics::RapierWorld& world)
{
    for (auto& [id, entry] : _bombs)
        world.removeBody(entry.bodyId);
    _bombs.clear();
}

} // namespace systems
