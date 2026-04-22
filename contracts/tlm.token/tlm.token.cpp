#include "tlm.token.hpp"

namespace eosio {

    void token::create(const name &issuer, const asset &maximum_supply) {
        check_not_paused();
        require_auth(get_self());

        auto sym = maximum_supply.symbol;
        check(sym.is_valid(), "invalid symbol name");
        check(maximum_supply.is_valid(), "invalid supply");
        check(maximum_supply.amount > 0, "max-supply must be positive");

        stats statstable(get_self(), sym.code().raw());
        auto  existing = statstable.find(sym.code().raw());
        check(existing == statstable.end(), "token with symbol already exists");

        statstable.emplace(get_self(), [&](auto &s) {
            s.supply.symbol = maximum_supply.symbol;
            s.max_supply    = maximum_supply;
            s.issuer        = issuer;
        });
    }

    void token::issue(const name &to, const asset &quantity, const string &memo) {
        check_not_paused();
        auto sym = quantity.symbol;
        check(sym.is_valid(), "invalid symbol name");
        check(memo.size() <= 256, "memo has more than 256 bytes");

        stats statstable(get_self(), sym.code().raw());
        auto  existing = statstable.find(sym.code().raw());
        check(existing != statstable.end(), "token with symbol does not exist, create token before issue");
        const auto &st = *existing;
        check(to == st.issuer, "tokens can only be issued to issuer account");

        require_auth(st.issuer);
        check(quantity.is_valid(), "invalid quantity");
        check(quantity.amount > 0, "must issue positive quantity");

        check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");
        check(quantity.amount <= st.max_supply.amount - st.supply.amount, "quantity exceeds available supply");

        statstable.modify(st, same_payer, [&](auto &s) {
            s.supply += quantity;
        });

        add_balance(st.issuer, quantity, st.issuer);
    }

    void token::burn(const name &from, const asset &quantity, const string &memo) {
        check_not_paused();
        auto sym = quantity.symbol;
        check(sym.is_valid(), "invalid symbol name");
        check(memo.size() <= 256, "memo has more than 256 bytes");

        stats statstable(get_self(), sym.code().raw());
        auto  existing = statstable.find(sym.code().raw());
        check(existing != statstable.end(), "token with symbol does not exist");
        const auto &st = *existing;

        require_auth(from);
        check(quantity.is_valid(), "invalid quantity");
        check(quantity.amount > 0, "must retire positive quantity");

        check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");

        statstable.modify(st, same_payer, [&](auto &s) {
            s.supply -= quantity;
        });

        sub_balance(from, quantity);
    }

    /*void token::retire(const asset &quantity, const string &memo)
    {
       auto sym = quantity.symbol;
       check(sym.is_valid(), "invalid symbol name");
       check(memo.size() <= 256, "memo has more than 256 bytes");

       stats statstable(get_self(), sym.code().raw());
       auto existing = statstable.find(sym.code().raw());
       check(existing != statstable.end(), "token with symbol does not exist");
       const auto &st = *existing;

       require_auth(st.issuer);
       check(quantity.is_valid(), "invalid quantity");
       check(quantity.amount > 0, "must retire positive quantity");

       check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");

       statstable.modify(st, same_payer, [&](auto &s) {
          s.supply -= quantity;
       });

       sub_balance(st.issuer, quantity);
    }*/

    void token::transfer(const name &from, const name &to, const asset &quantity, const string &memo) {
        check_not_paused();
        check(from != to, "cannot transfer to self");
        require_auth(from);
        check(is_account(to), "to account does not exist");
        auto        sym = quantity.symbol.code();
        stats       statstable(get_self(), sym.raw());
        const auto &st = statstable.get(sym.raw());

        require_recipient(from);
        require_recipient(to);

        check(quantity.is_valid(), "invalid quantity");
        check(quantity.amount > 0, "must transfer positive quantity");
        check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");
        check(memo.size() <= 256, "memo has more than 256 bytes");

        auto payer = has_auth(to) ? to : from;

        sub_balance(from, quantity);
        add_balance(to, quantity, payer);
    }

