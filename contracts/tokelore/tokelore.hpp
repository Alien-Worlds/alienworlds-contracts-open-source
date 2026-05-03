#include <eosio/action.hpp>
#include <eosio/asset.hpp>

#include "../common/contracts-common/safemath.hpp"
#include "../common/contracts-common/singleton.hpp"

#include "../atomicassets-contracts/include/atomicassets-interface.hpp"
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include <numeric>

using namespace eosio;
using namespace std;

static constexpr eosio::name VOTE_PROP_YES{"yes"};
static constexpr eosio::name VOTE_PROP_NO{"no"};
// static constexpr eosio::name VOTE_PROP_ABSTAIN{"abstain"};

static constexpr eosio::name TOKELORE_STATUS_OPEN{"open"};
static constexpr eosio::name TOKELORE_STATUS_PASSING{"passing"};
static constexpr eosio::name TOKELORE_STATUS_FAILING{"failing"};
static constexpr eosio::name TOKELORE_STATUS_QUORUM_UNMET{"quorum.unmet"};
static constexpr eosio::name TOKELORE_STATUS_EXPIRED{"expired"};
static constexpr eosio::name TOKELORE_STATUS_EXECUTED{"executed"};
static constexpr eosio::name TOKELORE_STATUS_MERGED{"merged"};
static constexpr eosio::name TOKELORE_STATUS_MINTPREP{"mintprep"};
static constexpr eosio::name TOKELORE_STATUS_COMPLETE{"complete"};

static constexpr symbol VP_SYM{"VP", 4};

// Precision multiplier to avoid truncation when dividing small rewards across large VP totals.
// TLM has 4 decimals (max raw ~10^14) × 10^12 = ~10^26, well within uint128_t (~3.4×10^38).
static constexpr uint64_t REWARD_PRECISION = 1000000000000ULL; // 1e12

