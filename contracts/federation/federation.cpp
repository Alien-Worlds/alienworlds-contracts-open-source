#include "federation.hpp"
#include "../common/contracts-common/string_format.hpp"

using namespace alienworlds;
using namespace atomicdata;

federation::federation(name s, name code, datastream<const char *> ds)
    : contract(s, code, ds), _players(get_self(), get_self().value), _userterms(get_self(), get_self().value) {}

void federation::agreeterms(name account, uint16_t terms_id, checksum256 terms_hash) {
    require_auth(account);

    auto terms = _userterms.find(account.value);
    if (terms == _userterms.end()) {
        _userterms.emplace(account, [&](auto &t) {
            t.account    = account;
            t.terms_id   = terms_id;
            t.terms_hash = terms_hash;
        });
    } else {
        _userterms.modify(*terms, account, [&](auto &t) {
            t.terms_id   = terms_id;
            t.terms_hash = terms_hash;
        });
    }
}

void federation::setavatar(name account, uint64_t avatar_id) {
    require_auth(account);

    auto player = _players.find(account.value);

    if (avatar_id >= 1 && avatar_id <= 2) {
        /* Give them a default avatar
         * 1 = male
         * 2 = female
         */

        ATTRIBUTE_MAP immutable_data     = {};
        ATTRIBUTE_MAP mutable_data       = {};
        vector<asset> quantities_to_back = {};

        uint32_t template_id = MALE_AVATAR_TEMPLATE;
        if (avatar_id == 2) {
            template_id = FEMALE_AVATAR_TEMPLATE;
        }

        // existing players cannot set avatar to default one
        check(player == _players.end(), "Only new players can set to the default avatar");
        // If the player row doesnt exist then create it so the player pays for ram
        _players.emplace(account, [&](auto &p) {
            p.account = account;
            p.avatar  = avatar_id;
        });

        // Mint the new asset, the mintassset listener will then set the avatar
        action(permission_level{"mint.worlds"_n, "issue"_n}, NFT_CONTRACT, "mintasset"_n,
            make_tuple("mint.worlds"_n, NFT_COLLECTION, AVATAR_SCHEMA, template_id, account, immutable_data, mutable_data, quantities_to_back))
            .send();

    } else {
        auto _assets = atomicassets::assets_t(NFT_CONTRACT, account.value);
        auto asset   = _assets.require_find(avatar_id, "ERR::MUST_OWN_AVATAR::You must own this avatar.");
        if (asset->collection_name == NFT_COLLECTION) {
            check(asset->schema_name == AVATAR_SCHEMA, "ERR::AVATAR_NOT_VALID::Avatar must be from the faces.worlds schema.");
        } else if (asset->collection_name == "alienavatars"_n) {
            check(asset->schema_name == "alienavatars"_n, "ERR::AVATAR_NOT_VALID_SCHEMA::Avatar must from an approved schema.");
        } else {
            check(false, "ERR::AVATAR_NOT_VALID::Avatar must from an approved collection.");
        }

        if (player != _players.end()) {
            _players.modify(player, account, [&](auto &p) {
                p.avatar = avatar_id;
            });
        } else {
            _players.emplace(account, [&](auto &p) {
                p.account = account;
                p.avatar  = avatar_id;
            });
        }
    }
}

void federation::settag(name account, string tag) {
    require_auth(account);

    check(tag.size() <= 18, "Player tag must have less than 19 characters");

    auto player = _players.find(account.value);

    if (player != _players.end()) {
        _players.modify(player, account, [&](auto &p) {
            p.tag = tag;
        });
    } else {
        _players.emplace(account, [&](auto &p) {
            p.account = account;
            p.tag     = tag;
        });
    }
}

//
void federation::logmint(uint64_t asset_id, name authorized_minter, name collection_name, name schema_name, int32_t preset_id, name new_asset_owner,
    ATTRIBUTE_MAP immutable_data, ATTRIBUTE_MAP mutable_data, vector<asset> backed_tokens) {
    /*if (new_asset_owner == get_self() && schema_name == TOOLS_SCHEMA) {
        stash_tool(asset_id);
    } else */
    if (schema_name == AVATAR_SCHEMA) {
        // check if it is their first avatar and set it if so
        auto player = _players.find(new_asset_owner.value);

        if (player == _players.end()) {
            // this should never happen
            _players.emplace(get_self(), [&](auto &p) {
                p.account = new_asset_owner;
                p.avatar  = asset_id;
            });
        } else if (player->avatar >= 1 && player->avatar <= 3) {
            // Was set as a default avatar
            _players.modify(player, new_asset_owner, [&](auto &p) {
                p.avatar = asset_id;
            });
        }
    }
}

/* Private methods */
bool federation::maintenance_mode() {
    const auto g = globals{get_self(), get_self()};
    return g.get_maintenance_mode();
}

void federation::maintenance(const bool maintenance) {
    require_auth(get_self());

    auto g = globals{get_self(), get_self()};
    g.set_maintenance_mode(maintenance);
}

void federation::check_maintenance_mode() {
    const auto g = globals{get_self(), get_self()};
    check(!g.get_maintenance_mode(), "The staking function has been moved to stake.worlds, please update your dapp.");
}
