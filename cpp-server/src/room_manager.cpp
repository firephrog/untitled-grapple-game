#include "room_manager.hpp"

#include <cstdio>

namespace game {

RoomManager::RoomManager(redis::RedisClient& redis)
    : _redis(redis)
{}

bool RoomManager::createRoom(const std::string& roomId,
                              const std::string& mode)
{
    std::lock_guard<std::mutex> lock(_mu);
    if (_rooms.count(roomId)) return false;

    // SendCb is set later via setSendCallback once the gRPC stream is open.
    _rooms[roomId] = std::make_unique<GameRoom>(
        roomId, mode, nullptr, _redis);
    std::printf("[RoomManager] created room %s (mode=%s)\n",
                roomId.c_str(), mode.c_str());
    return true;
}

bool RoomManager::destroyRoom(const std::string& roomId)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    _rooms.erase(it);
    std::printf("[RoomManager] destroyed room %s\n", roomId.c_str());
    return true;
}

bool RoomManager::addPlayer(const std::string& roomId,
                             const PlayerInfo&  info)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    return it->second->addPlayer(info);
}

bool RoomManager::removePlayer(const std::string& roomId,
                                const std::string& playerId)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    it->second->removePlayer(playerId);
    return true;
}

bool RoomManager::beginGame(const std::string& roomId,
                             const std::string& mapId,
                             const std::string& mapFile)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    return it->second->beginGame(mapId, mapFile);
}

bool RoomManager::enqueueMessage(const ::game::RoomClientMessage& msg)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(msg.room_id());
    if (it == _rooms.end()) return false;
    it->second->enqueueMessage(msg);
    return true;
}

bool RoomManager::setSendCallback(const std::string& roomId,
                                   GameRoom::SendCb   cb)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    it->second->setSendCallback(std::move(cb));
    return true;
}

bool RoomManager::addSendCallback(const std::string& roomId,
                                   uint64_t           subscriberId,
                                   GameRoom::SendCb   cb)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    it->second->addSendCallback(subscriberId, std::move(cb));
    return true;
}

bool RoomManager::removeSendCallback(const std::string& roomId,
                                      uint64_t           subscriberId)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    if (it == _rooms.end()) return false;
    it->second->removeSendCallback(subscriberId);
    return true;
}

GameRoom* RoomManager::getRoom(const std::string& roomId)
{
    std::lock_guard<std::mutex> lock(_mu);
    auto it = _rooms.find(roomId);
    return it != _rooms.end() ? it->second.get() : nullptr;
}

} // namespace game
