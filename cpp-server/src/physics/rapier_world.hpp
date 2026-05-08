#pragma once
#include <cstdint>
#include <string>
#include <vector>

// Include the cxx-generated header for the Rapier bridge.
// Path resolved by CMake via CXX_BRIDGE_INCLUDE_DIR.
#include "rapier-bridge/src/lib.rs.h"

namespace physics {

/// Thin C++ wrapper around the cxx Box<PhysicsWorld>.
/// Translates between C++ value types and the cxx POD bridge types.
class RapierWorld {
public:
    RapierWorld();
    ~RapierWorld() = default;

    // Non-copyable; move-only.
    RapierWorld(const RapierWorld&)            = delete;
    RapierWorld& operator=(const RapierWorld&) = delete;
    RapierWorld(RapierWorld&&)                 = default;
    RapierWorld& operator=(RapierWorld&&)      = default;

    /// Load a trimesh from flat vertex (xyz) and index arrays.
    void loadTrimesh(const std::vector<float>& vertices,
                     const std::vector<uint32_t>& indices);

    /// Load a trimesh from a Blender-exported collision JSON file
    /// (format: { "vertices": [...], "indices": [...] }).
    bool loadFromFile(const std::string& path);

    /// Advance physics by one fixed timestep (Config::DT).
    void step(float dt);

    /// Create a player sphere body at the given spawn position.
    /// Returns a stable body ID.
    uint64_t createPlayerBody(float x, float y, float z);

    /// Create a bomb sphere body with an initial impulse.
    uint64_t createBombBody(float x, float y, float z,
                            float ix, float iy, float iz);

    void removeBody(uint64_t id);

    // ── position / velocity ─────────────────────────────────────────────────

    struct Vec3 { float x, y, z; };
    struct Quat { float x, y, z, w; };

    Vec3 getPosition(uint64_t id) const;
    Vec3 getVelocity(uint64_t id) const;
    Quat getRotation(uint64_t id) const;

    void setPosition(uint64_t id, float x, float y, float z);
    void setVelocity(uint64_t id, float x, float y, float z);
    void addForce   (uint64_t id, float x, float y, float z);
    void applyImpulse(uint64_t id, float x, float y, float z);
    void resetForces (uint64_t id);

    // ── queries ─────────────────────────────────────────────────────────────

    bool isGrounded(uint64_t id) const;

    struct RayHit {
        bool     hit;
        float    toi;
        float    nx, ny, nz;
        uint64_t bodyId;   // 0 = terrain
    };

    RayHit castRay(float ox, float oy, float oz,
                   float dx, float dy, float dz,
                   float maxToi,
                   uint64_t excludeId = 0) const;

    bool hookHitsGeometry(float hx, float hy, float hz,
                          uint64_t playerId) const;

    std::vector<uint64_t> bodiesInSphere(float cx, float cy, float cz,
                                          float radius) const;

private:
    rust::Box<rapier_bridge::PhysicsWorld> _world;
};

} // namespace physics
