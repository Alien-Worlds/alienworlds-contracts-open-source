#include "tokelore.hpp"
#include "../config.hpp"
#include "../common/contracts-common/util.hpp"
using namespace eosdac;

void tokelore::receive(name from, name to, asset quantity, string memo) {
    if (to != _self || quantity.symbol != TLM_SYM) {
        return;
    }

    deposits_table deposits(get_self(), get_self().value);
    auto           existing = deposits.find(from.value);

    if (existing == deposits.end()) {
        deposits.emplace(get_self(), [&](deposit_info &d) {
            d.account = from;
            d.deposit = quantity;
        });
    } else {
        deposits.modify(existing, same_payer, [&](deposit_info &d) {
            d.deposit += quantity;
        });
    }
}

void tokelore::refund(name account) {
    deposits_table deposits(get_self(), get_self().value);
    auto           existing = deposits.find(account.value);
    check(existing != deposits.end(), "ERR::NO_DEPOSIT::This account does not have any deposit");

    string memo = "Return of TokeLore deposit.";
    eosio::action(eosio::permission_level{get_self(), "active"_n}, "alien.worlds"_n, "transfer"_n, make_tuple(get_self(), account, existing->deposit, memo))
        .send();

    deposits.erase(existing);
}

void tokelore::updateconfig(set_config_item new_config) {
    require_auth(get_self());

    check(new_config.duration >= 5, "ERR::DURATION_TOO_SHORT::Duration must be at least 5 seconds");
    check(new_config.fee.amount >= 0, "ERR::INVALID_FEE::Fee cannot be negative");
    check(new_config.quorum_percent_x100 >= 0, "ERR::INVALID_QUORUM::Quorum cannot be negative");
    check(new_config.pass_percent_x100 > new_config.quorum_percent_x100, "ERR::INVALID_PASS::Pass must be greater than quorum");
    current_globals2.duration            = new_config.duration;
    current_globals2.fee                 = new_config.fee;
    current_globals2.quorum_percent_x100 = new_config.quorum_percent_x100;
    current_globals2.pass_percent_x100   = new_config.pass_percent_x100;
}

// This action is used to update the total vote power in the globals.
// It is used to set the total vote power to a specific amount.
// This is a temporary action and will be removed after the fix.
void tokelore::updatetotvp(asset total_power) {
    require_auth(get_self());

    check(total_power.amount >= 0, "ERR::INVALID_TOTAL_POWER::Total power cannot be negative");
    check(total_power.symbol == VP_SYM, "ERR::INVALID_SYMBOL::Total power must be in VP");
    current_globals2.total_vote_power = total_power;
}

#ifdef IS_DEV
void tokelore::setpperday(asset power_per_day) {
    require_auth(get_self());
    check(power_per_day.amount <= 60 * 60 * 24, "ERR::INVALID_POWER_PER_DAY::Power per day cannot be greater than 1 per seocond");
    check(power_per_day.amount >= 0, "ERR::INVALID_POWER_PER_DAY::Power per day cannot be negative");
    check(power_per_day.symbol == VP_SYM, "ERR::INVALID_SYMBOL::Power per day must be in VP");
    current_globals2.power_per_day = power_per_day;
}
#endif

void tokelore::stake(name account) {
    require_auth(account);

    deposits_table deposits(get_self(), get_self().value);
    auto           deposit_itr = deposits.require_find(account.value, "ERR::NO_DEPOSIT::This account does not have any deposit");
    // auto delta       = asset{deposit_itr->deposit.amount, VP_SYM};
    update_voter(account, {0, VP_SYM}, deposit_itr->deposit);
    deposits.erase(deposit_itr);
    // important to update the global vote power before updating the total staked amount in the globals.
    updateGlobalVotePowerToCurrentTime();
    current_globals2.total_staked += deposit_itr->deposit;
    // current_globals2.total_vote_power += delta;
    check(current_globals2.total_vote_power.amount >= 0, "ERR::INVALID_VOTE_POWER::Vote power cannot be negative");
}

