#include "infl.hpp"
#include "../common/contracts-common/string_format.hpp"

using namespace alienworlds;
using namespace atomicdata;

infl::infl(name s, name code, datastream<const char *> ds) : contract(s, code, ds) {}

void infl::inflate() {
    check_not_paused();

    const auto one_day = S{uint32_t{60 * 60 * 24}};

    auto       state     = state_item::get_current_state(get_self(), get_self());
    const auto time_now  = S{current_time_point().sec_since_epoch()};
    const auto last_fill = S{state.last_land_fill.sec_since_epoch()};
#if !defined(IS_DEV)
    check(last_fill < time_now - one_day, "Last fill was less than 24 hours ago");
#endif
    state.last_land_fill = time_point_sec{S{state.last_land_fill.sec_since_epoch()} + one_day};
    state.save(get_self(), get_self(), get_self());

    auto       res      = reserve_item::get_current_reserve(get_self(), get_self());
    const auto reserve  = S{res.total}.to<double>();
    const auto _planets = planets_table{PLANETS_CONTRACT, PLANETS_CONTRACT.value};

    const auto number_planets = std::accumulate(_planets.begin(), _planets.end(), S<uint16_t>{0}, [](const auto &acc, const auto &p) {
        return acc + S<uint16_t>{1};
    });

    const auto max_planets = S<uint16_t>{7};
    ::check(number_planets <= max_planets, "Too many planets: %s. Max allowed: %s", number_planets, max_planets);

    const auto total_stake = std::accumulate(_planets.begin(), _planets.end(), S<int64_t>{0}, [](const auto &acc, const auto &p) {
        return acc + S{p.total_stake};
    });

    // Ensure there is at least some stake across all planets before proceeding
    check(total_stake > S<int64_t>{0}, "Total staked TLM must be greater than 0");

    // This is the daily trilium allocation of new tokens that need to be minted
    const auto inflation_double = (reserve * (S{13.0} + (S{number_planets}.to<double>() * S{1.9}))) / S{100000.0};
    const auto inflation        = asset{inflation_double.to<int64_t>(), TLM_SYM};

    ::check(inflation_double > 0.0, "Inflation must be positive. Inflation: %s", inflation_double);

    check(inflation_double <= reserve, "Inflation is greater than reserve. Inflation: %s Reserve: %s", inflation_double, reserve);

    // Defense-in-depth: Ensure daily inflation does not exceed the configured cap
    const auto cap_asset = asset{DAILY_INFLATION_CAP_UNITS, TLM_SYM};
    ::check(S{inflation.amount} <= S{DAILY_INFLATION_CAP_UNITS}, "Inflation exceeds daily cap. Inflation: %s Cap: %s", inflation, cap_asset);

    // Now we split the inflation into 4 parts:

    // DTAP (Daily Token Allocation to Planets) is 63% of total inflation
    const auto dtap_double = inflation_double * S{0.63};
    const auto dtap        = asset{dtap_double.to<int64_t>(), TLM_SYM};

    // DTAL (Daily Token Allocation to Landowners) is 20% of total inflation
    const auto dtal_double = inflation_double * S{0.2};
    const auto dtal        = asset{dtal_double.to<int64_t>(), TLM_SYM};

    // DTAS (Daily Token Allocation to Satellites) is 10% of total inflation
    const auto dtas_double = inflation_double * S{0.1};
    const auto dtas        = asset{dtas_double.to<int64_t>(), TLM_SYM};

    // DTAB (Daily Token Allocation to Binance) is 7% of total inflation
    const auto dtab_double = inflation_double * S{0.07};
    const auto dtab        = asset{dtab_double.to<int64_t>(), TLM_SYM};

    // Check to make sure the sum is 100%
    check((dtap_double + dtal_double + dtas_double + dtab_double - inflation_double).abs() < S{1.0},
        "Inflation does not equal sum of DTAP, DTAL, DTAS and DTAB. Inflation: %s DTAP: %s DTAL: %s DTAS: %s DTAB: %s", inflation, dtap, dtal, dtas, dtab);

    auto payouts     = payouts_table{get_self(), get_self().value};
    auto dac_payouts = dac_payouts_table{get_self(), get_self().value};

    // Now go through all planets and calculate the payout for each
    auto dtap_after_rounding = asset{0, TLM_SYM};
    for (const auto &planet : _planets) {
        const auto planet_pay = calculate_planet_pay(planet, dtap, total_stake);

        const auto mining_pay  = planet_pay * 80 / 100; // 80% of planet pay
        const auto reserve_pay = planet_pay * 13 / 100; // 13% of planet pay

        dtap_after_rounding += mining_pay;
        dtap_after_rounding += reserve_pay;

        upsert(payouts, planet.planet_name.value, get_self(), [&](auto &p) {
            p.planet_name = planet.planet_name;
            p.mining += mining_pay;
            p.reserve += reserve_pay;
        });

        const auto dac_name = dac_accounts.find(planet.planet_name);
        if (dac_name != dac_accounts.end()) {
            const auto dac_pay = planet_pay * 7 / 100; // 7% of planet pay
            dtap_after_rounding += dac_pay;

            upsert(dac_payouts, dac_name->second.value, get_self(), [&](auto &p) {
                p.dac_account = dac_name->second;
                p.amount += dac_pay;
            });
        }
    }

    // Make sure the sum of all planet payouts equals the DTAP modulo
    // rounding differences up to 0.01 TLM
    const auto diff = (S{dtap_after_rounding.amount} - S{dtap.amount}).abs();
    check(diff < S<int64_t>{100}, "Planet payout sum does not equal DTAP. Payout sum: %s DTAP: %s diff: %s", dtap_after_rounding, dtap, diff);

    // Since the dtap amount was changed by rounding, we need to re-calculate the amount of inflation so the correct
    // amount can be issued
    const auto inflation_after_rounding = dtap_after_rounding + dtal + dtas + dtab;

    const auto inflation_diff = (S{inflation_after_rounding.amount} - S{inflation.amount}).abs();
    check(inflation_diff < S<int64_t>{100}, "Inflation sum does not equal inflation. Inflation sum: %s Inflation: %s diff: %s", inflation_after_rounding,
        inflation, inflation_diff);

    // 2nd Defense-in-depth: Ensure daily inflation after rounding does not exceed the configured cap
    ::check(S{inflation_after_rounding.amount} <= S{DAILY_INFLATION_CAP_UNITS}, "Inflation after rounding exceeds daily cap. Inflation: %s Cap: %s",
        inflation_after_rounding, cap_asset);

    // Reduce the reserve by the amount of inflation we're about to issue
    res.total = S{res.total} - S{inflation_after_rounding.amount};

    ::check(S{res.total} >= S<int64_t>{0}, "Reserve is negative: %s", res.total);
    res.save(get_self(), get_self(), get_self());

    // Issue new TLM tokens due to inflation
    action(permission_level{get_self(), "issue"_n}, TOKEN_CONTRACT, "issue"_n, make_tuple(get_self(), inflation_after_rounding, "Daily Trilium Allocation"s))
        .send();

    // DTAL we can transfer to the landowners immediately
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), "awlndratings"_n, dtal, "Landowners Allocation"s))
        .send();

    // DTAS we can transfer to the satellites immediately
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), "sat.worlds"_n, dtas, "Satellite Allocation"s)).send();

    // DTAB we can transfer to binance immediately
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), binance_name, dtab, "Planet claim"s)).send();
}

