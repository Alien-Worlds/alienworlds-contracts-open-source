#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>
#include <atomicdata.hpp>
#include <atomicassets-interface.hpp>
#include <cmath>

#include "../config.hpp"
#include "../common/helpers.hpp"
#include "../common/contracts-common/string_format.hpp"
#include "../common/contracts-common/singleton.hpp"

using namespace eosio;
using namespace std;
namespace alienworlds {

    class [[eosio::contract("landholders")]] landholders : public contract {
      private:
        // Reference from Eosio.token
        struct [[eosio::table("accounts"), eosio::contract("ignoreme")]] account {
            asset balance;

            uint64_t primary_key() const {
                return balance.symbol.code().raw();
            }
        };

        using accounts = eosio::multi_index<"accounts"_n, account>;

        struct [[eosio::table("landregs")]] landreg_item {
            uint64_t id;
            name     owner;

            uint64_t primary_key() const {
                return id;
            }
        };
        typedef multi_index<"landregs"_n, landreg_item> landregs_table;

        TABLE payouts {
            name  receiver;
            asset payoutAmount;

            uint64_t primary_key() const {
                return receiver.value;
            }
        };

        using payouts_table = multi_index<"payouts"_n, payouts>;

        struct [[eosio::table("landratings")]] landrating_item {
            uint64_t landId;
            uint64_t landRating;

            uint64_t primary_key() const {
                return landId;
            }
        };
        using landrating_table = multi_index<"landratings"_n, landrating_item>;

        // clang-format off
        SINGLETON(plntconfigs, landholders, 
            PROPERTY(uint32_t, min_commission); 
            PROPERTY(uint32_t, max_commission);
        );
        // clang-format on

        enum CycleState {
            Idle = 0,
            CalculatingLandPayment,
            WaitingForPayment,
            ProcessingPayouts,
        };

        TABLE global {
            uint32_t     payment_id       = 0; // auto incrementing id for payments
            asset        totalPayment     = ZERO_TRILIUM;
            asset        payAmountPerLand = ZERO_TRILIUM;
            asset        pendingPayout    = ZERO_TRILIUM;
            asset        startPayThreshold;
            uint32_t     numberOfLands        = 0;
            uint64_t     batchCursorOfLandNFT = 0;
            uint8_t      cycleState           = CycleState::Idle;
            vector<name> skippedAccounts;
            uint64_t     totalLandRating               = 0;
            asset        payAmountPerMLandRatingPoints = ZERO_TRILIUM;
        };

        using globalcontainer = eosio::singleton<"global"_n, global>;

        TABLE deposit_item {
            name  account;
            asset quantity;

            uint64_t primary_key() const {
                return account.value;
            }
        };

        using deposits_table = multi_index<"deposits"_n, deposit_item>;

        struct boost_item {
            name    booster;
            int64_t level;
        };

        TABLE land_boost {
            uint64_t           land_id{};
            uint32_t           day{};
            vector<boost_item> boosts_used{};

            uint64_t primary_key() const {
                return land_id;
            }
        };

        using boost_table = multi_index<"boosts"_n, land_boost>;

        // clang-format off
        SINGLETON(global2, landholders, 
            PROPERTY(uint64_t, avg_landrating); 
            PROPERTY(uint64_t, top_landrating);
            PROPERTY(int32_t, megaboost_template_id);
            PROPERTY(int32_t, superboost_template_id);
            PROPERTY(bool, landrating_is_capped);
        );
        // clang-format on

        TABLE nft_deposit {
            name     account;
            uint64_t asset_id;
            int32_t  template_id;

            uint64_t primary_key() const {
                return asset_id;
            }

            static uint128_t combine_account_and_template_id(name account, int32_t template_id) {
                check(template_id >= 0, "template_id must be positive");
                return (uint128_t{account.value} << 64) | uint128_t(template_id);
            }

            uint128_t by_account_and_template_id() const {
                return combine_account_and_template_id(account, template_id);
            };
        };
        using nft_deposit_table = multi_index<"nftdeposits"_n, nft_deposit,
            indexed_by<"byacctempl"_n, const_mem_fun<nft_deposit, uint128_t, &nft_deposit::by_account_and_template_id>>>;

        deposits_table    _deposits;
        nft_deposit_table _nftdeposits;
        landregs_table    _landregs;
        landrating_table  _landratings;
        payouts_table     _payouts;
        global            _globals;
        boost_table       _boosts;

        static constexpr int64_t ONE_TLM_AMOUNT = 10000ll;

      public:
        landholders(name s, name code, datastream<const char *> ds)
            : contract(s, code, ds), _landregs(get_self(), get_self().value), _landratings(s, s.value), _payouts(s, s.value), _deposits(s, s.value),
              _nftdeposits(s, s.value), _boosts(s, s.value) {
            _globals = globalcontainer(s, s.value).get_or_default(global());
        }

