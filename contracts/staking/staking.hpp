#include <eosio/asset.hpp>
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/transaction.hpp>
#include "../common/contracts-common/string_format.hpp"
#include "../common/helpers.hpp"
#include "../common/contracts-common/safemath.hpp"
#include "../common/contracts-common/singleton.hpp"

namespace alienworlds {

    class [[eosio::contract("staking")]] staking : public contract {
      public:
        using contract::contract;
        staking(name s, name code, datastream<const char *> ds);

        struct [[eosio::table("planets"), eosio::contract("ignoreme")]] planet_item {
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

        struct [[eosio::table("stakedaos")]] stake_dao_item {
            name   dac_id;
            symbol dac_symbol;

            uint64_t primary_key() const {
                return dac_id.value;
            }
            uint64_t by_symbol() const {
                return dac_symbol.raw();
            }
        };

        using stake_dao_table =
            multi_index<"stakedaos"_n, stake_dao_item, indexed_by<"bysymbol"_n, const_mem_fun<stake_dao_item, uint64_t, &stake_dao_item::by_symbol>>>;

        /* Represents a user deposit before staking */
        struct [[eosio::table("deposits")]] deposit_item {
            name  account;
            asset quantity;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"deposits"_n, deposit_item> deposits_table;

        deposits_table _deposits;

        // clang-format off
        SINGLETON(globals, staking, 
            PROPERTY(bool, maintenance_mode);
        )
        // clang-format on

        ACTION maintenance(const bool maintenance);

        /**
         * @brief Deletes a deposit associated with the given account.
         *
         * This function is called to remove a deposit associated with the specified account from the _deposits
         * table. It ensures that the caller has the required authorization before proceeding with the deletion. It
         * also checks if there is a deposit for the given account before attempting to delete it.
         *
         * @param account The account whose deposit is to be deleted.
         *
         * @pre The function requires the authorization of the contract account.
         * @pre A deposit must exist for the given account.
         *
         * @post The deposit associated with the given account is removed from the _deposits table.
         */
        ACTION deldeposit(name account);

        /**
         * @brief Withdraws a user's TLM deposit.
         *
         * This function is called to withdraw a user's TLM deposit. It ensures that the caller has the required
         * authorization and that a deposit exists for the account. It sends a transfer action to return the deposited
         * TLM to the account. Finally, it removes the deposit entry from the _deposits table.
         *
         * @param account The account for which the TLM deposit is to be withdrawn.
         *
         * @pre The function requires the authorization of the account.
         * @pre A deposit must exist for the account.
         *
         * @post The deposited TLM is returned to the account.
         * @post The deposit entry for the account is removed from the _deposits table.
         */
        ACTION withdraw(name account);

        /**
         * @brief Stakes TLM tokens on a planet and converts them to DAC tokens.
         *
         * This function is called to stake TLM tokens on a specified planet and convert them to DAC tokens. It ensures
         * that the caller has the required authorization and that the staking quantity is greater than zero. It
         * searches for the planet in the _planets table and checks if it's part of the Federation and active. It
         * updates the total stake in the state and the planet's total stake. It checks if the account has a deposit and
         * if the deposit is sufficient for the staking quantity. It issues and transfers the required number of DAC
         * tokens to the account. Finally, it updates or removes the deposit entry for the account.
         *
         * @param account The account staking the TLM tokens.
         * @param planet_name The name of the planet on which the TLM tokens are staked.
         * @param quantity The amount of TLM tokens to be staked.
         *
         * @pre The function requires the authorization of the account.
         * @pre The staking quantity must be greater than zero.
         * @pre The planet must be part of the Federation and active.
         * @pre The account must have a sufficient deposit for the staking quantity.
         *
         * @post The total stake in the state and the planet's total stake are updated.
         * @post The required number of DAC tokens are issued and transferred to the account.
         * @post The deposit entry for the account is updated or removed.
         */
        ACTION stake(name account, name planet_name, asset quantity);
        ACTION addstakedao(name dac_id, symbol dac_symbol);
        ACTION rmvstakedao(name dac_id);

