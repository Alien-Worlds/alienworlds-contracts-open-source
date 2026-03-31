#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <eosio/time.hpp>
#include "../common/helpers.hpp"
#include "../common/contracts-common/singleton.hpp"

using namespace std;
using namespace eosio;

class [[eosio::contract("schedulepay")]] schedulepay : contract {
  public:
    using contract::contract;
    TABLE schedule {
        uint64_t       id;
        name           to;
        extended_asset quantity;
        uint32_t       frequency;
        string         memo;
        bool           active;
        time_point_sec last_pay_time = time_point_sec();

        uint64_t primary_key() const {
            return id;
        }
        uint64_t by_to() const {
            return to.value;
        }
    };

    using schedules_table = multi_index<"schedules"_n, schedule, indexed_by<"byto"_n, const_mem_fun<schedule, uint64_t, &schedule::by_to>>>;

    schedules_table schedules;

    SINGLETON(globals, schedulepay, PROPERTY_OPTIONAL_TYPECASTING(bool, bool, send_remainder_balance);)

    schedulepay(name receiver, name code, datastream<const char *> ds) : contract(receiver, code, ds), schedules(code, code.value) {}

    ACTION addschedule(name to, extended_asset asset, uint32_t frequency, string memo) {
        require_auth(get_self());
        check(is_account(to), "to account does not exist");
        check(asset.quantity.is_valid(), "invalid quantity");
        check(asset.quantity.amount > 0, "must transfer positive quantity");
        check(memo.size() <= 256, "memo has more than 256 bytes");

        schedules.emplace(get_self(), [&](auto &s) {
            s.id        = schedules.available_primary_key();
            s.to        = to;
            s.quantity  = asset;
            s.frequency = frequency;
            s.memo      = memo;
            s.active    = true;
        });
    }

    ACTION setactive(uint64_t id, bool active) {
        require_auth(get_self());
        auto itr = schedules.require_find(id, "id not found");
        schedules.modify(itr, get_self(), [&](auto &s) {
            s.active = active;
        });
    }

    ACTION remove(uint64_t id) {
        require_auth(get_self());
        auto itr = schedules.require_find(id, "schedule not found for id");
        schedules.erase(itr);
    }

    ACTION updschedule(uint64_t id, optional<name> to, optional<extended_asset> asset, optional<uint32_t> frequency, optional<string> memo) {
        require_auth(get_self());
        check(to || asset || frequency || memo, "nothing to update");
        auto itr = schedules.require_find(id, "id not found");
        schedules.modify(itr, get_self(), [&](auto &s) {
            if (to.has_value()) {
                check(is_account(to.value()), "to account does not exist");
                s.to = to.value();
            }
            if (asset.has_value()) {
                check(asset->quantity.is_valid(), "invalid quantity");
                check(asset->quantity.amount > 0, "must transfer positive quantity");
                s.quantity = asset.value();
            }
            if (frequency.has_value()) {
                s.frequency = frequency.value();
            }
            if (memo.has_value()) {
                check(memo->size() <= 256, "memo has more than 256 bytes");
                s.memo = memo.value();
            }
        });
    }

    ACTION claim(uint64_t id) {

        auto itr = schedules.require_find(id, "id not found");
        if (!has_auth(get_self())) {
            require_auth(itr->to);
        }
        check(itr->active, "schedule is not active");
        check(time_point_sec(current_time_point()) > itr->last_pay_time + itr->frequency, "too soon to pay");

        asset quantity = itr->quantity.quantity;

        auto g = globals{get_self(), get_self()};
        if (g.maybe_get_send_remainder_balance().value_or(false)) {
            auto current_bal = get_balance(itr->quantity.contract, get_self(), itr->quantity.quantity.symbol.code());
            quantity         = min(current_bal, itr->quantity.quantity);
        }
        action(permission_level{get_self(), "active"_n}, itr->quantity.contract, "transfer"_n, make_tuple(get_self(), itr->to, quantity, itr->memo)).send();
        schedules.modify(itr, get_self(), [&](auto &s) {
            s.last_pay_time = current_time_point();
        });
    }

    ACTION setpayremain(bool should_pay_remainder) {
        require_auth(get_self());
        auto g = globals{get_self(), get_self()};
        if (should_pay_remainder) {
            g.set_send_remainder_balance(true);
        } else {
            g.unset_send_remainder_balance();
        }
    }

  private:
    static asset get_balance(const name &token_contract_account, const name &owner, const symbol_code &sym_code) {
        accounts    accountstable(token_contract_account, owner.value);
        const auto &ac = accountstable.get(sym_code.raw());
        return ac.balance;
    }

    TABLE account {
        asset balance;

        uint64_t primary_key() const {
            return balance.symbol.code().raw();
        }
    };

    using accounts = eosio::multi_index<"accounts"_n, account>;
};