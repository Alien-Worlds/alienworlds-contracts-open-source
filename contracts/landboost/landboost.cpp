#include "landboost.hpp"

/* Notifications for tlm transfer */
ACTION landboost::ftransfer(const name &from, const name &to, const asset &quantity, const string &memo) {
    if (to == get_self()) {
        check(quantity.is_valid(), "ftransfer: Invalid quantity");
        check(quantity.amount > 0, "ftransfer: Deposit amount must be > 0");
        check(quantity.symbol == TLM_SYM, "ftransfer: We only accept %s tokens, not %s", TLM_SYM, quantity.symbol);
        check(is_account(from), "ftransfer: The account %s does not exist.", from);

        require_recipient(LANDOWNERS_ACCOUNT);
    }
}

ACTION landboost::withdraw(const name &user, const asset &quantity) {
    require_auth(user);

    require_recipient(LANDOWNERS_ACCOUNT);

    action(permission_level{get_self(), "active"_n}, TOKEN_CONTRACT, "transfer"_n, std::make_tuple(get_self(), user, quantity, std::string("Withdrawal")))
        .send();
}