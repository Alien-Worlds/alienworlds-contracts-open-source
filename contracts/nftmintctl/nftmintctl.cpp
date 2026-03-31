#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include "../common/contracts-common/safemath.hpp"
#include "../config.hpp"
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>

using namespace eosio;
using namespace std;
using namespace atomicdata;

// deploy to nftmt.worlds

using config_value_variant = std::variant<int8_t, uint8_t, int32_t, uint32_t, int64_t, uint64_t, int128_t, uint128_t, bool, std::vector<int64_t>, eosio::name,
    std::string, eosio::time_point_sec, eosio::asset, eosio::extended_asset>;

class [[eosio::contract("nftmintctl")]] nftmintctl : public contract {

  public:
    TABLE mintconfigs {
        uint32_t       template_id;
        name           mint_manager;
        name           collection;
        uint16_t       number_minted = 0;
        time_point_sec next_mint_time;
        uint32_t       mint_frequency = 25 * 24 * 60 * 60;
        name           market_place   = ""_n;
        asset          starting_bid;
        uint32_t       duration;
        ATTRIBUTE_MAP  immutable_data = {};
        ATTRIBUTE_MAP  mutable_data   = {};
        bool           active         = false;

        uint64_t primary_key() const {
            return uint64_t{template_id};
        };

        uint64_t by_manager() const {
            return mint_manager.value;
        };

        uint64_t by_active_and_next_time() const {
            return S<uint64_t>(active) << 32 | S<uint64_t>(next_mint_time.utc_seconds);
        };
    };

    using mint_configs_table =
        multi_index<"mintconfigs"_n, mintconfigs, indexed_by<"bymanager"_n, const_mem_fun<mintconfigs, uint64_t, &mintconfigs::by_manager>>,
            indexed_by<"byactivetime"_n, const_mem_fun<mintconfigs, uint64_t, &mintconfigs::by_active_and_next_time>>>;

    mint_configs_table _mint_configs;

    nftmintctl(name s, name code, datastream<const char *> ds) : contract(s, code, ds), _mint_configs(get_self(), get_self().value) {}

    /// @brief Set a new config to be able to mint and create auctions
    /// @param template_id for the atomic asset to be minted
    /// @param mint_manager and authorized account that manages the mint. This account should be authorised with
    /// AtomicAssets as a minter for the desigated collection but must be different to this contract account. In
    /// addition, this contract must be added as an authorized minter to the collection for this to work.
    /// @param collection within atomicassets that the template belongs
    /// @param mint_frequency how often to mint and create auctions for new assets.
    /// @param market_place that the new auction should be hosted in
    /// @param starting_bid amount for the newly created auction
    /// @param duration the length of the created auction in seconds.
    ACTION newconfig(uint32_t template_id, name mint_manager, eosio::name collection, uint32_t mint_frequency, eosio::name market_place,
        eosio::asset starting_bid, uint32_t duration) {
        require_auth(mint_manager);

        check(mint_manager != get_self(), "Mint manager cannot be this contract.");

        check_mint_auth(collection, mint_manager);
        check(collection == "alien.worlds"_n, "Only alien.worlds collection is supported.");

        check(_mint_configs.find(S<uint64_t>(template_id)) == _mint_configs.end(), "config with template already exists.");
        _mint_configs.emplace(mint_manager, [&](mintconfigs &c) {
            c.template_id    = template_id;
            c.mint_manager   = mint_manager;
            c.collection     = collection;
            c.mint_frequency = mint_frequency;
            c.market_place   = market_place;
            c.starting_bid   = starting_bid;
            c.duration       = duration;
        });
    }

    /// @brief Set the new auction configs for a given template_id
    /// @param template_id for the existing mintconfig to update
    /// @param mint_frequency how frequent the new mints should be able to run
    /// @param market_place for the new auction to be announced in
    /// @param starting_bid for the new auction to be started at.
    /// @param duration for the new auction in seconds
    ACTION updateconfig(uint64_t template_id, uint32_t mint_frequency, eosio::name market_place, eosio::asset starting_bid, uint32_t duration) {

        auto matching_config = _mint_configs.require_find(S<uint64_t>(template_id), "No config for the specified template_id.");
        check_mint_auth(matching_config->collection, matching_config->mint_manager);

        require_auth(matching_config->mint_manager);

        _mint_configs.modify(matching_config, same_payer, [&](auto &c) {
            c.mint_frequency = mint_frequency;
            c.market_place   = market_place;
            c.starting_bid   = starting_bid;
            c.duration       = duration;
        });
    }

