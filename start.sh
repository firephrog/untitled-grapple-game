#!/usr/bin/env bash
# start.sh — launch the C++ physics servers and Node.js game server together.
# Run from repo root:  ./start.sh
# Optional flag to also start the Vite dev client:  ./start.sh --client

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_CLIENT=0

for arg in "$@"; do
  case "$arg" in
    -c|--client)
      START_CLIENT=1
      ;;
    *)
      echo "[start] Unknown argument: $arg"
      echo "Usage: ./start.sh [--client]"
      exit 1
      ;;
  esac
done

# ── Ensure system build dependencies are installed (Debian/Ubuntu) ───────────
MISSING_PKGS=()
for pkg in \
  cmake \
  build-essential \
  pkg-config \
  libprotobuf-dev \
  protobuf-compiler \
  libgrpc++-dev \
  protobuf-compiler-grpc \
  libhiredis-dev \
  nlohmann-json3-dev
do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    MISSING_PKGS+=("$pkg")
  fi
done

if [ "${#MISSING_PKGS[@]}" -gt 0 ]; then
  echo "[start] Installing missing packages: ${MISSING_PKGS[*]}"
  sudo apt-get update -qq
  sudo apt-get install -y "${MISSING_PKGS[@]}"
  if [ "$?" -ne 0 ]; then
    echo "[start] ERROR: apt-get install failed. Install manually:"
    echo "  sudo apt-get install -y ${MISSING_PKGS[*]}"
    exit 1
  fi
else
  echo "[start] System deps OK."
fi

# ── Ensure Rust toolchain is available ───────────────────────────────────────
if ! command -v rustc >/dev/null 2>&1; then
  # Source cargo env in case rustup was already installed but not on PATH yet
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
fi

if ! command -v rustc >/dev/null 2>&1; then
  echo "[start] Rust not found. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
  if ! command -v rustc >/dev/null 2>&1; then
    echo "[start] ERROR: rustup install failed or rustc still not in PATH."
    echo "  Run:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "  Then: source \$HOME/.cargo/env"
    exit 1
  fi
  echo "[start] Rust installed: $(rustc --version)"
else
  echo "[start] Rust OK: $(rustc --version)"
fi

wait_for_tcp_port() {
  local host="$1"
  local port="$2"
  local timeout_secs="${3:-15}"
  local start_ts now elapsed

  start_ts="$(date +%s)"
  while true; do
    if command -v nc >/dev/null 2>&1; then
      if nc -z "$host" "$port" >/dev/null 2>&1; then
        return 0
      fi
    else
      if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
        return 0
      fi
    fi

    now="$(date +%s)"
    elapsed=$((now - start_ts))
    if [ "$elapsed" -ge "$timeout_secs" ]; then
      return 1
    fi

    sleep 0.25
  done
}

# Build C++ server so runtime uses latest code.
build_ok=0
pushd "$ROOT/cpp-server" >/dev/null || exit 1

# Dynamically locate cmake config dirs for Debian/Ubuntu multiarch installs.
# Passes explicit *_DIR hints so find_package(gRPC/hiredis CONFIG) works even
# when the cmake files are under /usr/lib/<arch>/cmake/ (non-default search path).
_CMAKE_EXTRA=""
_GRPC_DIR=$(find /usr/lib -maxdepth 5 -name "gRPCConfig.cmake" -exec dirname {} \; 2>/dev/null | head -1)
if [ -n "$_GRPC_DIR" ]; then
  _CMAKE_EXTRA="$_CMAKE_EXTRA -DgRPC_DIR=$_GRPC_DIR"
fi
_HIREDIS_DIR=$(find /usr/lib /usr/share -maxdepth 6 -name "hiredisConfig.cmake" -exec dirname {} \; 2>/dev/null | head -1)
if [ -n "$_HIREDIS_DIR" ]; then
  _CMAKE_EXTRA="$_CMAKE_EXTRA -Dhiredis_DIR=$_HIREDIS_DIR"
fi

# Always re-run configure so any new cmake hints take effect.
# (cmake skips unchanged targets, so this is fast after the first run.)
echo "[start] Configuring C++ build directory..."
# shellcheck disable=SC2086
cmake -S . -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="/usr;/usr/local" \
  $_CMAKE_EXTRA
