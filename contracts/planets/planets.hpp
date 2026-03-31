#include <eosio/asset.hpp>
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/transaction.hpp>
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include <math.h>
#include "../common/contracts-common/string_format.hpp"
#include "../common/helpers.hpp"
#include "../common/contracts-common/safemath.hpp"

namespace alienworlds {

    class [[eosio::contract("planets")]] planets : public contract {
      public:
        using contract::contract;
        planets(name receiver, name code, datastream<const char *> ds);

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

        using planets_table = multi_index<"planets"_n, planet_item>;

        /* maps are scoped by planet name */
        struct [[eosio::table("maps")]] map_item {
            uint16_t x;
            uint16_t y;
            uint64_t asset_id;

            uint64_t primary_key() const {
                return (uint64_t{x} << uint64_t{32}) + uint64_t{y};
            }
        };

        using maps_table = multi_index<"maps"_n, map_item>;

        /**
         * @brief Adds a new planet to the _planets table.
         *
         * This function is called to add a new planet to the _planets table. It first checks if the caller has the
         * required authorization. Then, it checks if a planet with the given planet_name already exists in the table.
         * If not, it creates a new planet with the provided information (title, dac_symbol, metadata) and adds it to
         * the table.
         *
         * @param planet_name The unique name of the planet to be added.
         * @param title The title of the planet.
         * @param dac_symbol The symbol of the DAC associated with the planet.
         * @param metadata Additional metadata related to the planet.
         *
         * @pre The function requires the authorization of the contract account.
         * @pre The planet_name must not already exist in the _planets table.
         *
         * @post A new planet with the provided information is added to the _planets table.
         */

        ACTION
        addplanet(name planet_name, string title, symbol dac_symbol, string metadata);

        /**
         * @brief Updates the information of an existing planet in the _planets table.
         *
         * This function is called to update the information of an existing planet in the _planets table. It first
         * checks if the caller has the required authorization. Then, it checks if the planet with the given planet_name
         * exists in the table. If it exists, it updates the planet's title, metadata, and active status.
         *
         * @param planet_name The unique name of the planet to be updated.
         * @param title The updated title of the planet.
         * @param metadata The updated metadata related to the planet.
         * @param active The updated active status of the planet (true or false).
         *
         * @pre The function requires the authorization of the contract account.
         * @pre The planet_name must exist in the _planets table.
         *
         * @post The planet's title, metadata, and active status are updated in the _planets table.
         */
        ACTION updateplanet(name planet_name, string title, string metadata, bool active);

        /**
         * @brief Removes an existing planet from the _planets table.
         *
         * This function is called to remove an existing planet from the _planets table. It first checks if the caller
         * has the required authorization. Then, it checks if the planet with the given planet_name exists in the table.
         * If it exists, it removes the planet from the table.
         *
         * @param planet_name The unique name of the planet to be removed.
         *
         * @pre The function requires the authorization of the contract account.
         * @pre The planet_name must exist in the _planets table.
         *
         * @post The planet is removed from the _planets table.
         */
        ACTION removeplanet(name planet_name);

        /**
         * @brief Sets a map for a specific planet in the _maps table.
         *
         * This function is called to set a map for a specific planet in the _maps table. It first checks if the caller
         * has the required authorization. Then, it checks if the planet with the given planet_name exists in the
         * _planets table. If it exists, it creates a new entry in the _maps table with the provided x, y, and asset_id.
         *
         * @param planet_name The unique name of the planet for which the map is being set.
         * @param x The x-coordinate of the map.
         * @param y The y-coordinate of the map.
         * @param asset_id The asset ID associated with the map.
         *
         * @pre The function requires the authorization of the contract account.
         * @pre The planet_name must exist in the _planets table.
         *
         * @post A new map entry with the provided x, y, and asset_id is added to the _maps table for the specified
         * planet.
         */
        ACTION setmap(name planet_name, uint16_t x, uint16_t y, uint64_t asset_id);

        /**
         * @brief Clears the map entries for a specific planet in the _maps table.
         *
         * This function is called to clear the map entries for a specific planet in the _maps table. It first checks if
         * the caller has the required authorization. Then, it checks if the planet with the given planet_name exists in
         * the _planets table. If it exists, it iterates through the _maps table and removes all the map entries for the
         * specified planet.
         *
         * @param planet_name The unique name of the planet for which the map entries are being cleared.
         *
         * @pre The function requires the authorization of the contract account.
         * @pre The planet_name must exist in the _planets table.
         *
         * @post All map entries for the specified planet are removed from the _maps table.
         */
        ACTION clearmap(name planet_name);

        /**
         * @brief Clears all the planet entries in the _planets table.
         *
         * This function is called to clear all the planet entries in the _planets table. It first checks if the caller
         * has the required authorization. Then, it iterates through the _planets table and removes all the planet
         * entries.
         *
         * @pre The function requires the authorization of the contract account.
         *
         * @post All planet entries are removed from the _planets table.
         */
        ACTION clearplanets();

        /**
         * @brief Resets the last_claim timestamp for all planets.
         *
         * This function is called to reset the last_claim timestamp for all planets. It ensures that the caller has the
         * required authorization. It iterates through all the planets in the _planets table and sets the last_claim
         * timestamp to 0 for each planet.
         *
         * @pre The function requires the authorization of the contract account.
         *
         * @post The last_claim timestamp for all planets is reset to 0.
         */
        ACTION resetclaim();

        ACTION updatestake(const name planet_name, const asset stake);

        ACTION updatemult(const name planet_name, const int64_t nft_multiplier);

      private:
        planets_table _planets;
    };
} // namespace alienworlds