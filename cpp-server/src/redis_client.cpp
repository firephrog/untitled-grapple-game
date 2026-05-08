#include "redis_client.hpp"

#include <cstdio>
#include <cstring>

namespace redis {

RedisClient::RedisClient(const std::string& host, int port)
{
    _ctx = redisConnect(host.c_str(), port);
    if (!_ctx || _ctx->err) {
        if (_ctx) {
            std::fprintf(stderr, "[Redis] connection error: %s\n", _ctx->errstr);
            redisFree(_ctx);
            _ctx = nullptr;
        } else {
            std::fprintf(stderr, "[Redis] can't allocate redis context\n");
        }
    }
}

RedisClient::~RedisClient()
{
    if (_ctx) redisFree(_ctx);
}

bool RedisClient::isConnected() const
{
    return _ctx && !_ctx->err;
}

bool RedisClient::publish(const std::string& channel,
                           const std::string& message)
{
    if (!isConnected()) return false;
    redisReply* r = static_cast<redisReply*>(
        redisCommand(_ctx, "PUBLISH %s %b",
                     channel.c_str(),
                     message.data(), message.size()));
    bool ok = r && r->type != REDIS_REPLY_ERROR;
    freeReply(r);
    return ok;
}

bool RedisClient::set(const std::string& key,
                       const std::string& value,
                       int                ttlSeconds)
{
    if (!isConnected()) return false;
    redisReply* r;
    if (ttlSeconds > 0) {
        r = static_cast<redisReply*>(
            redisCommand(_ctx, "SET %s %b EX %d",
                         key.c_str(), value.data(), value.size(),
                         ttlSeconds));
    } else {
        r = static_cast<redisReply*>(
            redisCommand(_ctx, "SET %s %b",
                         key.c_str(), value.data(), value.size()));
    }
    bool ok = r && r->type != REDIS_REPLY_ERROR;
    freeReply(r);
    return ok;
}

std::string RedisClient::get(const std::string& key)
{
    if (!isConnected()) return {};
    redisReply* r = static_cast<redisReply*>(
        redisCommand(_ctx, "GET %s", key.c_str()));
    std::string result;
    if (r && r->type == REDIS_REPLY_STRING)
        result.assign(r->str, r->len);
    freeReply(r);
    return result;
}

void RedisClient::del(const std::string& key)
{
    if (!isConnected()) return;
    redisReply* r = static_cast<redisReply*>(
        redisCommand(_ctx, "DEL %s", key.c_str()));
    freeReply(r);
}

void RedisClient::freeReply(redisReply* r)
{
    if (r) freeReplyObject(r);
}

} // namespace redis
