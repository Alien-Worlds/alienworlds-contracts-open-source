
#include <eosio/eosio.hpp>

using namespace eosio;
using namespace std;

#define RNG_CONTRACT_ACCOUNT "orng.wax"_n

CONTRACT orngwax : public contract{

    public : orngwax(name self, name code, datastream<const char *> ds) : contract(self, code, ds){}

    ~orngwax(){}

    ACTION requestrand(uint64_t assocId, uint64_t seed, name receiver){
        // first request here
        // require_auth(receiver);
    }

    ACTION sendbackrand(name receiver, uint64_t assocId, checksum256 randValue){
        action(permission_level{get_self(), "active"_n}, receiver, "receiverand"_n, std::make_tuple(assocId, randValue)).send();
}
}
;