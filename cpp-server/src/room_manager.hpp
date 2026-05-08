#pragma once
#include "game_room.hpp"
#include "redis_client.hpp"

#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace game {

/// Thread-safe registry of active GameRooms.
class RoomManager {
public:
    explicit RoomManager(redis::RedisClient& redis);

    // ── room lifecycle ────────────────────────────────────────────────────────

    bool createRoom(const std::string& roomId,
                    const std::string& mode);
    bool destroyRoom(const std::string& roomId);

    // ── player lifecycle ──────────────────────────────────────────────────────

    bool addPlayer(const std::string& roomId, const PlayerInfo& info);
    bool removePlayer(const std::string& roomId, const std::string& playerId);

    bool beginGame(const std::string& roomId,
                   const std::string& mapId,
                   const std::string& mapFile);

    // ── messaging ─────────────────────────────────────────────────────────────

    bool enqueueMessage(const ::game::RoomClientMessage& msg);

    /// Set (or replace) the send callback for a room.
    bool setSendCallback(const std::string& roomId,
                         GameRoom::SendCb   cb);
    bool addSendCallback(const std::string& roomId,
                         uint64_t           subscriberId,
                         GameRoom::SendCb   cb);
    bool removeSendCallback(const std::string& roomId,
                            uint64_t           subscriberId);

    // ── accessors ─────────────────────────────────────────────────────────────

    GameRoom* getRoom(const std::string& roomId);

private:
    mutable std::mutex                                    _mu;
    std::unordered_map<std::string, std::unique_ptr<GameRoom>> _rooms;
    redis::RedisClient& _redis;
};

} // namespace game
