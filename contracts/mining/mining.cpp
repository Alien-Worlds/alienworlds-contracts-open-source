#include "mining.hpp"
#include "../common/user_points_common.hpp"

using namespace alienworlds;

mining::mining(name s, name code, datastream<const char *> ds)
    : contract(s, code, ds), _miners(get_self(), get_self().value), _deposits(get_self(), get_self().value), _bags(get_self(), get_self().value),
      _tooluse(get_self(), get_self().value), _land_comms(get_self(), get_self().value), _miner_claims(get_self(), get_self().value) {}

#ifdef BOT_CHECK
#include "../../alienworlds-contracts-private/closed/mining_actions.cpp"
#else
void mining::setparam(uint64_t key, uint64_t value) {}

void mining::setparams(vector<std::pair<uint64_t, uint64_t>> params) {}

void mining::testparam(name key) {}

void mining::clearparams() {}

void mining::insert_miner(const name miner) {}

ACTION mining::setconfig(const std::string &key, const state_value_variant &value) {
    require_auth(get_self());
    auto conf = config{get_self(), get_self()};

    if (key == "claimmines_delay_secs") {
        conf.set_claimmines_delay_secs(std::get<uint32_t>(value));
    } else {
        check(false, "Invalid key");
    }
}
#endif

void mining::unlockbag(name miner) {
    require_auth(get_self());

    auto bag_itr = _bags.find(miner.value);
    check(bag_itr != _bags.end(), "ERR::BAG_NOT_FOUND::Bag not found");

    _bags.modify(bag_itr, same_payer, [&](auto &b) {
        b.locked = false;
    });
}
/*void mining::setnfttarget(double target) {
    auto state = contr_nftstate::get_current_state(get_self(), get_self());
    state.target = target;
    if (state.allocation == 0.0){
        state.allocation = target;
    }
    state.save(get_self(), get_self(), get_self());
}*/

void mining::setbag(name account, vector<uint64_t> items) {
    require_auth(account);

    check(items.size() <= 3, "ERR::BAG_MAX_3::Bag can only contain a maximum of 3 items");

    // check they own everything they are putting into their bag and that it is a tool
    auto               _aa_assets = atomicassets::assets_t(NFT_CONTRACT, account.value);
    std::set<uint64_t> dup_set{};

    for (auto id : items) {
        auto tool = _aa_assets.get(id, "ERR::BAG_MUST_OWN::You must own all the items in your mining bag");
        check(tool.schema_name == TOOLS_SCHEMA, "ERR::BAG_NOT_TOOLS::All assets in the bag must be mining tools");
        check(tool.collection_name == NFT_COLLECTION, "ERR::BAG_NOT_ALIEN::All assets in the bag must belong to the Alien Worlds collection");

        check(dup_set.insert(id).second, "ERR::BAG_DUPLICATE::Duplicate item in bag");
    }

    auto bag_itr = _bags.find(account.value);
    if (bag_itr == _bags.end()) {
        _bags.emplace(account, [&](auto &b) {
            b.account = account;
            b.items   = items;
        });
    } else {
        check(!bag_itr->locked, "ERR::BAG_LOCKED::Bag is locked, please wait for cool down");

        _bags.modify(bag_itr, account, [&](auto &b) {
            b.items = items;
        });
    }
}

void mining::setland(name account, uint64_t land_id) {
    require_auth(account);

    auto miner_inst = _miners.find(account.value);
    if (miner_inst == _miners.end()) {
        ATTRIBUTE_MAP immutable_data     = {};
        ATTRIBUTE_MAP mutable_data       = {};
        vector<asset> quantities_to_back = {};

        action(permission_level{"mint.worlds"_n, "issue"_n}, NFT_CONTRACT, "mintasset"_n,
            make_tuple("mint.worlds"_n, NFT_COLLECTION, TOOLS_SCHEMA, FREE_TOOL_ID, account, immutable_data, mutable_data, quantities_to_back))
            .send();

        _miners.emplace(account, [&](auto &m) {
            m.miner        = account;
            m.current_land = land_id;
            m.last_mine    = time_point_sec(0);
        });
    } else {

        /* add 6 hours to the next mining time */
        //        uint32_t next_mine_time = current_time_point().sec_since_epoch() + (60 * 10);
        _miners.modify(miner_inst, account, [&](auto &m) {
            m.current_land = land_id;
            //            m.last_mine    = time_point_sec(next_mine_time);
        });
    }

    // check the bag is not locked
    auto bag_itr = _bags.find(account.value);
    if (bag_itr != _bags.end()) {
        check(!bag_itr->locked, "ERR::BAG_LOCKED_LAND::Cannot change land while bag is locked");
    }
}