void tokelore::unstake(name account) {
    require_auth(account);

    voters_table2 voters(get_self(), get_self().value);
    auto          voter = voters.find(account.value);
    check(voter != voters.end(), "ERR::NO_VOTE_POWER::This account does not have anything to unstake.");

    deposits_table deposits(get_self(), get_self().value);
    auto           deposit = deposits.find(account.value);
    if (deposit != deposits.end()) {
        deposits.modify(deposit, same_payer, [&](deposit_info &d) {
            d.deposit += voter->staked_amount;
        });
    } else {
        deposits.emplace(get_self(), [&](deposit_info &d) {
            d.account = account;
            d.deposit = voter->staked_amount;
        });
    };
    // Update the vote power to now to get the correct accrued power before unstaking from the globals.
    update_voter(account, {0, VP_SYM}, ZERO_TRILIUM);
    voter = voters.find(account.value);
    // When unstaking, the current globals must first reduced by the current vote power, before updating the vote power
    current_globals2.total_staked -= voter->staked_amount;
    current_globals2.total_vote_power -= voter->vote_power;
    check(current_globals2.total_vote_power.amount >= 0, "ERR::INVALID_VOTE_POWER::Vote power cannot be negative");
    updateGlobalVotePowerToCurrentTime();

    voters.erase(voter);
}

/**
 * @brief Update the global vote power to the current time based on the current total staked amount.
 * The global vote power is updated by adding the total staked amount multiplied by the time since the last update.
 * The last update time is then set to the current time.
 *
 */
void tokelore::updateGlobalVotePowerToCurrentTime() {
    auto local_now = now();
    auto time_diff = local_now.sec_since_epoch() - current_globals2.last_update.sec_since_epoch();

    auto power_multiplier = S{current_globals2.power_per_day.amount}.to<double>() / S{(60 * 60 * 24 * 10000)}.to<double>(); // power per second

    auto extraPower = S{current_globals2.total_staked.amount}.to<double>() * S{time_diff}.to<double>() * power_multiplier;
    current_globals2.total_vote_power.amount += extraPower.to<int64_t>();
    check(current_globals2.total_vote_power.amount >= 0, "ERR::INVALID_VOTE_POWER::Vote power cannot be negative");
    current_globals2.last_update = now();
}

void tokelore::update_voter(name voter, asset vote_power_delta, asset staked_amount_delta = asset{0, TLM_SYM}) {
    voters_table2 voters(get_self(), get_self().value);
    auto          existing_voter = voters.find(voter.value);

    auto local_now = now();

    if (existing_voter == voters.end()) {
        voters.emplace(voter, [&](voter_info2 &v) {
            v.voter           = voter;
            v.vote_power      = asset(0, VP_SYM); // start with 0 vote power
            v.last_claim_time = local_now;
            v.staked_amount   = staked_amount_delta;
        });
    } else {
        voters.modify(existing_voter, same_payer, [&](voter_info2 &v) {
            auto accrued_power_since_last_claim_time = accruedPowerSinceLastClaimTime(v.staked_amount, v.last_claim_time);

            v.vote_power += accrued_power_since_last_claim_time; // only accrue power since last claim time
            if (vote_power_delta.amount < 0) {
                check(v.vote_power > -vote_power_delta, "ERR::VOTE_POWER_EXCEEDED::Vote power cannot be exceeded. vote power: %s delta: %s", v.vote_power,
                    vote_power_delta);
                v.vote_power += vote_power_delta; // only deduct vote power from voting.
            }

            v.last_claim_time = local_now;
            v.staked_amount += staked_amount_delta;
        });
    }
}

asset tokelore::accruedPowerSinceLastClaimTime(asset votePower, time_point_sec last_claim_time) {
    auto local_now        = now();
    auto time_diff        = local_now.sec_since_epoch() - last_claim_time.sec_since_epoch();
    auto power_multiplier = S{current_globals2.power_per_day.amount}.to<double>() / S{(60 * 60 * 24 * 10000)}.to<double>(); // power per second

    auto resultRaw = S{votePower.amount}.to<double>() * S{time_diff}.to<double>() * power_multiplier;

    auto result = resultRaw.to<int64_t>();

    return asset{result, VP_SYM};
}

