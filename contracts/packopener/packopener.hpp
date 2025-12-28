#include <eosio/asset.hpp>
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>
#include <eosio/crypto.hpp>
#include <eosio/transaction.hpp>
// #include <atomicassets.hpp>
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include "randomness_provider.cpp"

using namespace eosio;
using namespace std;

#include "../config.hpp"

#define SECONDS_PER_DAY 60 * 60 * 24

namespace alienworlds {
    class [[eosio::contract("packopener")]] packopener : public contract {

      public:
        struct cardprob {
            name     crate_name;
            uint16_t probability; // Probability * 10, 223 = 22.3%
        };

        struct chosen_card {
            name     crate_name;
            uint16_t crate_number;
            uint16_t crate_size;
            uint16_t template_number;
            uint32_t template_id;
            uint64_t asset_id;
            uint16_t rand_1;
            uint32_t rand_2;
        };

      private:
        struct [[eosio::table("deposits")]] deposit_item {
            name  account;
            asset deposited_asset;

            uint64_t primary_key() const {
                return account.value;
            }
        };
        typedef multi_index<"deposits"_n, deposit_item> deposits_table;

        /*struct [[eosio::table("nftdeposits")]] nftdeposit_item {
            name             account;
            vector<uint64_t> asset_ids;

            uint64_t primary_key() const { return account.value; }
        };
        typedef multi_index<"nftdeposits"_n, nftdeposit_item> nftdeposits_table;*/

        struct [[eosio::table("packs")]] pack_item {
            name           pack_name;
            symbol         pack_symbol;
            extended_asset bonus_ft;
            bool           active = true;

            uint64_t primary_key() const {
                return pack_name.value;
            }
            uint64_t by_sym() const {
                return pack_symbol.raw();
            }
        };
        typedef multi_index<"packs"_n, pack_item, indexed_by<"bysym"_n, const_mem_fun<pack_item, uint64_t, &pack_item::by_sym>>> packs_table;

        struct [[eosio::table("cards")]] card_item {
            uint64_t         card_id;
            name             pack_name;
            vector<cardprob> card_probabilities;

            uint64_t primary_key() const {
                return card_id;
            }
            uint64_t by_pack() const {
                return pack_name.value;
            }
        };
        typedef multi_index<"cards"_n, card_item, indexed_by<"bypack"_n, const_mem_fun<card_item, uint64_t, &card_item::by_pack>>> cards_table;

        struct [[eosio::table("crates")]] crate_item {
            name             crate_name;
            name             type;
            vector<uint64_t> ids;

            uint64_t primary_key() const {
                return crate_name.value;
            }
        };
        typedef multi_index<"crates"_n, crate_item> crates_table;

        struct [[eosio::table("crateassets")]] crateasset_item {
            uint64_t asset_id;
            uint64_t index;

            uint64_t primary_key() const {
                return asset_id;
            }
            uint64_t by_index() const {
                return index;
            }
        };
        typedef multi_index<"crateassets"_n, crateasset_item, indexed_by<"byindex"_n, const_mem_fun<crateasset_item, uint64_t, &crateasset_item::by_index>>>
            crateassets_table;

        struct [[eosio::table("claims")]] claim_item {
            name                account;
            vector<chosen_card> chosen_cards;
            asset               ft;

            uint64_t primary_key() const {
                return account.value;
            }
        };
        typedef multi_index<"claims"_n, claim_item> claims_table;

        struct minepot_item;
        typedef eosio::singleton<"minepot"_n, minepot_item> minepot_table;
        struct [[eosio::table("minepot")]] minepot_item {
            asset commission = ZERO_TRILIUM;

            static minepot_item get_minepot(eosio::name account, eosio::name scope) {
                return minepot_table(account, scope.value).get_or_default(minepot_item());
            }

            void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
                minepot_table(account, scope.value).set(*this, payer);
            }
        };

        packs_table    _packs;
        cards_table    _cards;
        crates_table   _crates;
        deposits_table _deposits;
        claims_table   _claims;
        // nftdeposits_table _nftdeposits;

        chosen_card choose_card(card_item card, name account, uint16_t rand_1, uint32_t rand_2);

      public:
        using contract::contract;

        packopener(name s, name code, datastream<const char *> ds);

        /*
         * For each pack created there will be a number of cards
         * Each card will have a probability of choosing a crate of templates
         * When a crate is chosen for each card, then a random template is chosen from that
         */

        /* Adds the pack (must also add items with their probability etc) */
        ACTION addpack(name pack_name, symbol pack_symbol, extended_asset bonus_ft, bool active);

        /* Edit pack after creation */
        ACTION editpack(name pack_name, symbol pack_symbol, extended_asset bonus_ft);

        /* Activate or deactivate a pack */
        ACTION activatepack(name pack_name, bool active);

        /* Deletes an existing pack */
        ACTION delpack(name pack_name);

        /* Add a card to the pack, this will include a set of probabilities for each crate */
        ACTION addcard(name pack_name, uint64_t card_id, vector<cardprob> card_probabilities);

        /* Edit a previously created card */
        ACTION editcard(uint64_t card_id, vector<cardprob> card_probabilities);

        /* Delete a previously created card */
        ACTION delcard(uint64_t card_id);

        /* A crate contains a number of template ids, when the crate is selected, a random template is pulled out and minted */
        ACTION addcrate(name crate_name, name type, vector<uint64_t> ids);

        /* Edit a previously created crate */
        ACTION editcrate(name crate_name, vector<uint64_t> template_ids);

        /* Fills a crate from owned NFTs */
        ACTION addasset(name crate_name, uint64_t asset_id);

        /* Empties the items from a crate */
        ACTION emptycrate(name crate_name);

        /* Edit a previously created crate */
        ACTION delcrate(name crate_name);

        ACTION clearcrates();
        ACTION clearpacks();
        ACTION clearcards();

        /* Will open one pack that has previously been sent to the contract */
        ACTION open(name account);

        /* Receive random number from orng.wax */
        ACTION receiverand(uint64_t assoc_id, checksum256 random_value);

        /* claim the unboxed cards / templates */
        ACTION claim(name account, name pack_name);
        /* delete claim */
        ACTION delclaim(name account);

        ACTION logopen(name opener, name pack_name, vector<chosen_card> chosen_cards, asset ft_bonus);

        /* Receive an nft for asset type cards
        [[eosio::on_notify(NFT_CONTRACT_STR "::transfer")]] void nfttransfer(name from, name to, vector<uint64_t> asset_ids, string memo); */

        /* Receive a pack from the user */
        [[eosio::on_notify(PACK_CONTRACT_STR "::transfer")]] void transfer(name from, name to, asset quantity, string memo);

        /* Receive trilium (only as a mining bonus) */
        [[eosio::on_notify(TOKEN_CONTRACT_STR "::transfer")]] void tlmtransfer(name from, name to, asset quantity, string memo);
    };
} // namespace alienworlds