#ifndef BOT_CHECK
void mining::assert_bot(const checksum256 &trx_id, const config &conf) {}
#endif

void mining::mine(const name miner, const vector<char> &nonce, binary_extension<name> notify) {
    require_auth(miner);

    const auto transaction_data = get_trx_data();
    const auto trx_id           = get_trxid(transaction_data);

    const bool is_bot = check_is_bot(miner, trx_id);

    // Moving this check here because changes to the check_trx could flag accounts and then without asserting. Therefore
    // this should happen before the mining logic rewards the miner and updates other state.
    if (!notify.has_value() && !has_auth(external_bot_checker)) {
        check_trx(transaction_data, miner);
    }

    const auto &miner_inst = _miners.get(miner.value, "ERR::MINER_NOT_INIT::Miner has not been initiated yet, choose land to mine on");
    const auto  land_id    = miner_inst.current_land;
    check(land_id > uint64_t{}, "ERR::LAND_NOT_SELECTED::Land has not been selected");

    const auto &bag = _bags.get(miner.value, "ERR::MUST_SET_BAG::You must set your bag before mining");

    // get landowner
    const auto  _landregs = landregs_table(LANDOWNERS_ACCOUNT, LANDOWNERS_ACCOUNT.value);
    const auto &landreg   = _landregs.get(land_id, "ERR::LAND_NOT_FOUND::Land not found in registry");
    const auto  landowner = landreg.owner;

    const auto land_data     = nft_get_template_data(landowner, land_id, LAND_SCHEMA);
    const auto [md, land_md] = mining_data(miner, land_id, bag, landowner, land_data);

    auto user_points       = user_points_table(USERPOINTS_ACCOUNT, USERPOINTS_ACCOUNT.value);
    auto miner_user_points = user_points.find(miner.value);

    uint32_t miner_total_points = 0;

    if (miner_user_points != user_points.end()) {
        miner_total_points = miner_user_points->total_points;
    }

    for (auto &[rarity, _] : md.eases) {
        if (rarity == "Rare") {
            // check(miner_total_points >= 660,
            //     "ERR::INSUFFICIENT_POINTS_RARE::You must be at least rank 2 level to mine with Rare tools.");
            check(miner_total_points >= 284'0, "ERR::INSUFFICIENT_POINTS_RARE::You must be at least rank 3 level to mine with Rare tools.");
        } else if (rarity == "Epic") {
            check(miner_total_points >= 965'0, "ERR::INSUFFICIENT_POINTS_EPIC::You must be at least rank 4 level to mine with Epic tools.");
        } else if (rarity == "Legendary") {
            check(miner_total_points >= 2843'0, "ERR::INSUFFICIENT_POINTS_LEGENDARY::You must be at least rank 5 level to mine with Legendary tools.");
        } else if (rarity == "Mythical") {
            check(miner_total_points >= 7'853'0, "ERR::INSUFFICIENT_POINTS_MYTHICAL::You must be at least rank 6 level to mine with Mythical tools.");
        }
    }

    const auto planet_name = planet_from_land_id(land_id, landowner, land_data);

    check_nonce(miner_inst, md, nonce);

    check_time_since_last_mine(miner_inst, bag, md);
    save_miner_data(miner_inst, trx_id);

    if (md.luck > 0 && !is_bot && hasAgreedToUserTerms(miner)) {
        add_luckpoints(md, miner);
    }

    // fill the mine bucket for the time since last fill
    auto       state              = contr_state::get_current_state(get_self(), planet_name);
    const auto new_to_mine_bucket = calculate_mine_bucket_allocation(state);
    state.bucket_total -= new_to_mine_bucket;
    state.mine_bucket += new_to_mine_bucket;
    state.last_fill_time = time_point(current_time_point().time_since_epoch());

    auto planet_dtap_conf = pltdtapconf{get_self(), planet_name};

    // This is the amount that will be added to the planet's claim bucket
    const auto planet_inc = new_to_mine_bucket * planet_dtap_conf.get_claim_rate_perc_x100() / 100 / 100;

    // Set planet's claim bucket to the new amount
    auto planet_claim_bucket = planet_dtap_conf.get_claim_bucket(); // this is initially initialize as asset{} (default initialization)

    if (planet_claim_bucket.symbol == symbol{} and planet_claim_bucket.amount == 0) {
        planet_claim_bucket = planet_inc;
    } else {
        planet_claim_bucket += planet_inc;
    }
    planet_dtap_conf.set_claim_bucket(planet_claim_bucket);

    // Deduct from the new_to_mine_bucket what has been siphoned off to the planet's claim bucket
    const auto new_to_mine_bucket_minus_planet_amount = new_to_mine_bucket - planet_inc;

    // const auto mined_asset_old = calculate_mining_amount(state, md, miner, is_bot);
    const auto [mined_asset, new_pool_amounts] = calculate_mining_amounts(new_to_mine_bucket_minus_planet_amount, md, miner, planet_name, is_bot);
    // check(mined_asset.amount == mined_asset_old.amount, "ERR::MINE_AMOUNTS_DIFFER::Mine amounts differ. old=%s
    // new=%s",
    //     mined_asset_old, mined_asset);

    state.mine_bucket -= mined_asset;
    check(state.mine_bucket.amount >= 0, "ERR::MINE_BUCKET_NEGATIVE::Mine bucket has gone negative");

    const auto landowner_share = calculate_profit_share(mined_asset, md, planet_name);
    const auto miner_reward    = mined_asset - landowner_share;

    // accumulate mined amount
    check(miner_reward.amount > 0, "ERR::MINE_NEGATIVE::Cannot mine a negative amount");

    const auto claim = _miner_claims.find(miner.value);
    if (claim == _miner_claims.end()) {

        const auto conf  = config{get_self(), get_self()};
        const auto delay = conf.get_claimmines_delay_secs();
        insert_miner(miner);
        _miner_claims.emplace(miner, [&](auto &c) {
            c.miner     = miner;
            c.timestamp = time_point_sec(current_time_point().sec_since_epoch() + delay);
            c.amount    = miner_reward;
        });
    } else {
        _miner_claims.modify(claim, miner, [&](auto &c) {
            c.amount += miner_reward;
        });
    }

    if (landowner == "open.worlds"_n && landowner_share.amount > 0) {
        action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n,
            make_tuple(get_self(), landowner, landowner_share, "ALIEN WORLDS - Mined Trilium Profit Share"s))
            .send();
    } else if (landowner_share.amount > 0 && should_get_commission(landowner)) {
        const auto comm = _land_comms.find(landowner.value);
        if (comm == _land_comms.end()) {
            _land_comms.emplace(miner, [&](auto &c) {
                c.landowner = landowner;
                c.comms     = landowner_share;
            });
        } else {
            _land_comms.modify(comm, miner, [&](auto &c) {
                c.comms += landowner_share;
            });
        }
    }

    static constexpr auto log_permission_name = "log"_n;
    static constexpr auto log_action_name     = "logmine"_n;

    const auto offset = time_now() - uint32_t{md.delay} - miner_inst.last_mine.sec_since_epoch();

    action(permission_level{get_self(), log_permission_name}, NOTIFY_ACCOUNT, log_action_name,
        make_tuple(miner, md, miner_reward, land_id, planet_name, landowner, bag.items, offset, landowner_share, new_pool_amounts))
        .send();

    if (notify.has_value()) {
        auto whitelists = whitelist_table(get_self(), planet_name.value);
        whitelists.require_find(notify.value().value, "ERR::NOTIFY_NOT_ALLOWED::The provided notify account is not authorized.");
        action(permission_level{get_self(), "active"_n}, notify.value(), log_action_name,
            make_tuple(miner, md, miner_reward, land_id, planet_name, landowner, bag.items, offset, landowner_share, new_pool_amounts))
            .send();
    }

    // update last_mine property on all bag nfts so they cannot be used by sending them to another account
    update_bag_mine_time(miner, bag);
    state.save(get_self(), planet_name, get_self());
    // check(false, "ERR::TEST::test 2");
}

void mining::setpoolrates(const std::map<string, double> &rates, const name planet_name) {
    require_auth(get_self());
    auto   _pools = pools::get_current(get_self(), planet_name);
    double total  = 0;
    for (const auto &[rarity, rate] : rates) {
        total += rate;
    }
    ::check(total <= 100.0, "total of pool rates (%s) must not exceed 100%", total);

    _pools.rates = rates;
    _pools.save(get_self(), planet_name, get_self());
}

void mining::pltdtapset(name planet_name, uint32_t claim_rate_perc_x100, name destination) {
    check(claim_rate_perc_x100 >= 0 && claim_rate_perc_x100 <= 3500, "ERR::INVALID_CLAIM_RATE::Claim rate must be between 0 and 35%");
    require_auth(planet_auth(planet_name));

    check(is_account(destination), "ERR::INVALID_DESTINATION::Destination must be a valid account");
    auto conf = pltdtapconf{get_self(), planet_name};
    conf.set_claim_destination(destination);
    conf.set_claim_rate_perc_x100(claim_rate_perc_x100);
    conf.set_claim_bucket(ZERO_TRILIUM);
}

void mining::pltdtapclaim(name planet_name) {

    auto conf        = pltdtapconf{get_self(), planet_name};
    auto destination = conf.get_claim_destination();

    if (!has_auth(planet_auth(planet_name))) {
        require_auth(destination);
    }
    check(is_account(destination), "ERR::INVALID_DESTINATION::Destination must be a valid account");
    check(conf.get_claim_bucket().amount > 0, "ERR::NO_CLAIM_BUCKET::No claim bucket found");
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n,
        make_tuple(get_self(), destination, conf.get_claim_bucket(), "Planet directed DTAP"s))
        .send();

    action(permission_level{get_self(), "claim"_n}, get_self(), "pltdtapntfy"_n, make_tuple(planet_name, destination, conf.get_claim_bucket())).send();

    conf.set_claim_bucket(ZERO_TRILIUM);
}

void mining::pltdtapntfy(const name planet, const name destination, asset amount) {
    require_auth(get_self());
}

name mining::planet_auth(const name planet) {
#ifndef IS_DEV
    // check(false, "Unauthorized"); // This line is temporary until we allow the planets to whitelist.
#endif
    const map<name, name> const_lookups = {{"eyeke.world"_n, "eye.unn.dac"_n}, {"kavian.world"_n, "kav.unn.dac"_n}, {"magor.world"_n, "mag.unn.dac"_n},
        {"naron.world"_n, "nar.unn.dac"_n}, {"neri.world"_n, "ner.unn.dac"_n}, {"veles.world"_n, "vel.unn.dac"_n}};

    const auto auth = const_lookups.find(planet);
    check(auth != const_lookups.end(), "ERR::UNKNOWN_PLANET::Unknown planet '%s'.", planet);
    return auth->second;
}

void mining::addnotify(const name authorizer, const name planet, const name account) {
    if (!has_auth(get_self())) {
        require_auth(planet_auth(planet));
    }
    require_auth(authorizer);

    auto white_lists = whitelist_table(get_self(), planet.value);

    auto existing = white_lists.find(account.value);
    check(existing == white_lists.end(), "ERR::ON_MINE_WHITELIST::The account is already on the whitelist.");
    white_lists.emplace(get_self(), [&](auto &a) {
        a.account    = account;
        a.authorizer = authorizer;
    });
}

void mining::rmvnotify(const name authorizer, const name planet, const name account) {
    if (!has_auth(get_self())) {
        require_auth(planet_auth(planet));
    }
    require_auth(authorizer);

    auto white_lists = whitelist_table(get_self(), planet.value);

    auto existing = white_lists.require_find(account.value, "ERR::NOT_ON_WHITELIST::The provided account is not whitelisted to remove.");
    white_lists.erase(existing);
}

bool mining::should_get_commission(const name landowner) {
    const auto is_blocked_account = std::find(blocked_landowners.begin(), blocked_landowners.end(), landowner) != blocked_landowners.end();
    return landowner != get_self() && !is_blocked_account;
}

void mining::claimmines(name receiver) {
    auto ram_payer = receiver;
    if (!has_auth(get_self())) {
        require_auth(receiver);
    } else {
        ram_payer = get_self();
    }
    auto pendingPay = _miner_claims.require_find(receiver.value, "Pending pay not found for supplied receiver.");
    check(current_time_point().sec_since_epoch() > (pendingPay->timestamp).sec_since_epoch(),
        "ERR::MINE_CLAIM_LOCKED::Receiver not able to claim until %s UTC.", pendingPay->timestamp);
    check(pendingPay->amount.amount > 0, "ERR::MINE_CLAIM_ZERO::No Trilium to claim.");

    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n,
        make_tuple(get_self(), pendingPay->miner, pendingPay->amount, "ALIEN WORLDS - Mined Trilium"s))
        .send();

    const auto conf  = config{get_self(), get_self()};
    const auto delay = conf.get_claimmines_delay_secs();

    _miner_claims.modify(pendingPay, ram_payer, [&](auto &c) {
        c.timestamp = time_point_sec(current_time_point().sec_since_epoch() + delay);
        c.amount    = ZERO_TRILIUM;
    });
    check(!is_flagged(receiver), "ERR::UNABLE_TO_CLAIM::Unable to claim mine rewards.");
}

