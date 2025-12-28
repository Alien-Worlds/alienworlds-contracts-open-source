#include "packopener.hpp"

using namespace alienworlds;
using namespace atomicdata;
using namespace atomicassets;

packopener::packopener(name s, name code, datastream<const char *> ds)
    : contract(s, code, ds), _packs(get_self(), get_self().value), _cards(get_self(), get_self().value), _crates(get_self(), get_self().value),
      _deposits(get_self(), get_self().value), _claims(get_self(), get_self().value) {}

void packopener::addpack(name pack_name, symbol pack_symbol, extended_asset bonus_ft, bool active) {
    require_auth(get_self());

    auto pack = _packs.find(pack_name.value);
    check(pack == _packs.end(), "Pack with this name exists");

    // TODO : Check that this symbol exists in the token contract
    _packs.emplace(get_self(), [&](auto &p) {
        p.pack_name   = pack_name;
        p.pack_symbol = pack_symbol;
        p.bonus_ft    = bonus_ft;
        p.active      = active;
    });
}

void packopener::editpack(name pack_name, symbol pack_symbol, extended_asset bonus_ft) {
    require_auth(get_self());

    auto pack = _packs.find(pack_name.value);
    check(pack != _packs.end(), "Could not find pack");

    // TODO : Check that this symbol exists in the token contract
    _packs.modify(pack, same_payer, [&](auto &p) {
        p.pack_symbol = pack_symbol;
        p.bonus_ft    = bonus_ft;
    });
}

void packopener::activatepack(name pack_name, bool active) {
    require_auth(get_self());

    auto pack = _packs.find(pack_name.value);
    check(pack != _packs.end(), "Could not find pack");

    _packs.modify(pack, same_payer, [&](auto &p) {
        p.active = active;
    });
}

void packopener::delpack(name pack_name) {
    require_auth(get_self());

    auto pack = _packs.find(pack_name.value);
    check(pack != _packs.end(), "Pack not found");

    _packs.erase(pack);
}

void packopener::addcard(name pack_name, uint64_t card_id, vector<cardprob> card_probabilities) {
    require_auth(get_self());

    auto pack = _packs.find(pack_name.value);
    check(pack != _packs.end(), "Pack not found");

    check(card_probabilities.size() < 255, "Too many crate probabilities");
    uint16_t prob_total;
    for (auto cp : card_probabilities) {
        prob_total += cp.probability;
    }
    check(prob_total == 1000, "Card probabilities must add up to 100%");

    auto card = _cards.find(card_id);
    check(card == _cards.end(), "Card id has already been created");

    _cards.emplace(get_self(), [&](auto &c) {
        c.card_id            = card_id;
        c.pack_name          = pack_name;
        c.card_probabilities = card_probabilities;
    });
}

void packopener::editcard(uint64_t card_id, vector<cardprob> card_probabilities) {
    require_auth(get_self());

    check(card_probabilities.size() < 255, "Too many crate probabilities");
    uint16_t prob_total;
    for (auto cp : card_probabilities) {
        prob_total += cp.probability;
    }
    check(prob_total == 1000, "Card probabilities must add up to 100%");

    auto card = _cards.find(card_id);
    check(card != _cards.end(), "Card id not found");

    _cards.modify(card, same_payer, [&](auto &c) {
        c.card_probabilities = card_probabilities;
    });
}

void packopener::delcard(uint64_t card_id) {
    require_auth(get_self());

    auto card = _cards.find(card_id);
    check(card != _cards.end(), "Card id not found");

    _cards.erase(card);
}

void packopener::addcrate(name crate_name, name type, vector<uint64_t> ids) {
    require_auth(get_self());

    auto crate = _crates.find(crate_name.value);
    check(crate == _crates.end(), "Crate with this name already exists");

    check(type == "template"_n || type == "asset"_n, "Type must be either 'template' or 'asset'");
    if (type == "template"_n) {
        check(ids.size() > 0, "Must include at least 1 template id");
        check(ids.size() < 65535, "Too many template ids");
    } else if (type == "asset"_n) {
        check(ids.size() == 0, "Asset type cannot contain ids");
    }

    _crates.emplace(get_self(), [&](auto &c) {
        c.crate_name = crate_name;
        c.type       = type;
        c.ids        = ids;
    });
}