void infl::claim(const name planet_name) {
    require_auth(planet_name);
    check_not_paused();

    // Pay out the mining and reserve amounts
    auto       payouts       = payouts_table{get_self(), get_self().value};
    const auto payout        = payouts.require_find(planet_name.value, "No payout found for planet");
    const auto mining_asset  = payout->mining;
    const auto reserve_asset = payout->reserve;
    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), MINING_CONTRACT, mining_asset, "Mining allocation"s))
        .send();
    action(permission_level{get_self(), "xfer"_n}, MINING_CONTRACT, "fill"_n, make_tuple(get_self(), planet_name, mining_asset)).send();

    action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n, make_tuple(get_self(), planet_name, reserve_asset, "Planet claim"s)).send();
    payouts.erase(payout);

    // Pay out the dac amounts
    const auto dac_name = dac_accounts.find(planet_name);
    if (dac_name != dac_accounts.end()) {
        auto       dac_payouts = dac_payouts_table{get_self(), get_self().value};
        const auto dac_pay     = dac_payouts.find(dac_name->second.value);
        if (dac_pay != dac_payouts.end()) {
            action(permission_level{get_self(), "xfer"_n}, TOKEN_CONTRACT, "transfer"_n,
                make_tuple(get_self(), dac_pay->dac_account, dac_pay->amount, "DAC claim"s))
                .send();
            dac_payouts.erase(dac_pay);
        }
    }
}