#ifdef IS_DEV
ACTION mining::reclaim(const std::vector<name> &users, bool extra_check, time_point_sec current_time) {
#else
ACTION mining::reclaim(const std::vector<name> &users, bool extra_check) {
    const auto current_time = time_point_sec(current_time_point());
#endif
    require_auth(get_self());

    const uint32_t INACTIVITY_THRESHOLD = 60 * 60 * 24 * 180; // 180 days (should match reclaim.js)
    asset          transfer_amount      = ZERO_TRILIUM;

    for (const auto &user : users) {
        const auto miner = _miners.find(user.value);
        // If user has miner entry and is still active, skip reclaim
        if (miner != _miners.end()) {
            const auto expires_at = miner->last_mine.sec_since_epoch() + INACTIVITY_THRESHOLD;
            if (current_time.sec_since_epoch() <= expires_at) {
                continue;
            }
            // If extra_check is true, we also need to check if the user is flagged
            if (extra_check && !is_flagged(user)) {
                continue;
            }
        }

        // If we get here, either the user has no miner entry or they're inactive
        const auto claim = _miner_claims.find(user.value);
        if (claim != _miner_claims.end()) {
            transfer_amount += claim->amount;
            _miner_claims.erase(claim);
        }
    }

    // Only send transfer action if there is something to transfer
    if (transfer_amount.amount > 0) {
        action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n,
            make_tuple(get_self(), "reclminerwds"_n, transfer_amount, "ALIEN WORLDS - reclaimed mining Trilium"s))
            .send();
    }
}

