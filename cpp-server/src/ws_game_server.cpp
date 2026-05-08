#include "ws_game_server.hpp"

#include <array>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

namespace game {

#ifdef _WIN32

namespace {

constexpr const char* WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

static uint32_t rol32(uint32_t v, uint32_t s) {
    return (v << s) | (v >> (32 - s));
}

static std::array<uint8_t, 20> sha1(const std::string& input) {
    uint64_t bitLen = static_cast<uint64_t>(input.size()) * 8ULL;

    std::vector<uint8_t> msg(input.begin(), input.end());
    msg.push_back(0x80);
    while ((msg.size() % 64) != 56) msg.push_back(0x00);
    for (int i = 7; i >= 0; --i) {
        msg.push_back(static_cast<uint8_t>((bitLen >> (i * 8)) & 0xFF));
    }

    uint32_t h0 = 0x67452301;
    uint32_t h1 = 0xEFCDAB89;
    uint32_t h2 = 0x98BADCFE;
    uint32_t h3 = 0x10325476;
    uint32_t h4 = 0xC3D2E1F0;

    for (size_t chunk = 0; chunk < msg.size(); chunk += 64) {
        uint32_t w[80]{};
        for (int i = 0; i < 16; ++i) {
            size_t o = chunk + static_cast<size_t>(i) * 4;
            w[i] = (static_cast<uint32_t>(msg[o]) << 24) |
                   (static_cast<uint32_t>(msg[o + 1]) << 16) |
                   (static_cast<uint32_t>(msg[o + 2]) << 8) |
                   static_cast<uint32_t>(msg[o + 3]);
        }
        for (int i = 16; i < 80; ++i) {
            w[i] = rol32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }

        uint32_t a = h0;
        uint32_t b = h1;
        uint32_t c = h2;
        uint32_t d = h3;
        uint32_t e = h4;

        for (int i = 0; i < 80; ++i) {
            uint32_t f = 0;
            uint32_t k = 0;
            if (i < 20) {
                f = (b & c) | ((~b) & d);
                k = 0x5A827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ED9EBA1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8F1BBCDC;
            } else {
                f = b ^ c ^ d;
                k = 0xCA62C1D6;
            }

            uint32_t temp = rol32(a, 5) + f + e + k + w[i];
            e = d;
            d = c;
            c = rol32(b, 30);
            b = a;
            a = temp;
        }

        h0 += a;
        h1 += b;
        h2 += c;
        h3 += d;
        h4 += e;
    }

    std::array<uint8_t, 20> out{};
    auto writeWord = [&](uint32_t v, int idx) {
        out[idx]     = static_cast<uint8_t>((v >> 24) & 0xFF);
        out[idx + 1] = static_cast<uint8_t>((v >> 16) & 0xFF);
        out[idx + 2] = static_cast<uint8_t>((v >> 8) & 0xFF);
        out[idx + 3] = static_cast<uint8_t>(v & 0xFF);
    };

    writeWord(h0, 0);
    writeWord(h1, 4);
    writeWord(h2, 8);
    writeWord(h3, 12);
    writeWord(h4, 16);
    return out;
}

static std::string base64Encode(const uint8_t* data, size_t len) {
    static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((len + 2) / 3) * 4);

    size_t i = 0;
    while (i < len) {
        uint32_t octetA = i < len ? data[i++] : 0;
        uint32_t octetB = i < len ? data[i++] : 0;
        uint32_t octetC = i < len ? data[i++] : 0;

        uint32_t triple = (octetA << 16) | (octetB << 8) | octetC;

        out.push_back(tbl[(triple >> 18) & 0x3F]);
        out.push_back(tbl[(triple >> 12) & 0x3F]);
        out.push_back((i - 1) > len ? '=' : tbl[(triple >> 6) & 0x3F]);
        out.push_back(i > len ? '=' : tbl[triple & 0x3F]);
    }