void packopener::editcrate(name crate_name, vector<uint64_t> ids) {
    require_auth(get_self());

    auto crate = _crates.find(crate_name.value);
    check(crate != _crates.end(), "Crate not found");

    check(ids.size() > 0, "Must include at least 1 template id");
    check(ids.size() <= 65535, "Too many template ids");

    _crates.modify(crate, same_payer, [&](auto &c) {
        c.ids = ids;
    });
}

void packopener::delcrate(name crate_name) {
    require_auth(get_self());

    auto crate = _crates.find(crate_name.value);
    check(crate != _crates.end(), "Crate not found");

    _crates.erase(crate);
}

/*void packopener::fillcrate(name crate_name, name filler) {
    require_auth(get_self());

    auto _crateassets = crateassets_table(get_self(), crate_name.value);

    auto nftdeposit = _nftdeposits.find(filler.value);
    check(nftdeposit != _nftdeposits.end(), "You do not have any NFTs deposited, send them to this contract to deposit");
    check(nftdeposit->asset_ids.size() > 0, "No deposited assets to fill");

    uint8_t count = 0;
    vector<uint64_t> newassets;

    for (auto asset_id: nftdeposit->asset_ids){

        if (count >= 50){
            newassets.push_back(asset_id);
            continue;
        }

        vector<uint8_t> asset_id_data;
        uint64_t tmp = asset_id;
        for (uint8_t i = 0; i < 8; i++){
            asset_id_data.push_back((uint8_t)((tmp >> (i * 8)) & 0xff));
        }

        checksum256 hash = sha256((const char *)asset_id_data.data(), asset_id_data.size());
        uint64_t reduced_hash = 0;
        auto byte_array = hash.extract_as_byte_array();
        // We only actually give it a 16 bit number which should be plenty for our needs
        for (uint8_t j = 0; j < 4; j++){
            reduced_hash += ((uint64_t)byte_array[j] << (j * 8));
        }

        _crateassets.emplace(get_self(), [&](auto &ca){
            ca.asset_id = asset_id;
            ca.hash = reduced_hash;
        });

    }

    _nftdeposits.modify(nftdeposit, same_payer, [&](auto &n){
        n.asset_ids = newassets;
    });
}*/

void packopener::addasset(name crate_name, uint64_t asset_id) {
    require_auth(get_self());

    auto crate = _crates.find(crate_name.value);
    check(crate != _crates.end(), "Crate not found");

    auto _crateassets = crateassets_table(get_self(), crate_name.value);

    // check we actually possess the asset
    auto _assets = atomicassets::assets_t(NFT_CONTRACT, get_self().value);
    auto asset   = _assets.find(asset_id);
    check(asset != _assets.end(), "This contract does not own the asset");

    uint64_t index = 0;
    if (_crateassets.begin() != _crateassets.end()) {
        auto _index    = _crateassets.get_index<"byindex"_n>();
        auto lastasset = --(_index.end());
        index          = lastasset->index + 1;
    }

    _crateassets.emplace(get_self(), [&](auto &ca) {
        ca.index    = index;
        ca.asset_id = asset_id;
    });
}

void packopener::emptycrate(name crate_name) {
    require_auth(get_self());

    auto _crateassets = crateassets_table(get_self(), crate_name.value);

    auto ca = _crateassets.begin();
    while (ca != _crateassets.end()) {
        ca = _crateassets.erase(ca);
    }
}

void packopener::clearcrates() {
    require_auth(get_self());
    auto crate = _crates.begin();
    while (crate != _crates.end()) {
        crate = _crates.erase(crate);
    }
}

void packopener::clearpacks() {
    require_auth(get_self());
    auto pack = _packs.begin();
    while (pack != _packs.end()) {
        pack = _packs.erase(pack);
    }
}

void packopener::clearcards() {
    require_auth(get_self());
    auto card = _cards.begin();
    while (card != _cards.end()) {
        card = _cards.erase(card);
    }
}

