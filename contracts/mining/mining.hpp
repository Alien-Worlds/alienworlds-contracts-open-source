#include <eosio/asset.hpp>
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>
#include <eosio/transaction.hpp>
// #include <atomicassets.hpp>
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include <cmath>
#include "randomness_provider.cpp"
#include <eosio/binary_extension.hpp>

using namespace eosio;
using namespace std;
using namespace atomicdata;

#include "../config.hpp"
#include "../common/contracts-common/string_format.hpp"
#include "../common/helpers.hpp"
#include "../common/contracts-common/singleton.hpp"
#include "../common/mining_data.hpp"
#include "../common/user_points_common.hpp"

namespace alienworlds {

    class [[eosio::contract("mining")]] mining : public contract {
      public:
#ifdef BOT_CHECK
#include "../../alienworlds-contracts-private/closed/closed.hpp"
#include "../../alienworlds-contracts-private/closed/mining_actions.hpp"
#endif
        /*
                struct contr_nftstate;
                typedef eosio::singleton<"nftstate"_n, contr_nftstate> nftstatecontainer;

                struct [[eosio::table("nftstate")]] contr_nftstate {
                    time_point last_update_time = time_point(current_time_point().time_since_epoch());
                    double     allocation       = 0.0;
                    double     target           = 0.0; // target per 24 hours

                    // Modifies allocation based on time passed and returns difference from target (to be used to modify
           probability) static double modifier(eosio::name account, eosio::name scope) { auto state =
           contr_nftstate::get_current_state(account, scope);

                        if (state.target == 0.0){
                            return 0.0;
                        }

                        double modifier = (state.allocation - state.target) / state.target; // shows proportion over /
           under if (modifier > 1.0){ modifier = 1.0;
                        }

                        uint32_t time_now = current_time_point().sec_since_epoch();
                        uint32_t diff = time_now - state.last_update_time.sec_since_epoch();
                        // subtract target for this number of seconds
                        state.allocation -= diff * (state.target / (60.0 * 60.0 * 24.0));
                        state.last_update_time = time_point(current_time_point().time_since_epoch());

                        state.save(account, scope);

                        return modifier;
                    }

                    // increments the counter if an nft was sent
                    void inc(eosio::name account, eosio::name scope) {
                        this->allocation += 1.0;
                        this->save(account, scope);
                    }

                    static contr_nftstate get_current_state(eosio::name account, eosio::name scope) {
                        return nftstatecontainer(account, scope.value).get_or_default(contr_nftstate());
                    }

                    void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                        nftstatecontainer(account, scope.value).set(*this, payer);
                    }
                };
        */

        struct [[eosio::table("minerclaim")]] miner_claim {
            name           miner;
            asset          amount;
            time_point_sec timestamp;

            uint64_t primary_key() const {
                return miner.value;
            }
        };

        typedef multi_index<"minerclaim"_n, miner_claim> miner_claim_table;

        struct [[eosio::table("landcomms")]] landcomm {
            name           landowner;
            asset          comms;
            time_point_sec timestamp;

            uint64_t primary_key() const {
                return landowner.value;
            }
        };

        typedef multi_index<"landcomms"_n, landcomm> landcomms_table;

        struct [[eosio::table("miners")]] miner {
            name           miner;
            checksum256    last_mine_tx;
            time_point_sec last_mine;
            uint64_t       current_land;

            uint64_t primary_key() const {
                return miner.value;
            }
        };
        typedef multi_index<"miners"_n, miner> miners_table;

        struct [[eosio::table("bags")]] bag {
            name             account;
            vector<uint64_t> items;
            bool             locked = false;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"bags"_n, bag> bags_table;

        struct [[eosio::table("deposits")]] deposit {
            name  account;
            asset quantity;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"deposits"_n, deposit> deposits_table;

        struct [[eosio::table("whitelist")]] whitelist {
            name account;
            name authorizer;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"whitelist"_n, whitelist> whitelist_table;

        struct contr_global;
        typedef eosio::singleton<"global"_n, contr_global> globalcontainer;

        struct [[eosio::table("global")]] contr_global {
            uint16_t delay_multiplier = 10; // all measured as multiplier with 1 decimal
            uint16_t luck_multiplier  = 10;
            uint16_t ease_multiplier  = 10;

            static contr_global get_current_global(eosio::name account, eosio::name scope) {
                return globalcontainer(account, scope.value).get_or_default(contr_global());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                globalcontainer(account, scope.value).set(*this, payer);
            }
        };

        struct contr_state;
        typedef eosio::singleton<"state3"_n, contr_state> statecontainer;

        struct [[eosio::table("state3")]] contr_state {
            time_point last_fill_time = time_point(current_time_point().time_since_epoch());
            double     fill_rate      = 0.0;
            asset      bucket_total   = ZERO_TRILIUM;
            asset      mine_bucket    = ZERO_TRILIUM;

            static contr_state get_current_state(eosio::name account, eosio::name scope) {
                return statecontainer(account, scope.value).get_or_default(contr_state());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                statecontainer(account, scope.value).set(*this, payer);
            }
        };