    const size_t mod = len % 3;
    if (mod > 0) {
        out[out.size() - 1] = '=';
        if (mod == 1) out[out.size() - 2] = '=';
    }
    return out;
}

static std::string trim(const std::string& s) {
    size_t b = 0;
    while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    size_t e = s.size();
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return s.substr(b, e - b);
}

static bool recvAll(SOCKET sock, void* buf, size_t len) {
    auto* p = static_cast<uint8_t*>(buf);
    size_t got = 0;
    while (got < len) {
        int n = recv(sock, reinterpret_cast<char*>(p + got), static_cast<int>(len - got), 0);
        if (n <= 0) return false;
        got += static_cast<size_t>(n);
    }
    return true;
}

static bool sendAll(SOCKET sock, const void* buf, size_t len) {
    const auto* p = static_cast<const uint8_t*>(buf);
    size_t sent = 0;
    while (sent < len) {
        int n = send(sock, reinterpret_cast<const char*>(p + sent), static_cast<int>(len - sent), 0);
        if (n <= 0) return false;
        sent += static_cast<size_t>(n);
    }
    return true;
}

} // namespace

WsGameServer::WsGameServer(RoomManager& rm)
    : _rm(rm)
{}

WsGameServer::~WsGameServer() {
    stop();
}

bool WsGameServer::start(uint16_t port) {
    if (_running.load()) return true;

    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        std::fprintf(stderr, "[WsGameServer] WSAStartup failed\n");
        return false;
    }

    _listenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (_listenSocket == INVALID_SOCKET) {
        std::fprintf(stderr, "[WsGameServer] socket() failed\n");
        WSACleanup();
        return false;
    }

    BOOL reuse = TRUE;
    setsockopt(_listenSocket, SOL_SOCKET, SO_REUSEADDR,
               reinterpret_cast<const char*>(&reuse), sizeof(reuse));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(port);

    if (bind(_listenSocket, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        std::fprintf(stderr, "[WsGameServer] bind() failed on port %u\n", port);
        closesocket(_listenSocket);
        _listenSocket = INVALID_SOCKET;
        WSACleanup();
        return false;
    }

    if (listen(_listenSocket, SOMAXCONN) != 0) {
        std::fprintf(stderr, "[WsGameServer] listen() failed\n");
        closesocket(_listenSocket);
        _listenSocket = INVALID_SOCKET;
        WSACleanup();
        return false;
    }

    _running = true;
    _acceptThread = std::thread(&WsGameServer::_acceptLoop, this);
    std::printf("[WsGameServer] listening on 0.0.0.0:%u\n", static_cast<unsigned>(port));
    return true;
}

void WsGameServer::stop() {
    if (!_running.exchange(false)) return;

    if (_listenSocket != INVALID_SOCKET) {
        closesocket(_listenSocket);
        _listenSocket = INVALID_SOCKET;
    }

    if (_acceptThread.joinable()) {
        _acceptThread.join();
    }

    WSACleanup();
}

void WsGameServer::_acceptLoop() {
    while (_running.load()) {
        SOCKET client = accept(_listenSocket, nullptr, nullptr);
        if (client == INVALID_SOCKET) {
            if (_running.load()) {
                std::fprintf(stderr, "[WsGameServer] accept() failed\n");
            }
            break;
        }

        std::thread(&WsGameServer::_handleClient, this, client).detach();
    }
}

void WsGameServer::_handleClient(SOCKET clientSocket) {
    Session s{};
    s.socket = clientSocket;

    if (!_doHandshake(clientSocket)) {
        closesocket(clientSocket);
        return;
    }

    std::string payload;
    uint8_t opcode = 0;

    while (_running.load() && _readFrame(clientSocket, payload, opcode)) {
        if (opcode == 0x8) break;
        if (opcode != 0x1) continue;

        nlohmann::json msg;
        try {
            msg = nlohmann::json::parse(payload);
        } catch (...) {
            continue;
        }

        if (!_handleClientMessage(s, msg)) {
            break;
        }
    }

    if (s.subscribed) {
        _rm.removeSendCallback(s.roomId, s.subscriberId);
    }
    closesocket(clientSocket);
}

