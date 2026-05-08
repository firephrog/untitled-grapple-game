#include "game_server.hpp"
#include "room_manager.hpp"
#include "redis_client.hpp"
#include "config.hpp"
#include "ws_game_server.hpp"

#include <grpcpp/grpcpp.h>
#include <grpcpp/server_builder.h>

#include <cstdio>
#include <string>
#include <csignal>
#include <atomic>

static std::atomic<bool> g_shutdown{ false };

static void sigHandler(int) { g_shutdown = true; }

int main(int argc, char* argv[])
{
    std::signal(SIGINT,  sigHandler);
    std::signal(SIGTERM, sigHandler);

    // ── Redis ─────────────────────────────────────────────────────────────────

    const char* redisHost = []{ auto v = std::getenv("REDIS_HOST"); return v ? v : "127.0.0.1"; }();
    int         redisPort = 6379;
    if (const char* p = std::getenv("REDIS_PORT"))
        redisPort = std::stoi(p);

    redis::RedisClient redis(redisHost, redisPort);
    if (!redis.isConnected()) {
        std::fprintf(stderr, "[main] Redis connection failed – events won't be published\n");
        // Non-fatal: game still works, Redis pub/sub just won't fire.
    }

    // ── Room manager ──────────────────────────────────────────────────────────

    game::RoomManager roomManager(redis);
    game::WsGameServer wsServer(roomManager);

    const int grpcPort = [] {
        auto v = std::getenv("GRPC_PORT");
        return v ? std::stoi(v) : Config::GRPC_PORT;
    }();

    const uint16_t wsPort = static_cast<uint16_t>([] (int grpcPortValue) {
        auto v = std::getenv("WS_PORT");
        // Keep WS away from gRPC by default when running multiple instances.
        return v ? std::stoi(v) : (grpcPortValue + 1000);
    }(grpcPort));
    if (!wsServer.start(wsPort)) {
        std::fprintf(stderr, "[main] Failed to start WebSocket server on port %u\n", wsPort);
    }

    // ── gRPC server ───────────────────────────────────────────────────────────

    const std::string grpcPortStr = std::to_string(grpcPort);
    std::string addr = std::string("0.0.0.0:") + grpcPortStr;

    game::GameServiceImpl service(roomManager);

    grpc::ServerBuilder builder;
    builder.AddListeningPort(addr, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);
    builder.SetMaxReceiveMessageSize(64 * 1024);   // 64 KB
    builder.SetMaxSendMessageSize(256 * 1024);     // 256 KB

    auto server = builder.BuildAndStart();
    if (!server) {
        std::fprintf(stderr, "[main] Failed to start gRPC server on %s\n", addr.c_str());
        return 1;
    }

    std::printf("[main] gRPC game server listening on %s\n", addr.c_str());

    // Wait for shutdown signal
    while (!g_shutdown.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    std::printf("[main] Shutting down...\n");
    wsServer.stop();
    server->Shutdown();
    return 0;
}
