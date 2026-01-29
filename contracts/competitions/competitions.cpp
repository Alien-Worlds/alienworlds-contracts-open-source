#include "../config.hpp"
#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>
#include <atomicdata.hpp>
#include <atomicassets-interface.hpp>
#include "../common/helpers.hpp"
#include "../common/contracts-common/string_format.hpp"
#include "../common/contracts-common/singleton.hpp"

static constexpr name COMP_STATE_PREPARING    = "preparing"_n;
static constexpr name COMP_STATE_1_PLAYING    = "1.playing"_n;
static constexpr name COMP_STATE_2_PROCESSING = "2.processing"_n;
static constexpr name COMP_STATE_3_AUDITING   = "3.auditing"_n;
static constexpr name COMP_STATE_4_REWARDING  = "4.rewarding"_n;
static constexpr name COMP_STATE_5_COMPLETE   = "5.complete"_n;
static constexpr name COMP_STATE_REJECTED     = "rejected"_n;
static constexpr name COMP_STATE_EXPIRED      = "expired"_n;
static constexpr name COMP_STATE_DELETING     = "deleting"_n;

CONTRACT competitions : public contract {

  public:
    competitions(name s, name code, datastream<const char *> ds) : contract(s, code, ds), _comps(s, s.value) {}

    TABLE comp_item {
        uint64_t                                   id;
        eosio::name                                admin;
        string                                     title;
        string                                     description;
        eosio::asset                               winnings_budget               = ZERO_TRILIUM;
        eosio::asset                               winnings_claimed              = ZERO_TRILIUM;
        uint16_t                                   winnings_allocated_perc_x_100 = 0;
        uint16_t                                   admin_pay_perc_x_100          = 0;
        uint32_t                                   shards_budget;
        uint32_t                                   shards_claimed;
        uint16_t                                   shards_allocated_perc_x_100;
        time_point_sec                             start_time;
        time_point_sec                             end_time;
        uint16_t                                   min_players;
        uint16_t                                   max_players;
        uint16_t                                   num_players = 0;
        name                                       state       = COMP_STATE_PREPARING;
        string                                     notice      = "";
        std::map<std::string, state_value_variant> extra_configs;

        uint64_t primary_key() const {
            return id;
        }

        uint64_t by_admin() const {
            return admin.value;
        }

        uint64_t state_key() const {
            return state.value;
        }

        uint64_t winnings_key() const {
            return S{winnings_budget.amount}.to<uint64_t>();
        }

        uint64_t start_key() const {
            return start_time.utc_seconds;
        }

        uint64_t end_key() const {
            return end_time.utc_seconds;
        }

        double proportion_full() const {
            return (double)num_players / (double)max_players;
        }

      private:
        // Extra configs accessor helpers
        auto set(const std::string &key, const state_value_variant &value) {
            return extra_configs.insert_or_assign(key, value);
        }

        void unset(const std::string &key) {
            const auto search = extra_configs.find(key);
            check(search != extra_configs.end(), "Cannot unset %s, no value set", key);
            extra_configs.erase(key);
        }

        template <typename T>
        T get(const std::string &key) const {
            const auto search = extra_configs.find(key);
            if (search != extra_configs.end()) {
                return std::get<T>(search->second);
            } else {
                return T{};
            }
        }

        template <typename T>
        std::optional<T> get_maybe(const std::string &key) const {
            const auto search = extra_configs.find(key);
            if (search != extra_configs.end()) {
                return std::get<T>(search->second);
            } else {
                return {};
            }
        }

      public:
        PROPERTY(bool, allow_late_registration);
    };

    using comps_table = eosio::multi_index<"comps"_n, comp_item, indexed_by<"admin"_n, const_mem_fun<comp_item, uint64_t, &comp_item::by_admin>>,
        indexed_by<"state"_n, const_mem_fun<comp_item, uint64_t, &comp_item::state_key>>,
        indexed_by<"winnings"_n, const_mem_fun<comp_item, uint64_t, &comp_item::winnings_key>>,
        indexed_by<"start"_n, const_mem_fun<comp_item, uint64_t, &comp_item::start_key>>,
        indexed_by<"end"_n, const_mem_fun<comp_item, uint64_t, &comp_item::end_key>>,
        indexed_by<"fullness"_n, const_mem_fun<comp_item, double, &comp_item::proportion_full>>>;

    // clang-format off
    SINGLETON(globals, competitions, 
        PROPERTY(uint32_t, min_prepare_dur_seconds); 
        PROPERTY(uint64_t, next_id); 
    )
    // clang-format on

    TABLE player_item {
        name     player;
        uint16_t reward_perc_x_100 = 0;
        uint16_t shards_perc_x_100 = 0;
        uint64_t live_score        = 0;
        bool     claimed           = false;

        uint64_t primary_key() const {
            return player.value;
        }

        uint64_t by_reward() const {
            return S{reward_perc_x_100}.to<uint64_t>();
        }

        uint64_t by_shards() const {
            return S{shards_perc_x_100}.to<uint64_t>();
        }

        uint64_t by_score() const {
            return live_score;
        }
        uint64_t by_claimed() const {
            return claimed ? 1 : 0;
        }
    };

    using players_table = eosio::multi_index<"players"_n, player_item, indexed_by<"score"_n, const_mem_fun<player_item, uint64_t, &player_item::by_score>>,
        indexed_by<"reward"_n, const_mem_fun<player_item, uint64_t, &player_item::by_reward>>,
        indexed_by<"shards"_n, const_mem_fun<player_item, uint64_t, &player_item::by_shards>>,
        indexed_by<"claimed"_n, const_mem_fun<player_item, uint64_t, &player_item::by_claimed>>>;

    TABLE sponsor_item {
        name  sponsor;
        asset reward = ZERO_TRILIUM;

        uint64_t primary_key() const {
            return sponsor.value;
        }
    };

    using sponsors_table = eosio::multi_index<"sponsors"_n, sponsor_item>;

    comps_table _comps;

    uint64_t next_id() {
        auto _globals = globals{get_self(), get_self().value};
        auto next_id  = _globals.get_next_id() + 1;
        _globals.set_next_id(next_id);
        return next_id;
    }

    ACTION setmindur(uint32_t min_prepare_dur_seconds) {
        require_auth(get_self());
        auto _globals = globals{get_self(), get_self().value};
        _globals.set_min_prepare_dur_seconds(min_prepare_dur_seconds);
    }

#ifdef IS_DEV
    ACTION initcomp(eosio::name admin, string title, string description, uint16_t admin_pay_perc_x_100, time_point_sec start, time_point_sec end,
        uint16_t min_players, uint16_t max_players, bool allow_late_registration, time_point_sec current_time, string image, string url) {
#else

    ACTION initcomp(eosio::name admin, string title, string description, uint16_t admin_pay_perc_x_100, time_point_sec start, time_point_sec end,
        uint16_t min_players, uint16_t max_players, bool allow_late_registration, string image, string url) {
        const auto current_time = now();

#endif

        if (!has_auth(get_self())) {
            require_auth(admin);
        }
        check(is_account(admin), "ERR:: provide admin account does not exist on chain.");
        check(title.size() <= 64, "ERR::Title has more than 64 bytes.");
        check(title.size() <= 700, "ERR::Description has more than 700 bytes.");

        // Validate image URL
        check(image.size() <= 512, "ERR::Image URL exceeds 512 characters");
        check(image.substr(0, 8) == "https://", "ERR::Image URL must start with https://");

        // Validate URL
        check(url.size() <= 512, "ERR::URL exceeds 512 characters");
        check(url.substr(0, 8) == "https://", "ERR::URL must start with https://");

        auto _globals             = globals{get_self(), get_self().value};
        auto min_prepare_duration = _globals.get_min_prepare_dur_seconds();
        ::check(
            start > (current_time + min_prepare_duration), "ERR::Start time must be in the future and after min prepare duration: %s", min_prepare_duration);
        check(end > start, "ERR::End time must be after start time.");
        _comps.emplace(get_self(), [&](comp_item &c) {
            c.id                            = next_id();
            c.admin                         = admin;
            c.title                         = title;
            c.description                   = description;
            c.min_players                   = min_players;
            c.max_players                   = max_players;
            c.admin_pay_perc_x_100          = admin_pay_perc_x_100;
            c.winnings_allocated_perc_x_100 = admin_pay_perc_x_100;
            c.start_time                    = start;
            c.end_time                      = end;
            c.state                         = COMP_STATE_PREPARING;
            if (allow_late_registration) {
                c.set_allow_late_registration(allow_late_registration);
            }
            c.extra_configs["image"] = image;
            c.extra_configs["url"]   = url;
        });
    }

    ACTION deletecomp(uint64_t id, uint32_t batch_size) {
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        if (!has_auth(get_self())) {
            require_auth(comp->admin);
        }
        check(comp->state == COMP_STATE_5_COMPLETE || comp->state == COMP_STATE_REJECTED || comp->state == COMP_STATE_DELETING,
            "ERR::Cannot delete a competition that is not in the rejected or completed state.");

        auto players = players_table(get_self(), id);
        auto player  = players.begin();
        while (player != players.end() && batch_size-- > 0) {
            player = players.erase(player);
        }

        if (player == players.end()) {
            _comps.erase(comp);
        } else {
            _comps.modify(comp, same_payer, [&](comp_item &c) {
                c.state = COMP_STATE_DELETING;
            });
        }
    }

    [[eosio::on_notify("alien.worlds::transfer")]] void transfer(name from, name to, asset quantity, string memo) {
        if (to == get_self()) {
            // This will check that it is the trilium token and that it is > 0
            check(ZERO_TRILIUM < quantity, "ERR::INVALID_TOKEN::Only TLM is accepted as winnings.");
            check(!memo.empty() && std::all_of(memo.begin(), memo.end(), ::isdigit),
                "ERR::INVALID_MEMO::Invalid memo for the winnings transfer. Please provide a valid competition ID.");
            auto comp_id = stoull(memo);
            auto comp    = _comps.require_find(comp_id, fmt("ERR::COMP_NOT_FOUND::No competition with the provided ID in the transfer memo: %s", comp_id));
            switch (comp->state.value) {
            case COMP_STATE_PREPARING.value:
            case COMP_STATE_1_PLAYING.value:
            case COMP_STATE_2_PROCESSING.value: {
                _comps.modify(comp, same_payer, [&](comp_item &c) {
                    c.winnings_budget += quantity;
                });

                auto sponsors = sponsors_table(get_self(), comp_id);
                auto sponsor  = sponsors.find(from.value);
                if (sponsor == sponsors.end()) {
                    sponsors.emplace(get_self(), [&](sponsor_item &s) {
                        s.sponsor = from;
                        s.reward  = quantity;
                    });
                } else {
                    sponsors.modify(sponsor, same_payer, [&](sponsor_item &s) {
                        s.reward += quantity;
                    });
                }
            } break;
            default:
                check(false, "ERR:: Invalid state to add to the winnings");
            }
        }
    }

    ACTION addshards(uint64_t id, uint32_t shards) {
        require_auth(get_self());
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        switch (comp->state.value) {
        case COMP_STATE_PREPARING.value:
        case COMP_STATE_1_PLAYING.value:
        case COMP_STATE_2_PROCESSING.value:
            _comps.modify(comp, same_payer, [&](comp_item &c) {
                c.shards_budget += shards;
            });
            break;
        default:
            check(false, "ERR:: Invalid state to add to the winnings");
        }
    }

#ifdef IS_DEV
    ACTION regplayer(uint64_t id, name player, time_point_sec current_time) {
#else
    ACTION regplayer(uint64_t id, name player) {
        const auto current_time = now();
#endif
        require_auth(player);
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        if (comp->get_allow_late_registration()) {
            check(comp->state == COMP_STATE_PREPARING || comp->state == COMP_STATE_1_PLAYING,
                "ERR::Not in the required state of `preparing` or `playing` to allow registering. state is: %s", comp->state);
        } else {
            check(comp->state == COMP_STATE_PREPARING, "ERR::Not in the required state of `preparing` to allow registering. state is: %s", comp->state);
            check(comp->start_time > current_time, "ERR::Competition has already started.");
        }
        check(comp->num_players < comp->max_players, "ERR:: The maximum number of players are already registered.");

        auto players = players_table(get_self(), id);
        check(players.find(player.value) == players.end(), "ERR::Player is already registered for this competition.");

        players.emplace(player, [&](player_item &p) {
            p.player = player;
        });

        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.num_players++;
        });
    }

    name get_state(comp_item comp, time_point_sec current_time) {
        // check the start time has passed and the competition is in the preparing state.
        if (comp.state == COMP_STATE_PREPARING && current_time >= comp.start_time) {
            if (current_time < comp.end_time) {
                if (comp.num_players >= comp.min_players) {
                    return COMP_STATE_1_PLAYING;
                } else if (comp.get_allow_late_registration()) {
                    return comp.state;
                } else {
                    return COMP_STATE_EXPIRED;
                }
            } else {
                return COMP_STATE_2_PROCESSING; // This should only happen if updatestate is not called between
                                                // start_time and end_time.
            }
        }
        // check the end time has passed and the competition is in the playing state.
        if (comp.state == COMP_STATE_1_PLAYING && current_time >= comp.end_time) {
            return COMP_STATE_2_PROCESSING;
        }
        return comp.state;
    }

#ifdef IS_DEV
    ACTION updatestate(uint64_t id, time_point_sec current_time) {
#else
    ACTION updatestate(uint64_t id) {
        const auto current_time = now();
#endif
        auto comp     = _comps.require_find(id, "ERR::No competition with the provided ID.");
        auto newState = get_state(*comp, current_time);

        if (comp->state != newState) {
            _comps.modify(comp, same_payer, [&](comp_item &c) {
                c.state = newState;
            });
        }
    }

/**
 * @brief Allow the admin to set the live score for a competition during play
 *
 * @param id - comp id
 * @param player_scores - a vector of pairs allowing multiple players scores to be updated in one txn. Should be in
 * the form of [["player1",123],["player2",345]]
 */
#ifdef IS_DEV

    ACTION scoreset(uint64_t id, vector<pair<name, uint64_t>> player_scores, time_point_sec current_time) {
        updatestate(id, current_time);
#else
    ACTION scoreset(uint64_t id, vector<pair<name, uint64_t>> player_scores) {
        const auto current_time = now();
        updatestate(id);
#endif
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        require_auth(comp->admin);
        check(comp->start_time < current_time, "ERR::NOT_STARTED::Competition has not yet started.");
        check(comp->end_time > current_time, "ERR::ENDED::Competition has completed playing.");

        auto players = players_table(get_self(), id);

        for (const auto player_score : player_scores) {
            auto player_itr = players.require_find(player_score.first.value, fmt("player: %s not registered.", player_score.first));
            players.modify(player_itr, same_payer, [&](player_item &p) {
                p.live_score = player_score.second;
            });
        }
    }

/**
 * @brief Allow the admin to increment the live score for a competition during play. This should result in the
 * current scores for each player being incremented by the amount supplied in the pair.
 *
 * @param id - comp id
 * @param player_scores - a vector of pairs allowing multiple players scores to be incremented in one txn. Should be
 * in the form of [["player1",1],["player2",3]].
 */
#ifdef IS_DEV
    ACTION scoreincr(uint64_t id, vector<pair<name, uint16_t>> player_scores, time_point_sec current_time) {

#else
    ACTION scoreincr(uint64_t id, vector<pair<name, uint16_t>> player_scores) {
        const auto current_time = now();
#endif
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        require_auth(comp->admin);
        check(comp->start_time < current_time, "ERR::NOT_STARTED::Competition has not yet started.");
        check(comp->end_time > current_time, "ERR::ENDED::Competition has completed playing.");

        auto players = players_table(get_self(), id);

        for (const auto player_score : player_scores) {
            auto player_itr = players.require_find(player_score.first.value, fmt("player: %s not registered.", player_score.first));
            players.modify(player_itr, same_payer, [&](player_item &p) {
                p.live_score += player_score.second;
            });
        }
    }

#ifdef IS_DEV
    ACTION declwinner(uint64_t id, name player, uint16_t reward_perc_x_100, uint16_t shards_perc_x_100, time_point_sec current_time) {
#else
    ACTION declwinner(uint64_t id, name player, uint16_t reward_perc_x_100, uint16_t shards_perc_x_100) {
        const auto current_time = now();
#endif
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        require_auth(comp->admin);
        // The first declwinner action will move the competition to the processing state.
        check(comp->end_time < current_time && (comp->state == COMP_STATE_2_PROCESSING), "ERR::Not in the required state of `processing`.");

        auto players      = players_table(get_self(), id);
        auto found_player = players.require_find(player.value, "ERR::Player not registered for this competition.");

        // update the deltas if the awards are being modifed from a previous call to this action.
        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.winnings_allocated_perc_x_100 = S{c.winnings_allocated_perc_x_100} - S{found_player->reward_perc_x_100};
            c.shards_allocated_perc_x_100   = S{c.shards_allocated_perc_x_100} - S{found_player->shards_perc_x_100};
            c.winnings_allocated_perc_x_100 = S{c.winnings_allocated_perc_x_100} + S{reward_perc_x_100};
            c.shards_allocated_perc_x_100   = S{c.shards_allocated_perc_x_100} + S{shards_perc_x_100};
            c.state                         = COMP_STATE_2_PROCESSING;
        });

        check(comp->winnings_allocated_perc_x_100 <= 100 * 100, "ERR:Exceeded winnings_budget allocation");
        check(comp->shards_allocated_perc_x_100 <= 100 * 100, "ERR:Exceeded shard allocation");

        players.modify(found_player, same_payer, [&](player_item &p) {
            p.reward_perc_x_100 = reward_perc_x_100;
            p.shards_perc_x_100 = shards_perc_x_100;
        });
    }

    ACTION completeproc(uint64_t id) {
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        require_auth(comp->admin);
        check(comp->state == COMP_STATE_2_PROCESSING, "ERR::Not in the required state of `processing`.");
        if (comp->winnings_budget.amount > 0) {
            auto winnings_delta = (100 * 100 - comp->winnings_allocated_perc_x_100) * 0.01;
            ::check(comp->winnings_allocated_perc_x_100 == 100 * 100, "ERR::Winnings have not been fully allocated. Missing: %s%%", winnings_delta);
        }
        if (comp->shards_budget > 0) {
            auto shards_delta = (100 * 100 - comp->shards_allocated_perc_x_100) * 0.01;
            ::check(comp->shards_allocated_perc_x_100 == 100 * 100, "ERR::Shards have not been fully allocated. Missing: %s%%", shards_delta);
        }
        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.state = COMP_STATE_3_AUDITING;
        });
    }

    ACTION approve(uint64_t id) {
        require_auth(get_self());
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        check(comp->state == COMP_STATE_3_AUDITING, "ERR::Not in the required state of `auditing`.");
        string memo       = fmt("Approved competition adminpay from: %s.", comp->id);
        auto   pay_amount = comp->winnings_budget * comp->admin_pay_perc_x_100 / 100 / 100;
        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.state = COMP_STATE_4_REWARDING;
            c.winnings_claimed += pay_amount;
        });
        action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), comp->admin, pay_amount, memo)).send();
    }

    ACTION dispute(uint64_t id, string notice) {
        require_auth(get_self());
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        check(comp->state == COMP_STATE_3_AUDITING, "ERR::Not in the required state of `auditing`.");
        check(notice.size() < 256, "ERR::notice must be less than 256 chars.");
        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.state  = COMP_STATE_2_PROCESSING;
            c.notice = notice;
        });
    }

    ACTION reject(uint64_t id, string notice) {
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        if (!has_auth(get_self())) {
            require_auth(comp->admin);
        }
        check(notice.size() < 256, "ERR::notice must be less than 256 chars.");
        check(comp->state != COMP_STATE_5_COMPLETE, "ERR::Cannot reject a complete competition.");
        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.state  = COMP_STATE_REJECTED;
            c.notice = notice;
        });

        const auto memo = std::string{fmt("rejected competition winnings from: %s.", comp->id)};

        if (comp->winnings_budget > ZERO_TRILIUM) {
            const auto message  = std::string{fmt("rejected competition winnings from: %s.", comp->id)};
            auto       sponsors = sponsors_table(get_self(), comp->id);
            auto       sponsor  = sponsors.begin();
            while (sponsor != sponsors.end()) {
                action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), sponsor->sponsor, sponsor->reward, memo))
                    .send();
                sponsor = sponsors.erase(sponsor);
            }
        }
    }

    ACTION claimreward(uint64_t id, name player) {
        auto comp = _comps.require_find(id, "ERR::No competition with the provided ID.");
        if (!has_auth(comp->admin) && !has_auth(get_self())) {
            require_auth(player);
        }

        auto players      = players_table(get_self(), id);
        auto found_player = players.require_find(player.value, "ERR::Player not registered for this competition.");
        check(comp->state == COMP_STATE_4_REWARDING, "ERR::Not in the required state of `rewarding`.");
        check(!found_player->claimed, "ERR::Player has already claimed their reward.");
        check(found_player->reward_perc_x_100 > 0 || found_player->shards_perc_x_100 > 0, "ERR::Player has no rewards to claim.");
        auto reward_to_pay = comp->winnings_budget * found_player->reward_perc_x_100 / 100 / 100;
        if (reward_to_pay.amount > 0) {
            string memo = fmt("Reward for competition: %s", id);

            // ensure the reward pay doesn't over spend the winnings budget.
            reward_to_pay.amount = min(comp->winnings_budget.amount - comp->winnings_claimed.amount, reward_to_pay.amount);

            action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), player, reward_to_pay, memo)).send();
        }
        auto shards_to_add = S{comp->shards_budget} * S{found_player->shards_perc_x_100}.to<uint32_t>() / S<uint32_t>{100} / S<uint32_t>{100};
        if (shards_to_add > S<uint32_t>{0}) {
            shards_to_add = min(S{comp->shards_budget} - S{comp->shards_claimed}, shards_to_add);

#ifdef IS_DEV
            action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, "addpoints"_n, make_tuple(player, shards_to_add.value(), now()))
                .send();

