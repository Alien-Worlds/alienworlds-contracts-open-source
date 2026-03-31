#pragma once
#include "../config.hpp"
#include "../common/contracts-common/string_format.hpp"
#include "../common/contracts-common/util.hpp"
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/contract.hpp>
#include <eosio/multi_index.hpp>

using namespace eosio;
using namespace std;

CONTRACT landboost : public contract {
  public:
    landboost(name self, name code, datastream<const char *> ds) : contract(self, code, ds) {}

    [[eosio::on_notify("alien.worlds::transfer")]] void ftransfer(const name &from, const name &to, const asset &quantity, const string &memo);
    ACTION                                              withdraw(const name &user, const asset &quantity);
};
