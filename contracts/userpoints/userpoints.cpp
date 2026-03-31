#include "userpoints.hpp"
#include "../common/contracts-common/string_format.hpp"

using namespace alienworlds;
using namespace atomicdata;

userpoints::userpoints(name s, name code, datastream<const char *> ds)
    : contract(s, code, ds), _userterms("federation"_n, "federation"_n.value), _userpoints(get_self(), get_self().value),
      _pointoffers(get_self(), get_self().value), _leveloffers(get_self(), get_self().value), _premintoffers(get_self(), get_self().value),
      _premintassets(get_self(), get_self().value), _whitelist(get_self(), get_self().value) {}

void userpoints::setptsreward(uint64_t id, time_point_sec start, time_point_sec end, uint64_t template_id, uint32_t required) {

    require_auth(get_self());
    check(end > start, "End date earlier than start date.");

    auto current_offer = _pointoffers.find(id);
    if (current_offer == _pointoffers.end()) {

        _pointoffers.emplace(get_self(), [&](points_offer &o) {
            o.id          = id;
            o.start       = start;
            o.end         = end;
            o.template_id = template_id;
            o.required    = required;
        });
    } else {
        _pointoffers.modify(current_offer, same_payer, [&](points_offer &o) {
            o.start       = start;
            o.end         = end;
            o.template_id = template_id;
            o.required    = required;
        });
    }
}

void userpoints::delptsreward(uint64_t id) {
    require_auth(get_self());
    auto current_offer = _pointoffers.require_find(id, "offer not found.");

    _pointoffers.erase(current_offer);
}

void userpoints::setlvlreward(uint64_t id, uint8_t level, uint64_t template_id, uint32_t required) {
    require_auth(get_self());
    auto current_offer = _leveloffers.find(id);
    if (current_offer == _leveloffers.end()) {
        _leveloffers.emplace(get_self(), [&](level_offer &o) {
            o.id          = id;
            o.level       = level;
            o.template_id = template_id;
            o.required    = required;
        });
    } else {
        _leveloffers.modify(current_offer, same_payer, [&](level_offer &o) {
            o.template_id = template_id;
            o.level       = level;
            o.required    = required;
        });
    }
}

void userpoints::dellvlreward(uint64_t id) {
    require_auth(get_self());
    auto current_offer = _leveloffers.require_find(id, "level offer not found.");

    _leveloffers.erase(current_offer);
}

#ifdef IS_DEV
void userpoints::redeempntnft(name user, uint64_t offer_id, time_point_sec current_time) {
#else
void userpoints::redeempntnft(name user, uint64_t offer_id) {
    auto current_time = time_point_sec(current_time_point());
#endif
    require_auth(user);
    check(!is_flagged(user), "A terms violation was detected. You are unable to redeem your points. Please contact support to appeal this decision.");

    auto offer = _pointoffers.require_find(offer_id, "offer does not exist.");

    auto userPoints = _userpoints.require_find(user.value, "No points to redeem.");
    check(current_time > offer->start, "Reward offer has not yet started.");

    check(current_time < offer->end, "Reward offer has expired.");
    check(offer->required <= userPoints->redeemable_points, "Not enough points available.");

    _userpoints.modify(userPoints, user, [&](user_points &p) {
        p.redeemable_points -= offer->required;
    });

    mint_asset(offer->template_id, user);
}

void userpoints::redeemprenft(name user, uint64_t offer_id) {

    require_auth(user);
    check(!is_flagged(user), "A terms violation was detected. You are unable to redeem your points. Please contact support to appeal this decision.");

    const auto offer = _premintoffers.require_find(offer_id, "ERR:OFFER_DOES_NOT_EXIST::Offer for offer_id does not exist.");

    auto userPoints = _userpoints.require_find(user.value, "No points to redeem.");

    check(offer->required <= userPoints->redeemable_points, "Not enough points available. Need %s but only has %s", offer->required,
        userPoints->redeemable_points);

    _userpoints.modify(userPoints, user, [&](auto &p) {
        p.redeemable_points -= offer->required;
    });

    auto assets    = _premintassets.get_index<"byoffer"_n>();
    auto asset_itr = assets.find(offer_id);
    check(asset_itr != assets.end() && asset_itr->offer_id == offer_id, "No Assets available for this offer.");

    action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "transfer"_n,
        make_tuple(get_self(), user, vector<uint64_t>{asset_itr->asset_id}, "NFT points reward."s))
        .send();

    if (is_account(offer->callback)) {
        action(permission_level{get_self(), "active"_n}, offer->callback, "logredeemnft"_n, make_tuple(user, asset_itr->asset_id, offer->message)).send();
    }

    // Assuming that assets are sorted by asset_id as a secondary sorting within the offer_id in order to get the next
    // mint number available for the offer.
    asset_itr = assets.erase(asset_itr);

    _premintoffers.modify(offer, user, [&](premint_offer &offer) {
        offer.available_count--;
        if (asset_itr != assets.end() && asset_itr->offer_id == offer_id) {
            offer.next_asset_id = asset_itr->asset_id;
        }
    });
}