void packopener::open(name account) {
    require_auth(account);

    auto deposit = _deposits.find(account.value);
    check(deposit != _deposits.end(), "No deposited packs found");

    auto pack_ind = _packs.get_index<"bysym"_n>();
    auto pack     = pack_ind.find(deposit->deposited_asset.symbol.raw());
    check(pack != pack_ind.end(), "Pack not found from symbol");
    check(pack->active, "Pack is not active yet and cannot be opened");

    // request the random number
    auto     size   = transaction_size();
    char    *buffer = (char *)(512 < size ? malloc(size) : alloca(size));
    uint32_t read   = read_transaction(buffer, size);
    check(size == read, "ERR::READ_TRANSACTION_FAILED::read_transaction failed");
    checksum256 trx_id = sha256(buffer, read);

    uint64_t signing_value = 0;
    auto     trx_bytes     = trx_id.extract_as_byte_array();
    signing_value += (uint64_t)trx_bytes[0] << (7 * 8);
    signing_value += (uint64_t)trx_bytes[1] << (6 * 8);
    signing_value += (uint64_t)trx_bytes[2] << (5 * 8);
    signing_value += (uint64_t)trx_bytes[3] << (4 * 8);
    signing_value += (uint64_t)trx_bytes[4] << (3 * 8);
    signing_value += (uint64_t)trx_bytes[5] << (2 * 8);
    signing_value += (uint64_t)trx_bytes[6] << 8;
    signing_value += (uint64_t)trx_bytes[7];

    action(permission_level{get_self(), "random"_n}, RNG_CONTRACT, "requestrand"_n, make_tuple(account.value, signing_value, get_self())).send();
}

void packopener::receiverand(uint64_t assoc_id, checksum256 random_value) {
    require_auth("orng.wax"_n);

    RandomnessProvider randomness_provider(random_value);

    auto deposit = _deposits.find(assoc_id);

    vector<chosen_card> chosen_cards;

    if (deposit != _deposits.end()) {
        // get the pack name from the symbol of the deposit
        auto pack_ind = _packs.get_index<"bysym"_n>();
        auto pack     = pack_ind.find(deposit->deposited_asset.symbol.raw());

        if (pack != pack_ind.end()) {
            auto bytes_array = random_value.extract_as_byte_array();

            auto    card_ind = _cards.get_index<"bypack"_n>();
            auto    card     = card_ind.find(pack->pack_name.value);
            uint8_t byte     = 0;
            while (card != card_ind.end() && card->pack_name == pack->pack_name) {
                // get 2 random numbers (8 bit and 16 bit)
                uint16_t rand_1 = randomness_provider.get_uint16();
                uint32_t rand_2 = randomness_provider.get_uint32();

                //            print("\nrand1 ", rand_1);
                //            check(false, "blah");

                chosen_card chosen = choose_card(*card, deposit->account, rand_1, rand_2);

                if (chosen.template_id != 0 || chosen.asset_id != 0) {
                    chosen_cards.push_back(chosen);

                    card++;
                }
            }

            // transfer the bonus fungible token
            asset qty = pack->bonus_ft.quantity;
            if (pack->bonus_ft.quantity.amount > 0) {
                // send between 50 and 100% of the tokens listed
                uint8_t  rand_ft               = randomness_provider.get_uint8();
                double   percentage_multiplier = ((((double)rand_ft / 255.0) * 50.0) + 50.0) / 100.0;
                uint64_t amount                = (uint64_t)((double)pack->bonus_ft.quantity.amount * percentage_multiplier);
                qty.amount                     = amount;
            }

            // hack for land pot on land cards
            if (pack->pack_name == "land"_n) {
                // take a random percentage between 10-20%
                auto mp = minepot_item::get_minepot(get_self(), get_self());

                uint8_t perc_byte  = randomness_provider.get_uint8();
                double  percentage = (((double)perc_byte / 255.0) * 10.0) + 10.0;
                asset   land_bonus = ZERO_TRILIUM;
                land_bonus.amount  = ((mp.commission.amount * 100) * percentage) / 10000;

                mp.commission.amount -= land_bonus.amount;
                mp.save(get_self(), get_self(), get_self());

                // for the log
                qty = land_bonus;
            }

            // add the claim records and send deferred transaction to claim
            auto existing_claim = _claims.find(deposit->account.value);
            if (existing_claim != _claims.end()) {
                chosen_cards.insert(chosen_cards.end(), existing_claim->chosen_cards.begin(), existing_claim->chosen_cards.end());
                qty += existing_claim->ft;

                _claims.modify(existing_claim, get_self(), [&](auto &c) {
                    c.chosen_cards = chosen_cards;
                    c.ft           = qty;
                });
            } else {
                _claims.emplace(get_self(), [&](auto &c) {
                    c.account      = deposit->account;
                    c.chosen_cards = chosen_cards;
                    c.ft           = qty;
                });
            }

            uint16_t trx_rnd = randomness_provider.get_uint16();

            transaction trx;
            trx.max_cpu_usage_ms = 5;
            trx.actions.push_back(action(permission_level{get_self(), "claim"_n}, get_self(), "claim"_n, make_tuple(deposit->account, pack->pack_name)));
            uint128_t def_id = uint128_t(deposit->account.value) << 64 | uint128_t(trx_rnd) << 32 | time_point_sec(current_time_point()).sec_since_epoch();
            trx.send(def_id, get_self());
        }

        _deposits.erase(deposit);
    }
}

