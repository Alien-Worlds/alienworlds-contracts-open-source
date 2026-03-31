// #include <atomicassets_public.hpp>
#include "../config.hpp"
#include <atomicdata.hpp>
#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/multi_index.hpp>
#include <eosio/singleton.hpp>

using namespace eosio;
using namespace std;

// Table Index IDs
#define QUEUE_IDX "queueidx"_n
#define MATCH_ROUND_IDX "matchround"_n
#define WINS_IDX "wins"_n
#define NUM_MATCHES_IDX "nummatches"_n
#define RATING_IDX "ratings"_n

// #define FEDERATION_ACCOUNT "federation"_n
// #define NFT_CONTRACT "atomicassets"_n
// #define TOKEN_CONTRACT "alien.worlds"_n
// #define NFT_COLLECTION "alwgcollectn"_n
// #define WEAPON_SCHEMA "alwweapschme"_n
#define MINION_SCHEMA "alwminschme"_n
#define MINION_TEMPLATE_ID 1
#define CONTRACT_NAME "alwgladiator"
// #define RNG_CONTRACT_ACCOUNT "orng.wax"_n
// #define TLM_SYM \
//     symbol { "TLM", 4 }
// #define ZERO_TRILIUM \
//     asset { \
//         0, symbol { "TLM", 4 } \
    }

namespace alwgames {
    enum WeaponType : uint8_t { NONE = 0, NATURE = 1, FIRE = 2, GEM = 3, AIR = 4, METAL = 5, EARTH = 6 };
    enum Race : uint8_t { Human = 0, Grey = 1, Nordic = 2, LGP = 3, Reptiloid = 4, robotron = 5 };
    enum MinionType : uint8_t { None = 0 };

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] weapon {
        uint64_t id      = 0;
        uint8_t  type    = NONE;
        uint8_t  attack  = 8;
        uint8_t  defence = 8;
    };

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] minion {
        uint64_t id          = 0;
        string   name        = "unnamed";
        uint8_t  type        = None;
        uint8_t  race        = Human;
        uint8_t  attack      = 5;
        uint8_t  defence     = 10;
        uint8_t  movecost    = 20;
        uint32_t num_matches = 0;
        uint32_t num_wins    = 0;

        atomicdata::ATTRIBUTE_MAP mutableAttributes() {
            atomicdata::ATTRIBUTE_MAP mutable_data = {};

            mutable_data["nummatches"] = num_matches;
            mutable_data["numwins"]    = num_wins;

            return mutable_data;
        }

        atomicdata::ATTRIBUTE_MAP immutableAttributes() {
            atomicdata::ATTRIBUTE_MAP mutable_data = {};

            mutable_data["name"]     = name;
            mutable_data["type"]     = type;
            mutable_data["race"]     = race;
            mutable_data["defence"]  = defence;
            mutable_data["attack"]   = attack;
            mutable_data["movecost"] = movecost;

            return mutable_data;
        }
    };

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] CombatData {
        name   player;
        minion minion;
        weapon playerWeapon;
        weapon minionWeapon;
        name   planetName;

        uint64_t primary_key() const { return player.value; };
        uint64_t by_minion() const { return minion.id; };
        uint64_t by_playerWeapon() const { return playerWeapon.id; };
        uint64_t by_minionWeapon() const { return minionWeapon.id; };

        bool hasWeaponMatching(WeaponType weaponType) {
            return (this->playerWeapon.type == weaponType || this->minionWeapon.type == weaponType);
        }
    };

    typedef multi_index<"combatdata"_n, CombatData> combatData_table;

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] RatedPlayer {
        name     player;
        uint32_t rating;
        uint32_t numberOfWins    = 0;
        uint32_t numberOfMatches = 0;
        asset    balance;

        uint64_t primary_key() const { return player.value; };
        uint64_t by_number_of_wins() const { return numberOfWins; };
        uint64_t by_number_of_matches() const { return numberOfMatches; };
        uint64_t by_rating() const { return UINT32_MAX - rating; };
    };

    typedef multi_index<"players"_n, RatedPlayer,
        indexed_by<WINS_IDX, const_mem_fun<RatedPlayer, uint64_t, &RatedPlayer::by_number_of_wins>>,
        indexed_by<NUM_MATCHES_IDX, const_mem_fun<RatedPlayer, uint64_t, &RatedPlayer::by_number_of_matches>>,
        indexed_by<RATING_IDX, const_mem_fun<RatedPlayer, uint64_t, &RatedPlayer::by_rating>>>
        players_table;

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] QueuedPlayer {
        name     player;
        uint32_t rating;
        uint64_t queueIdx;

        uint64_t primary_key() const { return player.value; };
        uint64_t by_queueIdx() const { return queueIdx; };
    };

    typedef multi_index<"matchqueue"_n, QueuedPlayer,
        indexed_by<QUEUE_IDX, const_mem_fun<QueuedPlayer, uint64_t, &QueuedPlayer::by_queueIdx>>>
        queue_table;

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] PendingMatch {
        uint64_t id;
        uint64_t matchRoundId;
        name     player1;
        name     player2;

        uint64_t primary_key() const { return id; };
        uint64_t matchRoundKey() const { return matchRoundId; };
    };

    typedef multi_index<"pendmatches"_n, PendingMatch,
        indexed_by<MATCH_ROUND_IDX, const_mem_fun<PendingMatch, uint64_t, &PendingMatch::matchRoundKey>>>
        matches_table;

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] PlanetConfig {
        name     planet_id;
        uint32_t arena_chance_to_win;

        uint64_t primary_key() const { return planet_id.value; };
    };

    typedef multi_index<"planetconfig"_n, PlanetConfig> planet_config_table;

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] state {
        uint64_t numberOfGamesPlayed  = 0;
        uint64_t nextQueuePosition    = 0;
        uint64_t matchRoundId         = 0;
        uint16_t numberPendingMatches = 0;
    };

    typedef singleton<"state"_n, state> state_singleton;

    struct [[eosio::table, eosio::contract(CONTRACT_NAME)]] configs {
        uint16_t numberOfGamesPerRound = 10;
        uint16_t kValue                = 40;
        uint32_t starterRating         = 1000;
        uint16_t matchRating           = 50;
        asset    deposit_required      = asset{200000, symbol{"TLM", 4}};
    };

    typedef singleton<"configs"_n, configs> config_singleton;
}; // namespace alwgames