        struct pools;
        typedef eosio::singleton<"pools"_n, pools> pools_container;

        struct [[eosio::table("pools")]] pools {
            std::map<string, double> rates        = {{"Abundant", 10.0}, {"Rare", 60.0}, {"Common", 20.0}};
            std::map<string, asset>  pool_buckets = {};

            static pools get_current(eosio::name account, eosio::name scope) {
                return pools_container(account, scope.value).get_or_default(pools());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                pools_container(account, scope.value).set(*this, payer);
            }

            void distribute_to_pools(const asset new_amount) {
                for (const auto &[rarity, rate] : rates) {
                    if (pool_buckets.find(rarity) == pool_buckets.end()) {
                        pool_buckets.insert_or_assign(rarity, ZERO_TRILIUM);
                        check(pool_buckets.find(rarity) != pool_buckets.end(), "pool_buckets.find(rarity) != pool_buckets.end() 1");
                    } else if (!pool_buckets.at(rarity).is_valid()) {
                        pool_buckets.insert_or_assign(rarity, ZERO_TRILIUM);
                    }

                    // if we're here that means there must be a value in it
                    check(pool_buckets.find(rarity) != pool_buckets.end(), "pool_buckets.find(rarity) != pool_buckets.end() 2");
                    check(pool_buckets.at(rarity).is_valid(), "pool_buckets.at(rarity).is_valid()");
                    pool_buckets.at(rarity) += new_amount * S{rate * 1000}.to<int64_t>().value() / S{int64_t{100'000}}.value();
                }
            }
        };

        struct contr_props;
        typedef eosio::singleton<"props"_n, contr_props> propscontainer;

        struct [[eosio::table("props")]] contr_props {
            uint32_t last_rng = 0;
            uint32_t reserved1;
            uint64_t reserved2;
            uint64_t reserved3;
            uint64_t reserved4;

            static contr_props get_current_state(eosio::name account, eosio::name scope) {
                return propscontainer(account, scope.value).get_or_default(contr_props());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                propscontainer(account, scope.value).set(*this, payer);
            }
        };

        struct [[eosio::table("tooluse")]] tooluse_item {
            uint64_t asset_id;
            uint32_t last_use;

            uint64_t primary_key() const {
                return asset_id;
            }
        };
        typedef multi_index<"tooluse"_n, tooluse_item> tooluse_table;

        /* From federation contract */

        struct userterms_item {
            name        account;
            int16_t     terms_id;
            checksum256 terms_hash;

            uint64_t primary_key() const {
                return account.value;
            }
        };
        typedef multi_index<"userterms"_n, userterms_item> userterms_table;

        struct landreg {
            uint64_t id;
            name     owner;

            uint64_t primary_key() const {
                return id;
            }
        };
        typedef multi_index<"landregs"_n, landreg> landregs_table;

        struct planet {
            name    planet_name;
            string  title;
            string  metadata;
            symbol  dac_symbol;
            bool    active      = true;
            int64_t total_stake = 0;

            uint64_t primary_key() const {
                return planet_name.value;
            }
        };
        typedef multi_index<"planets"_n, planet> planets_table;

        // clang-format off
        SINGLETON(pltdtapconf, mining, 
            PROPERTY(name, claim_destination);
            PROPERTY(uint32_t, claim_rate_perc_x100);
            PROPERTY(asset, claim_bucket);
        );
        // clang-format on

#ifndef BOT_CHECK
        // clang-format off
        SINGLETON(config, mining, 
            PROPERTY(uint32_t, claimmines_delay_secs);
        );
        // clang-format on
#endif
        // clang-format off
        SINGLETON(plntconfigs, landholders, 
            PROPERTY(uint32_t, min_commission); 
            PROPERTY(uint32_t, max_commission);
        );
        // clang-format on

      private:
        miners_table      _miners;
        deposits_table    _deposits;
        bags_table        _bags;
        tooluse_table     _tooluse;
        miner_claim_table _miner_claims;
        landcomms_table   _land_comms;
#ifndef BOT_CHECK
        static constexpr auto external_bot_checker = name{};
#endif
        static constexpr auto blocked_landowners = std::array{"atomicmarket"_n, "atomictoolsx"_n, "s.rplanet"_n};

        /* Private methods */
        name                                  planet_from_land_id(const uint64_t land_id, const name landowner, const atomicdata::ATTRIBUTE_MAP &data);
        mining_data2                          mining_data_from_account(const name account, const bag &bag);
        mining_data2                          mining_data_from_land(const uint64_t land_id, const name landowner, const atomicdata::ATTRIBUTE_MAP &data);
        std::pair<mining_data2, mining_data2> mining_data(
            const name account, const uint64_t land_id, const bag &bag, const name landowner, const atomicdata::ATTRIBUTE_MAP &data);
        void           update_bag_mine_time(const name miner, const bag &bag);
        time_point_sec bag_last_mine(const name owner, const vector<uint64_t> &bag_items);
        asset          calculate_mine_bucket_allocation(const contr_state &state);
        asset          calculate_mining_amount(const mining::contr_state &state, const mining_data2 &md, const name miner, const bool is_bot);
        std::tuple<asset, std::map<string, asset>> calculate_mining_amounts(
            asset new_to_mine_bucket, const mining_data2 &md, const name miner, const name planet_name, const bool is_bot);

        asset calculate_profit_share(const asset mined_asset, const mining_data2 &md, const name planet_name);
        void  add_luckpoints(const mining_data2 &md, const name miner);
        void  check_nonce(const miner &miner_inst, const mining_data2 &md, const vector<char> &nonce);
        void  save_miner_data(const miner &miner_inst, const checksum256 &trx_id);
        void  check_time_since_last_mine(const miner &miner_inst, const bag &bag_itr, const mining_data2 &md);
        bool  hasAgreedToUserTerms(const name miner);
#ifndef BOT_CHECK
        void assert_bot(const checksum256 &trx_id, const config &conf);

        void check_trx(const std::vector<char> &buffer, const name miner){};
#endif
        bool should_get_commission(const name landowner);
        name planet_auth(const name planet);

      public:
        using contract::contract;

        mining(name s, name code, datastream<const char *> ds);

#ifndef BOT_CHECK
        ACTION setparam(uint64_t key, uint64_t value);
        void   set_param_internal(uint64_t key, uint64_t value){};
        ACTION setparams(vector<std::pair<uint64_t, uint64_t>> params);
        ACTION testparam(name key);
        ACTION clearparams();
        void   insert_miner(const name miner);
        bool   is_flagged(const name miner) {
              return false;
        };
        bool check_is_bot(const name miner, const checksum256 &trx_id) {
            return false;
        }
#endif
        ACTION setpoolrates(const std::map<string, double> &rates, const name planet_name);
        ACTION addnotify(const name authorizer, const name planet, const name account);
        ACTION rmvnotify(const name authorizer, const name planet, const name account);

#ifdef IS_TEST_DEPLOY
        ACTION
        testpoints(name account, uint32_t points);
#endif
        /* Set target for nfts */
        //        ACTION setnfttarget(double target);

        /* Mine action, hash must be of {account_name}{time}{nonce} and first 5 characters (20bits) must be 0s */

        ACTION mine(const name miner, const vector<char> &nonce, binary_extension<name> notify);

        /**
         * @brief Claim pending mining rewards for receiver. Requires the receiver's auth or self to allow batch
         * processing.
         *
         * @param receiver
         */
        ACTION claimmines(name receiver);
#ifdef IS_DEV
        ACTION reclaim(const std::vector<name> &users, bool extra_check, time_point_sec current_time);
#else
        ACTION reclaim(const std::vector<name> &users, bool extra_check);
#endif

#ifdef IS_DEV

        /**
         * @brief DEBUG action to test mining claims delays
         *
         * @param miner
         * @param amount
         * @param timestamp
         * @return ACTION
         */
        ACTION instmineclms(name miner, asset amount, time_point_sec timestamp);

        /**
         * @brief DEBUG action to set miner's last_mine timestamp for testing activity-based reclaim
         *
         * @param miner
         * @param last_mine_timestamp
         * @return ACTION
         */
        ACTION setlastmine(name miner, time_point_sec last_mine_timestamp);

        /**
         * @brief DEBUG action to create a miner with specific last_mine timestamp
         *
         * @param miner
         * @param land_id
         * @param last_mine_timestamp
         * @return ACTION
         */
        ACTION testminer(name miner, uint64_t land_id, time_point_sec last_mine_timestamp);
#endif

        /**
         * @brief Claim pending land commissions for receiver. Requires the receiver's auth or self to allow batch
         * processing.
         *
         * @param receiver
         */
        ACTION claimcomms(name receiver);

#ifdef IS_DEV

        /**
         * @brief Test action for the mining point adding to federation
         *
         * @param miner
         * @param points
         */
        ACTION addpointst(name miner, uint32_t points);
#endif
        /* Fill action will fill the bucket for a particular planet based on a deposit (entire deposit always filled) */
        ACTION fill(name account, name planet_name);

        /* Set the players mining bag, items are ids of NFTs */
        ACTION setbag(name account, vector<uint64_t> items);

        /* Set the current piece of land to mine on */
        ACTION setland(name account, uint64_t land_id);

        /* Debug to reset state */
        ACTION resetstate(name planet_name);

        /* Admin only, remove miners */
        ACTION clearminers();

        /* Admin only, remove bags */
        ACTION clearbags();

        ACTION unlockbag(name miner);

        ACTION setconfig(const std::string &key, const state_value_variant &value);

        ACTION pltdtapset(name planet_name, uint32_t claim_rate_perc_x100, name destination);
        ACTION pltdtapclaim(name planet_name);
        ACTION pltdtapntfy(const name planet, const name destination, asset amount);

        /* NFT token log */
        [[eosio::on_notify(NFT_CONTRACT_STR "::logtransfer")]] void logtransfer(
            name collection_name, name from, name to, vector<uint64_t> asset_ids, string memo);

        /* Trilium transfer to register a deposit before fill */
        [[eosio::on_notify("alien.worlds::transfer")]] void transfer(name from, name to, asset quantity, string memo);
    };
} // namespace alienworlds
