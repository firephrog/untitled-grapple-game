#include "rapier_world.hpp"
#include "../config.hpp"

#include <fstream>
#include <stdexcept>
#include <nlohmann/json.hpp>

namespace physics {

RapierWorld::RapierWorld()
    : _world(rapier_bridge::new_world(Config::GRAVITY))
{}

void RapierWorld::loadTrimesh(const std::vector<float>&    vertices,
                               const std::vector<uint32_t>& indices)
{
    rust::Slice<const float>    vSlice{ vertices.data(), vertices.size() };
    rust::Slice<const uint32_t> iSlice{ indices.data(),  indices.size()  };
    _world->load_trimesh(vSlice, iSlice);
}

bool RapierWorld::loadFromFile(const std::string& path)
{
    std::ifstream f(path);
    if (!f.is_open()) return false;

    try {
        nlohmann::json j;
        f >> j;
        std::vector<float>    verts = j.at("vertices").get<std::vector<float>>();
        std::vector<uint32_t> idx   = j.at("indices").get<std::vector<uint32_t>>();
        loadTrimesh(verts, idx);
        return true;
    } catch (...) {
        return false;
    }
}

void RapierWorld::step(float dt) { _world->step_world(dt); }

uint64_t RapierWorld::createPlayerBody(float x, float y, float z)
{
    return _world->create_player_body(x, y, z);
}

uint64_t RapierWorld::createBombBody(float x, float y, float z,
                                      float ix, float iy, float iz)
{
    return _world->create_bomb_body(x, y, z, ix, iy, iz);
}

void RapierWorld::removeBody(uint64_t id) { _world->remove_body(id); }

// ── getters ──────────────────────────────────────────────────────────────────

RapierWorld::Vec3 RapierWorld::getPosition(uint64_t id) const
{
    auto v = _world->get_pos(id);
    return { v.x, v.y, v.z };
}

RapierWorld::Vec3 RapierWorld::getVelocity(uint64_t id) const
{
    auto v = _world->get_vel(id);
    return { v.x, v.y, v.z };
}

RapierWorld::Quat RapierWorld::getRotation(uint64_t id) const
{
    auto q = _world->get_rot(id);
    return { q.x, q.y, q.z, q.w };
}

// ── setters ──────────────────────────────────────────────────────────────────

void RapierWorld::setPosition(uint64_t id, float x, float y, float z)
{
    _world->set_pos(id, x, y, z);
}

void RapierWorld::setVelocity(uint64_t id, float x, float y, float z)
{
    _world->set_vel(id, x, y, z);
}

void RapierWorld::addForce(uint64_t id, float x, float y, float z)
{
    _world->add_force(id, x, y, z);
}

void RapierWorld::applyImpulse(uint64_t id, float x, float y, float z)
{
    _world->apply_impulse(id, x, y, z);
}

void RapierWorld::resetForces(uint64_t id) { _world->reset_forces(id); }

// ── queries ───────────────────────────────────────────────────────────────────

bool RapierWorld::isGrounded(uint64_t id) const
{
    return _world->is_grounded(id);
}

RapierWorld::RayHit RapierWorld::castRay(
    float ox, float oy, float oz,
    float dx, float dy, float dz,
    float maxToi,
    uint64_t excludeId) const
{
    auto h = _world->cast_ray(ox, oy, oz, dx, dy, dz, maxToi, excludeId);
    return { h.hit, h.toi, h.nx, h.ny, h.nz, h.body_id };
}

bool RapierWorld::hookHitsGeometry(float hx, float hy, float hz,
                                    uint64_t playerId) const
{
    return _world->hook_hits_geometry(hx, hy, hz, playerId);
}

std::vector<uint64_t> RapierWorld::bodiesInSphere(float cx, float cy, float cz,
                                                    float radius) const
{
    auto rv = _world->bodies_in_sphere(cx, cy, cz, radius);
    return std::vector<uint64_t>(rv.begin(), rv.end());
}

} // namespace physics
