#pragma once
#include <string>
#include <utility>

struct mining_data2 {
    uint8_t                                       invalid    = 0;
    std::string                                   error      = "";
    uint16_t                                      delay      = 0; // Delay added between current mine and previous mine
    uint8_t                                       difficulty = 0; // Reduction in pow difficulty (higher number means more is accepted for 5th word)
    uint16_t                                      ease       = 0; // Percentage of mining pool which is received
    uint16_t                                      luck       = 0; // increase in probability of receiving a random nft
    uint16_t                                      commission = 0; // commission to landowner (percentage)
    std::vector<std::pair<std::string, uint16_t>> eases;
};