#ifdef IS_DEV
void mining::instmineclms(name miner, asset amount, time_point_sec timestamp) {
    require_auth(get_self());
    auto claim = _miner_claims.find(miner.value);
    if (claim == _miner_claims.end()) {
        _miner_claims.emplace(get_self(), [&](auto &c) {
            c.miner     = miner;
            c.amount    = amount;
            c.timestamp = timestamp;
        });
    } else {
        _miner_claims.modify(claim, same_payer, [&](auto &c) {
            c.amount    = amount;
            c.timestamp = timestamp;
        });
    }
}

void mining::setlastmine(name miner, time_point_sec last_mine_timestamp) {
    require_auth(get_self());
    auto miner_itr = _miners.find(miner.value);
    check(miner_itr != _miners.end(), "ERR::MINER_NOT_FOUND::Miner not found in miners table");

    _miners.modify(miner_itr, same_payer, [&](auto &m) {
        m.last_mine = last_mine_timestamp;
    });
}

void mining::testminer(name miner, uint64_t land_id, time_point_sec last_mine_timestamp) {
    require_auth(get_self());

    auto miner_itr = _miners.find(miner.value);
    if (miner_itr == _miners.end()) {
        // Create new miner entry
        _miners.emplace(get_self(), [&](auto &m) {
            m.miner        = miner;
            m.current_land = land_id;
            m.last_mine    = last_mine_timestamp;
            m.last_mine_tx = checksum256{}; // Default empty hash
        });
    } else {
        // Modify existing miner
        _miners.modify(miner_itr, same_payer, [&](auto &m) {
            m.current_land = land_id;
            m.last_mine    = last_mine_timestamp;
        });
    }
}

