#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>

using namespace eosio;

class [[eosio::contract("mock.teleport")]] mock_teleport : public contract {
  public:
    using contract::contract;

    // This action simulates receiving a teleport.
    // The parameters match the standard teleport `received` action.
    ACTION teleport(name from, asset quantity, uint8_t chain_id, checksum256 eth_address);

    // This action is needed to handle the transfer notification from eosio.token
    // when receiving funds as part of a teleport.
    [[eosio::on_notify("eosio.token::transfer")]] void on_transfer(name from, name to, asset quantity, std::string memo);
};