/// @file autoteleport.cpp
/// @brief Defines the autoteleport contract for automating TLM token transfers via teleport.

#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/time.hpp>
#include <eosio/singleton.hpp>
#include "../common/helpers.hpp"

using namespace std;
using namespace eosio;

/// @brief The main contract class for managing automated TLM teleports.
/// @details This contract allows an owner to configure rules for automatically
///          transferring TLM tokens from its account to a specified destination
///          on another chain using the teleport mechanism. The transfer is triggered
///          manually via the `trigger` action but adheres to configured minimum balance,
///          maximum transfer amount, and minimum frequency constraints.
CONTRACT autoteleport : public contract {
  public:
    autoteleport(name receiver, name code, datastream<const char *> ds) : contract(receiver, code, ds) {}

    /// @brief Forward declaration of the config struct for autoteleport settings.
    struct config_item;

    /// @brief Singleton container for accessing the config struct.
    using config_container = eosio::singleton<"config"_n, config_item>;

    /// @brief Holds the configuration parameters for the autoteleport functionality.
    /// @contract autoteleport
    /// @table config
    struct [[eosio::table("config"), eosio::contract("autoteleport")]] config_item {
        /// @brief Flag indicating if the autoteleport functionality is active.
        bool is_active = false;
        /// @brief The minimum TLM balance required to trigger a teleport.
        asset min_amount;
        /// @brief The maximum TLM amount to teleport in a single operation.
        asset max_amount;
        /// @brief The minimum time (in seconds) required between teleports.
        uint32_t min_frequency;
        /// @brief The time of the last successful teleport.
        time_point_sec last_teleport_time;
        /// @brief The destination address hash on the target chain.
        checksum256 destination;
        /// @brief The identifier of the destination chain.
        uint8_t chain_id;

        /// @brief Retrieves the current configuration from the singleton.
        /// @param account The contract account name.
        /// @param scope The scope for the configuration table (usually the contract account).
        /// @return The current configuration, or a default configuration if none exists.
        static config_item get_current_configs(eosio::name account, eosio::name scope) {
            return config_container(account, scope.value).get_or_default(config_item());
        }

        /// @brief Saves the current configuration state to the singleton.
        /// @param account The contract account name.
        /// @param scope The scope for the configuration table.
        /// @param payer The account paying for the storage.
        void save(eosio::name account, eosio::name scope, eosio::name payer) {
            config_container(account, scope.value).set(*this, payer);
        }
    };

    /// @brief Sets the configuration parameters for autoteleport.
    /// @details Requires authorization of the contract account (`get_self()`). Updates
    ///          the minimum amount, maximum amount, minimum frequency, destination address,
    ///          and destination chain ID. Saves the updated configuration.
    /// @param min_amount The minimum TLM balance required.
    /// @param max_amount The maximum TLM amount to teleport.
    /// @param min_frequency The minimum seconds between teleports.
    /// @param destination The target destination address hash.
    /// @param chain_id The target chain identifier.
    ACTION setconfig(asset min_amount, asset max_amount, uint32_t min_frequency, checksum256 destination, uint8_t chain_id) {
        require_auth(get_self());

        // Check Symbol Code first
        check(min_amount.symbol.code() == TLM_SYM.code(), "ERR::INVALID_SYMBOL::min_amount symbol code mismatch");
        check(max_amount.symbol.code() == TLM_SYM.code(), "ERR::INVALID_SYMBOL::max_amount symbol code mismatch");

        // Then check Precision
        check(min_amount.symbol.precision() == TLM_SYM.precision(), "ERR::INVALID_PRECISION::min_amount precision mismatch");
        check(max_amount.symbol.precision() == TLM_SYM.precision(), "ERR::INVALID_PRECISION::max_amount precision mismatch");

        // Then check Amount values
        check(min_amount.amount > 0, "ERR::INVALID_AMOUNT::min_amount must be positive");
        check(max_amount.amount > 0, "ERR::INVALID_AMOUNT::max_amount must be positive");
        check(max_amount.amount >= min_amount.amount, "ERR::INVALID_AMOUNT::max_amount must be greater than or equal to min_amount");

        auto config          = config_item::get_current_configs(get_self(), get_self());
        config.min_amount    = min_amount;
        config.max_amount    = max_amount;
        config.min_frequency = min_frequency;
        config.destination   = destination;
        config.chain_id      = chain_id;
        config.save(get_self(), get_self(), get_self());
    }

    /// @brief Deactivates the autoteleport functionality.
    /// @details Requires authorization of the contract account (`get_self()`). Sets the
    ///          `is_active` flag in the configuration to `false`.
    ACTION stop() {
        require_auth(get_self());
        auto config      = config_item::get_current_configs(get_self(), get_self());
        config.is_active = false;
        config.save(get_self(), get_self(), get_self());
    }

    /// @brief Activates the autoteleport functionality.
    /// @details Requires authorization of the contract account (`get_self()`). Sets the
    ///          `is_active` flag in the configuration to `true`.
    ACTION start() {
        require_auth(get_self());
        auto config      = config_item::get_current_configs(get_self(), get_self());
        config.is_active = true;
        config.save(get_self(), get_self(), get_self());
    }

    /// @brief Triggers the teleport process based on the current configuration.
    /// @details Requires authorization of the contract account (`get_self()`). Checks if
    ///          autoteleport is active, if the balance meets the minimum threshold, and if
    ///          enough time has passed since the last teleport. If conditions are met,
    ///          it transfers the appropriate TLM amount (up to the maximum) to `other.worlds`
    ///          and then calls the `teleport` action on `other.worlds`. Updates the
    ///          `last_teleport_time` upon successful execution.
#ifdef IS_DEV
    ACTION trigger(time_point_sec current_time) {
#else
    ACTION trigger() {
        const auto current_time = time_point_sec(current_time_point());
#endif
        require_auth(get_self());
        auto config = config_item::get_current_configs(get_self(), get_self());
        check(config.is_active, "ERR: autoteleport is not active");

        auto balance_to_teleport = get_balance();
        check(balance_to_teleport > config.min_amount, "ERR: balance is less than min amount to teleport.");

        if (balance_to_teleport > config.max_amount) {
            balance_to_teleport = config.max_amount;
        }

        const auto time_since_last_teleport = (current_time - config.last_teleport_time.sec_since_epoch()).sec_since_epoch();
        check(time_since_last_teleport >= config.min_frequency, "ERR: too soon to teleport");

        action(permission_level{get_self(), "xfer"_n}, "alien.worlds"_n, "transfer"_n,
            make_tuple(get_self(), "other.worlds"_n, balance_to_teleport, string("Teleport")))
            .send();

        action(permission_level{get_self(), "teleport"_n}, "other.worlds"_n, "teleport"_n,
            make_tuple(get_self(), balance_to_teleport, config.chain_id, config.destination))
            .send();

        config.last_teleport_time = current_time;
        config.save(get_self(), get_self(), get_self());
    }

  private:
    /// @brief Retrieves the TLM balance of the contract account from the `alien.worlds` contract.
    /// @return The asset representing the TLM balance.
    asset get_balance() const {
        const accounts accountstable("alien.worlds"_n, get_self().value);
        const auto    &ac = accountstable.get(TLM_SYM.code().raw());
        return ac.balance;
    }

    /// @brief Represents an account structure holding a balance, used for querying `alien.worlds`.
    /// @contract alien.worlds
    /// @table accounts
    TABLE account {
        asset balance; /// The token balance.

        /// @brief Primary key based on the symbol code raw value.
        uint64_t primary_key() const {
            return balance.symbol.code().raw();
        }
    };

    /// @brief Defines the multi-index table type for accessing the `accounts` table in `alien.worlds`.
    using accounts = eosio::multi_index<"accounts"_n, account>;
};