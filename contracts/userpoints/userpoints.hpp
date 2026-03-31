#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include <math.h>

using namespace eosio;
using namespace std;

#include "../config.hpp"
#include "../common/contracts-common/safemath.hpp"
#include "../common/contracts-common/singleton.hpp"
#include "../common/user_points_common.hpp"

namespace alienworlds {
    class [[eosio::contract("userpoints")]] userpoints : public contract {
#ifdef IS_DEV
      public:
#else
      private:
#endif
      private:
#ifdef BOT_CHECK
#include "../../alienworlds-contracts-private/closed/closed.hpp"
#else
        bool is_flagged(const name miner) {
            return false;
        }
#endif
        struct [[eosio::table("userterms"), eosio::contract("ignoreme")]] userterms_item {
            name        account;
            int16_t     terms_id;
            checksum256 terms_hash;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"userterms"_n, userterms_item> userterms_table;

        /* Offers table for redeemable points NFTs */
        struct [[eosio::table("pointoffers")]] points_offer {
            uint64_t       id;
            time_point_sec start;
            time_point_sec end;
            uint64_t       template_id;
            uint32_t       required;

            uint64_t primary_key() const {
                return id;
            }
        };

        using point_offers = multi_index<"pointoffers"_n, points_offer>;

        /* Offers table for levels based on total_points for NFTs */
        struct [[eosio::table("leveloffers")]] level_offer {
            uint64_t id;
            uint8_t  level;
            uint64_t template_id;
            uint32_t required;

            uint64_t primary_key() const {
                return id;
            }
            uint64_t by_level() const {
                return uint64_t(level);
            }
        };

        using level_offers = multi_index<"leveloffers"_n, level_offer, indexed_by<"bylevel"_n, const_mem_fun<level_offer, uint64_t, &level_offer::by_level>>>;

        /* Offers table for levels based on total_points for NFTs */
        struct [[eosio::table("premintoffrs")]] premint_offer {
            uint64_t    offer_id;
            eosio::name creator;
            uint32_t    required;
            int32_t     template_id;
            eosio::name collection_name;
            eosio::name callback;
            string      message;
            uint32_t    available_count = 0;
            // This field is to help identify and display the next mint number for the offer.
            uint64_t next_asset_id = 0;

            uint64_t primary_key() const {
                return offer_id;
            }

            uint64_t by_callback() const {
                return callback.value;
            }

            uint64_t by_creator() const {
                return creator.value;
            }
        };

        using premint_offers =
            multi_index<"premintoffrs"_n, premint_offer, indexed_by<"bycallback"_n, const_mem_fun<premint_offer, uint64_t, &premint_offer::by_callback>>,
                indexed_by<"bycreator"_n, const_mem_fun<premint_offer, uint64_t, &premint_offer::by_creator>>>;

        /* Offers table for levels based on total_points for NFTs */
        struct [[eosio::table("preassets")]] premint_asset {
            uint64_t asset_id;
            uint64_t offer_id;

            uint64_t primary_key() const {
                return asset_id;
            }

            uint64_t by_offer() const {
                return offer_id;
            }
        };

        using premint_assets =
            multi_index<"preassets"_n, premint_asset, indexed_by<"byoffer"_n, const_mem_fun<premint_asset, uint64_t, &premint_asset::by_offer>>>;

        // clang-format off
        SINGLETON(daoconfigs, userpoints, 
            PROPERTY(uint8_t, num_added_to_whitelist); 
        );
        // clang-format on

        struct [[eosio::table("whitelist")]] whitelist {
            name account;
            name authorizer;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        typedef multi_index<"whitelist"_n, whitelist> whitelist_table;

        userterms_table   _userterms; // from federation
        user_points_table _userpoints;
        point_offers      _pointoffers;
        level_offers      _leveloffers;
        premint_offers    _premintoffers;
        premint_assets    _premintassets;
        whitelist_table   _whitelist;

        /**
         * @brief private method called by the redeem methods to mint a selected reward NFT fo the user.
         *
         * @param template_id The template id from the Alien worlds collection to mint.
         * @param destn_user The user account to be the intended recipient for the NFT reward
         */
        void mint_asset(uint32_t template_id, name destn_user);

      public:
        using contract::contract;

        userpoints(name s, name code, datastream<const char *> ds);

#ifdef IS_DEV

        ACTION addpoints(name user, uint32_t points, time_point_sec current_time);
        ACTION testaddpnts(name user, uint32_t points, time_point_sec current_time);

        /**
         * @brief action called by the user to redeen a point NFT reward.
         *
         * @param user the user to claim the NFT reward.
         * @param offer_id the available offer if to redeem
         * @param current_time the timestamp used as a reference for claiming the reward.

         */
        ACTION redeempntnft(name user, uint64_t offer_id, time_point_sec current_time);
#else

        /**
         * @brief called by various authorised contract actions to add points to a user account.
         *
         * @param user the user account that should receive the points credit.
         * @param points the number of points to add.
         */
        ACTION addpoints(name user, uint32_t points);
        ACTION testaddpnts(name user, uint32_t points);