void userpoints::redeemlvlnft(name user, uint64_t id) {
    require_auth(user);
    check(!is_flagged(user), "A terms violation was detected. You are unable to redeem your points. Please contact support to appeal this decision.");

    auto userPoints = _userpoints.require_find(user.value, "No points to redeem.");

    auto offer = _leveloffers.require_find(id, fmt("No level offer available with id: %s.", id));
    check(offer->required <= userPoints->total_points, "Not enough points earned to claim next level reward.");
    check(offer->level == userPoints->top_level_claimed + 1,
        fmt("User is only eligible to claim offer for level: %s. This offer is for level: %s.", (userPoints->top_level_claimed + 1), offer->level));

    _userpoints.modify(userPoints, user, [&](user_points &p) {
        p.top_level_claimed = offer->level;
    });

    mint_asset(offer->template_id, user);
}

void userpoints::setmilestone(name user, uint8_t key, uint16_t value) {
    require_auth(get_self());

    auto userPoints = _userpoints.require_find(user.value, "user should already have a userpoints row before setting milestones.");

    _userpoints.modify(userPoints, get_self(), [&](user_points &u) {
        u.milestones[key] = value;
    });
}

#ifdef IS_DEV
void userpoints::testaddpnts(name user, uint32_t points, time_point_sec current_time) {
    // check(false, "testaddpnts called user: %s points: %s", user, points);
#else
void userpoints::testaddpnts(name user, uint32_t points) {
#endif
    require_auth(get_self());
}

#ifdef IS_DEV
void userpoints::addpoints(name user, uint32_t points, time_point_sec current_time) {
#else
void userpoints::addpoints(name user, uint32_t points) {
    auto current_time = time_point_sec(current_time_point());
#endif
    require_auth(get_self());
    // Check if accepted terms. If not silently exit and don't add points.
    auto terms = _userterms.find(user.value);
    if (terms == _userterms.end()) {
        return;
    }

    // check if daily points is greater than max_userpoints_value, cap it at the max value
    constexpr auto max_userpoints_value = std::numeric_limits<uint16_t>::max();
    auto           daily_points         = (points > max_userpoints_value) ? max_userpoints_value : points;

    auto userPoints = _userpoints.find(user.value);

    if (userPoints == _userpoints.end()) {
        return;
    }

    _userpoints.modify(userPoints, same_payer, [&](user_points &p) {
        // Reset the clock to the start of the day.
        auto lastActionStartOfDay = time_point_sec((p.last_action_timestamp.sec_since_epoch() / SECONDS_PER_DAY) * SECONDS_PER_DAY);

        p.total_points      = S{p.total_points} + S{points};
        p.redeemable_points = S{p.redeemable_points} + S{points};

        // First action for today
        if (current_time > (lastActionStartOfDay + SECONDS_PER_DAY)) {
            p.daily_points = S{daily_points}.to<uint16_t>();
        } else {
            // check for overflow and set to max value instead of overflowing
            if (daily_points > max_userpoints_value - p.daily_points) {
                p.daily_points = max_userpoints_value;
            } else {
                p.daily_points = S{p.daily_points} + S{daily_points}.to<uint16_t>();
            }
        }

        // Reset the clock to the start of the week.
        auto lastActionStartOfWeek = time_point_sec((lastActionStartOfDay.sec_since_epoch() / SECONDS_PER_WEEK) * SECONDS_PER_WEEK);
        if (current_time > (lastActionStartOfWeek + SECONDS_PER_WEEK)) {
            p.weekly_points = points;
        } else {
            p.weekly_points = S{p.weekly_points} + S{points};
        }

        p.last_action_timestamp = current_time;
    });
}

#ifdef IS_DEV
ACTION userpoints::reclaim(const std::vector<name> &users, time_point_sec current_time) {
#else
ACTION userpoints::reclaim(const std::vector<name> &users) {
    const auto    current_time       = now();
#endif
    // No require auth. This can be called by anyone by design, since it's a housekeeping action.

    const uint32_t INACTIVITY_THRESHOLD = 60 * 60 * 24 * 180; // 180 days (should match reclaim.js)

    for (const auto &user : users) {
        const auto userPoints = _userpoints.find(user.value);
        if (userPoints != _userpoints.end()) {
            // Only erase if user has been inactive for longer than the threshold
            const auto expires_at = userPoints->last_action_timestamp.sec_since_epoch() + INACTIVITY_THRESHOLD;
            if (current_time.sec_since_epoch() > expires_at) {
                _userpoints.erase(userPoints);
            }
        }
    }
}

ACTION userpoints::reguser(name user) {
    require_auth(user);

    auto userPoints = _userpoints.find(user.value);
    if (userPoints == _userpoints.end()) {
        _userpoints.emplace(user, [&](user_points &p) {
            p.user = user;
        });
    }
}

ACTION userpoints::unreguser(name user) {
    require_auth(get_self());

    auto userPoints = _userpoints.find(user.value);
    check(userPoints != _userpoints.end(), "User points not found for user %s.", user);
    _userpoints.erase(userPoints);
}

/* Private methods */

void userpoints::mint_asset(uint32_t template_id, name destn_user) {
#ifdef IS_DEV
    eosio::print_f("Minting NFT: % to: %", template_id, destn_user);
#else
    auto          templates          = atomicassets::templates_t{NFT_CONTRACT, NFT_COLLECTION.value};
    auto          matching_template  = templates.require_find(template_id, "Unknown template.");
    ATTRIBUTE_MAP immutable_data     = {};
    ATTRIBUTE_MAP mutable_data       = {};
    vector<asset> quantities_to_back = {};

    auto mint_action = action(permission_level{"mint.worlds"_n, "issue"_n}, NFT_CONTRACT, "mintasset"_n,
        make_tuple("mint.worlds"_n, NFT_COLLECTION, matching_template->schema_name, template_id, destn_user, immutable_data, mutable_data, quantities_to_back));

    mint_action.send();
#endif
}

/**
 * @brief This action listens for NFT deposits to this contract and creates a premintoffer for these NFTs. The memo
 * of the transfer needs to be in the format of "<points_required>:<message>:<callback(optional)>".
 *
 * @param from
 * @param to
 * @param asset_ids
 * @param memo
 */
void userpoints::transfer(const name from, const name to, const vector<uint64_t> &asset_ids, const string &memo) {
    // We are only interested in incoming transfers to the userpoints contract.
    if (from == get_self() || to != get_self()) {
        return;
    }

    if (asset_ids.size() == 0) {
        return;
    }

    const auto offer_id = parse_memo(memo);

    const auto offer = _premintoffers.find(offer_id);
    ::check(offer != _premintoffers.end(), "ERR:OFFER_DOES_NOT_EXIST::No offer exists for id: %s.", offer_id);

    auto _aa_assets = atomicassets::assets_t(NFT_CONTRACT, get_self().value);

    for (const auto &asset_id : asset_ids) {
        ::check(_premintassets.find(asset_id) == _premintassets.end(), "ERR:OFFER_ALREADY_EXISTS::Offer already exists for asset %s.", asset_id);
        auto item = _aa_assets.find(asset_id);
        ::check(item->collection_name == offer->collection_name, "Asset: %s from collection: %s doesn't match the collection: %s in the offer: %s", asset_id,
            item->collection_name, offer->collection_name, offer_id);

        ::check(item->template_id == offer->template_id, "Asset: %s from template: %s doesn't match the template: %s in the offer: %s", asset_id,
            item->template_id, offer->template_id, offer_id);

        _premintassets.emplace(get_self(), [&](premint_asset &offer) {
            offer.asset_id = asset_id;
            offer.offer_id = offer_id;
        });
    }

    // find the lowest mint number for the given offer.
    auto assets    = _premintassets.get_index<"byoffer"_n>();
    auto asset_itr = assets.find(offer_id);

    _premintoffers.modify(offer, same_payer, [&](premint_offer &offer) {
        offer.available_count += asset_ids.size();
        offer.next_asset_id = asset_itr->asset_id;
    });
}

ACTION userpoints::crtpreoffer(const name creator, const uint64_t offer_id, const name collection_name, const int32_t template_id, const uint32_t required,
    const string &message, const name &callback) {
    require_auth(creator);
    require_auth(get_self());

    ::check(_premintoffers.find(offer_id) == _premintoffers.end(), "ERR:OFFER_EXISTS::An offer with id %s already exists,", offer_id);
    _premintoffers.emplace(creator, [&](premint_offer &offer) {
        offer.offer_id        = offer_id;
        offer.creator         = creator;
        offer.required        = required;
        offer.collection_name = collection_name;
        offer.template_id     = template_id;
        offer.message         = message;
        offer.callback        = callback;
    });
}

ACTION userpoints::updpreoffer(const name creator, const uint64_t offer_id, const uint32_t required, const string &message, const name &callback) {
    require_auth(creator);

    auto found_offer = _premintoffers.find(offer_id);
    ::check(found_offer != _premintoffers.end(), "ERR:OFFER_DOES_NOT_EXISTS::An offer with id %s doesn't exist.", offer_id);
    ::check(found_offer->creator == creator, "ERR:PERMISSION_DENIED::Only the creator %s can update an offer.", creator);
    _premintoffers.modify(found_offer, same_payer, [&](premint_offer &offer) {
        offer.required = required;
        offer.message  = message;
        offer.callback = callback;
    });
}

ACTION userpoints::rmvpreoffer(const uint64_t offer_id, uint16_t batch_size, name nft_receiver) {
    auto found_offer = _premintoffers.require_find(offer_id, fmt("Unable to find offer: %s", offer_id));
    if (!has_auth(found_offer->creator)) {
        require_auth(get_self());
    }
    auto assets    = _premintassets.get_index<"byoffer"_n>();
    auto asset_itr = assets.find(offer_id);
    check(asset_itr != assets.end() && asset_itr->offer_id == offer_id, "No Assets available for this offer.");

    vector<uint64_t> asset_ids = {};

    while (batch_size-- > 0 && asset_itr != assets.end() && asset_itr->offer_id == offer_id) {
        asset_ids.push_back(asset_itr->asset_id);
        asset_itr = assets.erase(asset_itr);
    }

    action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "transfer"_n, make_tuple(get_self(), nft_receiver, asset_ids, "NFT points reward."s)).send();

    if (found_offer->available_count == asset_ids.size()) { // Remove the offer if all assets are transferred.
        _premintoffers.erase(found_offer);
    } else {
        _premintoffers.modify(found_offer, same_payer, [&](premint_offer &offer) {
            offer.next_asset_id = asset_itr->asset_id;
            offer.available_count -= asset_ids.size();
        });
    }
}

ACTION userpoints::addwhitelist(name account, name authorizer) {
    const auto MAX_WHITELIST_QUOTA = 1;
    require_auth(get_self());
    require_auth(authorizer);
    auto configs = daoconfigs{get_self(), authorizer.value};
    check(configs.get_num_added_to_whitelist() < MAX_WHITELIST_QUOTA,
        "ERR:WHITELIST_QUOTA_EXCEEDED::Whitelist quota exhausted. Please remove an account before adding another.");
    configs.set_num_added_to_whitelist(configs.get_num_added_to_whitelist() + 1);
    auto existing = _whitelist.find(account.value);
    check(existing == _whitelist.end(), "ERR:ACCOUNT_ALREADY_WHITELISTED::Account is already whitelisted.");
    _whitelist.emplace(authorizer, [&](auto &w) {
        w.account    = account;
        w.authorizer = authorizer;
    });
}

ACTION userpoints::rmvwhitelist(name account) {
    require_auth(get_self());
    auto existing = _whitelist.require_find(account.value);
    check(existing != _whitelist.end(), "ERR:ACCOUNT_NOT_WHITELISTED::Account is not whitelisted.");
    auto configs = daoconfigs{get_self(), existing->authorizer.value};
    configs.set_num_added_to_whitelist(configs.get_num_added_to_whitelist() - 1);
    _whitelist.erase(existing);
}

// Helper function that parses the memo and returns a uint64_t for the offer_id
uint64_t userpoints::parse_memo(const string &memo) {
    // The memo must be a number, nothing else
    check(memo.find_first_not_of("0123456789") == string::npos, "ERR:INVALID_MEMO::Memo must be a positive number.");

    // atoi returns 0 if string is not a valid number instead of raising an exception (which we wouldn't be able to
    // catch). We cannot distinguish between an invalid number and 0, but the value must be greater than 0 for it to
    // be valid anyway, so we're good.
    const uint64_t offer_id = S{atoi(memo.c_str())}.to<uint64_t>();
    check(offer_id > 0, "ERR:INVALID_OFFER_ID::Invalid Offer ID, must be > 0.");

    return offer_id;
}

#ifdef IS_DEV
ACTION userpoints::logredeemnft(const name user, const uint64_t asset_id, const string &message) {
    auto x = logredeem{get_self(), get_self()};
    x.set_count(x.get_count() + 1);
}
#endif