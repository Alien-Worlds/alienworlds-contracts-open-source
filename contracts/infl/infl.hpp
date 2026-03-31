#include <eosio/asset.hpp>
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/transaction.hpp>
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include <math.h>
#include <numeric>

#include "../common/contracts-common/string_format.hpp"
#include "../common/contracts-common/util.hpp"
#include "../common/helpers.hpp"
#include "../common/contracts-common/safemath.hpp"
#include "../common/contracts-common/singleton.hpp"

#include "../config.hpp"

using namespace eosio;
using namespace std;

namespace alienworlds {

    class [[eosio::contract("infl")]] infl : public contract {
#ifdef IS_DEV
      public:
#else
      private:
#endif

      private:
        static constexpr auto binance_name = "bina.world"_n;

        // Binance allocation is 4 Million TLM per month of inflation, 60% of which can be claimed by binance, the
        // rest goes to the satellite fund
        const asset binance_daily          = TLM(2'400'000) / 30; // 2.4 Million TLM per month
        const asset sat_from_binance_daily = TLM(1'600'000) / 30; // 1.6 Million TLM per month

        struct state_item;
        typedef eosio::singleton<"state"_n, state_item> state_singleton;

        struct [[eosio::table("state")]] state_item {
            int64_t        total_stake;
            uint32_t       nft_genesis = 0;
            uint64_t       nft_total   = 0;
            time_point_sec last_land_fill;
            uint64_t       land_rating_total = 0;

            static state_item get_current_state(eosio::name account, eosio::name scope) {
                return state_singleton(account, scope.value).get_or_default(state_item());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                state_singleton(account, scope.value).set(*this, payer);
            }
        };

        struct reserve_item;
        typedef eosio::singleton<"reserve"_n, reserve_item> reserve_singleton;

        struct [[eosio::table("reserve")]] reserve_item {
            int64_t total = 0;

            static reserve_item get_current_reserve(eosio::name account, eosio::name scope) {
                return reserve_singleton(account, scope.value).get_or_default(reserve_item());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                reserve_singleton(account, scope.value).set(*this, payer);
            }
        };

        struct [[eosio::table("migration")]] migration_state {
            bool completed = false;
        };
        using migration_singleton = eosio::singleton<"migration"_n, migration_state>;

        // Pausable control (mirrors tlm.token)
        TABLE pausable {
            bool paused;
        };
        using pausable_singleton = eosio::singleton<"pausable"_n, pausable>;

        struct [[eosio::table("payouts")]] payout_item {
            name  planet_name;
            asset mining  = asset{0, TLM_SYM};
            asset reserve = asset{0, TLM_SYM};

            uint64_t primary_key() const {
                return planet_name.value;
            }
        };
        using payouts_table = eosio::multi_index<"payouts"_n, payout_item>;

        struct [[eosio::table("dacpayouts")]] dac_payout_item {
            name  dac_account;
            asset amount = asset{0, TLM_SYM};

            uint64_t primary_key() const {
                return dac_account.value;
            }
        };
        using dac_payouts_table = eosio::multi_index<"dacpayouts"_n, dac_payout_item>;

        const std::map<name, name> dac_accounts = {{"eyeke.world"_n, "eyeke.wp.dac"_n}, {"kavian.world"_n, "kavan.wp.dac"_n},
            {"magor.world"_n, "magor.wp.dac"_n}, {"naron.world"_n, "naron.wp.dac"_n}, {"neri.world"_n, "neri.wp.dac"_n}, {"veles.world"_n, "veles.wp.dac"_n}};

        struct [[eosio::table("planets")]] planet_item {
            name           planet_name;
            string         title;
            string         metadata;
            symbol         dac_symbol;
            bool           active         = true;
            int64_t        total_stake    = 0;
            int64_t        nft_multiplier = 0;
            time_point_sec last_claim;

            uint64_t primary_key() const {
                return planet_name.value;
            }
        };

        typedef multi_index<"planets"_n, planet_item> planets_table;

        // Pause helpers
        bool is_paused() {
            auto       x        = pausable_singleton{get_self(), get_self().value};
            const auto pausable = x.get_or_default();
            return pausable.paused;
        }

        void setpaused(const bool paused);

        void check_not_paused() {
            check(!is_paused(), "Contract is paused");
        }

      public:
        using contract::contract;

        infl(name s, name code, datastream<const char *> ds);

        ACTION migrate();

        ACTION inflate();

        ACTION claim(name planet_name);

        ACTION logclaim(name planet_name, asset planet_quantity, asset mining_quantity);

        ACTION pause();
        ACTION unpause();

        asset calculate_planet_pay(const planet_item &planet, const asset &dtap, const int64_t total_staked_tlm);

#ifdef IS_DEV

        /**
         * @brief Sets the reserve total.
         *
         * This function is called to set the reserve total. It ensures that the caller has the required
         * authorization. It retrieves the current reserve and updates its total value. Finally, it saves the
         * updated reserve.
         *
         * @param total The new total value for the reserve.
         *
         * @pre The function requires the authorization of the contract account.
         *
         * @post The reserve total is updated and saved.
         */
        ACTION setreserve(uint64_t total);

        ACTION setmultipl(const name planet, const int64_t nft_multiplier);
        ACTION setlandclaim(time_point_sec last_fill);
#endif
    };
} // namespace alienworlds