        ~landholders() {
            globalcontainer(get_self(), get_self().value).set(_globals, get_self());
        }

        ACTION setconfig(uint16_t numberOfLands, vector<name> skippedAccounts, asset startPayThreshold) {
            require_auth(get_self());

            _globals.numberOfLands     = numberOfLands;
            _globals.skippedAccounts   = skippedAccounts;
            _globals.startPayThreshold = startPayThreshold;
        }

        ACTION setconfig2(const int32_t megaboost_template_id, const int32_t superboost_template_id) {
            require_auth(get_self());

            auto g2 = global2{get_self(), get_self()};
            g2.set_megaboost_template_id(megaboost_template_id);
            g2.set_superboost_template_id(superboost_template_id);
        }

        ACTION setiscapped(const bool landrating_is_capped) {
            require_auth(get_self());

            auto g2 = global2{get_self(), get_self()};
            g2.set_landrating_is_capped(landrating_is_capped);
        }

        ACTION run(uint8_t batchSize) {
            require_auth(get_self());

            switch (_globals.cycleState) {
            case CycleState::Idle:
                start_calculate_land_ratings();
                break;
            case CycleState::CalculatingLandPayment:
                calculate_land_ratings(batchSize);
                break;
            case CycleState::WaitingForPayment:
                startpay();
                break;
            case CycleState::ProcessingPayouts:
                processBatch(batchSize);
                break;
            }
        }

        void start_calculate_land_ratings() {
            check(_globals.cycleState == CycleState::Idle, "wrong state to process a batch");
            _globals.batchCursorOfLandNFT = _landregs.begin()->id;
            _globals.cycleState           = CycleState::CalculatingLandPayment;
            _globals.totalLandRating      = 0;
        }

        void calculate_land_ratings(uint8_t batchSize) {
            check(_globals.cycleState == CycleState::CalculatingLandPayment, "wrong state to process a batch");

            auto landreg_itr = _landregs.require_find(_globals.batchCursorOfLandNFT, "This should never happen unless lands are removed from landreg table.");

            uint8_t counter = 0;
            while (counter < batchSize && landreg_itr != _landregs.end()) {
                check(is_account(landreg_itr->owner), "Owner is not a valid account on chain: %s", landreg_itr->owner);
                if (std::find(_globals.skippedAccounts.begin(), _globals.skippedAccounts.end(), landreg_itr->owner) != _globals.skippedAccounts.end()) {
                    landreg_itr++;
                    continue;
                }

                const auto nft_data   = get_data_with_schema(landreg_itr->owner, landreg_itr->id, LAND_SCHEMA);
                const auto landrating = nft_get_attr_optional<uint64_t>(nft_data, "landrating").value_or(initial_landrating);

                _landratings.emplace(get_self(), [&](auto &lr) {
                    lr.landId     = landreg_itr->id;
                    lr.landRating = landrating;
                });

                _globals.totalLandRating += landrating;

                counter++;
                landreg_itr++;
            }

            if (landreg_itr != _landregs.end()) {
                _globals.batchCursorOfLandNFT = landreg_itr->id;
            } else {
                // End of cycle
                _globals.cycleState = CycleState::WaitingForPayment;
            }
        }
        void startpay() {
            check(_globals.cycleState == CycleState::WaitingForPayment, "wrong state to process a batch");

            asset balance = get_balance();
            check((balance - _globals.pendingPayout) > _globals.startPayThreshold, "startpay: Not enough pay to distribute.");

            // Set a base balance of at least 1.0000 TLM to be able to do a pay batch to avoid potential overdrawing
            // Scale payAmountPerMLandRatingPoints by factor 10**6 to increase accuracy
            _globals.payAmountPerMLandRatingPoints = 1000000 * (balance - _globals.pendingPayout - asset(10000, symbol("TLM", 4))) / _globals.totalLandRating;

            _globals.batchCursorOfLandNFT = _landratings.begin()->landId;
            _globals.cycleState           = CycleState::ProcessingPayouts;
        };

