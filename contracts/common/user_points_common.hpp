#pragma once
#include <eosio/eosio.hpp>
#include "../config.hpp"

using namespace eosio;
using namespace std;

struct[[eosio::table("userpoints") eosio::contract("userpoints")]] user_points {
    name                        user;
    uint32_t                    total_points      = 0;
    uint32_t                    redeemable_points = 0;
    uint16_t                    daily_points      = 0;
    uint32_t                    weekly_points     = 0;
    uint8_t                     top_level_claimed = 1;
    time_point_sec              last_action_timestamp;
    std::map<uint8_t, uint16_t> milestones = {};

    uint64_t primary_key() const {
        return user.value;
    }
    uint64_t by_total_points() const {
        return uint64_t(total_points);
    }
    uint64_t by_daily_points() const {
        return uint64_t((last_action_timestamp.sec_since_epoch() / SECONDS_PER_DAY) * SECONDS_PER_DAY) << uint64_t(32) | uint64_t(daily_points);
    }
    uint64_t by_weekly_points() const {
        return uint64_t((last_action_timestamp.sec_since_epoch() / SECONDS_PER_WEEK) * SECONDS_PER_WEEK) << uint64_t(32) | uint64_t(weekly_points);
    }
};

using user_points_table =
    multi_index<"userpoints"_n, user_points, indexed_by<"bytotalpts"_n, const_mem_fun<user_points, uint64_t, &user_points::by_total_points>>,
        indexed_by<"bydailypts"_n, const_mem_fun<user_points, uint64_t, &user_points::by_daily_points>>,
        indexed_by<"byweeklypts"_n, const_mem_fun<user_points, uint64_t, &user_points::by_weekly_points>>>;