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

using namespace eosio;
using namespace std;

#include "../config.hpp"

namespace alienworlds {

    class [[eosio::contract("federation")]] federation : public contract {
#ifdef IS_DEV
      public:
#else
      private:
#endif

      private:
        template <typename T>
        T abs(const T &a) {
            return a < T{} ? -a : a;
        }

        struct [[eosio::table("userterms")]] userterms_item {
            name        account;
            int16_t     terms_id;
            checksum256 terms_hash;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"userterms"_n, userterms_item> userterms_table;

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

        /* NFTs held for mining rewards */
        struct [[eosio::table("players")]] player_item {
            name     account;
            uint64_t avatar;
            string   tag;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"players"_n, player_item> players_table;

        players_table   _players;
        userterms_table _userterms;

        // clang-format off
        SINGLETON(globals, staking, 
            PROPERTY(bool, maintenance_mode);
        )
        // clang-format on

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

        /**
         * @brief private method called by the redeem methods to mint a selected reward NFT fo the user.
         *
         * @param template_id The template id from the Alien worlds collection to mint.
         * @param destn_user The user account to be the intended recipient for the NFT reward
         */
        void mint_asset(uint32_t template_id, name destn_user);

      public:
        using contract::contract;

        federation(name s, name code, datastream<const char *> ds);

        ACTION maintenance(const bool maintenance);
        bool   maintenance_mode();
        void   check_maintenance_mode();

        /**
         * @brief Sets the tag for a given account.
         *
         * This function is called to set the tag for a specified account. It ensures that the caller has the required
         * authorization and that the tag size is less than or equal to 18 characters. If the player is found in the
         * _players table, it updates the player's tag. If the player is not found, it creates a new player entry with
         * the specified tag.
         *
         * @param account The account for which the tag is to be set.
         * @param tag The tag to be set for the account.
         *
         * @pre The function requires the authorization of the account.
         * @pre The tag size must be less than or equal to 18 characters.
         *
         * @post The tag for the specified account is set or updated in the _players table.
         */
        ACTION settag(name account, string tag);

        /**
         * @brief Sets the avatar for a given account.
         *
         * This function is called to set the avatar for a specified account. It ensures that the caller has the
         * required authorization and that the account has the correct suffix. If the avatar_id is 1 or 2, it sets a
         * default avatar (male or female) for new players. If the avatar_id is not 1 or 2, it checks if the player owns
         * the avatar and if the avatar is from the correct collection and schema. Finally, it updates or creates a new
         * player entry with the specified avatar_id.
         *
         * @param account The account for which the avatar is to be set.
         * @param avatar_id The ID of the avatar to be set for the account.
         *
         * @pre The function requires the authorization of the account.
         * @pre The account must have the correct suffix.
         * @pre If the avatar_id is not 1 or 2, the player must own the avatar and the avatar must be from the correct
         *      collection and schema.
         *
         * @post The avatar for the specified account is set or updated in the _players table.
         */
        ACTION setavatar(name account, uint64_t avatar_id);

        /**
         * @brief Allows an account to agree to terms by updating or creating an entry in the _userterms table.
         *
         * This function is called when an account wants to agree to terms. It first checks if the caller has the
         * required authorization. Then, it checks if the account has already agreed to any terms in the _userterms
         * table. If not, it creates a new entry with the provided terms_id and terms_hash and adds it to the table. If
         * the account already exists in the table, it updates the existing entry with the new terms_id and terms_hash.
         *
         * @param account The account agreeing to the terms.
         * @param terms_id The ID of the terms being agreed to.
         * @param terms_hash The hash of the terms being agreed to.
         *
         * @pre The function requires the authorization of the account.
         *
         * @post If the account has not previously agreed to any terms, a new entry is created in the _userterms table.
         * @post If the account has previously agreed to terms, the existing entry in the _userterms table is updated
         * with the new terms_id and terms_hash.
         */

        ACTION agreeterms(name account, uint16_t terms_id, checksum256 terms_hash);

#ifdef IS_DEV

#endif

        /**
         * @brief Handles actions when an NFT is minted.
         *
         * This function is called when an NFT is minted. It takes various parameters such as asset_id,
         * authorized_minter, collection_name, schema_name, preset_id, new_asset_owner, immutable_data, mutable_data,
         * and backed_tokens. If the schema_name is AVATAR_SCHEMA, it checks if it's the user's first avatar and sets it
         * accordingly. If the schema_name is LAND_SCHEMA, it registers the asset in the land registry.
         *
         * @param asset_id The ID of the minted NFT.
         * @param authorized_minter The account authorized to mint the NFT.
         * @param collection_name The name of the NFT collection.
         * @param schema_name The name of the NFT schema.
         * @param preset_id The preset ID of the NFT.
         * @param new_asset_owner The owner of the newly minted NFT.
         * @param immutable_data A map of immutable attributes for the NFT.
         * @param mutable_data A map of mutable attributes for the NFT.
         * @param backed_tokens A vector of backed tokens for the NFT.
         *
         * @post If the schema_name is AVATAR_SCHEMA, the user's first avatar is set accordingly.
         * @post If the schema_name is LAND_SCHEMA, the asset is registered in the land registry.
         */
        [[eosio::on_notify(NFT_CONTRACT_STR "::logmint")]] void logmint(uint64_t asset_id, name authorized_minter, name collection_name, name schema_name,
            int32_t preset_id, name new_asset_owner, atomicdata::ATTRIBUTE_MAP immutable_data, atomicdata::ATTRIBUTE_MAP mutable_data,
            vector<asset> backed_tokens);
    };
} // namespace alienworlds
