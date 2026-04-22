#pragma once
#include <eosio/symbol.hpp>
#include <eosio/asset.hpp>

using namespace eosio;

static constexpr name FEDERATION_ACCOUNT{"federation"};
static constexpr name INFLATION_ACCOUNT{"inflt.worlds"};
static constexpr name USERPOINTS_ACCOUNT{"uspts.worlds"};
static constexpr name MINING_CONTRACT{"m.federation"};
static constexpr name FIGHTING_CONTRACT{"f.federation"};
#define NFT_CONTRACT_STR "atomicassets"
static constexpr name NFT_CONTRACT{NFT_CONTRACT_STR};
#define TOKEN_CONTRACT_STR "alien.worlds"
static constexpr name TOKEN_CONTRACT{TOKEN_CONTRACT_STR};
static constexpr name NFT_COLLECTION{"alien.worlds"};
static constexpr name TOOLS_SCHEMA{"tool.worlds"};
static constexpr name LAND_SCHEMA{"land.worlds"};
static constexpr name AVATAR_SCHEMA{"faces.worlds"};
static constexpr name WEAPONS_SCHEMA{"arms.worlds"};
#define PACK_CONTRACT_STR "pack.worlds"
static constexpr name PACK_CONTRACT{PACK_CONTRACT_STR};
static constexpr name LANDOWNERS_ACCOUNT{"awlndratings"};
// change this later
static constexpr name RESERVE_ACCOUNT{"vault.worlds"};
static constexpr name NOTIFY_ACCOUNT{"notify.world"_n};
static constexpr name RNG_CONTRACT{"orng.wax"};
static constexpr name PLANETS_CONTRACT{"plnts.worlds"};

static constexpr symbol TLM_SYM{"TLM", 4};

// Inflation amount on 26th October 2025 was 829,029.5660 TLM
static constexpr int64_t DAILY_INFLATION_CAP_UNITS = 8'290'295'660;

#define ZERO_TRILIUM                                                                                                                                           \
    asset { 0, TLM_SYM }
#define UNSTAKE_DELAY 60 * 60 * 24 * 2
const uint32_t SECONDS_PER_DAY  = 24 * 60 * 60;
const uint32_t SECONDS_PER_WEEK = 7 * 24 * 60 * 60;

// mainnet
#define DAC_TOKEN_CONTRACT_STR "token.worlds"
static constexpr name DAC_TOKEN_CONTRACT{DAC_TOKEN_CONTRACT_STR};
#ifdef IS_DEV
#define FREE_TOOL_ID 2
#else
#define FREE_TOOL_ID 19552
#endif

#ifdef IS_DEV
#define MALE_AVATAR_TEMPLATE 4
#define FEMALE_AVATAR_TEMPLATE 5
#else
#define MALE_AVATAR_TEMPLATE 19649
#define FEMALE_AVATAR_TEMPLATE 19648
#endif

#define LANDBOOST_CONTRACT_STR "boost.worlds"
static constexpr name LANDBOOST_CONTRACT{LANDBOOST_CONTRACT_STR};

static constexpr char ERR_PLANET_DOES_NOT_EXIST[] = "ERR:PLANET_DOES_NOT_EXIST: Planet is not part of the federation";

// testnet
// #define DAC_TOKEN_CONTRACT_STR "token.world"
// #define DAC_TOKEN_CONTRACT name(DAC_TOKEN_CONTRACT_STR)
// #define FREE_TOOL_ID 12757
// #define MALE_AVATAR_TEMPLATE 12830
// #define FEMALE_AVATAR_TEMPLATE 12829