void tokelore::propose(uint64_t proposal_id, name proposer, string title, name type, atomicassets::ATTRIBUTE_MAP attributes) {

    require_auth(proposer);

    proposal_table proposals(get_self(), get_self().value);
    check(proposals.find(proposal_id) == proposals.end(), "ERR::DUPLICATE_ID::Proposal with this id already exists");

    // Check the fee has been paid
    deposits_table deposits(get_self(), get_self().value);
    auto           dep          = deposits.find(proposer.value);
    auto           fee_required = current_globals2.fee;
    if (fee_required.amount > 0) {
        check(dep != deposits.end(),
            "ERR::FEE_REQUIRED::A fee of %s is required to create a proposal. Please send the correct fee to this contract and try again.", fee_required);
        check(dep->deposit >= fee_required, "ERR::INSUFFICIENT_FEE::Fee provided is insufficient. Required: %s, Provided: %s", fee_required, dep->deposit);

        if (dep->deposit == fee_required) {
            deposits.erase(dep);
        } else {
            deposits.modify(*dep, same_payer, [&](auto &d) {
                d.deposit -= fee_required;
            });
        }
    }

    // Calculate expiry
    uint32_t time_now = current_time_point().sec_since_epoch();
    //    globals_item config = globals_item::get_current_configs(get_self(), get_self());
    uint32_t expiry_time        = time_now + current_globals2.duration;
    uint32_t earliest_exec_time = time_now + current_globals2.duration / 4;

    proposals.emplace(proposer, [&](proposal_data &r) {
        r.proposal_id   = proposal_id;
        r.proposer      = proposer;
        r.title         = title;
        r.type          = type;
        r.attributes    = attributes;
        r.expires       = time_point_sec(expiry_time);
        r.earliest_exec = time_point_sec(earliest_exec_time);
        r.status        = TOKELORE_STATUS_OPEN;
    });
}

void tokelore::vote(name voter, uint64_t proposal_id, name vote, asset vote_power) {
    check(vote == VOTE_PROP_YES || vote == VOTE_PROP_NO, "ERR::INVALID_VOTE::Vote must be either 'yes' or 'no'");
    require_auth(voter);
    check(vote_power.symbol == VP_SYM, "ERR::INVALID_SYMBOL::Vote power must be in VP");
    check(vote_power.amount > 0, "ERR::INVALID_VOTE_POWER_AMOUNT::Vote power must be greater than 0");

    proposal_table propsoals(get_self(), get_self().value);
    auto           prop = propsoals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");

    check(prop->status != TOKELORE_STATUS_EXECUTED, "ERR::PROPOSAL_EXECUTED::Proposal has already been executed");
    check(prop->status != TOKELORE_STATUS_EXPIRED, "ERR::PROPOSAL_EXPIRED::Proposal is closed, no more voting is allowed");
    check(prop->expires >= now(), "ERR::PROPOSAL_EXPIRED::Proposal is closed, no more voting is allowed");

    voters_table2 voters(get_self(), get_self().value);
    auto          existing_voter = voters.find(voter.value);
    check(existing_voter != voters.end(), "ERR::VOTER_NO_STAKE::You must stake before voting.");
    // check(existing_voter->vote_power.amount > 0, "ERR::NO_VOTE_POWER::Voter has no vote power.");

    update_voter(voter, -vote_power);

    updateGlobalVotePowerToCurrentTime();
    propsoals.modify(prop, same_payer, [&](proposal_data &p) {
        if (vote == VOTE_PROP_YES) {
            p.total_yes_votes += vote_power;
            p.number_yes_votes = S{p.number_yes_votes} + S<uint32_t>{1};
        } else {
            p.total_no_votes += vote_power;
            p.number_no_votes = S{p.number_no_votes} + S<uint32_t>{1};
        }
        p.status = get_status(p).status;
    });
    if (prop->status == TOKELORE_STATUS_PASSING && now() >= prop->earliest_exec) {
        exec(proposal_id);
    }
}

void tokelore::cancel(uint64_t proposal_id) {
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");

    require_auth(prop->proposer);
    check(prop->status != TOKELORE_STATUS_EXECUTED, "ERR::PROPOSAL_EXECUTED::Proposal has already been executed");
    subtract_total_vote_power(prop->total_yes_votes + prop->total_no_votes);

    proposals.erase(prop);
}

void tokelore::rmvexpired(uint64_t proposal_id) {
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");
    require_auth(prop->proposer);

    auto status = get_status(*prop);

    check(status.status == TOKELORE_STATUS_EXPIRED, "ERR::PROPOSAL_NOT_EXPIRED::Proposal is not expired");
    subtract_total_vote_power(prop->total_yes_votes + prop->total_no_votes);

    proposals.erase(prop);
}

