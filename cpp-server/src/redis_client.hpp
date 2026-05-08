#pragma once
#include <hiredis/hiredis.h>
#include <string>
#include <functional>
#include <memory>

namespace redis {

/// Synchronous Redis publisher using hiredis.
/// Used to broadcast game events to any Node.js processes subscribed.
class RedisClient {
public:
    explicit RedisClient(const std::string& host = "127.0.0.1",
                         int                port = 6379);
    ~RedisClient();

    RedisClient(const RedisClient&)            = delete;
    RedisClient& operator=(const RedisClient&) = delete;

    bool isConnected() const;

    /// PUBLISH channel message
    bool publish(const std::string& channel,
                 const std::string& message);

    /// SET key value [EX seconds]
    bool set(const std::string& key,
             const std::string& value,
             int                ttlSeconds = 0);

    /// GET key → value (empty string on miss)
    std::string get(const std::string& key);

    /// DEL key
    void del(const std::string& key);

private:
    void freeReply(redisReply* r);

    redisContext* _ctx = nullptr;
};

} // namespace redis
