#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/singleton.hpp>
#include <cmath>
#include "../common/contracts-common/string_format.hpp"
#include "../common/contracts-common/safemath.hpp"
#include "../common/contracts-common/util.hpp"
#include "../config.hpp"

using namespace eosio;
using namespace std;

class [[eosio::contract("pointsproxy")]] pointsproxy : public contract {

  public:
    // Used only for batch processing (if enabled)
    TABLE points_row {
        name     user;
        uint32_t total_points;

        uint64_t primary_key() const {
            return user.value;
        }
    };

    using points_table = multi_index<"points"_n, points_row>;

    TABLE allocator {
        name     allocator;
        double   budget;    // in points per day
        double   allocated; // in points per day
        uint64_t primary_key() const {
            return allocator.value;
        }
    };

    using allocator_table = multi_index<"allocators"_n, allocator>;

    TABLE allocations {
        name     account;
        double   allocated; // in points per day
        uint64_t primary_key() const {
            return account.value;
        }
    };

    using allocations_table = multi_index<"allocations"_n, allocations>;

    /* OLD globals table*/
    struct globals;

    using globals_container = singleton<"globals"_n, globals>;

    TABLE globals {
        bool           active        = false;
        bool           debug_mode    = false;
        float          multiplier    = 1;
        bool           batchProcess  = true;
        uint64_t       running_total = 0;
        uint64_t       period_total  = 0;
        uint64_t       period_budget = 0;
        time_point_sec period_end;
        uint32_t       period_duration = 30 * 24 * 60 * 60;

        static globals get_current_or_default(eosio::name account, eosio::name scope) {
            return globals_container(account, scope.value).get_or_default(globals());
        }

        static globals get_current(eosio::name account, eosio::name scope) {
            return globals_container(account, scope.value).get();
        }

        static bool exists(eosio::name account, eosio::name scope) {
            return globals_container(account, scope.value).exists();
        }

        void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
            globals_container(account, scope.value).set(*this, payer);
        }
    };

    /* NEW GLOBALS */
    struct pointsconfig;

    using pointsconfig_container = singleton<"pointsconfig"_n, pointsconfig>;

    TABLE pointsconfig {
        bool   active       = false;
        bool   debug_mode   = true;
        double multiplier   = 1;
        bool   batchProcess = true;
        // Total amount of points that has been spent since the beginning of time
        double running_total = 0;
        // Total amount of points that has been spent in the current period
        double period_total = 0;
        // Total amount of points that can be spent in the current period
        double period_budget = 0;
        // Time when the current period ends
        time_point_sec period_end;
        // Dureation of a period in days
        uint32_t period_duration = 30;

        static void migrate(eosio::name account, eosio::name scope) {
            if (globals::exists(account, scope)) {
                auto old = globals::get_current(account, scope);

                // Old table entry exists, we need to migrate
                pointsconfig new_config;
                new_config.active          = old.active;
                new_config.debug_mode      = old.debug_mode;
                new_config.multiplier      = old.multiplier;
                new_config.batchProcess    = old.batchProcess;
                new_config.running_total   = old.running_total;
                new_config.period_total    = old.period_total;
                new_config.period_budget   = old.period_budget;
                new_config.period_end      = old.period_end;
                new_config.period_duration = old.period_duration;
                new_config.save(account, scope, account);

                // we can now safely remove the old table entry for this scope
                globals_container(account, scope.value).remove();
            }
        }

        static pointsconfig get_current_or_default(eosio::name account, eosio::name scope) {
            migrate(account, scope);
            return pointsconfig_container(account, scope.value).get_or_default(pointsconfig());
        }

        static pointsconfig get_current(eosio::name account, eosio::name scope) {
            migrate(account, scope);
            return pointsconfig_container(account, scope.value).get();
        }

        static bool exists(eosio::name account, eosio::name scope) {
            migrate(account, scope);
            return pointsconfig_container(account, scope.value).exists();
        }

        void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
            pointsconfig_container(account, scope.value).set(*this, payer);
        }
    };

    allocator_table allocators;

    pointsproxy(name s, name code, datastream<const char *> ds) : contract(s, code, ds), allocators(s, s.value) {}

    /**
     * This function is an action that allocates a budget to a specific allocator.
     * It requires the authority of the contract itself to execute.
     * If the allocator already exists, it updates the allocator's budget.
     * If the allocator does not exist, it creates a new allocator with the specified budget.
     *
     * @param allocator - The name of the allocator to whom the budget is allocated.
     * @param budget - The amount of budget per day to be allocated.
     */
    ACTION setallocator(name allocator, double budget) {
        require_auth(get_self());

        upsert(allocators, allocator.value, get_self(), [&](auto &a) {
            a.allocator = allocator;
            a.budget    = budget;
            check(a.budget >= a.allocated, "ERR::ALLOCATOR_BUDGET_INVALID::Allocator budget can be set to less than the amount allocated.");
        });
    }

    double calc_allocation_budget(double budget, double n_days) {
        check(n_days > 0, "ERR::INVALID_DURATION::Number of days must be greater than 0.");
        check(n_days <= 60, "ERR::INVALID_DURATION::Number of days must be less than or equal to 60.");

        // allocation budget is expected as points per day
        return S{budget} / S{n_days};
    }

    double check_budget_overflow_and_clamp(double already_allocated, double allocation_budget, double total_budget) {

        ::check(already_allocated + allocation_budget <= total_budget,
            "ERR::ALLOCATOR_BUDGET_EXCEEDED::Allocator budget exceeded by %s. already_allocated: %s allocation_budget: %s total_budget: %s",
            already_allocated + allocation_budget - total_budget, already_allocated, allocation_budget, total_budget);

        check(already_allocated <= total_budget, "ERR::ALLOCATOR_BUDGET_EXCEEDED::Allocator budget exceeded. Already allocated: %s buget: %s",
            already_allocated, total_budget);

        return std::min(allocation_budget, total_budget - already_allocated);
    }

    /**
     * This function sets the budget for a specific allocator to a points manager.
     * It requires the authority of the allocator to execute.
     * The function first checks if the points manager already exists, if it does, an error is thrown.
     * It then calculates the allocation budget by dividing the total budget by the duration and further dividing by the
     * number of seconds in a day. It checks if the allocator exists and if the allocation budget does not exceed the
     * allocator's budget. If these conditions are met, it updates the allocator's allocated budget. It then checks if
     * the points manager exists. If it does not, it sets the points manager's budget and duration.
     *
     * @param allocator - The name of the allocator whose budget is being set.
     * @param points_manager - The name of the points manager whose budget is being set.
     * @param budget - The total budget to be allocated.
     * @param n_days - The duration in number of days over which the budget is to be allocated.
     */
    ACTION setbudget(name allocator, name points_manager, uint64_t budget, uint32_t n_days, bool batch_process) {
        require_auth(allocator);

        check(!pointsconfig::exists(get_self(), points_manager), "ERR::POINT_MANAGER_EXISTS::Point manager %s already exists.", points_manager);
        auto points_manager_settings = pointsconfig::get_current_or_default(get_self(), points_manager);

        const auto allocation_budget = calc_allocation_budget(S{budget}.to<double>(), S{n_days}.to<double>());

        auto allocators_itr = allocators.require_find(allocator.value, fmt("ERR::ALLOCATOR_NOT_FOUND::Allocator %s not found.", allocator));

        const auto already_allocated = allocators_itr->allocated;
        const auto total_budget      = allocators_itr->budget;

        const auto allocation_budget_clamped = check_budget_overflow_and_clamp(already_allocated, allocation_budget, total_budget);

        allocators.modify(allocators_itr, same_payer, [&](auto &a) {
            a.allocated += allocation_budget_clamped;
        });

        auto allocations = allocations_table(get_self(), allocator.value);

        upsert(allocations, points_manager.value, get_self(), [&](auto &a) {
            a.account   = points_manager;
            a.allocated = allocation_budget_clamped;
        });

        points_manager_settings.active          = true;
        points_manager_settings.debug_mode      = true;
        points_manager_settings.period_budget   = budget;
        points_manager_settings.period_duration = n_days;
        points_manager_settings.batchProcess    = batch_process;
        points_manager_settings.save(get_self(), points_manager, allocator);
    }

    ACTION addbudget(name allocator, name points_manager, uint64_t budget) {
        require_auth(allocator);

        check(pointsconfig::exists(get_self(), points_manager), "ERR::POINT_MANAGER_NOT_FOUND::Point manager %s not found.", points_manager);
        auto manager_settings = pointsconfig::get_current(get_self(), points_manager);

        const auto n_days            = manager_settings.period_duration;
        const auto allocation_budget = calc_allocation_budget(S{budget}.to<double>(), S{n_days}.to<double>());

        auto allocators_itr = allocators.require_find(allocator.value, fmt("ERR::ALLOCATOR_NOT_FOUND::Allocator %s not found.", allocator));

        const auto already_allocated = allocators_itr->allocated;
        const auto total_budget      = allocators_itr->budget;

        const auto allocation_budget_clamped = check_budget_overflow_and_clamp(already_allocated, allocation_budget, total_budget);

        allocators.modify(allocators_itr, same_payer, [&](auto &a) {
            a.allocated += allocation_budget_clamped;
        });

        auto allocations = allocations_table(get_self(), allocator.value);

        upsert(allocations, points_manager.value, get_self(), [&](auto &a) {
            a.account   = points_manager;
            a.allocated = allocation_budget_clamped;
        });
        manager_settings.period_budget += budget;
        manager_settings.save(get_self(), points_manager, allocator);
    }

    ACTION withdrawbudg(name allocator, name points_manager, optional<uint64_t> budget) {
        require_auth(allocator);
        check(pointsconfig::exists(get_self(), points_manager), "ERR::POINT_MANAGER_NOT_FOUND::Point manager %s not found.", points_manager);
        auto manager_settings = pointsconfig::get_current(get_self(), points_manager);

        auto resolved_budget = manager_settings.period_budget;
        if (budget.has_value()) {
            resolved_budget = S{budget.value()}.to<double>();
        }

        const auto allocation_budget = resolved_budget / manager_settings.period_duration;

        auto allocators_itr = allocators.find(allocator.value);
        check(allocators_itr != allocators.end(), "ERR::ALLOCATOR_NOT_FOUND::Allocator %s not found.", allocator);

        check(allocators_itr->allocated - allocation_budget >= 0,
            "ERR::ALLOCATOR_BUDGET_EXCEEDED::Allocator %s budget exceeded. allocation_budget: %s allocated:", allocator, allocation_budget,
            allocators_itr->allocated);
        allocators.modify(allocators_itr, same_payer, [&](auto &a) {
            a.allocated -= allocation_budget;
        });
        auto allocations = allocations_table(get_self(), allocator.value);

        auto allocations_itr = allocations.require_find(points_manager.value, "ERR::ALLOCATION_NOT_FOUND::No allocation found for this points manager.");

        allocations.modify(allocations_itr, same_payer, [&](auto &a) {
            a.allocated -= allocation_budget;
        });

        check(manager_settings.period_budget - resolved_budget >= manager_settings.period_total,
            "ERR::ALLOCATOR_NEW_BUDGET_EXCEEDED::Allocator reduced %s budget has already been exceeded. Reduce by less.", allocator);
        manager_settings.period_budget -= resolved_budget;

        manager_settings.save(get_self(), points_manager, allocator);
    }

    /// @brief Allows the points_manager to add userpoints for a user. If batch processing is disabled, this will add
    /// the points to the user immediately. If batch processing is disabled, you need to call the processbatch action
    /// later on.
    /// @param points_manager The account that is allowed to add points
    /// @param user The account that will receive the points
    /// @param points Number of points to add
