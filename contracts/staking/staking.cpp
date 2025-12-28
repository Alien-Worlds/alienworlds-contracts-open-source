#include "staking.hpp"

using namespace alienworlds;

staking::staking(name s, name code, datastream<const char *> ds) : contract(s, code, ds), _deposits(get_self(), get_self().value) {}

void staking::deldeposit(name account) {
    check_maintenance_mode();
    require_auth(get_self());

    auto deposit = _deposits.require_find(account.value, "No deposit for this account");

    _deposits.erase(deposit);
}

/* Notifications for tlm transfer */
void staking::ftransfer(name from, name to, asset quantity, std::string memo) {

    // Receive trilium and record as a deposit for later staking
    if (to == get_self() && from != FEDERATION_ACCOUNT) {
        check_maintenance_mode();

        // This will check that it is the trilium token and that it is > 0
        check(ZERO_TRILIUM < quantity, "Invalid deposit");

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

/* Notifications for dac token transfer */
void staking::dtransfer(const name from, const name to, const asset quantity, const string &memo) {
    // Receive DAC token and unstake TLM
    if (from == get_self() || to != get_self()) {
        return;
    }
    check_maintenance_mode();

    check(quantity.is_valid(), "Invalid quantity");
    check(quantity.amount > 0, "Deposit amount must be > 0");
    check(is_account(from), "The account %s does not exist.", from);
    check(from != to, "cannot transfer to self");

    // burn dac tokens received
    action(permission_level{get_self(), "issue"_n}, DAC_TOKEN_CONTRACT, "burn"_n, make_tuple(get_self(), quantity)).send();

    auto stake_daos           = stake_dao_table(get_self(), get_self().value);
    auto stake_daos_by_symbol = stake_daos.get_index<"bysymbol"_n>();
    auto stake_dao            = stake_daos_by_symbol.find(quantity.symbol.raw());
    if (stake_dao == stake_daos_by_symbol.end() || stake_dao->dac_symbol != quantity.symbol) {
        // Remove from total stake
        auto planet = *planet_from_symbol(quantity.symbol);
        update_planet_stake(planet.planet_name, -quantity);
    }

    // refund staked TLM to user
    const auto refund_quantity  = asset{quantity.amount, TLM_SYM};
    const auto refund_recipient = from;
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), refund_recipient, refund_quantity, "Refund of stake"s))
        .send();
}

void staking::stake(name account, name planet_name, asset quantity) {
    check_maintenance_mode();
    require_auth(account);
    check(quantity.amount > 0, "Stake must be greater than 0");

    // check they have previously deposited trilium
    auto deposit = _deposits.require_find(account.value, "No deposit found");
    check(deposit->quantity >= quantity, "You do not have enough deposited Trilium");

    asset dac_tokens;

    const auto stake_only_daos = stake_dao_table(get_self(), get_self().value);
    const auto stake_dao       = stake_only_daos.find(planet_name.value);
    if (stake_dao != stake_only_daos.end()) {
        dac_tokens = asset{quantity.amount, stake_dao->dac_symbol};
    } else {
        const auto _planets = planets_table(PLANETS_CONTRACT, PLANETS_CONTRACT.value);
        auto       planet   = _planets.get(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);
        check(planet.active, "Planet is not active, cannot stake to it");

        update_planet_stake(planet.planet_name, quantity);

        // Issue (then transfer) the required number of dac tokens to the player
        dac_tokens = get_dac_tokens(planet_name, quantity.amount);
    }
    check(dac_tokens.amount == quantity.amount, "Number of DAC tokens should exactly match the number of TLM staked");

    std::string memo = "Voting tokens for stake";
    action(permission_level{get_self(), "issue"_n}, DAC_TOKEN_CONTRACT, "issue"_n, make_tuple(get_self(), dac_tokens, memo)).send();
    action(permission_level{get_self(), "issue"_n}, DAC_TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), account, dac_tokens, memo)).send();

    // remove entry from deposits
    if (deposit->quantity == quantity) {
        _deposits.erase(deposit);
    } else {
        _deposits.modify(deposit, same_payer, [&](auto &d) {
            d.quantity -= quantity;
        });
    }
}

ACTION staking::addstakedao(name dac_id, symbol dac_symbol) {
    require_auth(get_self());
    auto stake_daos = stake_dao_table(get_self(), get_self().value);

    stake_daos.emplace(get_self(), [&](stake_dao_item &d) {
        d.dac_id     = dac_id;
        d.dac_symbol = dac_symbol;
    });
}

ACTION staking::rmvstakedao(name dac_id) {
    require_auth(get_self());
    auto stake_daos = stake_dao_table(get_self(), get_self().value);

    auto stake_dao = stake_daos.require_find(dac_id.value, "ERR::STAKE_DAO_NOT_FOUND::Stake DAO does not exist.");
    stake_daos.erase(stake_dao);
}

void staking::withdraw(name account) {
    check_maintenance_mode();
    auto deposit = _deposits.require_find(account.value, "No deposit found");

    string memo = "Return of deposit";
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), deposit->account, deposit->quantity, memo)).send();

    // remove the deposit
    _deposits.erase(deposit);
}

asset staking::get_dac_tokens(name planet_name, int64_t amount) {
    const auto _planets = planets_table{PLANETS_CONTRACT, PLANETS_CONTRACT.value};
    auto       planet   = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    return asset{amount, planet->dac_symbol};
}

bool staking::maintenance_mode() {
    const auto g = globals{get_self(), get_self()};
    return g.get_maintenance_mode();
}

void staking::maintenance(const bool maintenance) {
    require_auth(get_self());

    auto g = globals{get_self(), get_self()};
    g.set_maintenance_mode(maintenance);
}

void staking::check_maintenance_mode() {
    const auto g = globals{get_self(), get_self()};
    check(!g.get_maintenance_mode(), "Contract is in maintenance mode, please try again in a few minutes.");
}