#include "gear_system.hpp"
#include "../config.hpp"

#include <cmath>
#include <algorithm>

namespace systems {

namespace {
    float len3(float x, float y, float z)
    {
        return std::sqrt(x*x + y*y + z*z);
    }

    bool onCooldown(
        const std::unordered_map<std::string, TimePoint>& map,
        const std::string& id,
        float cdMs)
    {
        auto it = map.find(id);
        if (it == map.end()) return false;
        float elapsed = std::chrono::duration<float, std::milli>(
            Clock::now() - it->second).count();
        return elapsed < cdMs;
    }
} // anonymous

// ── actions ───────────────────────────────────────────────────────────────────

void GearSystem::snipe(const std::string& shooterId,
                        float cx, float cy, float cz,
                        float dx, float dy, float dz,
                        const std::vector<PlayerEntry>& players)
{
    // Validate direction BEFORE consuming the cooldown so a zero-length
    // direction (client bug / race condition) doesn't silently burn the shot.
    float dlen = len3(dx, dy, dz);
    if (dlen < 1e-6f) return;

    if (onCooldown(_snipeCooldown, shooterId, Config::SNIPER_COOLDOWN_MS)) return;
    _snipeCooldown[shooterId] = Clock::now();
    dx /= dlen; dy /= dlen; dz /= dlen;

    auto execAt = Clock::now() +
        std::chrono::duration_cast<Clock::duration>(
            std::chrono::duration<float, std::milli>(Config::SNIPER_PREVIEW_MS));

    _snipes.push_back({ shooterId, cx, cy, cz, dx, dy, dz, players, execAt });

    float previewSec = Config::SNIPER_PREVIEW_MS / 1000.0f;
    _onPreview(shooterId, "sniper", cx, cy, cz, dx, dy, dz, previewSec);
}

void GearSystem::mace(const std::string& shooterId,
                       uint64_t           shooterBodyId,
                       physics::RapierWorld& /*world*/,
                       const std::vector<PlayerEntry>& players)
{
    if (onCooldown(_maceCooldown, shooterId, Config::MACE_COOLDOWN_MS)) return;
    _maceCooldown[shooterId] = Clock::now();

    auto execAt = Clock::now() +
        std::chrono::duration_cast<Clock::duration>(
            std::chrono::duration<float, std::milli>(Config::MACE_CHARGE_MS));

    _maces.push_back({ shooterId, shooterBodyId, players, execAt });

    auto pos = physics::RapierWorld::Vec3{ 0, 0, 0 }; // position fetched in tick
    _onPreview(shooterId, "mace", 0, 0, 0, 0, 0, 0,
               Config::MACE_CHARGE_MS / 1000.0f);
}

// ── direction update (called each tick from handleInput) ──────────────────────

void GearSystem::updatePendingDirection(const std::string& shooterId,
                                         float cx, float cy, float cz,
                                         float dx, float dy, float dz)
{
    float dlen = len3(dx, dy, dz);
    if (dlen < 1e-6f) return;
    dx /= dlen; dy /= dlen; dz /= dlen;
    for (auto& s : _snipes) {
        if (s.shooterId == shooterId) {
            s.camX = cx; s.camY = cy; s.camZ = cz;
            s.dirX = dx; s.dirY = dy; s.dirZ = dz;
        }
    }
}

// ── tick ──────────────────────────────────────────────────────────────────────

void GearSystem::tick(physics::RapierWorld& world)
{
    auto now = Clock::now();

    {
        auto it = _snipes.begin();
        while (it != _snipes.end()) {
            if (now >= it->execAt) {
                _executeSnipe(world, *it);
                it = _snipes.erase(it);
            } else {
                ++it;
            }
        }
    }
    {
        auto it = _maces.begin();
        while (it != _maces.end()) {
            if (now >= it->execAt) {
                _executeMace(world, *it);
                it = _maces.erase(it);
            } else {
                ++it;
            }
        }
    }
}

// ── cooldown checks ───────────────────────────────────────────────────────────

bool GearSystem::canSnipe(const std::string& pid) const
{
    return !onCooldown(_snipeCooldown, pid, Config::SNIPER_COOLDOWN_MS);
}

bool GearSystem::canMace(const std::string& pid) const
{
    return !onCooldown(_maceCooldown, pid, Config::MACE_COOLDOWN_MS);
}

void GearSystem::resetCooldowns()
{
    _snipeCooldown.clear();
    _maceCooldown.clear();
}

// ── execution ─────────────────────────────────────────────────────────────────

void GearSystem::_executeSnipe(physics::RapierWorld& world,
                                 const PendingSnipe&   s)
{
    // Offset ray origin slightly past the shooter to avoid self-hit
    float ox = s.camX + s.dirX * Config::SNIPER_SKIP_DIST;
    float oy = s.camY + s.dirY * Config::SNIPER_SKIP_DIST;
    float oz = s.camZ + s.dirZ * Config::SNIPER_SKIP_DIST;

    // Find the shooter's body ID to exclude
    uint64_t shooterBodyId = 0;
    for (auto& e : s.players)
        if (e.playerId == s.shooterId) { shooterBodyId = e.bodyId; break; }

    constexpr float rayMax = 1000.0f;
    auto hit = world.castRay(ox, oy, oz, s.dirX, s.dirY, s.dirZ,
                             rayMax, shooterBodyId);

    float lineEndX = ox + s.dirX * (hit.hit ? hit.toi : rayMax);
    float lineEndY = oy + s.dirY * (hit.hit ? hit.toi : rayMax);
    float lineEndZ = oz + s.dirZ * (hit.hit ? hit.toi : rayMax);
    _onLine(s.camX, s.camY, s.camZ, lineEndX, lineEndY, lineEndZ);

    if (!hit.hit || hit.bodyId == 0) return; // terrain or miss: VFX only

    // Identify target
    for (auto& e : s.players) {
        if (e.bodyId == hit.bodyId && e.playerId != s.shooterId) {
            _onSnipeHit(s.shooterId, e.playerId, Config::SNIPER_DAMAGE);
            return;
        }
    }
}

void GearSystem::_executeMace(physics::RapierWorld& world,
                                const PendingMace&    m)
{
    auto pos = world.getPosition(m.shooterBodyId);
    auto vel = world.getVelocity(m.shooterBodyId);
    float speed = len3(vel.x, vel.y, vel.z);

    // Damage scales: 10 + 60 * clamp(speed / 30, 0, 1)
    float factor  = std::min(speed / 30.0f, 1.0f);
    int   baseDmg = static_cast<int>(10.0f + 60.0f * factor);

    // AOE scan
    auto hits = world.bodiesInSphere(pos.x, pos.y, pos.z,
                                      Config::MACE_AOE_RADIUS);
    for (uint64_t bodyId : hits) {
        for (auto& e : m.players) {
            if (e.bodyId == bodyId && e.playerId != m.shooterId) {
                _onAoeDamage(m.shooterId, e.playerId, baseDmg);
                break;
            }
        }
    }

    if (_onParticles) {
        int particleCount = 20 + static_cast<int>(factor * 10.0f);
        _onParticles(pos.x, pos.y, pos.z, "mace_impact", particleCount);
    }
}

} // namespace systems
