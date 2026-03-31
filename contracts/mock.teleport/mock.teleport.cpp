#include "mock.teleport.hpp"
#include <string> // Include for std::to_string with vectors

using namespace eosio;

// Implementation for the 'received' action.
// In a real scenario, this would handle incoming teleported assets.
// For the mock, we just acknowledge the call and log parameters via check.
void mock_teleport::teleport(name from, asset quantity, uint8_t chain_id, checksum256 eth_address) {
    // Convert checksum256 to string for display
    std::string eth_address_str = "0x";
    const auto  bytes           = eth_address.extract_as_byte_array();
    for (uint8_t byte : bytes) {
        char hex[3];
        sprintf(hex, "%02x", byte);
        eth_address_str += hex;
    }

    // Fail transaction and print parameters for debugging
    // check(false, "mock_teleport::teleport called with: from=" + from.to_string() +
    //                  ", quantity=" + quantity.to_string() + ", chain_id=" + std::to_string(chain_id) +
    //                  ", eth_address=" + eth_address_str);
    print("mock_teleport::teleport called with: from=", from, ", quantity=", quantity, ", chain_id=", (int)chain_id, ", eth_address=", eth_address_str);
}

// Implementation for the 'on_transfer' notification.
// In a real scenario, this might verify incoming funds related to a teleport.
// For the mock, we just acknowledge the notification and log parameters via check.
void mock_teleport::on_transfer(name from, name to, asset quantity, std::string memo) {
    // We only care about transfers *to* this contract
    if (to != get_self()) {
        return;
    }
    // Fail transaction and print parameters for debugging
    // check(false, "mock_teleport::on_transfer called with: from=" + from.to_string() + ", to=" + to.to_string() +
    //                  ", quantity=" + quantity.to_string() + ", memo=" + memo);
    print("mock_teleport::on_transfer called with: from=", from, ", to=", to, ", quantity=", quantity, ", memo=", memo);
}