void tokelore::exec(uint64_t proposal_id) {

    proposal_table proposals(get_self(), get_self().value);
    auto           prop   = proposals.require_find(proposal_id, "ERR:PROPOSAL_NOT_FOUND::Proposal not found");
    auto           status = get_status(*prop);

    check(status.status == TOKELORE_STATUS_PASSING,
        "ERR:PROPOSAL_NOT_PASSED::Proposal has not passed required amount of 'yes' votes. Currently at 'Yes': %s\%. Quorum: %s\%. Status: %s",
        status.yes_percentage, status.quorum, status.status);

    check(now() >= prop->earliest_exec, "ERR::PROPOSAL_NOT_READY::Too early to execute proposal. Must wait until %s", prop->earliest_exec);

    proposals.modify(prop, same_payer, [&](auto &r) {
        r.status = TOKELORE_STATUS_EXECUTED;
    });
    subtract_total_vote_power(prop->total_yes_votes + prop->total_no_votes);

    action(permission_level{get_self(), "active"_n}, get_self(), "publresult"_n, make_tuple(*prop)).send();
}

void tokelore::pubretry(uint64_t proposal_id) {
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR:PROPOSAL_NOT_FOUND::Proposal not found");

    // Anyone can call this action since it doesn't change state
    //  if (!has_auth(get_self())) {
    //      require_auth(prop->proposer);
    //  }

    check(prop->status == TOKELORE_STATUS_EXECUTED || prop->status == TOKELORE_STATUS_MERGED,
        "ERR:PROPOSAL_NOT_EXECUTED_OR_MERGED::Proposal has not been executed or merged.");

    action(permission_level{get_self(), "active"_n}, get_self(), "publresult"_n, make_tuple(*prop)).send();
}

void tokelore::setmerged(uint64_t proposal_id) {
    require_auth(get_self());
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");

    check(prop->status == TOKELORE_STATUS_EXECUTED, "ERR::PROPOSAL_NOT_EXECUTED::Proposal has not been executed.");
    proposals.modify(prop, same_payer, [&](auto &r) {
        r.status = TOKELORE_STATUS_MERGED;
    });
    action(permission_level{get_self(), "active"_n}, get_self(), "publresult"_n, make_tuple(*prop)).send();
}

void tokelore::setmintprep(uint64_t proposal_id) {
    require_auth(get_self());
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");

    check(prop->status == TOKELORE_STATUS_MERGED || prop->status == TOKELORE_STATUS_MINTPREP, "ERR::PROPOSAL_NOT_MERGED::Proposal has not been merged.");
    proposals.modify(prop, same_payer, [&](auto &r) {
        r.status = TOKELORE_STATUS_MINTPREP;
    });
    action(permission_level{get_self(), "active"_n}, get_self(), "publresult"_n, make_tuple(*prop)).send();
}

void tokelore::mint(uint64_t proposal_id, string fnt_image) {
    require_auth(get_self());
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");

    check(prop->status == TOKELORE_STATUS_MINTPREP, "ERR::PROPOSAL_NOT_MINTPREP::Proposal has not been prepared for minting.");

    auto                        tokeLoreSchemaName = "lore.worlds"_n;
    vector<asset>               quantities_to_back = {};
    atomicassets::ATTRIBUTE_MAP mutable_attributes = {};
    atomicassets::ATTRIBUTE_MAP immutable_attrs    = prop->attributes;

    immutable_attrs.insert({"name", prop->title});
    immutable_attrs.insert({"type", prop->type.to_string()});
    immutable_attrs.insert({"img", fnt_image});

    auto collection  = "art.worlds"_n; // Tokenized Lore NFTs must be minted in the art.worlds collection
    auto template_id = -1;             // This indicates that we are minting with no template. Each NFT will be unique.

    action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "mintasset"_n,
        make_tuple(get_self(), collection, tokeLoreSchemaName, template_id, prop->proposer, immutable_attrs, mutable_attributes, quantities_to_back))
        .send();

    proposals.modify(prop, same_payer, [&](auto &r) {
        r.status = TOKELORE_STATUS_COMPLETE;
    });
}

void tokelore::rmvcompleted(uint64_t proposal_id) {

    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");
    require_auth(prop->proposer);

    check(prop->status == TOKELORE_STATUS_COMPLETE, "ERR::PROPOSAL_NOT_COMPLETED::Proposal has not been minted.");
    proposals.erase(prop);
}