    void token::sub_balance(const name &owner, const asset &value) {
        accounts from_acnts(get_self(), owner.value);

        const auto &from = from_acnts.get(value.symbol.code().raw(), "no balance object found");
        ::check(from.balance >= value, "overdrawn balance. Trying to withdraw %s but only %s is available", value, from.balance);

        const auto remaining_balance = from.balance - value;
        // Check vesting if applicable
        vestings vesting_table(get_self(), get_self().value);
        auto     vest = vesting_table.find(owner.value);
        if (vest != vesting_table.end() && vest->vesting_quantity.symbol.code().raw() == value.symbol.code().raw()) {
            // check we are beyond vesting start (no vesting possible before then)
            uint32_t time_now        = current_time_point().sec_since_epoch();
            uint32_t vesting_seconds = 0;
            if (time_now >= vest->vesting_start.sec_since_epoch()) {
                vesting_seconds = time_now - vest->vesting_start.sec_since_epoch();
            }
            //        print("\nvesting seconds ", vesting_seconds);
            int64_t vest_per_second_sats = (vest->vesting_quantity.amount * 10'000) / vest->vesting_length;
            //        print("\nvest_per_second_sats ", vest_per_second_sats);
            const auto vested_total =
                asset{(vesting_seconds * vest_per_second_sats) / 10'000, vest->vesting_quantity.symbol}; // amount they can withdraw
                                                                                                         //        print("\nvested_total ", vested_total);
            if (vested_total < vest->vesting_quantity) {
                const auto min_balance = vest->vesting_quantity - vested_total;
                //            print("\nmin_balance ", min_balance);
                //            print("\ncurrent balance ", from.balance.amount);
                ::check(remaining_balance >= min_balance, "Trying to withdraw %s but only %s has vested.", value, vested_total);
            }
        }

        from_acnts.modify(from, owner, [&](auto &a) {
            a.balance -= value;
        });
    }

    void token::add_balance(const name &owner, const asset &value, const name &ram_payer) {
        accounts to_acnts(get_self(), owner.value);
        auto     to = to_acnts.find(value.symbol.code().raw());
        if (to == to_acnts.end()) {
            to_acnts.emplace(ram_payer, [&](auto &a) {
                a.balance = value;
            });
        } else {
            to_acnts.modify(to, same_payer, [&](auto &a) {
                a.balance += value;
            });
        }
    }

    void token::open(const name &owner, const symbol &symbol, const name &ram_payer) {
        check_not_paused();
        require_auth(ram_payer);

        check(is_account(owner), "owner account does not exist");

        auto        sym_code_raw = symbol.code().raw();
        stats       statstable(get_self(), sym_code_raw);
        const auto &st = statstable.get(sym_code_raw, "symbol does not exist");
        check(st.supply.symbol == symbol, "symbol precision mismatch");

        accounts acnts(get_self(), owner.value);
        auto     it = acnts.find(sym_code_raw);
        if (it == acnts.end()) {
            acnts.emplace(ram_payer, [&](auto &a) {
                a.balance = asset{0, symbol};
            });
        }
    }

    void token::close(const name &owner, const symbol &symbol) {
        check_not_paused();
        require_auth(owner);
        accounts acnts(get_self(), owner.value);
        auto     it = acnts.find(symbol.code().raw());
        check(it != acnts.end(), "Balance row already deleted or never existed. Action won't have any effect.");
        check(it->balance.amount == 0, "Cannot close because the balance is not zero.");
        acnts.erase(it);
    }

    void token::addvesting(const name &account, const time_point_sec &vesting_start, const uint32_t &vesting_length, const asset &vesting_quantity) {
        check_not_paused();
        require_auth(get_self());
        vestings vesting_table(get_self(), get_self().value);
        auto     existing = vesting_table.find(account.value);

        if (existing == vesting_table.end()) {
            vesting_table.emplace(get_self(), [&](auto &v) {
                v.account          = account;
                v.vesting_start    = vesting_start;
                v.vesting_length   = vesting_length;
                v.vesting_quantity = vesting_quantity;
            });
        } else {
            vesting_table.modify(*existing, get_self(), [&](auto &v) {
                v.vesting_start    = vesting_start;
                v.vesting_length   = vesting_length;
                v.vesting_quantity = vesting_quantity;
            });
        }
    }
    /*void token::clearvesting()
    {
        require_auth(get_self());
        vestings vesting_table(get_self(), get_self().value);
        auto vest = vesting_table.begin();
        while (vest != vesting_table.end()){
            vest = vesting_table.erase(vest);
        }
    }*/

    void token::setpaused(const bool paused) {
        auto       x             = pausable_singleton{get_self(), get_self().value};
        const auto current_state = x.get_or_default();
        x.set(pausable{paused}, get_self());
    }

    void token::pause() {
        require_auth(get_self());
        check(!is_paused(), "already paused");
        setpaused(true);
    }

    void token::unpause() {
        require_auth(get_self());
        check(is_paused(), "already unpaused");
        setpaused(false);
    }

    void token::chngissuer() {
        require_auth(get_self());

        const eosio::symbol sym        = {"TLM", 4};
        const auto          new_issuer = "inflt.worlds"_n;
        const auto          sym_name   = sym.code().raw();
        stats               statstable(get_self(), sym_name);
        const auto          token = statstable.find(sym_name);
        ::check(token != statstable.end(), "ERR::CHNGISSUER_NON_EXISTING_SYMBOL::token with symbol %s does not exist.", sym);
        ::check(token->issuer != new_issuer, "ERR::CHNGISSUER_ALREADY_SET::token with symbol %s already has issuer set to %s.", sym, new_issuer);
        statstable.modify(token, same_payer, [&](auto &s) {
            s.issuer = new_issuer;
        });
    }
} // namespace eosio