#endif

void mining::claimcomms(name receiver) {
    if (!has_auth(get_self())) {
        require_auth(receiver);
    }
    auto pendingPay = _land_comms.require_find(receiver.value, "Pending pay not found for supplied receiver.");

    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n,
        make_tuple(get_self(), pendingPay->landowner, pendingPay->comms, "ALIEN WORLDS - Mined Trilium Profit Share"s))
        .send();

    _land_comms.erase(pendingPay);
}

#if IS_DEV
void mining::addpointst(name miner, uint32_t points) {
    action(permission_level{FEDERATION_ACCOUNT, "usrpoints"_n}, FEDERATION_ACCOUNT, "addpoints"_n, make_tuple(miner, points)).send();
}
#endif

void mining::fill(name account, name planet_name) {
    require_auth(account);

    auto deposit_itr = _deposits.find(account.value);
    check(deposit_itr != _deposits.end(), "ERR::NO_DEPOSIT::No deposit found");

    const auto _planets = planets_table{PLANETS_CONTRACT, PLANETS_CONTRACT.value};
    _planets.get(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    auto state = contr_state::get_current_state(get_self(), planet_name);
    state.bucket_total += deposit_itr->quantity;
    state.fill_rate      = S{state.bucket_total.amount}.to<double>() / S{SECONDS_PER_DAY}.to<double>();
    state.last_fill_time = time_point(current_time_point().time_since_epoch());

    state.save(get_self(), planet_name, get_self());

    _deposits.erase(deposit_itr);
}

void mining::transfer(name from, name to, asset quantity, string memo) {
    if (to == get_self()) {
        // This will check that it is the trilium token and that it is > 0
        check(ZERO_TRILIUM < quantity, "ERR::INVALID_DEPOSIT::Invalid deposit");

        auto deposit = _deposits.find(from.value);
        if (deposit == _deposits.end()) {
            // no existing deposit (99.9% should be here)
            _deposits.emplace(get_self(), [&](auto &d) {
                d.account  = from;
                d.quantity = quantity;
            });
        } else {
            // Topping up an existing deposit
            _deposits.modify(deposit, same_payer, [&](auto &d) {
                d.quantity += quantity;
            });
        }
    }
}

void mining::resetstate(name planet_name) {
    require_auth(get_self());

    auto state           = contr_state::get_current_state(get_self(), planet_name);
    state.last_fill_time = time_point(current_time_point().time_since_epoch());
    state.fill_rate      = 0.0;
    state.bucket_total   = ZERO_TRILIUM;
    state.mine_bucket    = ZERO_TRILIUM;

    state.save(get_self(), planet_name, get_self());
}

void mining::clearminers() {
    require_auth(get_self());

    auto miner = _miners.begin();
    while (miner != _miners.end()) {
        miner = _miners.erase(miner);
    }
}

void mining::clearbags() {
    require_auth(get_self());

    auto bag = _bags.begin();
    while (bag != _bags.end()) {
        bag = _bags.erase(bag);
    }
}

// NFT transfer
void mining::logtransfer(name collection_name, name from, name to, vector<uint64_t> asset_ids, string memo) {
    // check if the asset is in their bag and if it is, remove it
    auto bag = _bags.find(from.value);
    if (bag != _bags.end()) {
        vector<uint64_t> new_items;

        for (auto bag_asset : bag->items) {
            auto found = find(asset_ids.begin(), asset_ids.end(), bag_asset);

            if (found == asset_ids.end()) {
                new_items.emplace_back(bag_asset);
            }
        }

        if (bag->items.size() != new_items.size()) {
            // bag items have changed
            _bags.modify(bag, same_payer, [&](auto &b) {
                b.items = new_items;
            });
        }
    }
}

/* Private */

void mining::update_bag_mine_time(const name miner, const bag &bag) {
    for (const auto asset_id : bag.items) {
        const auto tu_itr = _tooluse.find(asset_id);
        if (tu_itr != _tooluse.end()) {
            _tooluse.modify(*tu_itr, miner, [&](auto &t) {
                t.last_use = current_time_point().sec_since_epoch();
            });
        } else {
            _tooluse.emplace(miner, [&](auto &t) {
                t.asset_id = asset_id;
                t.last_use = current_time_point().sec_since_epoch();
            });
        }
    }
}

time_point_sec mining::bag_last_mine(const name owner, const vector<uint64_t> &bag_items) {
    uint32_t lm = 0;

    for (uint64_t asset_id : bag_items) {
        auto tu_itr = _tooluse.find(asset_id);
        if (tu_itr != _tooluse.end()) {
            uint32_t _lm = tu_itr->last_use;
            if (_lm > lm) {
                lm = _lm;
            }
        }
    }

    return time_point_sec(lm);
}

name mining::planet_from_land_id(const uint64_t land_id, const name landowner, const atomicdata::ATTRIBUTE_MAP &data) {
    const auto planet_name = name{nft_get_attr<uint64_t>(data, "planet")};
    const auto _planets    = planets_table{PLANETS_CONTRACT, PLANETS_CONTRACT.value};
    _planets.get(planet_name.value, "ERR::LAND_DOES_NOT_EXIST::Land is on non-existent planet, or planet no longer part of federation! s");

    return planet_name;
}

mining_data2 mining::mining_data_from_land(const uint64_t land_id, const name landowner, const atomicdata::ATTRIBUTE_MAP &data) {
    auto md       = mining_data2{};
    md.ease       = nft_get_attr<uint8_t>(data, "ease");
    md.difficulty = nft_get_attr<uint8_t>(data, "difficulty");
    md.delay      = nft_get_attr<uint8_t>(data, "delay");
    md.luck       = nft_get_attr<uint8_t>(data, "luck");

    check(md.ease > 0, "ERR::LAND_BARREN::Land is barren!");

    const auto mutable_data = nft_get_mutable_data(landowner, land_id, LAND_SCHEMA);
    md.commission           = nft_get_attr<uint16_t>(mutable_data, "commission");
    check(md.commission <= 2500,
        "ERR::LAND_COMMISSION_HIGH::Land commission has been set to over 25%, to mine here you must adjust your maximum allowable commission");
    return md;
}

mining_data2 mining::mining_data_from_account(const name account, const bag &bag) {
    auto md      = mining_data2{};
    auto _assets = atomicassets::assets_t(NFT_CONTRACT, account.value);
    check(bag.items.size() > 0, "ERR::BAG_EMPTY::Cannot mine with an empty bag");

    auto delays          = std::vector<uint16_t>{};
    auto rarity_ease_map = std::map<string, uint16_t>{};
    for (const auto item_id : bag.items) {
        auto tool = _assets.find(item_id);
        check(tool != _assets.end(), "ERR::BAG_ITEMS_NOT_OWNED::You must own all items in your bag");
        check(tool->schema_name == TOOLS_SCHEMA, "ERR::BAG_ITEMS_NOT_TOOLS::All assets in the bag must be mining tools");
        const auto data   = nft_get_template_data(account, item_id, TOOLS_SCHEMA);
        const auto rarity = nft_get_attr<string>(data, "rarity");
        const auto ease   = nft_get_attr<uint16_t>(data, "ease");
        md.ease += ease;
        rarity_ease_map[rarity] += ease;

        md.difficulty += nft_get_attr<uint8_t>(data, "difficulty");
        const auto delay = nft_get_attr<uint16_t>(data, "delay");
        delays.push_back(delay);
        md.delay += delay;

        const auto luck = nft_get_attr<uint16_t>(data, "luck");
        // Rather than flooring each tool, add the non-abundant tools together and then floor after the land multiplying
        // factor. This allows more benefit from shining process and blocks all the abundant tools from points.
        if (rarity != "Abundant") {
            md.luck += luck;
        }
    }
    for (const auto &[rarity, ease] : rarity_ease_map) {
        md.eases.push_back({rarity, ease});
    }
    const auto min_delay = *std::min_element(delays.begin(), delays.end());

    if (bag.items.size() == 2) {
        md.delay -= min_delay / 2;
    } else if (bag.items.size() == 3) {
        md.delay -= min_delay;
    }
    return md;
}

std::pair<mining_data2, mining_data2> mining::mining_data(
    const name account, const uint64_t land_id, const bag &bag, const name landowner, const atomicdata::ATTRIBUTE_MAP &land_data) {
    auto       md      = mining_data_from_account(account, bag);
    const auto land_md = mining_data_from_land(land_id, landowner, land_data);
    md.delay           = uint16_t(double(md.delay) * double(land_md.delay) / 10.0);
    md.ease            = uint16_t(double(md.ease) * double(land_md.ease) / 10.0);

    // Multiply the eases of each tool by the land ease
    // This mutates the values inside the md.eases vector
    for (auto &[rarity, ease] : md.eases) {
        ease = uint16_t(double(ease) * double(land_md.ease) / 10.0);
    }

    md.difficulty = std::min(md.difficulty + land_md.difficulty, 15);
    if (land_md.luck > 0) {
        md.luck = md.luck * land_md.luck / 10;
    }
    md.commission = land_md.commission;
    return {md, land_md};
}

asset mining::calculate_mine_bucket_allocation(const mining::contr_state &state) {
    const auto ms_since_fill      = current_time_point().time_since_epoch() - state.last_fill_time.time_since_epoch();
    const auto seconds_since_fill = S{ms_since_fill.count()}.to<double>() / S{1000000.0};
    const auto new_tokens_amount  = (S{state.fill_rate} * seconds_since_fill).to<int64_t>();
    const auto new_tokens         = asset{new_tokens_amount, TLM_SYM};
    return std::min(new_tokens, state.bucket_total);
}

asset mining::calculate_mining_amount(const mining::contr_state &state, const mining_data2 &md, const name miner, const bool is_bot) {
    const auto mine_per_thousand = std::min(md.ease, uint16_t{800});
    auto       mined_asset       = state.mine_bucket * mine_per_thousand / 1000;
    if (is_bot) {
        // 1/1000th the amount for bots
        mined_asset /= 1000;
    }
    mined_asset = std::min(mined_asset, state.mine_bucket);
    // print(fmt("md.ease: %s mine_per_thousand: %s state.mine_bucket: %s mined_asset: %s", md.ease, mine_per_thousand,
    //     state.mine_bucket, mined_asset));

    check(mined_asset.amount > 0, "ERR::NOTHING_TO_MINE::Nothing to be mined! Please try again later");
    return mined_asset;
}

std::tuple<asset, std::map<string, asset>> mining::calculate_mining_amounts(
    const asset new_to_mine, const mining_data2 &md, const name miner, const name planet_name, const bool is_bot) {

    auto planet_pools = pools::get_current(get_self(), planet_name);
    planet_pools.distribute_to_pools(new_to_mine);

    // make a copy of the pool buckets before we deduct the mining amounts from them
    const auto new_pool_amounts = planet_pools.pool_buckets;
    // new_pool_amounts now contains the new pool amounts before the mining amounts have been deducted

    auto mined_asset = ZERO_TRILIUM;

    for (const auto &[rarity, ease] : md.eases) {
        check(planet_pools.pool_buckets.find(rarity) != planet_pools.pool_buckets.end(),
            "ERR::RARITY_NOT_FOUND::Rarity not found in planet pools: %s in mining.cpp", rarity);

        const auto mine_per_thousand = std::min(ease, uint16_t{800});
        const auto ease_bucket       = planet_pools.pool_buckets.at(rarity);
        auto       pool_amount       = ease_bucket * mine_per_thousand / 1000;
        if (is_bot) {
            // 1/1000th the amount for bots
            pool_amount /= 1000;
        }
        check(mined_asset.symbol == pool_amount.symbol && pool_amount.symbol == planet_pools.pool_buckets.at(rarity).symbol,
            "ERR::SYMBOL_MISMATCH::Symbol mismatch. mined_asset: %s pool_amount: %s ease_bucket: %s rarity: %s planet_pools.pool_buckets.at(rarity): %s",
            mined_asset, pool_amount, ease_bucket, rarity, planet_pools.pool_buckets.at(rarity));
        pool_amount = std::min(pool_amount, ease_bucket);
        planet_pools.pool_buckets.at(rarity) -= pool_amount;

        mined_asset += pool_amount;
    }

    check(mined_asset.amount > 0, "ERR::NOTHING_TO_MINE::Nothing to be mined! Please try again later");
    planet_pools.save(get_self(), planet_name, get_self());

    return {mined_asset, new_pool_amounts};
}

asset mining::calculate_profit_share(const asset mined_asset, const mining_data2 &md, const name planet_name) {
    const auto globalConfigs = plntconfigs{LANDOWNERS_ACCOUNT, LANDOWNERS_ACCOUNT.value};
    const auto planetConfigs = plntconfigs{LANDOWNERS_ACCOUNT, planet_name.value};

    const auto min_commission = S{std::max(planetConfigs.get_min_commission(), globalConfigs.get_min_commission())};
    const auto max_commission =
        S{std::min(planetConfigs.get_maybe<uint32_t>("max_commission").value_or(10000), globalConfigs.get_maybe<uint32_t>("max_commission").value_or(10000))};

    const auto commission = std::clamp(md.commission, min_commission.to<uint16_t>().value(), max_commission.to<uint16_t>().value());
    return mined_asset * commission / 10000;
}

void mining::add_luckpoints(const mining_data2 &md, const name miner) {
    const auto points = uint32_t(md.luck);
    if (points <= 0) {
        return;
    }
// Send to the user points;
#ifdef IS_DEV
    const auto current_time = time_point_sec(current_time_point());
    action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, "addpoints"_n, make_tuple(miner, points, current_time)).send();
#else
#ifndef IS_TEST_DEPLOY
    action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, "addpoints"_n, make_tuple(miner, points)).send();