        /**
         * @brief action called by the user to redeen a point NFT reward.
         *
         * @param user the user to claim the NFT reward.
         * @param offer_id the available offer if to redeem
         */
        ACTION redeempntnft(name user, uint64_t offer_id);
#endif

        /**
         * @brief action called by the user to redeen a preminted NFT reward with NFT points.
         *
         * @param user the user to claim the NFT reward.
         * @param offer_id the available offer if to redeem
         */
        ACTION redeemprenft(name user, uint64_t offer_id);

        /**
         * @brief called by the federation admins to add/update an existing points based NFT reward offer.
         *
         * @param id The unique id for the reward to either create or update.
         * @param start The date/time when the offer should become active. must be in the future.
         * @param end The date/time when the offer should become inactive. must be in the future and after the start
         * time/date.
         * @param template_id The template id from the alien.worlds collection to mint for the reward.
         * @param required The number of redeemable points required by the user to claim the reward.
         */
        ACTION setptsreward(uint64_t id, time_point_sec start, time_point_sec end, uint64_t template_id, uint32_t required);

        /**
         * @brief called the federation account to delete an existing points based NFT reward offer.
         *
         * @param id the id of the offer to delete.
         */
        ACTION delptsreward(uint64_t id);

        /**
         * @brief called by the federation admins to add/update an existing level based NFT reward offer.
         *
         * @param id The unique id for the level reward to either create or update.
         * @param level the level number to create/update. This should be sequentially set starting at 1
         * @param template_id the atomic assets template id to mint for this level reward.
         * @param required the required number of total points required to get this reward.
         */
        ACTION setlvlreward(uint64_t id, uint8_t level, uint64_t template_id, uint32_t required);

        /**
         * @brief called the federation account to delete an existing level based NFT reward offer.
         *
         * @param id the id of the offer to delete.
         */
        ACTION dellvlreward(uint64_t id);

        /**
         * @brief action called by the user to redeen their next available level NFT reward. This will claim the next
         * available reward based on top_level_claimed + 1.
         *
         * @param user the user to claim the level NFT reward.
         */
        ACTION redeemlvlnft(name user, uint64_t id);

        /**
         * @brief Configure a new Premint offer
         * @param creator name of the account that manages offers
         * @param offer_id to uniquely identify the offer
         * @param collection_name the atomic assets collection for the NFT template on offer
         * @param template_id the atomic assets template_id from the NFT collection on offer
         * @param required number of points to redeem this offer
         * @param message message to display to users wanting to redeem this offer
         * @param callback optional callback account that gets called while redeeming
         */
        ACTION crtpreoffer(const name creator, const uint64_t offer_id, const name collection_name, const int32_t template_id, const uint32_t required,
            const string &message, const name &callback);

        /**
         * @brief Update an existing Premint offer
         * @param creator name of the account that manages offers
         * @param offer_id to uniquely identify the offer
         * @param required number of points to redeem this offer
         * @param message message to display to users wanting to redeem this offer
         * @param callback optional callback account that gets called while redeeming
         */
        ACTION updpreoffer(const name creator, const uint64_t offer_id, const uint32_t required, const string &message, const name &callback);
        /**
         * @brief Removes an existing offer, allowed buy the creator as long as there are no assets available for
         * the offer.
         *
         * @param offer_id
         */
        ACTION
        rmvpreoffer(const uint64_t offer_id, uint16_t batch_size, name nft_receiver);

        /**
         * @brief Sets the value for a generic milestone for a user by an authorised account.
         *
         * @param user to record the milestone value for
         * @param key the numeric key to identify the action
         * @param value the numberic value to record for the provided key
         */
        ACTION
        setmilestone(name user, uint8_t key, uint16_t value);

        ACTION addwhitelist(name account, name authorizer);
        ACTION rmvwhitelist(name account);

        [[eosio::on_notify(NFT_CONTRACT_STR "::transfer")]] void transfer(
            const name from, const name to, const vector<uint64_t> &asset_ids, const string &memo);

#ifdef IS_DEV
        /**
         * @brief Action to test the callback functionality for the preminted NFTs.
         *
         * @param user
         * @param asset_id
         * @param message
         *
         */
        ACTION logredeemnft(const name user, const uint64_t asset_id, const string &message);

        /**
         * @brief Singleton Table to hold a counter for the number of times the logredeemnft action has been called.
         * Just used in development to verify the logredeem notifications are working.
         *
         */
        SINGLETON(logredeem, userpoints, PROPERTY(uint8_t, count);)
#endif

#ifdef IS_DEV
        ACTION reclaim(const std::vector<name> &users, time_point_sec current_time);
#else
        ACTION reclaim(const std::vector<name> &users);
#endif
        ACTION reguser(name user);
        ACTION unreguser(name user);

      private:
        uint64_t parse_memo(const string &memo);
    };
} // namespace alienworlds