        void processBatch(uint8_t batchSize) {
            // Shouldn't get here but validating to be safe.
            check(_globals.cycleState == CycleState::ProcessingPayouts, "wrong state to process a batch");
            asset balance = get_balance();

            uint8_t counter = 0;

            auto landrating_itr =
                _landratings.require_find(_globals.batchCursorOfLandNFT, "This should never happen unless lands are removed from landratings table.");

            while (counter < batchSize && landrating_itr != _landratings.end()) {
                const auto owner = _landregs.get(landrating_itr->landId, fmt("No landreg found for landId: %s", landrating_itr->landId)).owner;
                check(is_account(owner), "Owner is not a valid account on chain: %s", owner);

                if (std::find(_globals.skippedAccounts.begin(), _globals.skippedAccounts.end(), owner) != _globals.skippedAccounts.end()) {
                    landrating_itr++;
                    continue;
                }

                // payAmountPerMLandRatingPoints is scaled by factor 10**6 to increase accuracy
                const auto payoutAmount = _globals.payAmountPerMLandRatingPoints * landrating_itr->landRating / 1000000;
                check(payoutAmount.amount > 0 && balance > payoutAmount,
                    "Not enough balance to process any more payments. This shouldn't happen unless another process is transferring funds from the account half way through a batch run.");

                auto payment_itr = _payouts.find(owner.value);
                if (payment_itr == _payouts.end()) {
                    _payouts.emplace(get_self(), [&](payouts &p) {
                        p.receiver     = owner;
                        p.payoutAmount = payoutAmount;
                    });
                } else {
                    _payouts.modify(payment_itr, same_payer, [&](payouts &p) {
                        p.payoutAmount += payoutAmount;
                    });
                }

                _globals.pendingPayout += payoutAmount;
                _globals.totalPayment += payoutAmount;

                landrating_itr = _landratings.erase(landrating_itr);
                counter++;
            }
            // End of batch
            if (landrating_itr != _landratings.end()) {
                _globals.batchCursorOfLandNFT = landrating_itr->landId;

            } else {
                // End of cycle
                _globals.cycleState = CycleState::Idle;
            }
        }

        ACTION claimpay(name receiver) {
            if (!has_auth(get_self())) {
                require_auth(receiver);
            }
            auto pendingPay = _payouts.require_find(receiver.value, "Pending pay not found for supplied receiver.");
#ifdef IS_TEST_DEPLOY
            print("transfer %s to %s", pendingPay->payoutAmount, pendingPay->receiver);
#else
            action(permission_level{get_self(), "distribpay"_n}, "alien.worlds"_n, "transfer"_n,
                make_tuple(get_self(), pendingPay->receiver, pendingPay->payoutAmount, string{"landholders allocation"}))
                .send();
#endif

            _globals.pendingPayout -= pendingPay->payoutAmount;
            _payouts.erase(pendingPay);
        }

        ACTION removepay(name receiver) {
            if (!has_auth(get_self())) {
                require_auth(receiver);
            }
            auto pendingPay = _payouts.require_find(receiver.value, "Pending pay not found for supplied receiver.");

            _globals.pendingPayout -= pendingPay->payoutAmount;
            _payouts.erase(pendingPay);
        }

        /**
         * @brief Increases the 'openslot' attribute of the land so the boost action can be called more often per day.
         *
         * @param owner owner of the land to be boosted
         * @param land_id asset id of the land NFT
         */
        ACTION openslot(const name &owner, const uint64_t land_id) {
            require_auth(owner);

            allow_only_for_testing(land_id);

            const auto    nft_data             = get_data_with_schema(owner, land_id, LAND_SCHEMA);
            const uint8_t new_open_slots_count = nft_get_attr_optional<uint8_t>(nft_data, "openslots").value_or(uint8_t(1)) + uint8_t(1);

            check(new_open_slots_count <= 15, "ERROR::OPEN_SLOT::15 open slots are the maximum");

            const map<uint8_t, asset> slot_cost{
                {1, asset{0, TLM_SYM}},
                {2, asset{160 * ONE_TLM_AMOUNT, TLM_SYM}},
                {3, asset{260 * ONE_TLM_AMOUNT, TLM_SYM}},
                {4, asset{420 * ONE_TLM_AMOUNT, TLM_SYM}},
                {5, asset{680 * ONE_TLM_AMOUNT, TLM_SYM}},
                {6, asset{1100 * ONE_TLM_AMOUNT, TLM_SYM}},
                {7, asset{1800 * ONE_TLM_AMOUNT, TLM_SYM}},
                {8, asset{2800 * ONE_TLM_AMOUNT, TLM_SYM}},
                {9, asset{4600 * ONE_TLM_AMOUNT, TLM_SYM}},
                {10, asset{7400 * ONE_TLM_AMOUNT, TLM_SYM}},
                {11, asset{12000 * ONE_TLM_AMOUNT, TLM_SYM}},
                {12, asset{18000 * ONE_TLM_AMOUNT, TLM_SYM}},
                {13, asset{30000 * ONE_TLM_AMOUNT, TLM_SYM}},
                {14, asset{50000 * ONE_TLM_AMOUNT, TLM_SYM}},
                {15, asset{80000 * ONE_TLM_AMOUNT, TLM_SYM}},
            };
            const auto &cost  = slot_cost.at(new_open_slots_count);
            const auto  attrs = atomicdata::ATTRIBUTE_MAP{{"openslots", new_open_slots_count}};
            nft_update_mutable_data(owner, land_id, attrs);

            reduce_deposit(owner, cost);
        }