#else
            action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, "addpoints"_n, make_tuple(player, shards_to_add.value())).send();
#endif
        }
        players.modify(found_player, same_payer, [&](player_item &p) {
            p.claimed = true;
        });

        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.winnings_claimed += reward_to_pay;
            c.shards_claimed = S{c.shards_claimed} + shards_to_add;

            const bool winnings_done = (c.winnings_budget.amount == 0) || (c.winnings_claimed == c.winnings_budget);
            const bool shards_done   = (c.shards_budget == 0) || ((c.shards_budget - c.shards_claimed) <= 1);
            if (winnings_done && shards_done) {
                c.state = COMP_STATE_5_COMPLETE;
            }
        });
    }

    ACTION postnotice(uint64_t id, string notice) {
        auto comp = _comps.require_find(id, "ERR::NO_COMP::No competition with the provided ID.");
        if (!has_auth(comp->admin)) {
            require_auth(get_self());
        }
        check(notice.size() < 256, "ERR::notice must be less than 256 chars.");
        check(comp->state != COMP_STATE_5_COMPLETE && comp->state != COMP_STATE_REJECTED,
            "ERR::POST_NOTICE_COMPLETED::Cannot post a notice for a complete competition.");
        _comps.modify(comp, same_payer, [&](comp_item &c) {
            c.notice = notice;
        });
    };
};