#ifdef IS_DEV
    ACTION addpoints(name points_manager, name user, uint32_t points, time_point_sec simulated_time) {
#else
    ACTION addpoints(name points_manager, name user, uint32_t points) {
#endif
        require_auth(points_manager);

        check(is_account(user), "ERR::NON_EXISTENT_USER::The user %s doesn't exist on chain.", user);

        auto globals = pointsconfig::get_current(get_self(), points_manager);
        check(globals.active, "ERR:POINT_MANAGER_NOT_ACTIVE::point_manager %s doesn't have an active globals to add points.", points_manager);

        if (globals.batchProcess) {

            auto _points = points_table(get_self(), points_manager.value);

            auto existing_points_row = _points.find(user.value);

            if (existing_points_row == _points.end()) {
                _points.emplace(points_manager, [&](auto &p) {
                    p.user         = user;
                    p.total_points = points;
                });
            } else {
                _points.modify(existing_points_row, same_payer, [&](auto &p) {
                    p.total_points += points;
                });
            }
        } else {
#ifdef IS_DEV
            sendpoints(user, points, globals, points_manager, simulated_time);
#else
            sendpoints(user, points, globals, points_manager);
#endif
            globals.save(get_self(), points_manager, get_self());
        }
    }

    /// @brief Used to set/change global variables for a points_manager. If points_manager does not exists yet, it will
    /// be created.
    /// @param points_manager The account that is allowed to add points
    /// @param budget The budget in terms of number of points for the period the points_manager is allowed to spend
    /// @param duration The duration of the period in seconds
    /// @param start The start time of the period
    /// @param multiplier The multiplier to apply to the points. Can be used to scale points up or down.
    /// @param batch_process If true, points will not be added to the user immediately when calling addpoints, rather
    /// you have to call processbatch to send out the points. If false, points will be added to the user immediately.
    /// @param active Whether the points_manager is active or not
    /// @param debug_mode If true, the points are not actually sent to the user, but only logged to a dummy action.
    /// @return
    ACTION setglobals(
        name points_manager, uint64_t budget, uint32_t duration, time_point_sec start, double multiplier, bool batch_process, bool active, bool debug_mode) {
        require_auth(get_self());
        pointsconfig new_globals;
        new_globals.period_budget   = budget;
        new_globals.period_duration = duration;
        new_globals.period_end      = start + duration;
        new_globals.multiplier      = multiplier;
        new_globals.batchProcess    = batch_process;
        new_globals.active          = active;
        new_globals.debug_mode      = debug_mode;

        new_globals.save(get_self(), points_manager, get_self());
    }

#ifdef IS_DEV
    // adds test entries to the old table in order to test the migrations
    ACTION testglobals(
        name points_manager, uint64_t budget, uint32_t duration, time_point_sec start, double multiplier, bool batch_process, bool active, bool debug_mode) {
        require_auth(get_self());
        globals new_globals;
        new_globals.period_budget   = budget;
        new_globals.period_duration = duration;
        new_globals.period_end      = start + duration;
        new_globals.multiplier      = multiplier;
        new_globals.batchProcess    = batch_process;
        new_globals.active          = active;
        new_globals.debug_mode      = debug_mode;

        new_globals.save(get_self(), points_manager, get_self());
    }
#endif

    ACTION updglobals(name points_manager, optional<uint64_t> budget, optional<uint32_t> duration, optional<double> multiplier, optional<bool> batch_process,
        bool active, bool debug_mode) {
        require_auth(get_self());
        auto manager_settings = pointsconfig::get_current(get_self(), points_manager);
        if (budget.has_value())
            manager_settings.period_budget = budget.value();
        if (duration.has_value())
            manager_settings.period_duration = duration.value();
        if (multiplier.has_value())
            manager_settings.multiplier = multiplier.value();
        if (batch_process.has_value())
            manager_settings.batchProcess = batch_process.value();
        manager_settings.active     = active;
        manager_settings.debug_mode = debug_mode;

        manager_settings.save(get_self(), points_manager, get_self());
    }

    /// @brief Change the active status of a points_manager
    /// @param active Whether the points_manager is active or not
    /// @param points_manager Points manager to change the status of
    /// @return
    ACTION activate(bool active, name points_manager) {
        require_auth(get_self());

        auto globals   = pointsconfig::get_current(get_self(), points_manager);
        globals.active = active;
        globals.save(get_self(), points_manager, get_self());
    }

    ACTION exitdebug(name points_manager) {
        require_auth(points_manager);

        auto globals = pointsconfig::get_current(get_self(), points_manager);
        check(globals.debug_mode, "ERR::DEBUG_MODE_NOT_ACTIVE::Debug mode is not active.");

        auto points = points_table(get_self(), points_manager.value);
        check(points.begin() == points.end(), "ERR::POINTS_TABLE_NOT_EMPTY::Points table is not empty. run processbatch first.");
        globals.debug_mode    = false;
        globals.period_end    = time_point_sec(current_time_point()) + globals.period_duration * SECONDS_PER_DAY;
        globals.running_total = 0;
        globals.period_total  = 0;
        globals.save(get_self(), points_manager, get_self());
    }

    /// @brief Used to process the batch of points that have been added to the points_manager
    /// @param points_manager The points_manager to process
    /// @param batch_size Desired batch size
    /// @return
#ifdef IS_DEV
    ACTION processbatch(name points_manager, uint16_t batch_size, time_point_sec simulated_time) {
#else
    ACTION processbatch(name points_manager, uint16_t batch_size) {
#endif
        require_auth(points_manager);

        auto globals = pointsconfig::get_current(get_self(), points_manager);
        auto points  = points_table(get_self(), points_manager.value);

        auto itrr = points.begin();
        while (itrr != points.end() && batch_size > 0) {
#ifdef IS_DEV
            sendpoints(itrr->user, itrr->total_points, globals, points_manager, simulated_time);
#else
            sendpoints(itrr->user, itrr->total_points, globals, points_manager);
#endif
            itrr = points.erase(itrr);
            batch_size--;
        }
        globals.save(get_self(), points_manager, get_self());
    }

  private:
#ifdef IS_DEV
    void sendpoints(const name user, const uint32_t points, pointsconfig &current_globals, const name points_manager, const time_point_sec simulated_time){
#else
    void sendpoints(const name user, const uint32_t points, pointsconfig &current_globals, const name points_manager) {
#endif

        const auto multiplier = S{current_globals.multiplier};
    const auto points_to_send_float = S{points}.to<double>() * multiplier;
    const auto points_to_send       = S{std::floor(points_to_send_float)};

#ifdef IS_DEV
    const auto current_time = simulated_time;
#else
        const auto current_time = time_point_sec(current_time_point());
#endif
    if (current_time > current_globals.period_end) {
        current_globals.period_total = 0;
        current_globals.period_end += current_globals.period_duration * SECONDS_PER_DAY;
    }

    const auto remaining_budget = S{current_globals.period_budget} - S{current_globals.period_total};
    check(remaining_budget >= points_to_send, "ERR::EXCEEDED_POINTS_BUDGET::Trying to send %s but remaining budget is only %s (multiplier %s)", points_to_send,
        remaining_budget, multiplier);

    current_globals.running_total = S{current_globals.running_total} + S{points_to_send};
    current_globals.period_total  = S{current_globals.period_total} + S{points_to_send};

    const auto notify_action = current_globals.debug_mode ? "testaddpnts"_n : "addpoints"_n;

#ifdef IS_DEV
    action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, notify_action,
        std::make_tuple(user, points_to_send.to<uint32_t>().value(), current_time))
        .send();
#else
        action(permission_level{USERPOINTS_ACCOUNT, "usrpoints"_n}, USERPOINTS_ACCOUNT, notify_action,
            std::make_tuple(user, points_to_send.to<uint32_t>().value()))
            .send();
#endif
}
}
;
