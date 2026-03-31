#include <vector>
#include <string>

#include <eosio/contract.hpp>
#include <eosio/name.hpp>
#include <eosio/asset.hpp>
#include <eosio/action.hpp>
#include "../config.hpp"
#include "../common/mining_data.hpp"

using namespace eosio;
using namespace std;

namespace alienworlds {

    CONTRACT notify : public contract {
      public:
        notify(name self, name code, datastream<const char *> ds) : contract(self, code, ds) {}

        ACTION logmine(const name miner, const mining_data2 &params, const asset bounty, const uint64_t land_id, const name planet_name, const name landowner,
            const std::vector<uint64_t> &bag_items, const uint32_t offset, const asset landowner_share, std::map<string, asset> &pool_amounts) {
            require_auth(MINING_CONTRACT);
        };
    };

} // namespace alienworlds