#pragma once
#include "physics/rapier_world.hpp"
#include "systems/player_controller.hpp"
#include "systems/grapple_system.hpp"
#include "systems/bomb_system.hpp"
#include "systems/parry_system.hpp"
#include "systems/gear_system.hpp"
#include "redis_client.hpp"

// gRPC-generated types
#include "game.grpc.pb.h"

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace game {

// ── player metadata stored server-side ───────────────────────────────────────

struct PlayerInfo {
    std::string playerId;     // WebSocket session id (matches client)
    std::string userDbId;     // MongoDB _id
    std::string skinId;
    std::string grappleId;
    std::string bombSkinId;
    std::string gear;         // "sniper" | "mace"
    int         spawnIndex = 0;
};

struct PlayerState {
    int   health   = 100;
    bool  alive    = true;
    int   lastSeq  = 0;
};

struct SpawnPoint {
    float x, y, z;
};

// ── GameRoom ─────────────────────────────────────────────────────────────────

/// One simulation room. Runs a 60 Hz game loop on a dedicated thread.
/// Sends RoomServerMessage events via a user-supplied callback (the gRPC
/// server-side stream writer in GameServer).
class GameRoom {
public:
    using SendCb = std::function<void(const ::game::RoomServerMessage&)>;

    explicit GameRoom(std::string id,
                      std::string mode,
                      SendCb      sendCallback,
                      redis::RedisClient& redis);
    ~GameRoom();

    // Non-copyable.
    GameRoom(const GameRoom&)            = delete;
    GameRoom& operator=(const GameRoom&) = delete;

    // ── lifecycle ─────────────────────────────────────────────────────────────

    bool beginGame(const std::string& mapId, const std::string& mapFile);
    bool addPlayer(const PlayerInfo& info);
    void removePlayer(const std::string& playerId);

    void setSendCallback(SendCb cb);
    void addSendCallback(uint64_t subscriberId, SendCb cb);
    void removeSendCallback(uint64_t subscriberId);

    // ── input ingestion (called from gRPC thread) ─────────────────────────────

    void enqueueMessage(const ::game::RoomClientMessage& msg);

    // ── accessors ─────────────────────────────────────────────────────────────

    const std::string& id()   const { return _id;   }
    const std::string& mode() const { return _mode; }
    int  playerCount()        const;

    std::string phase() const { return _phase; }

private:
    // ── game loop ─────────────────────────────────────────────────────────────

    void _run();
    void _tick(float dt);

    // ── input processing ──────────────────────────────────────────────────────

    void _processInputs();
    void _handleInput     (const std::string& pid, const ::game::PlayerInput&     msg);
    void _handleGrapple   (const std::string& pid, const ::game::GrappleAction&   msg);
    void _handleSpawnBomb (const std::string& pid, const ::game::SpawnBombAction& msg);
    void _handleUseGear   (const std::string& pid, const ::game::UseGearAction&   msg);
    void _handleParry     (const std::string& pid, const ::game::ParryAction&     msg);
    void _handleRematch   (const std::string& pid);

    // ── game logic ────────────────────────────────────────────────────────────

    void _applyDamage(const std::string& targetId,
                      const std::string& sourceId,
                      int                damage);
    void _endGame(const std::string& winnerId, const std::string& loserId);
    void _handleExplosion(const std::string& bombId,
                          float cx, float cy, float cz,
                          const std::string& ownerId);

    // ── state broadcasting ────────────────────────────────────────────────────

    void _broadcastState();
    void _sendEvent(const std::string& type, const std::string& jsonPayload);
    void _emit(const ::game::RoomServerMessage& msg);

    // ── helpers ───────────────────────────────────────────────────────────────

    std::vector<systems::PlayerEntry> _makePlayerEntries() const;
    SpawnPoint _spawnPoint(int index) const;
    void       _respawnPlayer(const std::string& pid, int spawnIndex);

    // ── members ───────────────────────────────────────────────────────────────

    std::string _id;
    std::string _mode;
    std::string _phase = "waiting";
    std::string _mapId;

    std::unique_ptr<physics::RapierWorld> _world;
    std::unique_ptr<systems::BombSystem>  _bombs;
    std::unique_ptr<systems::GearSystem>  _gear;

    // Per-player data
    std::unordered_map<std::string, PlayerInfo>           _infos;
    std::unordered_map<std::string, PlayerState>          _states;
    std::unordered_map<std::string, uint64_t>             _bodies;
    std::unordered_map<std::string, systems::GrappleSystem> _grapples;
    std::unordered_map<std::string, systems::ParrySystem>   _parries;
    std::unordered_map<std::string, systems::PlayerInput>   _inputs;
    std::unordered_map<uint64_t, std::string>             _bodyToPlayer;

    std::vector<SpawnPoint> _spawnPoints;

    // Thread-safe input queue
    std::mutex                                    _inputMutex;
    std::queue<::game::RoomClientMessage>         _inputQueue;

    // Players that joined mid-game and need a physics body spawned on the
    // game-loop thread (Rapier is not thread-safe).
    // Protected by _inputMutex (piggyback on the same lock).
    std::vector<std::string>                      _spawnQueue;

    // Game loop thread
    std::thread             _loopThread;
    std::atomic<bool>       _running{ false };

    int64_t                 _tickCount  = 0;
    int                     _patchTick  = 0;

    std::mutex                                  _sendCbMutex;
    std::unordered_map<uint64_t, SendCb>        _sendCbs;
    redis::RedisClient&     _redis;
};

} // namespace game
