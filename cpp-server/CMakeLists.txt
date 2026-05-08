cmake_minimum_required(VERSION 3.22)
project(ugg-game-server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Export compile_commands.json so VS Code IntelliSense can find all headers
# automatically (avoids manual includePath configuration).
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── build the Rapier cxx bridge (Rust + Rapier) ──────────────────────────────

# Fetch Corrosion (CMake–Cargo integration) automatically.
# Falls back to a system install if one is already present.
find_package(Corrosion QUIET)
if(NOT Corrosion_FOUND)
    include(FetchContent)
    FetchContent_Declare(
        Corrosion
        GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git
        GIT_TAG        v0.5.1
    )
    FetchContent_MakeAvailable(Corrosion)
endif()

corrosion_import_crate(MANIFEST_PATH "${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml")
# corrosion creates a target named `rapier_bridge`

# Generated cxx header is placed by the cargo build at:
#   target/cxxbridge/rapier-bridge/src/lib.rs.h
set(CXX_BRIDGE_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/target/cxxbridge")

# ── find gRPC / Protobuf ──────────────────────────────────────────────────────

# vcpkg installs protobuf in config mode (lowercase package name)
find_package(protobuf CONFIG REQUIRED)
find_package(gRPC     CONFIG REQUIRED)

# Locate protoc executable (vcpkg puts tools under installed/<triplet>/tools/)
find_program(PROTOC_EXE
    NAMES protoc
    PATHS "${_VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/protobuf"
          "C:/vcpkg/installed/x64-windows/tools/protobuf"
    NO_DEFAULT_PATH
)
if(NOT PROTOC_EXE)
    # Fallback: use protobuf::protoc target if available
    if(TARGET protobuf::protoc)
        set(PROTOC_EXE "$<TARGET_FILE:protobuf::protoc>")
    else()
        message(FATAL_ERROR "protoc not found. Install grpc:x64-windows via vcpkg.")
    endif()
endif()

# Generate protobuf + gRPC stubs
set(PROTO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/proto")
set(PROTO_SRC "${PROTO_DIR}/game.proto")

get_filename_component(PROTO_ABS "${PROTO_SRC}" ABSOLUTE)
get_filename_component(PROTO_DIR_ABS "${PROTO_DIR}" ABSOLUTE)

set(PROTO_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/proto_generated")
file(MAKE_DIRECTORY "${PROTO_GEN_DIR}")

set(PROTO_CC   "${PROTO_GEN_DIR}/game.pb.cc")
set(PROTO_HDR  "${PROTO_GEN_DIR}/game.pb.h")
set(GRPC_CC    "${PROTO_GEN_DIR}/game.grpc.pb.cc")
set(GRPC_HDR   "${PROTO_GEN_DIR}/game.grpc.pb.h")

add_custom_command(
    OUTPUT "${PROTO_CC}" "${PROTO_HDR}" "${GRPC_CC}" "${GRPC_HDR}"
    COMMAND "${PROTOC_EXE}"
        --cpp_out="${PROTO_GEN_DIR}"
        --grpc_out="${PROTO_GEN_DIR}"
        --plugin=protoc-gen-grpc="$<TARGET_FILE:gRPC::grpc_cpp_plugin>"
        -I "${PROTO_DIR_ABS}"
        "${PROTO_ABS}"
    DEPENDS "${PROTO_SRC}"
)

# ── find nlohmann/json (header-only) ─────────────────────────────────────────

find_package(nlohmann_json 3.11 REQUIRED)

# ── find hiredis ─────────────────────────────────────────────────────────────

find_package(hiredis REQUIRED)

# ── collect sources ───────────────────────────────────────────────────────────

set(SRC
    src/main.cpp
    src/game_server.cpp
    src/room_manager.cpp
    src/game_room.cpp
    src/ws_game_server.cpp
    src/redis_client.cpp
    src/physics/rapier_world.cpp
    src/systems/player_controller.cpp
    src/systems/grapple_system.cpp
    src/systems/bomb_system.cpp
    src/systems/parry_system.cpp
    src/systems/gear_system.cpp
    "${PROTO_CC}"
    "${GRPC_CC}"
)

add_executable(ugg-server ${SRC})

target_include_directories(ugg-server PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
    "${PROTO_GEN_DIR}"
    "${CXX_BRIDGE_INCLUDE_DIR}"
)

target_link_libraries(ugg-server PRIVATE
    rapier_bridge          # Rust static lib from corrosion
    gRPC::grpc++
    gRPC::grpc++_reflection
    protobuf::libprotobuf
    nlohmann_json::nlohmann_json
    hiredis::hiredis
    $<$<CXX_COMPILER_ID:MSVC>:ws2_32>
    # pthreads: use system threads; on Windows MSVC uses native win32 threads
    $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:pthread>
)

# Ensure the Rust bridge is built before we compile C++
add_dependencies(ugg-server rapier_bridge)
