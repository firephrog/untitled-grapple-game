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
#include <cstdlib>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <thread>
#include <exception>

#ifdef _WIN32
#include <process.h>
#else
#include <unistd.h>
#endif

static std::atomic<bool> g_shutdown{ false };
static std::mutex g_diagMu;

static std::string diagLogPath()
{
    if (const char* p = std::getenv("CPP_DIAG_LOG_FILE")) {
        return std::string(p);
    }
    return std::string("logs/cpp-diagnostics.log");
}

static std::string isoNowUtc()
{
    using namespace std::chrono;
    const auto now = system_clock::now();
    const std::time_t tt = system_clock::to_time_t(now);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &tt);
#else
    gmtime_r(&tt, &tm);
#endif
    char buf[64]{};
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return std::string(buf);
}

static void appendDiag(const char* kind, const std::string& message)
{
    std::lock_guard<std::mutex> lock(g_diagMu);
    const std::string p = diagLogPath();
    std::filesystem::path fp(p);
    if (fp.has_parent_path()) {
        std::error_code ec;
        std::filesystem::create_directories(fp.parent_path(), ec);
    }

    std::ofstream out(p, std::ios::app);
    if (!out.is_open()) return;
#ifdef _WIN32
    const long long pid = static_cast<long long>(_getpid());
#else
    const long long pid = static_cast<long long>(getpid());
#endif
    out << isoNowUtc()
        << " pid=" << pid
        << " kind=" << kind
        << " " << message << "\n";
}

static void sigHandler(int sig)
{
    appendDiag("signal", std::string("signal=") + std::to_string(sig));
    g_shutdown = true;
}

static void terminateHandler()
{
    try {
        auto eptr = std::current_exception();
        if (eptr) {
            std::rethrow_exception(eptr);
        }
    } catch (const std::exception& e) {
        appendDiag("crash", std::string("terminate exception=") + e.what());
    } catch (...) {
        appendDiag("crash", "terminate unknown_exception");
    }
    std::_Exit(1);
}

int main(int argc, char* argv[])
{
    (void)argc;
    (void)argv;

    std::set_terminate(terminateHandler);
    std::signal(SIGINT,  sigHandler);
    std::signal(SIGTERM, sigHandler);
    appendDiag("process_start", "starting cpp server");

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
        appendDiag("ws_start_failed", std::string("port=") + std::to_string(wsPort));
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
        appendDiag("grpc_start_failed", std::string("addr=") + addr);
        return 1;
    }

    std::printf("[main] gRPC game server listening on %s\n", addr.c_str());
    appendDiag("grpc_start", std::string("addr=") + addr + " ws_port=" + std::to_string(wsPort));

    // Wait for shutdown signal
    while (!g_shutdown.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    std::printf("[main] Shutting down...\n");
    appendDiag("process_exit", "shutdown requested");
    wsServer.stop();
    server->Shutdown();
    return 0;
}
