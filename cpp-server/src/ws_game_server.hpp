#pragma once

#include "room_manager.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#endif

namespace game {

class WsGameServer {
public:
    explicit WsGameServer(RoomManager& rm);
    ~WsGameServer();

    bool start(uint16_t port);
    void stop();

private:
#ifdef _WIN32
    struct Session {
        SOCKET socket = INVALID_SOCKET;
        std::string roomId;
        std::string playerId;
        uint64_t subscriberId = 0;
        bool subscribed = false;
        std::mutex sendMutex;
    };

    void _acceptLoop();
    void _handleClient(SOCKET clientSocket);

    bool _doHandshake(SOCKET sock);
    bool _readFrame(SOCKET sock, std::string& payload, uint8_t& opcode);
    bool _sendText(SOCKET sock, const std::string& payload, std::mutex* sendMu);
    bool _sendJson(SOCKET sock, const nlohmann::json& j, std::mutex* sendMu);

    bool _handleClientMessage(Session& s, const nlohmann::json& msg);
    nlohmann::json _serializeServerMessage(const ::game::RoomServerMessage& msg);
#endif

private:
    RoomManager& _rm;
    std::atomic<bool> _running{false};
    std::atomic<uint64_t> _nextSubscriberId{1};

#ifdef _WIN32
    SOCKET _listenSocket = INVALID_SOCKET;
    std::thread _acceptThread;
#endif
};

} // namespace game