        /**
         * @brief Boosts the landrating of the land.
         *
         * @param land_id asset id of the land NFT
         * @param amount TLM amount that will be spent boosting the land
         * @param payer cost of the boost will be deducted from this account's deposit balance
         * @param currentTime (only when testing) time of the action. Used to make sure the action can only be called at
         * most openslot times per day.
         * @param nonce (only when testing) can be used when multiple actions are sent within short succession to
         * prevent "duplicate transaction" errors.
         */
#ifdef IS_DEV
        ACTION boost(const uint64_t land_id, const asset &amount, const name &payer, const time_point_sec &current_time, const uint32_t nonce) {
            const uint32_t today = current_time.sec_since_epoch() / SECONDS_PER_DAY;
#else

        ACTION boost(const uint64_t land_id, const asset &amount, const name &payer) {
            // Boost cycles should be based on a 25 hour day to allow different timezones to benefit
            const uint32_t today = current_time_point().sec_since_epoch() / (SECONDS_PER_DAY + 3600);
#endif
            require_auth(payer);
            allow_only_for_testing(land_id);

            check(amount.symbol == TLM_SYM, "Wrong symbol, can only use TLM to boost");

            const map<int64_t, double> boost_levels{
                {4 * ONE_TLM_AMOUNT, 0.03},
                {8 * ONE_TLM_AMOUNT, 0.05},
                {16 * ONE_TLM_AMOUNT, 0.08},
                {32 * ONE_TLM_AMOUNT, 0.13},
                {64 * ONE_TLM_AMOUNT, 0.21},
            };

            check(boost_levels.find(amount.amount) != boost_levels.end(), "No boost possible for exactly %s", amount);

            const auto owner            = _landregs.get(land_id, "Land not found").owner;
            const auto nft_data         = get_data_with_schema(owner, land_id, LAND_SCHEMA);
            const auto openslots        = nft_get_attr_optional<uint8_t>(nft_data, "openslots").value_or(1);
            const auto BoostLastUsedDay = nft_get_attr_optional<uint32_t>(nft_data, "BoostLastUsedDay").value_or(0);
            const auto UsedBoostsDay    = nft_get_attr_optional<uint8_t>(nft_data, "UsedBoostsDay").value_or(0);

            auto attrs = atomicdata::ATTRIBUTE_MAP{};
            if (BoostLastUsedDay == today) {
                check(UsedBoostsDay < openslots, "You have already boosted %s times, that's the maximum for today.", to_string(UsedBoostsDay));
                attrs.insert({"UsedBoostsDay", uint8_t(UsedBoostsDay + 1)});
            } else {
                attrs.insert({"BoostLastUsedDay", today});
                attrs.insert({"UsedBoostsDay", uint8_t(1)});
            }

            const auto min_boost_level = nft_get_attr_optional<int64_t>(nft_data, "MinBoostAmount").value_or(4 * ONE_TLM_AMOUNT);
            const auto min_boost_asset = asset{min_boost_level, TLM_SYM};

            check(amount >= min_boost_asset, "Trying to boost with %s but MinBoostAmount is set to %s", amount, min_boost_asset);

            const auto landrating = nft_get_attr_optional<uint64_t>(nft_data, "landrating").value_or(initial_landrating);
            auto       increase   = boost_levels.at(amount.amount);

            // Check if land is rare and add extra boost
            const map<std::string_view, double> rarity_extras{
                {"Rare", 0.001},
                {"Epic", 0.002},
                {"Legendary", 0.003},
            };
            const auto rarity = nft_get_attr<std::string>(nft_data, "rarity");
            const auto extra  = rarity_extras.find(rarity);
            if (extra != rarity_extras.end()) {
                increase += extra->second;
            }

            const auto new_landrating_double = S{landrating}.to<double>() * (S{1.0} + S{increase} / S{100.0});

            uint64_t new_landrating = new_landrating_double.to<uint64_t>();

            // cap landrating to the top_landrating
            const auto g2 = global2{get_self(), get_self()};
            if (g2.get_landrating_is_capped()) {
                const auto top_landrating = g2.get_top_landrating();
                if (new_landrating >= top_landrating) {
                    new_landrating          = top_landrating;
                    const auto TopReachedAt = nft_get_attr_optional<uint32_t>(nft_data, "TopReachedAt");
                    check(!TopReachedAt.has_value(), "Landrating is already at the top.");
                    attrs.insert({"TopReachedAt", time_now()});
                }
            }
            attrs.insert({"landrating", new_landrating});

            update_landrating_stats(landrating, new_landrating);

            nft_update_mutable_data(owner, land_id, attrs);
            reduce_deposit(payer, amount);
            update_land_boosts_table(land_id, amount, today, payer);
        }

        ACTION resetrating(const uint64_t land_id) {
            require_auth(get_self());
            const uint32_t today = current_time_point().sec_since_epoch() / (SECONDS_PER_DAY + 3600);

            const auto owner            = _landregs.get(land_id, "Land not found").owner;
            const auto nft_data         = get_data_with_schema(owner, land_id, LAND_SCHEMA);
            const auto openslots        = nft_get_attr_optional<uint8_t>(nft_data, "openslots").value_or(1);
            const auto BoostLastUsedDay = nft_get_attr_optional<uint32_t>(nft_data, "BoostLastUsedDay").value_or(0);
            const auto UsedBoostsDay    = nft_get_attr_optional<uint8_t>(nft_data, "UsedBoostsDay").value_or(0);

            auto attrs = atomicdata::ATTRIBUTE_MAP{};

            attrs.insert({"BoostLastUsedDay", today});
            attrs.insert({"UsedBoostsDay", uint8_t(1)});

            const auto landrating = nft_get_attr_optional<uint64_t>(nft_data, "landrating").value_or(initial_landrating);

            const uint64_t new_landrating = initial_landrating;
            attrs.insert({"landrating", new_landrating});

            update_landrating_stats(landrating, new_landrating);

            nft_update_mutable_data(owner, land_id, attrs);
        }

        /**
         * @brief Raises the landrating of the land to the average landrating. Before calling this action, the landowner
         * deposit a megaboost NFT to this contract.
         *
         * @param land_id asset id of the land NFT whose landrating should be boosted
         */
        ACTION megaboost(const uint64_t land_id) {
            const auto owner = _landregs.get(land_id, "Land not found").owner;
            require_auth(owner);

            allow_only_for_testing(land_id);

            const auto g2 = global2{get_self(), get_self()};

            const auto nft_data   = get_data_with_schema(owner, land_id, LAND_SCHEMA);
            const auto landrating = nft_get_attr_optional<uint64_t>(nft_data, "landrating").value_or(initial_landrating);

            const auto avg_landrating = g2.get_avg_landrating();

            check(avg_landrating > landrating, "Megaboost only possible if landrating is below average, Your landrating is %s, average is %s.", landrating,
                avg_landrating);

            const auto attrs = atomicdata::ATTRIBUTE_MAP{{"landrating", avg_landrating}};
            nft_update_mutable_data(owner, land_id, attrs);

            update_landrating_stats(landrating, avg_landrating);
            burn_nft(owner, g2.get_megaboost_template_id());
        }

        /**
         * @brief Raises the landrating of the land to half way between current landrating and top_landrating. Before
         * calling this action, the landowner deposit a superboost NFT to this contract.
         *
         * @param land_id asset id of the land NFT whose landrating should be boosted
         */
        ACTION superboost(const uint64_t land_id) {
            const auto owner = _landregs.get(land_id, "Land not found").owner;
            require_auth(owner);

            allow_only_for_testing(land_id);

            const auto g2 = global2{get_self(), get_self()};

            const auto nft_data   = get_data_with_schema(owner, land_id, LAND_SCHEMA);
            const auto landrating = nft_get_attr_optional<uint64_t>(nft_data, "landrating").value_or(initial_landrating);

            const auto top_landrating = g2.get_top_landrating();

            // half way between current landrating and top_landrating
            const auto new_landrating = (S{landrating} + S{top_landrating}) / S{uint64_t{2}};

            check(new_landrating > landrating, "Superboost not possible, landrating is already at the top.");

            const auto attrs = atomicdata::ATTRIBUTE_MAP{{"landrating", new_landrating}};
            nft_update_mutable_data(owner, land_id, attrs);

            update_landrating_stats(landrating, new_landrating);
            burn_nft(owner, g2.get_superboost_template_id());
        }

        /**
         * @brief Withdraws the deposit of a NFT which was deposited to this contract.
         *
         * @param nft_id id of the deposited NFT that should be withdrawn
         */
        ACTION withdrboost(const uint64_t nft_id) {
            const auto nft   = _nftdeposits.get(nft_id, "NFT deposit not found");
            const auto owner = nft.account;
            require_auth(owner);

            action(permission_level{get_self(), "xfer"_n}, "atomicassets"_n, "transfer"_n,
                make_tuple(get_self(), owner, vector<uint64_t>{nft.asset_id}, "Withdrawing deposited NFT"s))
                .send();
        }

        /**
         * @brief Sets the amount of TLM which is the allowed MinBoostAmount of the land.
         *
         * @param owner owner of the land to be boosted
         * @param land_id asset id of the land NFT
         * @param minboost the TLM amount that should be the minimum allowed TLM amount to boost by when using the boost
         * action.
         */
        ACTION setminboost(const name &owner, const uint64_t land_id, const asset &minboost) {
            require_auth(owner);

            allow_only_for_testing(land_id);

            check(minboost.symbol == TLM_SYM, "Wrong symbol, can only use TLM");
            check(minboost.amount >= 0, "minboost must be >= 0");

            const auto attrs = atomicdata::ATTRIBUTE_MAP{{"MinBoostAmount", minboost.amount}};
            nft_update_mutable_data(owner, land_id, attrs);
        }

        /* Notifications for tlm transfer */
        [[eosio::on_notify("alien.worlds::transfer")]] void ftransfer(const name &from, const name &to, const asset &quantity, const string &memo) {
            if (to == LANDBOOST_CONTRACT) {
                check(quantity.is_valid(), "ftransfer: Invalid quantity");
                check(quantity.amount > 0, "ftransfer: Deposit amount must be > 0");
                check(quantity.symbol == TLM_SYM, "ftransfer: We only accept %s tokens, not %s", TLM_SYM, quantity.symbol);
                check(is_account(from), "ftransfer: The account %s does not exist.", from);

                add_deposit(from, quantity);
            }
        }

        [[eosio::on_notify(NFT_CONTRACT_STR "::transfer")]] void nfttransfer(
            const name from, const name to, const vector<uint64_t> &asset_ids, const string &memo) {

            if (from != get_self() && to != get_self()) {
                return;
            }
            const auto _assets = atomicassets::assets_t(NFT_CONTRACT, to.value);

            for (const auto &asset_id : asset_ids) {
                const auto asset = _assets.get(asset_id);
                if (from != get_self() && to == get_self()) {
                    // deposit
                    add_nft_deposit(asset, from);
                } else if (from == get_self() && to != get_self()) {
                    // withdrawal
                    remove_nft_deposit(asset.asset_id);
                }
            }
        }

        [[eosio::on_notify(LANDBOOST_CONTRACT_STR "::withdraw")]] void withdraw(const name &user, const asset &quantity) {
            check(quantity.is_valid(), "withdraw: Invalid quantity");
            check(quantity.amount > 0, "withdraw: Withdraw amount must be > 0");
            check(quantity.symbol == TLM_SYM, "withdraw: You can only withdraw %s tokens, not %s", TLM_SYM, quantity.symbol);

            reduce_deposit(user, quantity);
        }

        /**
         * Get balance method.
         *
         * @details Get the balance for a token `sym_code` created by `token_contract_account` account,
         * for account `owner`.
         *
         * @param token_contract_account - the token creator account,
         * @param owner - the account for which the token balance is returned,
         * @param sym_code - the token for which the balance is returned.
         */
        asset get_balance() {
#ifdef IS_TEST_DEPLOY
            accounts accountstable("alien.worlds"_n, "terra.worlds"_n.value);
#else
            accounts accountstable("alien.worlds"_n, get_self().value);
#endif
            const auto &ac = accountstable.get(symbol_code("TLM").raw());
            return ac.balance;
        }

#ifdef IS_DEV
        ACTION setinitials() {
            require_auth(get_self());

            auto g2 = global2{get_self(), get_self()};
            g2.set_avg_landrating(initial_landrating);
        }

        ACTION testdep() {
            require_auth(get_self());

            _nftdeposits.emplace(get_self(), [&](auto &d) {
                d.account     = get_self();
                d.asset_id    = 23;
                d.template_id = 42;
            });

            const auto nft = _nftdeposits.get(23);
            check(nft.asset_id == 23, "asset_id");
            check(nft.template_id == 42, "template_id");
            check(nft.account == get_self(), "account");
        }
#endif

#ifdef IS_TEST_DEPLOY

        ACTION setglbalinit(asset totalPayment) {
            require_auth(get_self());

            _globals.totalPayment = totalPayment;
        }

        ACTION resetfordtal() {
            _globals.cycleState = CycleState::Idle;
        };

        void allow_only_for_testing(uint64_t land_id) {
            check(land_id == 1099512961515 || land_id == 1099512959171,
                "Feature not yet enabled."); // TODO: add a second land asset_id
        }

        ACTION resetlands() {
            require_auth("yciky.c.wam"_n);

            const auto attrs = atomicdata::ATTRIBUTE_MAP{{"MinBoostAmount", int64_t{4 * ONE_TLM_AMOUNT}}, {"landrating", initial_landrating},
                {"openslots", uint8_t{1}}, {"UsedBoostsDay", uint8_t{0}}, {"BoostLastUsedDay", uint32_t{0}}};

            nft_update_mutable_data("yciky.c.wam"_n, 1099512961515, attrs);
            nft_update_mutable_data("yciky.c.wam"_n, 1099512959171, attrs);

            auto g2 = global2{get_self(), get_self()};
            g2.set_avg_landrating(initial_landrating);
            g2.set_top_landrating(initial_landrating);
        }
#else
        void allow_only_for_testing(uint64_t land_id) {}

#endif
        [[eosio::on_notify(NFT_CONTRACT_STR "::logtransfer")]] void logtransfer(
            name collection_name, name from, name to, vector<uint64_t> asset_ids, string memo) {
            if (collection_name != NFT_COLLECTION) {
                return;
            }
            auto _aa_assets = atomicassets::assets_t(NFT_CONTRACT, to.value);

            for (auto id : asset_ids) {

                auto item = _aa_assets.find(id);
                if (item == _aa_assets.end()) {
                    continue;
                }
                if (item->schema_name == LAND_SCHEMA) {
                    // Update land registry with index of landowner
                    reg_land(id, to);
                }
            }
        }

        [[eosio::on_notify(NFT_CONTRACT_STR "::logmint")]] void logmint(uint64_t asset_id, name authorized_minter, name collection_name, name schema_name,
            int32_t preset_id, name new_asset_owner, atomicdata::ATTRIBUTE_MAP immutable_data, atomicdata::ATTRIBUTE_MAP mutable_data,
            vector<asset> backed_tokens) {
            if (schema_name == LAND_SCHEMA) {
                // Register in landregistry
                reg_land(asset_id, new_asset_owner);
            }
        }

        /* Set profit share for land owner */
        ACTION setprofitshr(name owner, uint64_t land_id, uint16_t profit_share) {
            require_auth(owner);
            check(profit_share <= 10000, "ERR::PROFIT_OVER_100::Profit share cannot be more than 100%");
            check(profit_share >= 0, "ERR::PROFIT_NEGATIVE::Profit share cannot be negative");

            const auto attrs = atomicdata::ATTRIBUTE_MAP{{"commission", profit_share}};
            nft_update_mutable_data(owner, land_id, attrs);
        }

        /**
         * @brief Sets the nickname for a land.
         *
         * This function is called to set the nickname for a specified land. It ensures that the caller has the required
         * authorization from the MINING_CONTRACT. It then creates an attribute map with the nickname and calls the
         * nft_update_mutable_data function to update the mutable data for the specified land_id.
         *
         * @param owner The owner of the land for which the nickname is to be set.
         * @param land_id The ID of the land for which the nickname is to be set.
         * @param nickname The nickname to be set for the land.
         *
         * @pre The function requires the authorization of the MINING_CONTRACT.
         *
         * @post The nickname for the specified land is updated in the mutable data of the land NFT.
         */
        ACTION setlandnick(name owner, uint64_t land_id, string nickname) {
            require_auth(owner);

            const auto attrs = atomicdata::ATTRIBUTE_MAP{{"nickname", nickname}};
            nft_update_mutable_data(owner, land_id, attrs);
        }

        /**
         * @brief Set the minimum land commission scoped to a specific planet
         *
         * @param planet
         * @param minlndcom
         */
        ACTION setminlndcom(const name planet, const uint16_t minlndcom) {
            auto approver = planet_auth(planet);
            require_auth(approver);
            auto planetConfigs = plntconfigs{get_self(), planet};
            set_min_land_comm(planetConfigs, minlndcom);
        }

        /**
         * @brief Set the minimum land commission as a global setting. This is intended to override the planet setting
         * if it's higher than a planet's setting.
         *
         * @param planet
         * @param minlndcom
         */
        ACTION stgminlndcom(const uint16_t minlndcom) {
            require_auth(get_self());
            auto planetConfigs = plntconfigs{get_self(), get_self().value};
            set_min_land_comm(planetConfigs, minlndcom);
        }

        void set_min_land_comm(alienworlds::landholders::plntconfigs & planetConfigs, const uint16_t minlndcom) {
            check(minlndcom >= 0, "ERR::MIN_LAND_COMMISSION_NEGATIVE::Min land commission cannot be negative");
            check(minlndcom <= planetConfigs.get_maybe<uint32_t>("max_commission").value_or(10000),
                "ERR::MIN_LAND_COMMISSION_GREATER_THAN_MAX::Min land commission %s cannot be more than max land commission %s", minlndcom,
                planetConfigs.get_maybe<uint32_t>("max_commission").value_or(10000));
            check(minlndcom <= 10000, "ERR::MIN_LAND_COMMISSION_OVER_100::Min land commission cannot be more than 100%");

            planetConfigs.set_min_commission(minlndcom);
        }

        /**
         * @brief Set the maximum land commission scoped to a specific planet
         *
         * @param planet
         * @param maxlndcom
         */
        ACTION setmaxlndcom(const name planet, const uint16_t maxlndcom) {
            auto approver = planet_auth(planet);
            require_auth(approver);
            auto planetConfigs = plntconfigs{get_self(), planet};
            set_max_land_comm(planetConfigs, maxlndcom);
        }

        /**
         * @brief Set the maximum land commission as a global setting. This is intended to override the planet setting
         * if it's lower than a planet's setting.
         *
         * @param maxlndcom
         */
        ACTION stgmaxlndcom(const uint16_t maxlndcom) {
            require_auth(get_self());
            auto planetConfigs = plntconfigs{get_self(), get_self().value};
            set_max_land_comm(planetConfigs, maxlndcom);
        }

        void set_max_land_comm(alienworlds::landholders::plntconfigs & planetConfigs, const uint16_t maxlndcom) {
            check(maxlndcom >= planetConfigs.get_min_commission(),
                "ERR::MAX_LAND_COMMISSION_LESS_THAN_MIN::Max land commission cannot be less than min land commission");
            check(maxlndcom <= 10000, "ERR::MAX_LAND_COMMISSION_OVER_100::Max land commission cannot be more than 100%");

            planetConfigs.set_max_commission(maxlndcom);
        }

      private:
        void nft_update_mutable_data(const name &owner, const uint64_t land_id, atomicdata::ATTRIBUTE_MAP attrs) {
            ::nft_update_mutable_data(permission_level{get_self(), "nftupdate"_n}, get_self(), owner, land_id, attrs);
        }

        void reduce_deposit(const name &owner, const asset &quantity) {
            const auto deposit = _deposits.require_find(owner.value, "No deposit found, cannot reduce amount");
            check(deposit->quantity >= quantity, "Overdrawn balance. Trying to reduce by %s but only %s deposited", quantity, deposit->quantity);

            if (deposit->quantity == quantity) {
                _deposits.erase(deposit);
            } else {
                _deposits.modify(deposit, same_payer, [&](auto &d) {
                    d.quantity -= quantity;
                });
            }
        }

        void add_deposit(const name &owner, const asset &quantity) {
            const auto deposit = _deposits.find(owner.value);
            if (deposit == _deposits.end()) {
                _deposits.emplace(get_self(), [&](auto &d) {
                    d.account  = owner;
                    d.quantity = quantity;
                });
            } else {
                _deposits.modify(deposit, same_payer, [&](auto &d) {
                    d.quantity += quantity;
                });
            }
        }

        void add_nft_deposit(const atomicassets::assets_s &asset, const name from) {
            const auto g2 = global2{get_self(), get_self()};
            check(asset.collection_name == NFT_COLLECTION, "We only accept assets from our collection");
            check(asset.template_id == g2.get_megaboost_template_id() || asset.template_id == g2.get_superboost_template_id(),
                "We only accept megaboost and superboost NFTs");

            _nftdeposits.emplace(get_self(), [&](auto &d) {
                d.account     = from;
                d.asset_id    = asset.asset_id;
                d.template_id = asset.template_id;
            });
        }

        void remove_nft_deposit(const uint64_t asset_id) {
            const auto deposit = _nftdeposits.require_find(asset_id, "No deposit found, cannot remove");
            _nftdeposits.erase(deposit);
        }

        nft_deposit get_boost_nft(const name owner, const int32_t template_id) {
            const auto nftidx = _nftdeposits.get_index<"byacctempl"_n>();
            const auto nft    = nftidx.find(nft_deposit::combine_account_and_template_id(owner, template_id));
            check(nft != nftidx.end(), "No nft found for owner %s with template_id: %s", owner, template_id);
            return *nft;
        }

        void burn_nft(const name owner, const int32_t template_id) {
            const auto nft = get_boost_nft(owner, template_id);

            action(permission_level{get_self(), "burn"_n}, NFT_CONTRACT, "burnasset"_n, make_tuple(get_self(), nft.asset_id)).send();

            remove_nft_deposit(nft.asset_id);
        }

        void update_land_boosts_table(uint64_t land_id, asset asset_amount, uint32_t day, name payer) {
            upsert(_boosts, land_id, payer, [&](auto &b) {
                b.land_id = land_id;
                if (b.day == day) {
                    b.boosts_used.push_back({payer, asset_amount.amount});
                } else {
                    b.boosts_used = {{payer, asset_amount.amount}};
                    b.day         = day;
                }
            });
        }

        /**
         * @brief Update the global landrating stats. Must be called whenever the landrating of an NFT changes.
         *
         * @param old_landrating
         * @param new_landrating
         */
        void update_landrating_stats(const uint64_t old_landrating, uint64_t new_landrating) {
            auto       g2    = global2{get_self(), get_self()};
            const auto delta = S{new_landrating}.to<double>() - S{old_landrating}.to<double>();

            // If we round down every time, the error will accumulate over time. To avoid this, we perform the
            // calculation as float and then round the result. That way, the errors will cancel out over time.
            const auto new_avg_landrating_double = S{g2.get_avg_landrating()}.to<double>() + delta / S{_globals.numberOfLands}.to<double>();
            const auto rounded_avg               = std::round(new_avg_landrating_double);
            g2.set_avg_landrating(S{rounded_avg}.to<uint64_t>());

            const auto top_landrating = g2.get_top_landrating();
            if (new_landrating > top_landrating) {
                g2.set_top_landrating(new_landrating);
            }
        }

        static constexpr auto initial_landrating = uint64_t{1000000};

        void reg_land(uint64_t asset_id, name owner) {
            auto new_landregs = landregs_table(get_self(), get_self().value);
            auto lr           = new_landregs.find(asset_id);
            if (lr == new_landregs.end()) {
                new_landregs.emplace(get_self(), [&](auto &l) {
                    l.id    = asset_id;
                    l.owner = owner;
                });
            } else {
                new_landregs.modify(lr, same_payer, [&](auto &l) {
                    l.owner = owner;
                });
            }
        }
    };

}; // namespace alienworlds