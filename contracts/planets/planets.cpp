#include "planets.hpp"

using namespace alienworlds;

planets::planets(name s, name code, datastream<const char *> ds) : contract(s, code, ds), _planets(get_self(), get_self().value) {}

void planets::addplanet(name planet_name, string title, symbol dac_symbol, string metadata) {
    require_auth(get_self());

    auto planet = _planets.find(planet_name.value);
    check(planet == _planets.end(), "Planet already exists with this name %s", planet_name);

    _planets.emplace(get_self(), [&](auto &p) {
        p.planet_name = planet_name;
        p.title       = title;
        p.dac_symbol  = dac_symbol;
        p.metadata    = metadata;
    });
}

void planets::updateplanet(name planet_name, string title, string metadata, bool active) {
    require_auth(get_self());

    auto planet = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    _planets.modify(planet, get_self(), [&](auto &p) {
        p.title    = title;
        p.metadata = metadata;
        p.active   = active;
    });
}

void planets::removeplanet(name planet_name) {
    require_auth(get_self());

    auto planet = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    _planets.erase(planet);
}

void planets::setmap(name planet_name, uint16_t x, uint16_t y, uint64_t asset_id) {
    require_auth(get_self());

    auto planet = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    maps_table _maps(get_self(), planet_name.value);

    _maps.emplace(get_self(), [&](auto &m) {
        m.x        = x;
        m.y        = y;
        m.asset_id = asset_id;
    });
}

void planets::clearmap(name planet_name) {
    require_auth(get_self());

    auto planet = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    maps_table _maps(get_self(), planet_name.value);
    auto       map = _maps.begin();

    while (map != _maps.end()) {
        map = _maps.erase(map);
    }
}

void planets::clearplanets() {
    require_auth(get_self());

    auto planet = _planets.begin();

    while (planet != _planets.end()) {
        planet = _planets.erase(planet);
    }
}

void planets::updatestake(const name planet_name, const asset stake) {
    // stake can be negative, so we should test for that case as well

    require_auth(get_self());

    auto planet = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    _planets.modify(planet, same_payer, [&](auto &p) {
        p.total_stake += stake.amount;
        check(p.total_stake >= 0, "Trying to refund more than was staked on planet %s", planet_name);
    });
}

void planets::updatemult(const name planet_name, const int64_t nft_multiplier) {
    require_auth(get_self());

    check(S{nft_multiplier} >= S{int64_t{}}, "Multiplier must be positive");
    auto planet = _planets.require_find(planet_name.value, ERR_PLANET_DOES_NOT_EXIST);

    _planets.modify(planet, same_payer, [&](auto &p) {
        p.nft_multiplier = S{p.nft_multiplier} + S{nft_multiplier};
    });
}

/** END OF inter-contract communication */

void planets::resetclaim() {
    require_auth(get_self());

    auto planet = _planets.begin();

    while (planet != _planets.end()) {
        _planets.modify(*planet, same_payer, [&](auto &p) {
            p.last_claim = time_point_sec(0);
        });

        planet++;
    }
}
