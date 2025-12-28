#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>

using namespace eosio;
using namespace std;

#include "../config.hpp"

namespace alienworlds {
    CONTRACT shining : public contract {

      public:
        TABLE lookups {
            uint32_t       from;
            uint32_t       to;
            uint8_t        qty;
            asset          cost;
            time_point_sec start_time;
            bool           active;

            uint64_t primary_key() const {
                return (uint64_t)from;
            }
        };
        using lookups_table = multi_index<"lookups"_n, lookups>;

        TABLE deposits {
            name  account;
            asset quantity;

            uint64_t primary_key() const {
                return account.value;
            }
        };
        using deposits_table = multi_index<"deposits"_n, deposits>;

        TABLE shines {
            name           account;
            time_point_sec last_shine;

            uint64_t primary_key() const {
                return account.value;
            }
        };
        using shines_table = multi_index<"shines"_n, shines>;

        TABLE config_item {
            uint64_t genesis_id = 0;

            static auto get_config(eosio::name account, eosio::name scope) {
                return config_table(account, scope.value).get_or_default(config_item());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                config_table(account, scope.value).set(*this, payer);
            }
        };
        using config_table = eosio::singleton<"config"_n, config_item>;

        lookups_table  _lookups;
        deposits_table _deposits;
        shines_table   _shines;

      public:
        using contract::contract;

        shining(name s, name code, datastream<const char *> ds);

        ACTION addlookup(uint32_t from, uint32_t to, asset cost, uint8_t qty, time_point_sec start_time, bool active);

        ACTION setgenesisid(uint64_t genesis_id);

        ACTION clearlookups();

        /* Receive an NFT from the user */
        [[eosio::on_notify(NFT_CONTRACT_STR "::transfer")]] ACTION nfttransfer(name from, name to, vector<uint64_t> asset_ids, string memo);

        /* Receive tlm for payment */
        [[eosio::on_notify(TOKEN_CONTRACT_STR "::transfer")]] ACTION tlmtransfer(name from, name to, asset quantity, string memo);
    };
} // namespace alienworlds
