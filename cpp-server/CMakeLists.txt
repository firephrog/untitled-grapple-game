cmake_minimum_required(VERSION 3.22)
project(ugg-game-server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(UGG_NATIVE_OPTIMIZE "Enable native CPU tuning flags for Release builds" ON)

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

# Ensure Corrosion/cargo emits cxx bridge headers into a deterministic path
# that our C++ include uses: target/cxxbridge/rapier-bridge/src/lib.rs.h
set(ENV{CARGO_TARGET_DIR} "${CMAKE_CURRENT_SOURCE_DIR}/target")

corrosion_import_crate(MANIFEST_PATH "${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml")
# corrosion creates a target named `rapier_bridge`

# Generated cxx header is placed by the cargo build at:
#   target/cxxbridge/rapier-bridge/src/lib.rs.h
set(CXX_BRIDGE_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/target/cxxbridge")

# ── find gRPC / Protobuf ──────────────────────────────────────────────────────

# protobuf: vcpkg uses config mode (lowercase); Debian/Ubuntu apt only provides
# CMake module mode (FindProtobuf, uppercase).  Try config first, fall back.
find_package(protobuf CONFIG QUIET)
if(NOT protobuf_FOUND)
    find_package(Protobuf REQUIRED)
endif()

# gRPC: vcpkg uses config mode; Debian puts cmake files in a multiarch path
# (/usr/lib/<arch>/cmake/grpc/) that needs an explicit gRPC_DIR hint or
# pkg-config fallback.  Try config first, then synthesise targets via
# pkg-config so the same target names (gRPC::grpc++ etc.) are always present.
find_package(gRPC CONFIG QUIET)
if(NOT gRPC_FOUND)
    message(STATUS "gRPC CMake config not found — trying pkg-config fallback")
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(GRPCPP REQUIRED IMPORTED_TARGET grpc++)
    if(NOT TARGET gRPC::grpc++)
        add_library(gRPC::grpc++ ALIAS PkgConfig::GRPCPP)
    endif()
    if(NOT TARGET gRPC::grpc++_reflection)
        add_library(gRPC::grpc++_reflection INTERFACE IMPORTED)
        target_link_libraries(gRPC::grpc++_reflection INTERFACE PkgConfig::GRPCPP)
    endif()
    if(NOT TARGET gRPC::grpc_cpp_plugin)
        find_program(_GRPC_CPP_PLUGIN grpc_cpp_plugin REQUIRED)
        add_executable(gRPC::grpc_cpp_plugin IMPORTED)
        set_target_properties(gRPC::grpc_cpp_plugin PROPERTIES
            IMPORTED_LOCATION "${_GRPC_CPP_PLUGIN}")
    endif()
endif()

# Locate protoc executable (vcpkg puts tools under installed/<triplet>/tools/)
find_program(PROTOC_EXE
    NAMES protoc
    PATHS "${_VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/tools/protobuf"
          "C:/vcpkg/installed/x64-windows/tools/protobuf"
    NO_DEFAULT_PATH
)
if(NOT PROTOC_EXE)
    if(TARGET protobuf::protoc)
        set(PROTOC_EXE "$<TARGET_FILE:protobuf::protoc>")
    elseif(DEFINED Protobuf_PROTOC_EXECUTABLE)
        set(PROTOC_EXE "${Protobuf_PROTOC_EXECUTABLE}")
    else()
        message(FATAL_ERROR "protoc not found. Install grpc:x64-windows via vcpkg (Windows) or protobuf-compiler (Linux).")
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

# vcpkg: nlohmann_json CONFIG; Debian apt: nlohmann-json3-dev (header-only,
# no cmake config file — fall back to finding the header directly).
find_package(nlohmann_json 3.11 QUIET)
if(NOT nlohmann_json_FOUND)
    find_path(NLOHMANN_JSON_INCLUDE_DIR nlohmann/json.hpp
        PATHS /usr/include /usr/local/include
        REQUIRED
    )
    add_library(nlohmann_json::nlohmann_json INTERFACE IMPORTED)
    target_include_directories(nlohmann_json::nlohmann_json
        INTERFACE "${NLOHMANN_JSON_INCLUDE_DIR}")
    message(STATUS "nlohmann/json found via header at ${NLOHMANN_JSON_INCLUDE_DIR}")
endif()

# ── find hiredis ─────────────────────────────────────────────────────────────

# vcpkg: hiredis CONFIG; Debian apt: libhiredis-dev (pkg-config only, no
# cmake config file).
find_package(hiredis QUIET)
if(NOT hiredis_FOUND)
    message(STATUS "hiredis CMake config not found — trying pkg-config fallback")
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(HIREDIS REQUIRED IMPORTED_TARGET hiredis)
        if(NOT TARGET hiredis::hiredis)
            add_library(hiredis::hiredis ALIAS PkgConfig::HIREDIS)
        endif()
    else()
        # Last resort: find header + library directly
        find_path(HIREDIS_INCLUDE_DIR hiredis/hiredis.h REQUIRED)
        find_library(HIREDIS_LIB NAMES hiredis REQUIRED)
        add_library(hiredis::hiredis UNKNOWN IMPORTED)
        set_target_properties(hiredis::hiredis PROPERTIES
            IMPORTED_LOCATION "${HIREDIS_LIB}"
            INTERFACE_INCLUDE_DIRECTORIES "${HIREDIS_INCLUDE_DIR}")
    endif()
endif()

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

include(CheckIPOSupported)
check_ipo_supported(RESULT UGG_IPO_SUPPORTED OUTPUT UGG_IPO_ERROR)
if(UGG_IPO_SUPPORTED)
    set_property(TARGET ugg-server PROPERTY INTERPROCEDURAL_OPTIMIZATION_RELEASE TRUE)
else()
    message(STATUS "IPO/LTO not enabled: ${UGG_IPO_ERROR}")
endif()

if(UGG_NATIVE_OPTIMIZE)
    target_compile_options(ugg-server PRIVATE
        $<$<AND:$<CONFIG:Release>,$<CXX_COMPILER_ID:GNU>>:-march=native -mtune=native>
        $<$<AND:$<CONFIG:Release>,$<CXX_COMPILER_ID:Clang>>:-march=native -mtune=native>
    )
endif()

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
