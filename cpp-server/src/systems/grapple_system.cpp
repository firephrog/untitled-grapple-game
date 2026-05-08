#include "grapple_system.hpp"
#include "../config.hpp"

#include <cmath>
#include <algorithm>

namespace systems {

static float len3(float x, float y, float z)
{
    return std::sqrt(x * x + y * y + z * z);
}

static float dot3(float ax, float ay, float az,
                  float bx, float by, float bz)
{
    return ax * bx + ay * by + az * bz;
}

static void clampVel(float& vx, float& vy, float& vz, float maxSpeed)
{
    if (maxSpeed <= 0.0f) return;
    const float speed = len3(vx, vy, vz);
    if (speed <= maxSpeed || speed <= 1e-6f) return;
    const float s = maxSpeed / speed;
    vx *= s;
    vy *= s;
    vz *= s;
}

void GrappleSystem::activate(physics::RapierWorld& world,
                              uint64_t              bodyId,
                              float cdx, float cdy, float cdz,
                              float eyeOffsetY)
{
    if (_status == GrappleStatus::IDLE) {
        // Start shooting from eye level
        auto pos = world.getPosition(bodyId);
        _hx = pos.x; _hy = pos.y + eyeOffsetY; _hz = pos.z;
        _dx = cdx;    _dy = cdy;                _dz = cdz;
        _travelled = 0.0f;
        _status = GrappleStatus::SHOOTING;
    } else if (_status == GrappleStatus::STUCK) {
        _status = GrappleStatus::REELING;
    } else {
        reset(world, bodyId);
    }
}

void GrappleSystem::tick(physics::RapierWorld& world,
    uint64_t              
    bodyId,
    float                 
    dt)
{
    switch (_status) {
        case GrappleStatus::SHOOTING:  _tickShooting(world, bodyId, dt);   break;
        case GrappleStatus::STUCK:     _tickConstraint(world, bodyId, dt); break;
        case GrappleStatus::REELING:   _tickConstraint(world, bodyId, dt); break;
        default: break;
    }
}

void GrappleSystem::reset(physics::RapierWorld& world, uint64_t bodyId)
{
    if (_status != GrappleStatus::IDLE) {
        // Preserve 90% of horizontal velocity, so doesnt hard stop
        auto vel = world.getVelocity(bodyId);
        world.setVelocity(bodyId, vel.x * 0.9f, vel.y, vel.z * 0.9f);
        world.resetForces(bodyId);
    }
    _status = GrappleStatus::IDLE;
}

// ── private ───────────────────────────────────────────────────────────────────

void GrappleSystem::_tickShooting(physics::RapierWorld& world,
                                   uint64_t              bodyId,
                                   float                 dt)
{
    const int   SUB   = 4;
    const float step  = Config::GRAPPLE_SPEED * dt;
    const float dStep = step / static_cast<float>(SUB);

    for (int i = 0; i < SUB; ++i) {
        _hx += _dx * dStep;
        _hy += _dy * dStep;
        _hz += _dz * dStep;
        _travelled += dStep;

        if (_travelled > Config::GRAPPLE_MAX) {
            reset(world, bodyId);
            return;
        }

        if (world.hookHitsGeometry(_hx, _hy, _hz, bodyId)) {
            auto pos = world.getPosition(bodyId);
            float dx = _hx - pos.x;
            float dy = _hy - pos.y;
            float dz = _hz - pos.z;
            _ropeLen = len3(dx, dy, dz);
            _status  = GrappleStatus::STUCK;
            return;
        }
    }
}

void GrappleSystem::_tickConstraint(physics::RapierWorld& world,
                                     uint64_t              bodyId,
                                     float                 dt)
{
    if (_status == GrappleStatus::REELING) {
        _ropeLen -= Config::REEL_SPEED * dt;
        if (_ropeLen <= Config::MIN_ROPE_LEN) {
            reset(world, bodyId);
            return;
        }
    }

    auto pos = world.getPosition(bodyId);
    float dx = _hx - pos.x;
    float dy = _hy - pos.y;
    float dz = _hz - pos.z;
    float dist = len3(dx, dy, dz);

    if (dist <= 1e-6f) return;

    float ndx = dx / dist;
    float ndy = dy / dist;
    float ndz = dz / dist;

    if (dist > _ropeLen) {
        auto vel = world.getVelocity(bodyId);

        // Taut-string behavior:
        // - STUCK: prevent moving farther away from the hook, but don't add
        //   constant pull toward the hook. Gravity then naturally creates a
        //   pendulum instead of an auto-swinging motorized rope.
        // - REELING: enforce inward radial speed (reel in).
        const float radialVel = dot3(vel.x, vel.y, vel.z, ndx, ndy, ndz);
        float minInwardRadial = (_status == GrappleStatus::REELING)
            ? Config::REEL_SPEED
            : 0.0f;

        // Small anti-stretch correction only when actually stretched.
        const float stretch = dist - _ropeLen;
        const float slop = 0.02f;
        if (stretch > slop) {
            const float invDt = (dt > 1e-6f) ? (1.0f / dt) : 0.0f;
            const float corrSpeed = std::min(stretch * invDt * 0.25f, Config::GRAPPLE_PULL_SPEED);
            minInwardRadial = std::max(minInwardRadial, corrSpeed);
        }

        if (radialVel < minInwardRadial) {
            const float velCorr = (minInwardRadial - radialVel);
            vel.x += ndx * velCorr;
            vel.y += ndy * velCorr;
            vel.z += ndz * velCorr;
        }

        float newVx = vel.x;
        float newVy = vel.y;
        float newVz = vel.z;
        clampVel(newVx, newVy, newVz, Config::GRAPPLE_MAX_VEL);

        world.setVelocity(bodyId,
            newVx,
            newVy,
            newVz);
    }
}

} // namespace systems