ACTION tokelore::publresult(proposal_data proposal) {
    require_auth(get_self());
}

tokelore::status_result tokelore::get_status(proposal_data prop) {
    auto yes_votes_s   = S{prop.total_yes_votes.amount}.to<double>();
    auto current_all_s = yes_votes_s + S{prop.total_no_votes.amount}.to<double>();
    auto time_now      = current_time_point().sec_since_epoch();
    // check(current_globals2.total_vote_power.amount != 0, "ERR::ZERO_VOTE_POWER::Total vote power is zero");
    check(current_globals2.total_vote_power.amount >= 0, "ERR::INVALID_VOTE_POWER::Vote power cannot be negative");
    auto current_quorum_s = current_all_s / S{current_globals2.total_vote_power.amount}.to<double>();
    auto current_quorum   = narrow_cast<uint64_t>(current_quorum_s * S{10000.0}); // multiply by 10000 to get integer with 2

    ::check(current_quorum_s <= 100.0, "ERR::QUORUM_EXCEEDED::Quorum cannot be greater than 100.0. Is: %s", current_quorum_s);
    ::check(current_quorum_s >= 0.0, "ERR::QUORUM_EXCEEDED::Quorum cannot be less than 0.0. Is: %s", current_quorum_s);

    // prevent division by zero if current_all_s is zero
    auto yes_proportion_s = S{0.0};
    if (current_all_s != 0.0) {
        yes_proportion_s = (yes_votes_s / current_all_s);
    }
    auto yes_percentage = narrow_cast<uint64_t>(yes_proportion_s * S{10000.0}); // multiply by 10000 to get integer with 2

    if (time_now >= prop.expires.sec_since_epoch()) {
        return {TOKELORE_STATUS_EXPIRED, current_quorum_s, yes_proportion_s};
    }

    if (current_quorum < current_globals2.quorum_percent_x100) {
        return {TOKELORE_STATUS_QUORUM_UNMET, current_quorum_s, yes_proportion_s};
    }

    // quorum has been reached, check we have passed
    if (yes_percentage >= current_globals2.pass_percent_x100) {
        return {TOKELORE_STATUS_PASSING, current_quorum_s, yes_proportion_s};
    } else {
        return {TOKELORE_STATUS_FAILING, current_quorum_s, yes_proportion_s};
    }
}

ACTION tokelore::checkstatus(uint64_t proposal_id) {
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");

    check(false, "%s", get_status(*prop));
}

ACTION tokelore::settemplid(uint32_t template_id) {
    require_auth(get_self());
    current_globals2.template_id = template_id;
}

void tokelore::subtract_total_vote_power(asset vote_power) {
    current_globals2.total_vote_power -= vote_power;
    check(current_globals2.total_vote_power.amount >= 0, "ERR::INVALID_VOTE_POWER::Vote power cannot be negative");
}

ACTION tokelore::forcedel(uint64_t proposal_id) {
    require_auth(get_self());
    proposal_table proposals(get_self(), get_self().value);
    auto           prop = proposals.require_find(proposal_id, "ERR::PROPOSAL_NOT_FOUND::Proposal not found");
    subtract_total_vote_power(prop->total_yes_votes + prop->total_no_votes);
    proposals.erase(prop);
}

ACTION tokelore::batchupdstat(uint16_t batch_size) {
    require_auth(get_self());
    proposal_table proposals(get_self(), get_self().value);
    bool           processed_some_rows = false;
    auto           props               = proposals.begin();
    while (props != proposals.end() && batch_size > 0) {
        if (props->status == TOKELORE_STATUS_OPEN || props->status == TOKELORE_STATUS_PASSING || props->status == TOKELORE_STATUS_FAILING ||
            props->status == TOKELORE_STATUS_QUORUM_UNMET) {
            auto status = get_status(*props);
            if (status.status != props->status) {
                processed_some_rows = true;
                proposals.modify(props, same_payer, [&](auto &r) {
                    r.status = status.status;
                });
            }
        }
        props++;
        batch_size--;
    }
    check(processed_some_rows, "ERR::NO_ROWS_PROCESSED::No rows processed, Assert to avoid txn spam on chain.");
}