CONTRACT tokelore : public contract {

  public:
    enum vote_choice : uint64_t {
        VOTE_YES = VOTE_PROP_YES.value,
        VOTE_NO  = VOTE_PROP_NO.value,
    };

    struct set_config_item {
        uint32_t duration;
        asset    fee;
        uint16_t pass_percent_x100;   // Percentage with 2 decimal places, eg. 1001 == 10.01%
        uint64_t quorum_percent_x100; // Percentage with 2 decimal places, eg. 5001 == 50.01%
    };

    // one week duration
    /**
        {
          "duration": 604,800,
          "fee": "0.0000 TLM",
          "quorum_percent_x100": 501,
          "pass_percent_x100": 5001,
          "power_per_day": 144,
        }
    */

    struct globals_item2;
    using globals_container2 = eosio::singleton<"globals2"_n, globals_item2>;
    struct [[eosio::table("globals2"), eosio::contract("tokelore")]] globals_item2 {
        uint32_t       duration;
        asset          fee;
        uint64_t       quorum_percent_x100; // Percentage with 2 decimal places, eg. 5001 == 50.01%
        uint16_t       pass_percent_x100;   // Percentage with 2 decimal places, eg. 1001 == 10.01%
        asset          total_staked     = asset(0, symbol("TLM", 4));
        asset          total_unstaking  = asset(0, symbol("TLM", 4));
        asset          total_vote_power = asset(0, VP_SYM);
        asset          power_per_day    = asset(0, VP_SYM);
        time_point_sec last_update;
        int32_t        template_id;

        static globals_item2 get_current_configs(eosio::name account, eosio::name scope) {
            return globals_container2(account, scope.value).get_or_default(globals_item2());
        }

        void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
            globals_container2(account, scope.value).set(*this, payer);
        }
    };

    // Reward globals singleton — tracks the Synthetix-style accumulator for voting rewards.
    // Kept separate from globals2 to avoid schema migration of the existing singleton.
    struct reward_globals_item;
    using reward_globals_container = eosio::singleton<"rewardglob"_n, reward_globals_item>;
    struct [[eosio::table("rewardglob"), eosio::contract("tokelore")]] reward_globals_item {
        asset     reward_pot             = asset(0, symbol("TLM", 4));
        uint128_t reward_per_vp_stored   = 0; // scaled by REWARD_PRECISION to preserve precision
        int64_t   total_vp_participating = 0; // raw VP amount (4 decimals) from all voters who have voted

        static reward_globals_item get_current(eosio::name account, eosio::name scope) {
            return reward_globals_container(account, scope.value).get_or_default(reward_globals_item());
        }

        void save(eosio::name account, eosio::name scope, eosio::name payer = same_payer) {
            reward_globals_container(account, scope.value).set(*this, payer);
        }
    };

    // Per-voter reward tracking — records each voter's accumulated entitlement.
    struct [[eosio::table("voterreward"), eosio::contract("tokelore")]] voter_reward_info {
        name      voter;
        int64_t   vp_participating   = 0; // total raw VP this voter has committed via voting
        uint128_t reward_per_vp_paid = 0; // snapshot of reward_per_vp_stored at last interaction
        int64_t   rewards_accrued    = 0; // unclaimed rewards in raw TLM (4 decimals)

        uint64_t primary_key() const {
            return voter.value;
        }
    };
    using voter_rewards_table = eosio::multi_index<"voterreward"_n, voter_reward_info>;

    struct [[eosio::table("proposals"), eosio::contract("tokelore")]] proposal_data {
        uint64_t                    proposal_id;
        name                        proposer;
        name                        type;
        name                        status;
        string                      title;
        asset                       total_yes_votes = asset(0, VP_SYM);
        asset                       total_no_votes  = asset(0, VP_SYM);
        uint32_t                    number_yes_votes;
        uint32_t                    number_no_votes;
        time_point_sec              expires;
        time_point_sec              earliest_exec;
        atomicassets::ATTRIBUTE_MAP attributes;

        uint64_t primary_key() const {
            return proposal_id;
        }
        uint64_t by_proposer() const {
            return proposer.value;
        }
        uint64_t by_expiry() const {
            return expires.sec_since_epoch();
        }
        uint64_t by_type() const {
            return type.value;
        }
        uint64_t by_status() const {
            return status.value;
        }
    };

    using proposal_table =
        eosio::multi_index<"tokelores"_n, proposal_data, indexed_by<"byproposer"_n, const_mem_fun<proposal_data, uint64_t, &proposal_data::by_proposer>>,
            indexed_by<"byexpiry"_n, const_mem_fun<proposal_data, uint64_t, &proposal_data::by_expiry>>,
            indexed_by<"bytype"_n, const_mem_fun<proposal_data, uint64_t, &proposal_data::by_type>>,
            indexed_by<"bystatus"_n, const_mem_fun<proposal_data, uint64_t, &proposal_data::by_status>>>;

    struct [[eosio::table("votepower2"), eosio::contract("tokelore")]] voter_info2 {
        name                  voter;
        asset                 vote_power = asset(0, VP_SYM);
        eosio::time_point_sec last_claim_time;
        asset                 staked_amount;

        uint64_t primary_key() const {
            return voter.value;
        }
    };
    using voters_table2 = eosio::multi_index<"voters2"_n, voter_info2>;

    struct [[eosio::table("deposits"), eosio::contract("tokelore")]] deposit_info {
        name  account;
        asset deposit;

        uint64_t primary_key() const {
            return account.value;
        }
    };
    using deposits_table = eosio::multi_index<"deposits"_n, deposit_info>;

    globals_item2       current_globals2;
    reward_globals_item current_reward_globals;

    struct status_result {
        name   status;
        double quorum;
        double yes_percentage;

        string to_string() const {
            return string{fmt("status: %s quorum: %s yes: %s", status, quorum, yes_percentage)};
        }
    };

    status_result get_status(proposal_data prop);

    void  update_proposal_status(uint64_t proposal_id);
    void  update_voter(name voter, asset vote_power_delta, asset staked_amount_delta);
    void  updateGlobalVotePowerToCurrentTime();
    asset accruedPowerSinceLastClaimTime(asset votePower, time_point_sec last_claim_time);

    void subtract_total_vote_power(asset vote_power);
    void update_voter_rewards(name voter);

  public:
    using contract::contract;
    tokelore(eosio::name receiver, eosio::name code, datastream<const char *> ds) : contract(receiver, code, ds) {
        current_globals2       = globals_item2::get_current_configs(get_self(), get_self());
        current_reward_globals = reward_globals_item::get_current(get_self(), get_self());
    }

    ~tokelore() {
        current_globals2.save(get_self(), get_self(), get_self());
        current_reward_globals.save(get_self(), get_self(), get_self());
    }

    // Actions
    ACTION updateconfig(set_config_item config);
#ifdef IS_DEV
    ACTION setpperday(asset power_per_day);
#endif
    ACTION propose(uint64_t proposal_id, name proposer, string title, name type, atomicassets::ATTRIBUTE_MAP attributes);
    ACTION cancel(uint64_t proposal_id);
    ACTION rmvexpired(uint64_t proposal_id);
    ACTION vote(name voter, uint64_t proposal_id, name vote, asset vote_power); // vote: 1=yes, 2=no
    ACTION exec(uint64_t proposal_id);
    /** Push by anyone to re-trigger the pubresult for an executed proposal that still need merging by the API bot
     * account. This could be needed if exec has been called before a PR has enough approvals to allow a merge by the
     * API bot account.  */
    ACTION pubretry(uint64_t proposal_id);
    ACTION setmerged(uint64_t proposal_id);
    ACTION setmintprep(uint64_t proposal_id);
    ACTION mint(uint64_t proposal_id, string fnt_image);

    ACTION rmvcompleted(uint64_t proposal_id);
    ACTION stake(name account);
    ACTION unstake(name account);
    ACTION refund(name account);
    ACTION fillpot(name filler);
    ACTION claimreward(name voter);
    ACTION publresult(proposal_data proposal);
    ACTION checkstatus(uint64_t proposal_id);
    ACTION settemplid(uint32_t template_id);
    ACTION forcedel(uint64_t proposal_id);
    ACTION batchupdstat(uint16_t batch_size);
    // Temporary action to update the total vote power in the globals.
    ACTION updatetotvp(asset total_power);

    // Notify transfers for payment of fees
    [[eosio::on_notify("alien.worlds::transfer")]] void receive(name from, name to, asset quantity, string memo);
};
