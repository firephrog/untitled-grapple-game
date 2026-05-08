#pragma once
#include "room_manager.hpp"

// gRPC generated
#include "game.grpc.pb.h"

#include <grpcpp/grpcpp.h>

namespace game {

/// gRPC
/// Handles room lifecycle RPCs and the bidirectional RoomStream.
class GameServiceImpl final : public ::game::GameService::Service {
public:
    explicit GameServiceImpl(RoomManager& rm);

    // ── unary RPCs ────────────────────────────────────────────────────────────

    grpc::Status CreateRoom(
        grpc::ServerContext*             ctx,
        const ::game::CreateRoomRequest* req,
        ::game::CreateRoomResponse*      resp) override;

    grpc::Status DestroyRoom(
        grpc::ServerContext*              ctx,
        const ::game::DestroyRoomRequest* req,
        ::game::DestroyRoomResponse*      resp) override;

    grpc::Status AddPlayer(
        grpc::ServerContext*           ctx,
        const ::game::AddPlayerRequest* req,
        ::game::AddPlayerResponse*      resp) override;

    grpc::Status RemovePlayer(
        grpc::ServerContext*              ctx,
        const ::game::RemovePlayerRequest* req,
        ::game::RemovePlayerResponse*      resp) override;

    grpc::Status BeginGame(
        grpc::ServerContext*            ctx,
        const ::game::BeginGameRequest*  req,
        ::game::BeginGameResponse*       resp) override;

    // ── bidirectional streaming RPC ───────────────────────────────────────────

    grpc::Status RoomStream(
        grpc::ServerContext*                                     ctx,
        grpc::ServerReaderWriter<::game::RoomServerMessage,
                                 ::game::RoomClientMessage>*    stream) override;

private:
    RoomManager& _rm;
};

} // namespace game
