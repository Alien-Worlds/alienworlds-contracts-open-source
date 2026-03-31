#include "shining.hpp"

using namespace alienworlds;
using namespace atomicdata;
using namespace atomicassets;

shining::shining(name s, name code, datastream<const char *> ds)
    : contract(s, code, ds), _lookups(get_self(), get_self().value), _deposits(get_self(), get_self().value), _shines(get_self(), get_self().value) {}

ACTION shining::addlookup(const uint32_t from, const uint32_t to, const asset cost, const uint8_t qty, const time_point_sec start_time, const bool active) {
    require_auth(get_self());

    const auto lookup = _lookups.find(static_cast<uint64_t>(from));
    check(lookup == _lookups.end(), "Lookup for this template exists");
    check(qty > 0, "Quantity is invalid");
    check(from > 0, "From template id is invalid is invalid");
    check(to > 0, "To template id is invalid is invalid");

    _lookups.emplace(get_self(), [&](auto &l) {
        l.from       = from;
        l.to         = to;
        l.qty        = qty;
        l.cost       = cost;
        l.start_time = start_time;
        l.active     = active;
    });
}

ACTION shining::nfttransfer(const name from, const name to, const vector<uint64_t> asset_ids, const string memo) {
    if (to != get_self()) {
        return;
    }

    // load config for min asset id
    const auto     config   = config_item::get_config(get_self(), get_self());
    const uint32_t time_now = current_time_point().sec_since_epoch();

    uint32_t template_check = 0;
    uint64_t material_grade = 0;

    // verify and burn each asset
    const auto _assets = atomicassets::assets_t(NFT_CONTRACT, get_self().value);
    for (auto asset_id : asset_ids) {
        const auto asset = _assets.find(asset_id);
        check(asset != _assets.end(), "Asset not found or not ours");
        check(asset->collection_name == NFT_COLLECTION, "We only accept assets from our collection");

        const uint32_t template_id = asset->template_id;
        check(template_id != 0, "Asset sent is not created from a template");

        if (template_check != 0) {
            check(template_check == template_id, "All assets must be from the same template");
        }

        template_check = template_id;

        // calculate material grade
        check(config.genesis_id <= asset_id, "Invalid genesis asset id");
        material_grade += asset_id - config.genesis_id;

        // burn each asset sent
        action(permission_level{get_self(), "burn"_n}, NFT_CONTRACT, "burnasset"_n, make_tuple(get_self(), asset_id)).send();
    }

    check(template_check != 0, "Template ID not found");

    const auto lookup = _lookups.find(static_cast<uint64_t>(template_check));

    check(lookup != _lookups.end(), "ERR::NOT_BE_SHINED::These assets cannot be shined");
    check(lookup->qty == asset_ids.size(), "ERR::INCORRECT_NUMBER_ASSETS::Incorrect number of assets sent");
    check(lookup->active, "ERR::SHINE_NOT_ACTIVE::This shining is not active");
    check(lookup->start_time.sec_since_epoch() <= time_now, "ERR::SHINE_NOT_STARTED::Shining has not started for this item yet");

    const uint32_t new_asset_template_id = lookup->to;

    // check we have the correct deposit required
    const auto existing_deposit = _deposits.find(from.value);
    check(existing_deposit != _deposits.end(), "Deposit not found");
    check(existing_deposit->quantity.amount >= lookup->cost.amount, "Not enough Trilium paid for shining");

    // remove deposit
    if (existing_deposit->quantity.amount == lookup->cost.amount) {
        _deposits.erase(existing_deposit);
    } else {
        _deposits.modify(*existing_deposit, same_payer, [&](auto &d) {
            d.quantity -= lookup->cost;
        });
    }

    // mint the new asset
    const ATTRIBUTE_MAP immutable_data{{"material_grade", material_grade}};
    const ATTRIBUTE_MAP mutable_data       = {};
    const vector<asset> quantities_to_back = {};

    const templates_t templates{NFT_CONTRACT, NFT_COLLECTION.value};
    const auto        t = templates.find(new_asset_template_id);
    check(t != templates.end(), "To template not found");
    const auto schema = t->schema_name;

    action(permission_level{get_self(), "mint"_n}, NFT_CONTRACT, "mintasset"_n,
        make_tuple(get_self(), NFT_COLLECTION, schema, new_asset_template_id, from, immutable_data, mutable_data, quantities_to_back))
        .send();

    // burn the trilium received
    /*string burn_memo = "Burn for shining";
    action(permission_level{get_self(), "burn"_n},
           TOKEN_CONTRACT, "burn"_n,
           make_tuple(get_self(), lookup->cost, burn_memo))
            .send();*/

    const auto shine = _shines.find(from.value);
    if (shine == _shines.end()) {
        _shines.emplace(get_self(), [&](auto &s) {
            s.account    = from;
            s.last_shine = time_point_sec(current_time_point());
        });
    } else {
        check(time_now > (shine->last_shine.sec_since_epoch() + 60), "ERR::SHINE_TOO_SOON::Please wait 60 seconds between shines");
        _shines.modify(*shine, get_self(), [&](auto &s) {
            s.last_shine = time_point_sec(current_time_point());
        });
    }
}

ACTION shining::tlmtransfer(const name from, const name to, const asset quantity, const string memo) {
    if (to == get_self()) {
        // receive trilium for payment
        const auto existing_deposit = _deposits.find(from.value);
        if (existing_deposit == _deposits.end()) {
            _deposits.emplace(get_self(), [&](auto &d) {
                d.account  = from;
                d.quantity = quantity;
            });
        } else {
            _deposits.modify(*existing_deposit, same_payer, [&](auto &d) {
                d.quantity += quantity;
            });
        }
    }
}

ACTION shining::setgenesisid(const uint64_t genesis_id) {
    require_auth(get_self());

    auto config       = config_item::get_config(get_self(), get_self());
    config.genesis_id = genesis_id;

    config.save(get_self(), get_self(), get_self());
}

ACTION shining::clearlookups() {
    require_auth(get_self());

    auto    lookup = _lookups.begin();
    uint8_t i      = 0;

    while (lookup != _lookups.end() && i < 50) {
        lookup = _lookups.erase(lookup);
        i++;
    }
}
