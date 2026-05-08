#include "game_room.hpp"
#include "config.hpp"

#include <nlohmann/json.hpp>
#include <cmath>
#include <algorithm>
#include <sstream>

namespace game {

using json = nlohmann::json;
using Clock = std::chrono::steady_clock;

namespace {
std::vector<game::SpawnPoint> spawnPointsForMap(const std::string& mapId)
{
    if (mapId == "skylands") {
        return {
            { -60.0f, 10.0f, -60.0f },
            {  60.0f, 10.0f, -60.0f },
            { -60.0f, 10.0f,  60.0f },
            {  60.0f, 10.0f,  60.0f },
            {   0.0f, 28.0f,   0.0f },
        };
    }

    if (mapId == "orbit") {
        return {
            {   5.8f, 26.6f,  20.0f },
            { -20.8f, 27.0f, -57.0f },
        };
    }

    if (mapId == "stonelands") {
        return {
            { 0.0f, 2.0f, -50.0f },
            { 0.0f, 2.0f,  40.0f },
        };
    }

    if (mapId == "test") {
        return {
            { -10.0f, 2.0f, 0.0f },
            {  10.0f, 2.0f, 0.0f },
        };
    }

    return {};
}
}

// ── construction / destruction ────────────────────────────────────────────────

GameRoom::GameRoom(std::string id,
                   std::string mode,
                   SendCb      sendCallback,
                   redis::RedisClient& redis)
    : _id(std::move(id))
    , _mode(std::move(mode))
    , _redis(redis)
{
    if (sendCallback) {
        _sendCbs.emplace(0, std::move(sendCallback));
    }
}

GameRoom::~GameRoom()
{
    _running = false;
    if (_loopThread.joinable()) _loopThread.join();
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

bool GameRoom::beginGame(const std::string& mapId,
                          const std::string& mapFile)
{
    _mapId = mapId;
    _world = std::make_unique<physics::RapierWorld>();

    if (!_world->loadFromFile(mapFile)) {
        // Fallback flat quad if map file not found
        std::vector<float>    verts = { -200,0,-200, 200,0,-200, 200,0,200, -200,0,200 };
        std::vector<uint32_t> idx   = { 0,1,2, 0,2,3 };
        _world->loadTrimesh(verts, idx);
    }

    // Prefer map-authored spawn points; fall back to a simple circle.
    _spawnPoints = spawnPointsForMap(_mapId);
    if (_spawnPoints.empty()) {
        for (int i = 0; i < Config::BLOCK_COUNT; ++i) {
            float angle = (2.0f * 3.14159265f * i) / Config::BLOCK_COUNT;
            _spawnPoints.push_back({
                std::cos(angle) * 20.0f,
                5.0f,
                std::sin(angle) * 20.0f
            });
        }
    }
    if (_spawnPoints.empty())
        _spawnPoints.push_back({ 0.0f, 5.0f, 0.0f });

    // Spawn all existing players
    int spawnIdx = 0;
    for (auto& [pid, info] : _infos) {
        auto sp = _spawnPoint(info.spawnIndex >= 0 ? info.spawnIndex : spawnIdx++);
        uint64_t body = _world->createPlayerBody(sp.x, sp.y, sp.z);
        _bodies[pid] = body;
        _bodyToPlayer[body] = pid;
        _states[pid].health = Config::START_HEALTH;
        _states[pid].alive  = true;
    }

    // Gear callbacks
    _gear = std::make_unique<systems::GearSystem>(
        // onSnipeHit
        [this](const std::string& sId, const std::string& tId, int dmg) {
            _applyDamage(tId, sId, dmg);
        },
        // onAoeDamage
        [this](const std::string& sId, const std::string& tId, int dmg) {
            _applyDamage(tId, sId, dmg);
        },
        // onPreview
        [this](const std::string& pid, const std::string& gear,
               float px, float py, float pz,
               float dx, float dy, float dz, float dur) {
            json j{{"playerId",pid},{"gearType",gear},
                   {"pos",{px,py,pz}},{"dir",{dx,dy,dz}},
                   {"durationSec",dur}};
            _sendEvent("gearPreview", j.dump());
        },
        // onLine
        [this](float fx, float fy, float fz,
               float tx, float ty, float tz) {
            json j{{"from",{fx,fy,fz}},{"to",{tx,ty,tz}}};
            _sendEvent("snipeLine", j.dump());
        },
        // onParticles
        [this](float px, float py, float pz,
               const std::string& type,
               int count) {
            json j{{"pos",{px,py,pz}},{"type",type},{"count",count}};
            _sendEvent("particles", j.dump());
        }
    );

    // Bomb callbacks
    _bombs = std::make_unique<systems::BombSystem>(
        [this](const std::string& bid,
               float cx, float cy, float cz,
               const std::string& ownerId) {
            _handleExplosion(bid, cx, cy, cz, ownerId);
        }
    );

    _phase     = "playing";
    _tickCount = 0;
    _running   = true;
    _loopThread = std::thread(&GameRoom::_run, this);

    json startEvt{{"phase","playing"}};
    _sendEvent("gameStart", startEvt.dump());
    return true;
}

bool GameRoom::addPlayer(const PlayerInfo& info)
{
    _infos[info.playerId]    = info;
    _states[info.playerId]   = PlayerState{};
    _grapples[info.playerId] = systems::GrappleSystem{};
    _parries[info.playerId]  = systems::ParrySystem{};
    _inputs[info.playerId]   = systems::PlayerInput{};

    // If the game is already running, queue a body spawn on the game-loop thread.
    // We must NOT call _world->createPlayerBody() here because Rapier is not
    // thread-safe and _tick may be inside _world->step() right now.
    if (_world) {
        std::lock_guard<std::mutex> lock(_inputMutex);
        _spawnQueue.push_back(info.playerId);
    }
    return true;
}

void GameRoom::removePlayer(const std::string& pid)
{
    if (_world) {
        auto it = _bodies.find(pid);
        if (it != _bodies.end()) {
            _bodyToPlayer.erase(it->second);
            _world->removeBody(it->second);
            _bodies.erase(it);
        }
    }
    _infos.erase(pid);
    _states.erase(pid);
    _grapples.erase(pid);
    _parries.erase(pid);
    _inputs.erase(pid);

    if (_phase == "playing") {
        json j{{"playerId", pid}};
        _sendEvent("playerDisconnected", j.dump());
    }
}

void GameRoom::setSendCallback(SendCb cb)
{
    std::lock_guard<std::mutex> lock(_sendCbMutex);
    if (cb) _sendCbs[0] = std::move(cb);
    else    _sendCbs.erase(0);
}

void GameRoom::addSendCallback(uint64_t subscriberId, SendCb cb)
{
    if (!cb) return;
    std::lock_guard<std::mutex> lock(_sendCbMutex);
    _sendCbs[subscriberId] = std::move(cb);
}

void GameRoom::removeSendCallback(uint64_t subscriberId)
{
    std::lock_guard<std::mutex> lock(_sendCbMutex);
    _sendCbs.erase(subscriberId);
}

int GameRoom::playerCount() const { return static_cast<int>(_infos.size()); }

// ── input ingestion ───────────────────────────────────────────────────────────

void GameRoom::enqueueMessage(const ::game::RoomClientMessage& msg)
{
    std::lock_guard<std::mutex> lock(_inputMutex);
    _inputQueue.push(msg);
}

// ── game loop ─────────────────────────────────────────────────────────────────

void GameRoom::_run()
{
    using namespace std::chrono;
    auto next = steady_clock::now();
    const auto tickDur = duration_cast<steady_clock::duration>(
        duration<float>(Config::DT));

    while (_running.load()) {
        next += tickDur;
        try {
            _tick(Config::DT);
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[GameRoom:%s] tick exception: %s\n", _id.c_str(), e.what());
        } catch (...) {
            std::fprintf(stderr, "[GameRoom:%s] tick unknown exception\n", _id.c_str());
        }
        std::this_thread::sleep_until(next);
    }
}

void GameRoom::_tick(float dt)
{
    if (_phase != "playing") return;

    _processInputs();

    // Apply movement + grapple for each living player
    for (auto& [pid, state] : _states) {
        if (!state.alive) continue;
        auto bodyIt = _bodies.find(pid);
        if (bodyIt == _bodies.end()) continue;
        uint64_t body = bodyIt->second;

        bool grounded = _world->isGrounded(body);
        auto& grapple = _grapples.at(pid);

        systems::applyMovement(*_world, body, _inputs[pid], grounded,
                               grapple.status());
        _inputs[pid].jump = false;  // consume jump; prevent stale re-use next tick
        grapple.tick(*_world, body, dt);
    }

    _world->step(dt);

    // Void check
    for (auto& [pid, state] : _states) {
        if (!state.alive) continue;
        auto it = _bodies.find(pid);
        if (it == _bodies.end()) continue;
        auto pos = _world->getPosition(it->second);
        if (pos.y < Config::VOID_Y) {
            if (_mode == "ffa") {
                state.alive = false;
                json j{{"playerId",pid},{"killerName","The Void"}};
                _sendEvent("playerDied", j.dump());
            } else {
                // In 1v1, void = death → find opponent
                for (auto& [other, _] : _states) {
                    if (other != pid) { _endGame(other, pid); return; }
                }
            }
        }
    }

    // Bomb tick
    _bombs->tick(*_world);

    // Gear tick
    _gear->tick(*_world);

    // Broadcast state at PATCH_RATE
    ++_patchTick;
    if (_patchTick >= Config::PATCH_RATE_TICKS) {
        _patchTick = 0;
        _broadcastState();
    }

    ++_tickCount;
}

// ── input processing ──────────────────────────────────────────────────────────

void GameRoom::_processInputs()
{
    // ── drain spawn queue first ───────────────────────────────────────────────
    // New players that joined while the game was already running need a body.
    // Body creation must happen on THIS thread (game-loop) because Rapier is
    // single-threaded.
    {
        std::vector<std::string> toSpawn;
        {
            std::lock_guard<std::mutex> lock(_inputMutex);
            std::swap(toSpawn, _spawnQueue);
        }
        for (const auto& pid : toSpawn) {
            if (!_infos.count(pid)) continue;  // player left before body was created
            auto& info = _infos.at(pid);
            int idx = info.spawnIndex >= 0 ? info.spawnIndex
                                           : static_cast<int>(_bodies.size());
            auto sp = _spawnPoint(idx);
            uint64_t body = _world->createPlayerBody(sp.x, sp.y, sp.z);
            _bodies[pid]         = body;
            _bodyToPlayer[body]  = pid;
            _states[pid].health  = Config::START_HEALTH;
            _states[pid].alive   = true;
        }
    }

    // ── input queue ───────────────────────────────────────────────────────────
    std::queue<::game::RoomClientMessage> q;
    {
        std::lock_guard<std::mutex> lock(_inputMutex);
        std::swap(q, _inputQueue);
    }

    while (!q.empty()) {
        auto& msg = q.front();
        const std::string& pid = msg.player_id();

        // Only process messages from known players
        if (_states.find(pid) == _states.end()) { q.pop(); continue; }

        switch (msg.payload_case()) {
            case ::game::RoomClientMessage::kInput:
                _handleInput(pid, msg.input());
                break;
            case ::game::RoomClientMessage::kGrapple:
                _handleGrapple(pid, msg.grapple());
                break;
            case ::game::RoomClientMessage::kSpawnBomb:
                _handleSpawnBomb(pid, msg.spawn_bomb());
                break;
            case ::game::RoomClientMessage::kUseGear:
                _handleUseGear(pid, msg.use_gear());
                break;
            case ::game::RoomClientMessage::kParry:
                _handleParry(pid, msg.parry());
                break;
            case ::game::RoomClientMessage::kRematch:
                _handleRematch(pid);
                break;
            default:
                break;
        }
        q.pop();
    }
}

void GameRoom::_handleInput(const std::string& pid,
                             const ::game::PlayerInput& msg)
{
    auto& inp    = _inputs[pid];
    inp.seq      = msg.seq();
    inp.forward  = msg.forward();
    inp.backward = msg.backward();
    inp.left     = msg.left();
    inp.right    = msg.right();
    inp.jump     = msg.jump();
    inp.camYaw   = msg.cam_yaw();
    inp.camPitch = msg.cam_pitch();
    if (msg.has_cam_pos()) {
        inp.camX = msg.cam_pos().x();
        inp.camY = msg.cam_pos().y();
        inp.camZ = msg.cam_pos().z();
    }
    // Keep any pending snipe aimed at the player's current look direction and position.
    // Prefer live body position as origin fallback so older clients that don't send
    // cam_pos every tick won't collapse the origin to (0,0,0).
    if (_gear) {
        float dx =  std::sin(inp.camYaw) * std::cos(inp.camPitch);
        float dy =  std::sin(inp.camPitch);
        float dz = -std::cos(inp.camYaw) * std::cos(inp.camPitch);

        float ox = inp.camX;
        float oy = inp.camY;
        float oz = inp.camZ;
        auto bodyIt = _bodies.find(pid);
        if (bodyIt != _bodies.end() && _world) {
            auto p = _world->getPosition(bodyIt->second);
            ox = p.x;
            oy = p.y;
            oz = p.z;
        }

        _gear->updatePendingDirection(pid, ox, oy, oz, dx, dy, dz);
    }
    _states[pid].lastSeq = msg.seq();
}

void GameRoom::_handleGrapple(const std::string& pid,
                               const ::game::GrappleAction& /*msg*/)
{
    auto bodyIt = _bodies.find(pid);
    if (bodyIt == _bodies.end()) return;
    auto& inp = _inputs[pid];
    _grapples[pid].activate(*_world, bodyIt->second,
                             std::sin(inp.camYaw) * std::cos(inp.camPitch),
                             std::sin(inp.camPitch),
                            -std::cos(inp.camYaw) * std::cos(inp.camPitch));
}

void GameRoom::_handleSpawnBomb(const std::string& pid,
                                 const ::game::SpawnBombAction& msg)
{
    if (_states[pid].health <= 0) return;
    auto& info = _infos[pid];
    _bombs->spawn(*_world,
                  msg.position().x(), msg.position().y(), msg.position().z(),
                  msg.impulse().x(),  msg.impulse().y(),  msg.impulse().z(),
                  pid, info.bombSkinId);
}

void GameRoom::_handleUseGear(const std::string& pid,
                               const ::game::UseGearAction& msg)
{
    auto& info = _infos[pid];
    auto entries = _makePlayerEntries();

    if (msg.gear_type() == "sniper") {
        _gear->snipe(pid,
                     msg.cam_pos().x(), msg.cam_pos().y(), msg.cam_pos().z(),
                     msg.cam_dir().x(), msg.cam_dir().y(), msg.cam_dir().z(),
                     entries);
    } else if (msg.gear_type() == "mace") {
        auto bodyIt = _bodies.find(pid);
        if (bodyIt != _bodies.end())
            _gear->mace(pid, bodyIt->second, *_world, entries);
    }
}

void GameRoom::_handleParry(const std::string& pid,
                             const ::game::ParryAction& /*msg*/)
{
    if (_parries[pid].activate()) {
        json j{{"playerId", pid}};
        _sendEvent("parryActivated", j.dump());
    }
}

void GameRoom::_handleRematch(const std::string& /*pid*/)
{
    // Rematch logic: reset all players and restart simulation
    if (_phase != "ended") return;
    _bombs->clear(*_world);
    int idx = 0;
    for (auto& [pid, state] : _states) {
        state.health = Config::START_HEALTH;
        state.alive  = true;
        state.lastSeq = 0;
        auto sp = _spawnPoint(idx++);
        if (_bodies.count(pid))
            _world->setPosition(_bodies[pid], sp.x, sp.y, sp.z);
    }
    _phase = "playing";
    _sendEvent("rematchStart", "{}");
}

// ── game logic ────────────────────────────────────────────────────────────────

void GameRoom::_applyDamage(const std::string& targetId,
                             const std::string& sourceId,
                             int                damage)
{
    auto stateIt = _states.find(targetId);
    if (stateIt == _states.end() || !stateIt->second.alive) return;

    // Check parry
    if (_parries.count(targetId) && _parries[targetId].isAttackBlocked()) {
        json j{{"targetId", targetId}};
        _sendEvent("attackParried", j.dump());
        return;
    }

    stateIt->second.health -= damage;
    int newHealth = stateIt->second.health;

    json j{{"targetId",targetId},{"sourceId",sourceId},
           {"damage",damage},{"newHealth",newHealth}};
    _sendEvent("playerHit", j.dump());

    if (newHealth <= 0) {
        stateIt->second.alive = false;
        if (_mode == "ffa") {
            json dj{{"playerId",targetId},{"killerId",sourceId},{"canRespawn",true}};
            _sendEvent("playerDied", dj.dump());
        } else {
            _endGame(sourceId, targetId);
        }
    }
}

void GameRoom::_endGame(const std::string& winnerId,
                         const std::string& loserId)
{
    if (_phase == "ended") return;
    _phase = "ended";

    json j{{"winner",winnerId},{"loser",loserId}};
    _sendEvent("gameEnd", j.dump());

    // Also publish to Redis so Node.js can handle ELO / DB updates
    _redis.publish("game:end:" + _id, j.dump());
}

void GameRoom::_handleExplosion(const std::string& bombId,
                                 float cx, float cy, float cz,
                                 const std::string& ownerId)
{
    json evtJ{{"id",bombId},{"pos",{cx,cy,cz}},{"ownerId",ownerId}};
    _sendEvent("bombExploded", evtJ.dump());

    // Build body→player map for blast resolution
    auto damages = systems::BombSystem::resolveExplosion(
        *_world,
        {},  // allBodyIds (unused in new impl)
        _bodyToPlayer,
        cx, cy, cz,
        ownerId,
        _bodies);

    for (auto& de : damages) {
        _applyDamage(de.playerId, ownerId, de.damage);
    }
}

// ── state broadcasting ────────────────────────────────────────────────────────

void GameRoom::_broadcastState()
{
    ::game::RoomServerMessage msg;
    msg.set_room_id(_id);
    auto* snap = msg.mutable_state();
    snap->set_tick(_tickCount);
    snap->set_phase(_phase);

    for (auto& [pid, state] : _states) {
        auto* ps = snap->add_players();
        ps->set_player_id(pid);
        ps->set_health(state.health);
        ps->set_last_seq(state.lastSeq);
        ps->set_alive(state.alive);

        auto bodyIt = _bodies.find(pid);
        if (bodyIt != _bodies.end()) {
            auto pos = _world->getPosition(bodyIt->second);
            auto vel = _world->getVelocity(bodyIt->second);
            ps->mutable_position()->set_x(pos.x);
            ps->mutable_position()->set_y(pos.y);
            ps->mutable_position()->set_z(pos.z);
            ps->mutable_velocity()->set_x(vel.x);
            ps->mutable_velocity()->set_y(vel.y);
            ps->mutable_velocity()->set_z(vel.z);
        }

        auto& grapple = _grapples[pid];
        ps->set_grapple_active(grapple.active());
        if (grapple.active()) {
            ps->mutable_grapple_pos()->set_x(grapple.hookX());
            ps->mutable_grapple_pos()->set_y(grapple.hookY());
            ps->mutable_grapple_pos()->set_z(grapple.hookZ());
        }
    }

    _bombs->forEachLive(*_world, [&](
        const std::string& id,
        float px, float py, float pz,
        float rx, float ry, float rz, float rw,
        const std::string& skin)
    {
        auto* bs = snap->add_bombs();
        bs->set_id(id);
        bs->mutable_pos()->set_x(px); bs->mutable_pos()->set_y(py); bs->mutable_pos()->set_z(pz);
        bs->mutable_rot()->set_x(rx); bs->mutable_rot()->set_y(ry); bs->mutable_rot()->set_z(rz); bs->mutable_rot()->set_w(rw);
        bs->set_skin(skin);
    });

    _emit(msg);
}

void GameRoom::_sendEvent(const std::string& type,
                           const std::string& jsonPayload)
{
    ::game::RoomServerMessage msg;
    msg.set_room_id(_id);
    auto* evt = msg.mutable_event();
    evt->set_type(type);
    evt->set_json_payload(jsonPayload);
    _emit(msg);

    // Also publish to Redis for cross-process subscribers
    _redis.publish("game:event:" + _id,
                   "{\"type\":\"" + type + "\",\"data\":" + jsonPayload + "}");
}

void GameRoom::_emit(const ::game::RoomServerMessage& msg)
{
    std::vector<SendCb> sinks;
    {
        std::lock_guard<std::mutex> lock(_sendCbMutex);
        sinks.reserve(_sendCbs.size());
        for (auto& [_, cb] : _sendCbs) {
            if (cb) sinks.push_back(cb);
        }
    }

    for (auto& cb : sinks) {
        cb(msg);
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

std::vector<systems::PlayerEntry> GameRoom::_makePlayerEntries() const
{
    std::vector<systems::PlayerEntry> entries;
    entries.reserve(_bodies.size());
    for (auto& [pid, body] : _bodies)
        entries.push_back({ pid, body });
    return entries;
}

SpawnPoint GameRoom::_spawnPoint(int index) const
{
    if (_spawnPoints.empty()) return { 0.0f, 5.0f, 0.0f };
    return _spawnPoints[index % static_cast<int>(_spawnPoints.size())];
}

void GameRoom::_respawnPlayer(const std::string& pid, int spawnIndex)
{
    auto& state = _states[pid];
    state.health = Config::START_HEALTH;
    state.alive  = true;
    auto sp = _spawnPoint(spawnIndex);
    if (_bodies.count(pid)) {
        _world->setPosition(_bodies[pid], sp.x, sp.y, sp.z);
        _world->setVelocity(_bodies[pid], 0, 0, 0);
    }
    _grapples[pid].reset(*_world, _bodies[pid]);
}

} // namespace game