void packopener::claim(name account, name pack_name) {
    auto existing_claim = _claims.find(account.value);
    if (existing_claim != _claims.end()) {
        for (auto card : existing_claim->chosen_cards) {
            if (card.template_id) {
                // quick fix for little green man
                if (card.template_id == 19655) {
                    card.template_id = 19654;
                }

                // mint the random template
                ATTRIBUTE_MAP immutable_data     = {};
                ATTRIBUTE_MAP mutable_data       = {};
                vector<asset> quantities_to_back = {};

                templates_t templates(NFT_CONTRACT, NFT_COLLECTION.value);
                auto        t = templates.find(card.template_id);
                check(t != templates.end(), "Template not found, please fix the crates");
                name schema = t->schema_name;

                // Mint the new asset, the mintassset listener will then set the avatar
                action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "mintasset"_n,
                    make_tuple(get_self(), NFT_COLLECTION, schema, card.template_id, account, immutable_data, mutable_data, quantities_to_back))
                    .send();
            } else if (card.asset_id) {
                vector<uint64_t> ids;
                ids.push_back(card.asset_id);
                string memo = "Alien Worlds Pack Open";
                action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "transfer"_n, make_tuple(get_self(), account, ids, memo)).send();
            }
        }

        if (existing_claim->ft.amount > 0) {
            auto mp = minepot_item::get_minepot(get_self(), get_self());

            string ft_memo = "Bonus Tokens";
            action(permission_level{get_self(), "issue"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), account, existing_claim->ft, ft_memo)).send();
        }

        // send log
        action(permission_level{get_self(), "log"_n}, get_self(), "logopen"_n, make_tuple(account, pack_name, existing_claim->chosen_cards, existing_claim->ft))
            .send();

        _claims.erase(existing_claim);
    }
}

void packopener::delclaim(name account) {
    require_auth(get_self());

    auto existing_claim = _claims.find(account.value);

    check(existing_claim != _claims.end(), "Claim not found");

    _claims.erase(existing_claim);
}
// void packopener::randerror(uint64_t job_id, uint64_t assoc_id, checksum256 random_value, string error_msg) {}

void packopener::transfer(name from, name to, asset quantity, string memo) {
    if (to != get_self() || from == "eosio.stake"_n) {
        return;
    }

    auto deposit = _deposits.find(from.value);
    check(deposit == _deposits.end(), "Packs are already deposited, please call the open action before proceeding");

    auto pack_ind = _packs.get_index<"bysym"_n>();
    auto pack     = pack_ind.find(quantity.symbol.raw());
    check(pack != pack_ind.end(), "Pack not found from symbol");

    check(quantity.amount == 1, "You can only open one pack at a time");

    _deposits.emplace(get_self(), [&](auto &d) {
        d.account         = from;
        d.deposited_asset = quantity;
    });
}