configure_exit=$?
if [ "$configure_exit" -ne 0 ]; then
  echo "[start] C++ configure failed (exit $configure_exit). Clearing cache for next run."
  rm -f build/CMakeCache.txt
fi

echo "[start] Building C++ server (build)..."
cmake --build build
if [ "$?" -eq 0 ]; then
  build_ok=1
  echo "[start] C++ build OK."
else
  echo "[start] C++ build failed."
fi

popd >/dev/null || exit 1

if [ "$build_ok" -ne 1 ]; then
  echo "[start] WARNING: C++ build failed. Continuing with existing binary if present."
fi

# Build client bundle so /public serves latest JS changes.
client_build_ok=0
pushd "$ROOT" >/dev/null || exit 1

echo "[start] Building client bundle (Vite -> public)..."
npm run build
if [ "$?" -eq 0 ]; then
  client_build_ok=1
  echo "[start] Client build OK."
else
  echo "[start] Client build failed."
fi

popd >/dev/null || exit 1

if [ "$client_build_ok" -ne 1 ]; then
  echo "[start] WARNING: Client build failed. Continuing with existing public bundle."
fi

# Locate the C++ binary.
cpp_bin=""
for candidate in \
  "$ROOT/cpp-server/build/ugg-server" \
  "$ROOT/cpp-server/build/Release/ugg-server" \
  "$ROOT/cpp-server/build-ninja/ugg-server"
do
  if [ -f "$candidate" ]; then
    cpp_bin="$candidate"
    break
  fi
done

if [ -z "$cpp_bin" ]; then
  echo "[start] ERROR: ugg-server not found. Build it first:"
  echo "  cd cpp-server && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build"
  exit 1
fi

mkdir -p "$ROOT/.runlogs"

# Kill any leftover processes.
echo "[start] Stopping any existing processes..."
pkill -f '/ugg-server' >/dev/null 2>&1 || true
pkill -f 'node .*server.js' >/dev/null 2>&1 || true
pkill -f 'npm start' >/dev/null 2>&1 || true
sleep 0.3

# Start C++ servers (PVP + FFA).
echo "[start] Starting C++ PVP physics server on :50051..."
GRPC_PORT=50051 WS_PORT=51051 "$cpp_bin" >"$ROOT/.runlogs/cpp-pvp.log" 2>&1 &
cpp_pvp_pid=$!
echo "  PID $cpp_pvp_pid  -> $cpp_bin (gRPC 50051, WS 51051)"

echo "[start] Starting C++ FFA physics server on :50052..."
GRPC_PORT=50052 WS_PORT=51052 "$cpp_bin" >"$ROOT/.runlogs/cpp-ffa.log" 2>&1 &
cpp_ffa_pid=$!
echo "  PID $cpp_ffa_pid  -> $cpp_bin (gRPC 50052, WS 51052)"

# Wait for both gRPC ports before Node tries to connect.
if ! wait_for_tcp_port 127.0.0.1 50051 15; then
  echo "[start] WARNING: PVP gRPC port 50051 did not become ready in time."
fi
if ! wait_for_tcp_port 127.0.0.1 50052 15; then
  echo "[start] WARNING: FFA gRPC port 50052 did not become ready in time."
fi

# Start Node.js server.
echo "[start] Starting Node.js game server..."
(
  cd "$ROOT" || exit 1
  CPP_SERVER_ADDR='127.0.0.1:50051' \
  FFA_CPP_SERVER_ADDR='127.0.0.1:50052' \
  CPP_PVP_WS_PORT='51051' \
  CPP_FFA_WS_PORT='51052' \
  npm start
) >"$ROOT/.runlogs/node.log" 2>&1 &
node_pid=$!
echo "  PID $node_pid  -> npm start"

# Optionally start Vite dev client.
if [ "$START_CLIENT" -eq 1 ]; then
  echo "[start] Starting Vite dev client..."
  (
    cd "$ROOT/client" || exit 1
    npm run dev
  ) >"$ROOT/.runlogs/vite.log" 2>&1 &
  vite_pid=$!
  echo "  PID $vite_pid  -> npm run dev"
fi

echo
echo "All processes launched in background."
echo "Logs: $ROOT/.runlogs"
echo "Stop all with: pkill -f '/ugg-server' ; pkill -f 'node .*server.js' ; pkill -f 'vite'"
echo "To also start the Vite dev client, run: ./start.sh --client"
