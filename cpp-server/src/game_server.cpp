#include "game_server.hpp"

#include <cstdio>
#include <atomic>
#include <mutex>
#include <thread>

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

    // Register stream writer as send callback on the room.
    // Access must be serialized; use a mutex per-stream.
    std::mutex writeMu;
    const uint64_t subscriberId = s_nextSubscriberId.fetch_add(1);
    bool streamOk = _rm.addSendCallback(roomId, subscriberId,
        [stream, &writeMu, ctx](const ::game::RoomServerMessage& out) {
            if (ctx->IsCancelled()) return;
            std::lock_guard<std::mutex> lock(writeMu);
            stream->Write(out);
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

    // Deregister callback so the dead stream isn't written to.
    _rm.removeSendCallback(roomId, subscriberId);

    return grpc::Status::OK;
}

} // namespace game
