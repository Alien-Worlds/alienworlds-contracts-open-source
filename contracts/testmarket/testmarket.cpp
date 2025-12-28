#include "../config.hpp"
#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>
#include <atomicdata.hpp>
#include <atomicassets-interface.hpp>
#include "../common/helpers.hpp"
#include "../common/contracts-common/string_format.hpp"

/**
 * @brief Used only for testing to make sure the announceauct action works
 *
 */
CONTRACT testmarket : public contract {
  public:
    testmarket(name s, name code, datastream<const char *> ds) : contract(s, code, ds) {}

    TABLE auction {
        uint64_t              id;
        eosio::name           seller;
        std::vector<uint64_t> asset_ids;
        eosio::asset          starting_bid;
        uint32_t              duration;
        eosio::name           maker_marketplace;
        uint64_t              primary_key() const {
                         return id;
        }
    };
    using auction_table = eosio::multi_index<"auctions"_n, auction>;

    ACTION announceauct(eosio::name seller, std::vector<uint64_t> asset_ids, eosio::asset starting_bid, uint32_t duration, eosio::name maker_marketplace) {
        auto auctions = auction_table(get_self(), get_self().value);
        auctions.emplace(get_self(), [&](auto &a) {
            a.id                = auctions.available_primary_key();
            a.seller            = seller;
            a.asset_ids         = asset_ids;
            a.starting_bid      = starting_bid;
            a.duration          = duration;
            a.maker_marketplace = maker_marketplace;
        });
    }
};