    /// @brief Erase an existing config for a given template_id
    /// @param template_id for the existing mintconfig to update
    ACTION eraseconfig(uint64_t template_id) {

        auto matching_config = _mint_configs.require_find(S<uint64_t>(template_id), "No config for the specified template_id.");

        require_auth(matching_config->mint_manager);

        _mint_configs.erase(matching_config);
    }

    /// @brief Set the attributes to be set on the newly minted asset for a given template_id
    /// @param template_id for the existing mintconfig to update
    /// @param immutable attributes map to set on new assets
    /// @param mutable attributes map to set on new assets
    ACTION setattrs(uint64_t template_id, ATTRIBUTE_MAP immutable_data, ATTRIBUTE_MAP mutable_data) {
        auto matching_config = _mint_configs.require_find(S<uint64_t>(template_id), "No config for the specified template_id.");
        require_auth(matching_config->mint_manager);

        _mint_configs.modify(matching_config, same_payer, [&](auto &c) {
            c.immutable_data = immutable_data;
            c.mutable_data   = mutable_data;
        });
    }

    /// @brief Change the active status of a mint_config
    /// @param template_id for the MintConfig to change the active status of
    /// @param active whether the mint_config is active or not
    /// @param message string to justify why a mintconfig is being deactivated
    /// @return
    ACTION activate(uint64_t template_id, bool active, string message) {
        require_auth(get_self());

        auto matching_config = _mint_configs.require_find(template_id, "No config for the specified template_id.");

        _mint_configs.modify(matching_config, same_payer, [&](auto &c) {
            c.active = active;
        });
    }

    void check_mint_auth(name collection, name mint_manager) {
        auto collection_itr = atomicassets::collections.require_find(collection.value, "No collection with this name exists");

        check(std::find(collection_itr->authorized_accounts.begin(), collection_itr->authorized_accounts.end(), mint_manager) !=
                  collection_itr->authorized_accounts.end(),
            "mint_manager: %s not authorized to mint new assets", mint_manager);
    }

    ACTION trigger(uint64_t template_id) {
        auto matching_config = _mint_configs.require_find(template_id, "No config for the specified template_id.");

        check_mint_auth(matching_config->collection, matching_config->mint_manager);

        auto current_time = time_point_sec(current_time_point());
        check(matching_config->active, "Minting config is inactive.");
        check(current_time >= matching_config->next_mint_time, "Too soon to trigger next mint. current_time: %s, waiting for time: %s", current_time,
            matching_config->next_mint_time);

        auto          templates          = atomicassets::templates_t{NFT_CONTRACT, matching_config->collection.value};
        auto          matching_template  = templates.require_find(template_id, "Unknown template.");
        vector<asset> quantities_to_back = {};

        action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "mintasset"_n,
            make_tuple(get_self(), matching_config->collection, matching_template->schema_name, matching_config->template_id, get_self(),
                matching_config->immutable_data, matching_config->mutable_data, quantities_to_back))
            .send();
    }

    // Upon successful mint this action should be called with the new asset details
    [[eosio::on_notify(NFT_CONTRACT_STR "::logmint")]] void logmint(uint64_t asset_id, name authorized_minter, name collection_name, name schema_name,
        int32_t preset_id, name new_asset_owner, ATTRIBUTE_MAP immutable_data, ATTRIBUTE_MAP mutable_data, vector<asset> backed_tokens) {

        if (new_asset_owner != get_self() || authorized_minter != get_self()) {
            return;
        }

        auto _aa_assets = atomicassets::assets_t(NFT_CONTRACT, get_self().value);

        auto item = _aa_assets.find(asset_id);

        auto matching_config = _mint_configs.require_find(S<uint64_t>(item->template_id), "No config for the specified template_id.");
        auto current_time    = time_point_sec(current_time_point());

        check(current_time >= matching_config->next_mint_time, "Too soon to start a new auction.");

        // Start auction here
        // announce the auction market.
        action(permission_level{get_self(), "announce"_n}, "atomicmarket"_n, "announceauct"_n,
            make_tuple(get_self(), vector<uint64_t>{asset_id}, matching_config->starting_bid, matching_config->duration, matching_config->market_place))
            .send();

        // Transfer asset to market
        action(permission_level{get_self(), "xfer"_n}, "atomicassets"_n, "transfer"_n,
            make_tuple(get_self(), "atomicmarket"_n, vector<uint64_t>{asset_id}, "auction"s))
            .send();

        _mint_configs.modify(matching_config, same_payer, [&](mintconfigs &c) {
            c.next_mint_time = current_time + matching_config->mint_frequency;
            c.number_minted++;
        });
    }
};