bool WsGameServer::_doHandshake(SOCKET sock) {
    std::string req;
    req.reserve(4096);

    char buf[1024];
    while (req.find("\r\n\r\n") == std::string::npos) {
        int n = recv(sock, buf, sizeof(buf), 0);
        if (n <= 0) return false;
        req.append(buf, buf + n);
        if (req.size() > 16384) return false;
    }

    std::istringstream iss(req);
    std::string line;
    std::string wsKey;
    while (std::getline(iss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const std::string keyPrefix = "Sec-WebSocket-Key:";
        if (line.rfind(keyPrefix, 0) == 0) {
            wsKey = trim(line.substr(keyPrefix.size()));
            break;
        }
    }

    if (wsKey.empty()) return false;

    const std::string acceptSrc = wsKey + WS_GUID;
    const auto digest = sha1(acceptSrc);
    const std::string accept = base64Encode(digest.data(), digest.size());

    std::ostringstream out;
    out << "HTTP/1.1 101 Switching Protocols\r\n";
    out << "Upgrade: websocket\r\n";
    out << "Connection: Upgrade\r\n";
    out << "Sec-WebSocket-Accept: " << accept << "\r\n";
    out << "\r\n";
    const std::string resp = out.str();
    return sendAll(sock, resp.data(), resp.size());
}

bool WsGameServer::_readFrame(SOCKET sock, std::string& payload, uint8_t& opcode) {
    uint8_t hdr[2]{};
    if (!recvAll(sock, hdr, 2)) return false;

    opcode = static_cast<uint8_t>(hdr[0] & 0x0F);
    const bool masked = (hdr[1] & 0x80) != 0;
    uint64_t len = static_cast<uint64_t>(hdr[1] & 0x7F);

    if (len == 126) {
        uint8_t ext[2]{};
        if (!recvAll(sock, ext, 2)) return false;
        len = (static_cast<uint64_t>(ext[0]) << 8) | static_cast<uint64_t>(ext[1]);
    } else if (len == 127) {
        uint8_t ext[8]{};
        if (!recvAll(sock, ext, 8)) return false;
        len = 0;
        for (int i = 0; i < 8; ++i) {
            len = (len << 8) | static_cast<uint64_t>(ext[i]);
        }
    }

    if (len > (1024ULL * 1024ULL)) return false;

    uint8_t mask[4]{};
    if (masked && !recvAll(sock, mask, 4)) return false;

    std::vector<uint8_t> data(static_cast<size_t>(len));
    if (len > 0 && !recvAll(sock, data.data(), static_cast<size_t>(len))) return false;

    if (masked) {
        for (size_t i = 0; i < data.size(); ++i) {
            data[i] ^= mask[i % 4];
        }
    }

    payload.assign(data.begin(), data.end());
    return true;
}

bool WsGameServer::_sendText(SOCKET sock, const std::string& payload, std::mutex* sendMu) {
    std::lock_guard<std::mutex> lock(*sendMu);

    std::vector<uint8_t> frame;
    frame.reserve(payload.size() + 16);
    frame.push_back(0x81);

    const size_t len = payload.size();
    if (len < 126) {
        frame.push_back(static_cast<uint8_t>(len));
    } else if (len <= 65535) {
        frame.push_back(126);
        frame.push_back(static_cast<uint8_t>((len >> 8) & 0xFF));
        frame.push_back(static_cast<uint8_t>(len & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; --i) {
            frame.push_back(static_cast<uint8_t>((static_cast<uint64_t>(len) >> (i * 8)) & 0xFF));
        }
    }

    frame.insert(frame.end(), payload.begin(), payload.end());
    return sendAll(sock, frame.data(), frame.size());
}

bool WsGameServer::_sendJson(SOCKET sock, const nlohmann::json& j, std::mutex* sendMu) {
    return _sendText(sock, j.dump(), sendMu);
}

bool WsGameServer::_handleClientMessage(Session& s, const nlohmann::json& msg) {
    const std::string type = msg.value("type", "");
    if (type.empty()) return true;

    if (type == "hello") {
        if (s.subscribed) return true;

        s.roomId = msg.value("room_id", "");
        s.playerId = msg.value("player_id", "");
        if (s.roomId.empty() || s.playerId.empty()) {
            _sendJson(s.socket, nlohmann::json{{"type", "error"}, {"message", "room_id and player_id are required"}}, &s.sendMutex);
            return false;
        }

        s.subscriberId = _nextSubscriberId.fetch_add(1);
        const bool ok = _rm.addSendCallback(s.roomId, s.subscriberId,
            [this, sock = s.socket, sendMu = &s.sendMutex](const ::game::RoomServerMessage& out) {
                const nlohmann::json j = _serializeServerMessage(out);
                _sendJson(sock, j, sendMu);
            });

        if (!ok) {
            _sendJson(s.socket, nlohmann::json{{"type", "error"}, {"message", "room not found"}}, &s.sendMutex);
            return false;
        }

        s.subscribed = true;
        _sendJson(s.socket, nlohmann::json{{"type", "helloAck"}, {"room_id", s.roomId}, {"player_id", s.playerId}}, &s.sendMutex);
        return true;
    }

    if (!s.subscribed) {
        _sendJson(s.socket, nlohmann::json{{"type", "error"}, {"message", "send hello first"}}, &s.sendMutex);
        return false;
    }

    if (type == "ping") {
        _sendJson(s.socket, nlohmann::json{{"type", "pong"}, {"t", msg.value("t", 0LL)}}, &s.sendMutex);
        return true;
    }

    ::game::RoomClientMessage in;
    in.set_room_id(s.roomId);
    in.set_player_id(s.playerId);

    if (type == "input") {
        const auto& inputs = msg.contains("inputs") ? msg["inputs"] : nlohmann::json::object();
        const auto& camDir = msg.contains("camDir") ? msg["camDir"] : nlohmann::json::object();
        const auto& camPos = msg.contains("camPos") ? msg["camPos"]
            : (msg.contains("cameraPos") ? msg["cameraPos"]
            : (msg.contains("cam_pos") ? msg["cam_pos"] : nlohmann::json::object()));

        auto* ip = in.mutable_input();
        ip->set_seq(msg.value("seq", 0));
        ip->set_forward(inputs.value("w", false));
        ip->set_backward(inputs.value("s", false));
        ip->set_left(inputs.value("a", false));
        ip->set_right(inputs.value("d", false));
        ip->set_jump(inputs.value("space", false));

        const float cx = camDir.value("x", 0.0f);
        const float cy = camDir.value("y", 0.0f);
        const float cz = camDir.value("z", 0.0f);

        const float yaw = std::atan2(cx, -cz);
        const float pitch = std::asin(std::max(-1.0f, std::min(1.0f, cy)));
        ip->set_cam_yaw(yaw);
        ip->set_cam_pitch(pitch);
        if (camPos.is_object() &&
            camPos.contains("x") && camPos.contains("y") && camPos.contains("z")) {
            ip->mutable_cam_pos()->set_x(camPos.value("x", 0.0f));
            ip->mutable_cam_pos()->set_y(camPos.value("y", 0.0f));
            ip->mutable_cam_pos()->set_z(camPos.value("z", 0.0f));
        }
    } else if (type == "grapple") {
        in.mutable_grapple();
    } else if (type == "spawnBomb") {
        const auto& pos = msg.contains("position") ? msg["position"] : nlohmann::json::object();
        const auto& imp = msg.contains("impulse") ? msg["impulse"] : nlohmann::json::object();
        auto* sb = in.mutable_spawn_bomb();
        sb->mutable_position()->set_x(pos.value("x", 0.0f));
        sb->mutable_position()->set_y(pos.value("y", 0.0f));
        sb->mutable_position()->set_z(pos.value("z", 0.0f));
        sb->mutable_impulse()->set_x(imp.value("x", 0.0f));
        sb->mutable_impulse()->set_y(imp.value("y", 0.0f));
        sb->mutable_impulse()->set_z(imp.value("z", 0.0f));
    } else if (type == "useGear") {
        const auto& cp = msg.contains("cameraPos") ? msg["cameraPos"] : nlohmann::json::object();
        const auto& cd = msg.contains("cameraDir") ? msg["cameraDir"] : nlohmann::json::object();
        auto* ug = in.mutable_use_gear();
        std::string gearType = msg.value("gearType", std::string{});
        if (gearType.empty()) gearType = msg.value("gearName", std::string{});
        ug->set_gear_type(gearType);
        ug->mutable_cam_pos()->set_x(cp.value("x", 0.0f));
        ug->mutable_cam_pos()->set_y(cp.value("y", 0.0f));
        ug->mutable_cam_pos()->set_z(cp.value("z", 0.0f));
        ug->mutable_cam_dir()->set_x(cd.value("x", 0.0f));
        ug->mutable_cam_dir()->set_y(cd.value("y", 0.0f));
        ug->mutable_cam_dir()->set_z(cd.value("z", 0.0f));
    } else if (type == "parry") {
        in.mutable_parry();
    } else if (type == "rematch") {
        in.mutable_rematch();
    } else {
        return true;
    }

    _rm.enqueueMessage(in);
    return true;
}

nlohmann::json WsGameServer::_serializeServerMessage(const ::game::RoomServerMessage& msg) {
    using nlohmann::json;

    json out;
    out["room_id"] = msg.room_id();

    if (msg.has_state()) {
        out["type"] = "state";
        out["tick"] = msg.state().tick();
        out["phase"] = msg.state().phase();

        out["players"] = json::array();
        for (const auto& p : msg.state().players()) {
            json jp;
            jp["player_id"] = p.player_id();
            jp["health"] = p.health();
            jp["last_seq"] = p.last_seq();
            jp["alive"] = p.alive();
            jp["grapple_active"] = p.grapple_active();

            jp["position"] = {
                {"x", p.position().x()},
                {"y", p.position().y()},
                {"z", p.position().z()}
            };
            jp["velocity"] = {
                {"x", p.velocity().x()},
                {"y", p.velocity().y()},
                {"z", p.velocity().z()}
            };
            jp["grapple_pos"] = {
                {"x", p.grapple_pos().x()},
                {"y", p.grapple_pos().y()},
                {"z", p.grapple_pos().z()}
            };
            out["players"].push_back(std::move(jp));
        }

        out["bombs"] = json::array();
        for (const auto& b : msg.state().bombs()) {
            json jb;
            jb["id"] = b.id();
            jb["skin"] = b.skin();
            jb["pos"] = {
                {"x", b.pos().x()},
                {"y", b.pos().y()},
                {"z", b.pos().z()}
            };
            jb["rot"] = {
                {"x", b.rot().x()},
                {"y", b.rot().y()},
                {"z", b.rot().z()},
                {"w", b.rot().w()}
            };
            out["bombs"].push_back(std::move(jb));
        }
        return out;
    }

    if (msg.has_event()) {
        out["type"] = "event";
        out["eventType"] = msg.event().type();
        try {
            out["data"] = nlohmann::json::parse(msg.event().json_payload());
        } catch (...) {
            out["data"] = msg.event().json_payload();
        }
        return out;
    }

    out["type"] = "unknown";
    return out;
}

#endif // _WIN32

} // namespace game