#endif
#endif
}

#ifdef IS_TEST_DEPLOY
// This action is to test sending points as a inline action as would be done through the mining action.
void mining::testpoints(name miner, uint32_t points) {
    require_auth(get_self());

    action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, "addpoints"_n, make_tuple(miner, points)).send();
}
#endif

void mining::check_nonce(const miner &miner_inst, const mining_data2 &md, const vector<char> &nonce) {
    char tmp[24];
    // Account name
    for (uint8_t i = 0; i < 8; i++) {
        tmp[i] = (miner_inst.miner.value >> (i * 8)) & 0xff;
    }
    // First 8 bytes of last mine tx id
    auto txid_bytes = miner_inst.last_mine_tx.extract_as_byte_array();
    for (uint8_t j = 8; j < 16; j++) {
        tmp[j] = txid_bytes[j - 8];
    }
    // Nonce
    for (uint8_t k = 16; k < 24; k++) {
        tmp[k] = nonce[k - 16];
    }

    const auto hash = sha256(tmp, 24).extract_as_byte_array();
    check(hash[0] == 0, "ERR::INVALID_HASH::Invalid hash");
    check(hash[1] == 0, "ERR::INVALID_HASH_1::Invalid hash 1");
    const uint8_t last_word = hash[2] >> 4;
    check(last_word <= md.difficulty, "ERR::INVALID_HASH_5::Invalid hash (5th character)");
}

void mining::save_miner_data(const miner &miner_inst, const checksum256 &trx_id) {
    _miners.modify(miner_inst, miner_inst.miner, [&](auto &m) {
        m.last_mine_tx = trx_id;
        m.last_mine    = time_point_sec(current_time_point());
    });
}

void mining::check_time_since_last_mine(const miner &miner_inst, const bag &bag, const mining_data2 &md) {
    const time_point_sec prev_mine = std::max(miner_inst.last_mine, bag_last_mine(bag.account, bag.items));
    // Check next mine time delay
    check(prev_mine.sec_since_epoch() < S{time_now()} - S{md.delay}.to<uint32_t>(), "ERR::MINE_TOO_SOON::Mine too soon");
}

bool mining::hasAgreedToUserTerms(const name miner) {
    const auto _userterms = userterms_table(FEDERATION_ACCOUNT, FEDERATION_ACCOUNT.value);
    const auto userterms  = _userterms.find(miner.value);
    return (userterms != _userterms.end());
}