#include "player_controller.hpp"
#include "../config.hpp"

#include <cmath>
#include <algorithm>

namespace systems {

namespace {
    // Project a direction onto the camera's horizontal plane and normalise.
    void projectHorizontal(float yaw, float ix, float iz,
                           float& outX, float& outZ)
    {
        // camera forward in XZ: (sin(yaw), 0, -cos(yaw)) (right-hand Y-up)
        float fwdX =  std::sin(yaw);
        float fwdZ = -std::cos(yaw);
        float rgtX =  std::cos(yaw);
        float rgtZ =  std::sin(yaw);

        outX = fwdX * iz + rgtX * ix;  // iz == forward(+1)/backward(-1)
        outZ = fwdZ * iz + rgtZ * ix;

        float len = std::sqrt(outX * outX + outZ * outZ);
        if (len > 1e-6f) { outX /= len; outZ /= len; }
    }
} // anonymous

void applyMovement(physics::RapierWorld& world,
                   uint64_t              bodyId,
                   const PlayerInput&    inp,
                   bool                  grounded,
                   GrappleStatus         grappleStatus)
{
    bool grappling = (grappleStatus == GrappleStatus::STUCK ||
                      grappleStatus == GrappleStatus::REELING);

    float ix = (inp.right ? 1.0f : 0.0f) - (inp.left    ? 1.0f : 0.0f);
    float iz = (inp.forward ? 1.0f : 0.0f) + (inp.backward ? -1.0f : 0.0f);
    bool  moving = (std::abs(ix) > 0.01f || std::abs(iz) > 0.01f);

    // Jump
    if (!grappling && inp.jump && grounded) {
        auto vel = world.getVelocity(bodyId);
        world.setVelocity(bodyId, vel.x, Config::JUMP_VEL, vel.z);
    }

    // While grappling, movement input applies lateral force in move direction.
    // This preserves anchored strafing without rotating rope orientation.
    if (grappling) {
        if (moving) {
            float mx, mz;
            projectHorizontal(inp.camYaw, ix, iz, mx, mz);
            world.addForce(bodyId,
                           mx * Config::GRAPPLE_STRAFE,
                           0.0f,
                           mz * Config::GRAPPLE_STRAFE);
        }
        return;
    }

    if (moving) {
        float mx, mz;
        projectHorizontal(inp.camYaw, ix, iz, mx, mz);

        auto vel = world.getVelocity(bodyId);
        world.setVelocity(bodyId,
                          mx * Config::WALK_SPEED,
                          vel.y,
                          mz * Config::WALK_SPEED);
    } else {
        // Friction drag
        auto vel = world.getVelocity(bodyId);
        float drag = grounded ? 12.0f : 2.0f;
        float hSpeedSq = vel.x * vel.x + vel.z * vel.z;

        if (hSpeedSq < 0.01f) {
            world.setVelocity(bodyId, 0.0f, vel.y, 0.0f);
        } else {
            float factor = std::max(0.0f, 1.0f - drag * Config::DT);
            world.setVelocity(bodyId, vel.x * factor, vel.y, vel.z * factor);
        }
    }
}

} // namespace systems