/*void packopener::nfttransfer(name from, name to, vector<uint64_t> asset_ids, string memo) {
    if (to != get_self()){
        return;
    }

    auto _assets = atomicassets::assets_t(NFT_CONTRACT, get_self().value);
    for (auto asset_id: asset_ids){
        auto asset = _assets.find(asset_id);
        check(asset != _assets.end(), "Asset not found or not ours");
        check(asset->collection_name == NFT_COLLECTION, "We only accept assets from our collection");
    }

    auto deposit = _nftdeposits.find(from.value);
    if (deposit == _nftdeposits.end()){
        _nftdeposits.emplace(get_self(), [&](auto &n){
            n.account = from;
            n.asset_ids = asset_ids;
        });
    }
    else {
        check(deposit->asset_ids.size() + asset_ids.size() <= 50, "Max of 50 NFTs can be deposited at one time");

        _nftdeposits.modify(deposit, get_self(), [&](auto &n){
            n.asset_ids.insert(n.asset_ids.end(), asset_ids.begin(), asset_ids.end());
        });
    }
}*/

void packopener::tlmtransfer(name from, name to, asset quantity, string memo) {
    if (to == get_self() && from == MINING_CONTRACT) {
        // receive trilium from mining
        auto mp = minepot_item::get_minepot(get_self(), get_self());
        mp.commission.amount += quantity.amount;
        mp.save(get_self(), get_self(), get_self());
    }
}

void packopener::logopen(name opener, name pack_name, vector<chosen_card> chosen_cards, asset ft_bonus) {}

packopener::chosen_card packopener::choose_card(card_item card, name account, uint16_t rand_1, uint32_t rand_2) {
    // choose a random crate based on the probabilities (use 16 bits, reduced to 1/1000)
    // Get a number between 0-1000 and  then loop through the crates until our number is hit from the probability sum
    //    print("\nChoosing card...");
    uint64_t asset_id        = 0;
    uint32_t template_id     = 0;
    uint16_t template_number = 0;
    uint16_t crate_number    = (uint16_t)(1001.0 * ((double)rand_1 / 65535.0));
    if (crate_number > 1000) {
        crate_number = 1000;
    }
    //    print("\nCrate number ", crate_number);
    uint16_t cumulative = 0;
    name     crate_name = name(0);
    for (auto prob : card.card_probabilities) {
        cumulative += prob.probability;
        if (crate_number <= cumulative) {
            crate_name = prob.crate_name;
            break;
        }
    }
    auto crate = _crates.find(crate_name.value);
    check(crate != _crates.end(), "Crate not found after random selection");
    uint16_t crate_size = crate->ids.size();

    if (crate->type == "template"_n) {
        // choose a random item from the crate
        check(crate_size > 0, "Crate is empty!");
        // we only need 16 bits for rand_2
        rand_2          = rand_2 & 0xffff;
        template_number = (uint16_t)((crate_size + 1) * ((double)rand_2 / 65535.0));
        if (template_number >= crate_size) {
            template_number = crate_size - 1;
        }
        check(template_number < crate_size, "Template number is invalid");

        template_id = crate->ids[template_number];

        atomicassets::templates_t templates(NFT_CONTRACT, NFT_COLLECTION.value);
        auto                      t = templates.find(template_id);
        check(t != templates.end(), "Template not found in table");
        if (t->max_supply > 0 && t->max_supply == t->issued_supply) {
            template_id = 0;
        }
    } else if (crate->type == "asset"_n) {
        auto _crateassets = crateassets_table(get_self(), crate->crate_name.value);

        check(_crateassets.begin() != _crateassets.end(), "Crate has no assets");
        rand_2 = rand_2 & 0xffff;

        auto     _index       = _crateassets.get_index<"byindex"_n>();
        auto     lastasset    = --(_index.end());
        uint64_t asset_number = (uint64_t)((double)lastasset->index * ((double)rand_2 / 65535.0));

        auto crateasset = _index.find(asset_number);
        if (crateasset == _index.end()) {
            crateasset = _index.begin();
        }

        asset_id       = crateasset->asset_id;
        uint64_t index = crateasset->index;

        _crateassets.modify(*lastasset, same_payer, [&](auto &a) {
            a.index = index;
        });

        _index.erase(crateasset);
    }

    return {crate_name, crate_number, crate_size, template_number, template_id, asset_id, rand_1, rand_2};
}