asset infl::calculate_planet_pay(const planet_item &planet, const asset &dtap, const int64_t total_staked_tlm) {
    const auto state = state_item::get_current_state(get_self(), get_self());

    const auto planet_staked_tlm = S{planet.total_stake};

    const auto planet_nft_multiplier       = S{planet.nft_multiplier};
    const auto total_planet_nft_multiplier = S{state.nft_total};
    check(total_planet_nft_multiplier > 0ull, "Total planet nft multiplier is 0");

    const auto nft_mod = S{0.2};

    const auto nft_pay_double = S{dtap.amount}.to<double>() * nft_mod * planet_nft_multiplier.to<double>() / total_planet_nft_multiplier.to<double>();
    const auto nft_pay        = asset{nft_pay_double.to<int64_t>(), TLM_SYM};

    const auto stake_pay_double = S{dtap.amount}.to<double>() * (S{1.0} - nft_mod) * planet_staked_tlm.to<double>() / S{total_staked_tlm}.to<double>();
    const auto stake_pay        = asset{stake_pay_double.to<int64_t>(), TLM_SYM};

    const auto planet_pay = nft_pay + stake_pay;
    const auto max_payout = asset{500'000'0000, TLM_SYM};
    return std::min(planet_pay, max_payout);
}

void infl::logclaim(name planet_name, asset planet_quantity, asset mining_quantity) {}

#ifdef IS_DEV
void infl::setreserve(uint64_t total) {
    require_auth(get_self());

    auto res  = reserve_item::get_current_reserve(get_self(), get_self());
    res.total = total;
    res.save(get_self(), get_self(), get_self());
}

void infl::setlandclaim(time_point_sec last_fill) {
    require_auth(get_self());

    auto state           = state_item::get_current_state(get_self(), get_self());
    state.last_land_fill = last_fill;
    state.save(get_self(), get_self(), get_self());
}

void infl::setmultipl(const name planet, const int64_t nft_multiplier) {
    require_auth(get_self());

    const auto _planets   = planets_table(PLANETS_CONTRACT, PLANETS_CONTRACT.value);
    auto       planet_itr = _planets.require_find(planet.value, ERR_PLANET_DOES_NOT_EXIST);

    auto state = state_item::get_current_state(get_self(), get_self());
    state.nft_total += nft_multiplier;
    state.save(get_self(), get_self(), get_self());
}

#endif

void infl::setpaused(const bool paused) {
    auto       x             = pausable_singleton{get_self(), get_self().value};
    const auto current_state = x.get_or_default();
    x.set(pausable{paused}, get_self());
}

void infl::pause() {
    require_auth(get_self());
    check(!is_paused(), "already paused");
    setpaused(true);
}

void infl::unpause() {
    require_auth(get_self());
    check(is_paused(), "already unpaused");
    setpaused(false);
}