        /**
         * @brief Handles notifications for Trilium (TLM) transfers.
         *
         * This function is called when a TLM transfer is made. If the transfer is made to the contract itself, it
         * checks if the transferred quantity is greater than zero. Then, it searches for an existing deposit for the
         * sender in the _deposits table. If a deposit is found, it updates the deposit with the new quantity. If no
         * deposit is found, it creates a new deposit entry with the transferred quantity.
         *
         * @param from The sender of the TLM transfer.
         * @param to The receiver of the TLM transfer.
         * @param quantity The amount of TLM transferred.
         * @param memo A memo attached to the TLM transfer.
         *
         * @pre If the transfer is made to the contract itself, the transferred quantity must be greater than zero.
         *
         * @post If the transfer is made to the contract itself, the deposit for the sender is updated or created in the
         *       _deposits table.
         */
        [[eosio::on_notify("alien.worlds::transfer")]] void ftransfer(name from, name to, asset quantity, std::string memo);

        /**
         * @brief Handles notifications for DAC token transfers (for unstaking).
         *
         * This function is called when a DAC token transfer is made. If the transfer is made from the contract itself
         * or not to the contract, it returns. It performs various checks on the transferred quantity and the sender. It
         * retrieves the planet associated with the transferred quantity's symbol and burns the received DAC tokens. It
         * updates the total stake in the state and the planet's total stake. Finally, it refunds the staked TLM to the
         * sender.
         *
         * @param from The sender of the DAC token transfer.
         * @param to The receiver of the DAC token transfer.
         * @param quantity The amount of DAC tokens transferred.
         * @param memo A memo attached to the DAC token transfer.
         *
         * @pre The transferred quantity must be valid, greater than zero, and the sender must be an existing account.
         * @pre The sender and receiver must not be the same.
         *
         * @post If the transfer is made to the contract itself, the total stake in the state and the planet's total
         * stake are updated, and the staked TLM is refunded to the sender.
         */
        [[eosio::on_notify(DAC_TOKEN_CONTRACT_STR "::transfer")]] void dtransfer(const name from, const name to, const asset quantity, const string &memo);

      private:
        bool maintenance_mode();
        void check_maintenance_mode();

        /**
         * @brief Finds and returns a planet iterator based on the given DAC symbol.
         *
         * This utility function is called to find and return a planet iterator based on the given DAC symbol. It
         * iterates through the _planets table and checks if the planet's DAC symbol matches the input dac_symbol. If a
         * match is found, it returns the iterator pointing to the planet. If no match is found, it raises an error
         * stating that the planet was not found for the given symbol.
         *
         * @param dac_symbol The DAC symbol for which the planet iterator is to be retrieved.
         *
         * @return An iterator pointing to the planet with the matching DAC symbol.
         *
         * @pre A planet with the given DAC symbol must exist in the _planets table.
         */
        auto planet_from_symbol(const symbol dac_symbol) {
            const auto _planets = planets_table(PLANETS_CONTRACT, PLANETS_CONTRACT.value);
            auto       planet   = _planets.begin();
            while (planet != _planets.end()) {
                if (planet->dac_symbol == dac_symbol) {
                    return planet;
                } else {
                    planet++;
                }
            }

            check(false, "Planet not found for symbol %s", dac_symbol);
            __builtin_unreachable();
        }

        void update_planet_stake(const name planet_name, const asset stake_delta) {
            action(permission_level{PLANETS_CONTRACT, "updatestake"_n}, PLANETS_CONTRACT, "updatestake"_n, make_tuple(planet_name, stake_delta)).send();
        }

        /**
         * @brief Gets the DAC tokens for a given planet_name and amount.
         *
         * This function is called to get the DAC tokens for a specified planet_name and amount. It first checks if the
         * planet is part of the Federation of Planets. Then, it returns an asset with the specified amount and the
         * planet's DAC symbol.
         *
         * @param planet_name The name of the planet for which the DAC tokens are to be retrieved.
         * @param amount The amount of DAC tokens to be retrieved.
         *
         * @return An asset with the specified amount and the planet's DAC symbol.
         *
         * @pre The planet must be part of the Federation of Planets.
         */
        asset get_dac_tokens(name planet_name, int64_t amount);
    };

} // namespace alienworlds