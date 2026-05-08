#include "game_server.hpp"

#include <cstdio>
#include <atomic>
#include <mutex>
#include <thread>
#include <condition_variable>
#include <deque>

namespace game {

GameServiceImpl::GameServiceImpl(RoomManager& rm)
    : _rm(rm)
{}

// ── unary RPCs ────────────────────────────────────────────────────────────────

grpc::Status GameServiceImpl::CreateRoom(
    grpc::ServerContext*             /*ctx*/,
    const ::game::CreateRoomRequest* req,
    ::game::CreateRoomResponse*      resp)
{
    bool ok = _rm.createRoom(req->room_id(), req->mode());
    resp->set_ok(ok);
    if (!ok) resp->set_error("room already exists");
    return grpc::Status::OK;
}

grpc::Status GameServiceImpl::DestroyRoom(
    grpc::ServerContext*              /*ctx*/,
    const ::game::DestroyRoomRequest* req,
    ::game::DestroyRoomResponse*      resp)
{
    resp->set_ok(_rm.destroyRoom(req->room_id()));
    return grpc::Status::OK;
}

grpc::Status GameServiceImpl::AddPlayer(
    grpc::ServerContext*            /*ctx*/,
    const ::game::AddPlayerRequest*  req,
    ::game::AddPlayerResponse*       resp)
{
    PlayerInfo info{
        req->player_id(),
        req->user_db_id(),
        req->skin_id(),
        req->grapple_id(),
        req->bomb_skin_id(),
        req->gear(),
        req->spawn_index(),
    };
    bool ok = _rm.addPlayer(req->room_id(), info);
    resp->set_ok(ok);
    if (!ok) resp->set_error("room not found");
    return grpc::Status::OK;
}

grpc::Status GameServiceImpl::RemovePlayer(
    grpc::ServerContext*               /*ctx*/,
    const ::game::RemovePlayerRequest*  req,
    ::game::RemovePlayerResponse*       resp)
{
    resp->set_ok(_rm.removePlayer(req->room_id(), req->player_id()));
    return grpc::Status::OK;
}

grpc::Status GameServiceImpl::BeginGame(
    grpc::ServerContext*            /*ctx*/,
    const ::game::BeginGameRequest*  req,
    ::game::BeginGameResponse*       resp)
{
    bool ok = _rm.beginGame(req->room_id(), req->map_id(), req->map_file());
    resp->set_ok(ok);
    if (!ok) resp->set_error("room not found or already started");
    return grpc::Status::OK;
}

// ── bidirectional stream ──────────────────────────────────────────────────────

grpc::Status GameServiceImpl::RoomStream(
    grpc::ServerContext*                                    ctx,
    grpc::ServerReaderWriter<::game::RoomServerMessage,
                              ::game::RoomClientMessage>*  stream)
{
    static std::atomic<uint64_t> s_nextSubscriberId{1};

    // The first message must be an input (or any message) that carries a room_id.
    // We read one message just to identify the room, then register a send callback
    // that writes to this stream.

    ::game::RoomClientMessage msg;
    if (!stream->Read(&msg)) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                            "expected at least one message to identify room");
    }

    const std::string roomId = msg.room_id();
    if (roomId.empty()) {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                            "room_id missing in first message");
    }

    // Register a non-blocking enqueue callback; a dedicated writer thread
    // performs stream->Write() so room simulation never stalls on socket I/O.
    std::mutex queueMu;
    std::condition_variable queueCv;
    std::deque<::game::RoomServerMessage> outQueue;
    bool stopWriter = false;

    std::thread writer([&]() {
        while (true) {
            ::game::RoomServerMessage out;
            {
                std::unique_lock<std::mutex> lock(queueMu);
                queueCv.wait(lock, [&]() {
                    return stopWriter || !outQueue.empty() || ctx->IsCancelled();
                });

                if ((stopWriter || ctx->IsCancelled()) && outQueue.empty()) {
                    break;
                }
                if (outQueue.empty()) continue;

                out = std::move(outQueue.front());
                outQueue.pop_front();
            }

            if (!stream->Write(out)) {
                break;
            }
        }
    });

    constexpr size_t kMaxQueuedMsgs = 128;
    const uint64_t subscriberId = s_nextSubscriberId.fetch_add(1);
    bool streamOk = _rm.addSendCallback(roomId, subscriberId,
        [&queueMu, &queueCv, &outQueue, ctx, kMaxQueuedMsgs](const ::game::RoomServerMessage& out) {
            if (ctx->IsCancelled()) return;

            std::lock_guard<std::mutex> lock(queueMu);

            if (out.has_state()) {
                // Keep only the newest state snapshot in queue.
                for (auto it = outQueue.begin(); it != outQueue.end();) {
                    if (it->has_state()) it = outQueue.erase(it);
                    else ++it;
                }
            }

            if (outQueue.size() >= kMaxQueuedMsgs) {
                // Drop oldest state first; if none exists, drop this state.
                bool droppedOne = false;
                for (auto it = outQueue.begin(); it != outQueue.end(); ++it) {
                    if (it->has_state()) {
                        outQueue.erase(it);
                        droppedOne = true;
                        break;
                    }
                }
                if (!droppedOne && out.has_state()) {
                    return;
                }
                if (!droppedOne && !outQueue.empty()) {
                    outQueue.pop_front();
                }
            }

            outQueue.push_back(out);
            queueCv.notify_one();
        });

    if (!streamOk) {
        return grpc::Status(grpc::StatusCode::NOT_FOUND,
                            "room not found: " + roomId);
    }

    // Process the already-read first message.
    _rm.enqueueMessage(msg);

    // Keep reading until the client disconnects.
    while (stream->Read(&msg)) {
        if (ctx->IsCancelled()) break;
        _rm.enqueueMessage(msg);
    }

    // Deregister callback so dead stream is no longer queued to.
    _rm.removeSendCallback(roomId, subscriberId);

    {
        std::lock_guard<std::mutex> lock(queueMu);
        stopWriter = true;
    }
    queueCv.notify_all();
    if (writer.joinable()) writer.join();

    return grpc::Status::OK;
}

} // namespace game
