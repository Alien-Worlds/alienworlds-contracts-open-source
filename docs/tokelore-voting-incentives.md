# TokeLore Voting Incentive Mechanism

## Overview

TokeLore uses a **continuous accrued voting reward** model to incentivise active participation in the Alien Worlds governance voting system. Voters who stake TLM and cast votes earn a proportional share of a community-funded reward pot, paid out in TLM.

The design rewards voters who commit vote power to proposals — not just stakers who sit idle.

---

## Core Concepts

### Vote Power (VP)

Vote Power is earned passively by staking TLM over time. It is not transferable and decays when spent on a vote.

- Staking TLM causes VP to accrue at a configurable rate (`power_per_day`)
- Default rate: `144 VP` per day per `10,000 TLM` staked (i.e. ~0.000000167 VP per second per TLM staked)
- VP is consumed when casting a vote — spending VP is the act that earns rewards

### The Reward Pot

Anyone can fund the reward pot by transferring TLM to the contract and calling `fillpot`. The full deposit goes directly into the pot — there is no admin fee or protocol cut.

When the pot is filled, rewards are distributed **instantly and proportionally** to all voters who currently have VP committed to proposals.

### Reward Accumulator

The contract tracks a running total of **reward earned per VP** since the beginning. Each time the pot is filled, this value increases based on how much TLM was added and how many VP are currently participating:

```
reward per VP += fill amount ÷ total VP participating
```

When a voter commits VP to a proposal, their entry point on this running total is recorded. When they claim, they receive the difference — i.e. everything that accumulated after they committed their VP.

This means a voter only earns rewards for pot fills that occurred **after** they cast their vote.

---

## Participant Roles

| Role       | Action                        | Benefit                               |
| ---------- | ----------------------------- | ------------------------------------- |
| **Staker** | Stakes TLM                    | Accrues VP over time                  |
| **Voter**  | Casts vote (spends VP)        | Earns share of reward pot             |
| **Funder** | Fills the reward pot with TLM | Incentivises governance participation |

---

## Step-by-Step Flow

### 1. Stake TLM

Transfer TLM to the contract, then call `stake`:

```
alice transfers 1000 TLM → tokelore contract
alice calls stake("alice")
```

Alice now has `1000 TLM` staked. Her VP begins accruing at ~`0.0001 VP/sec` per TLM.

After 1 day: Alice has accrued ~`14.4 VP`.

### 2. Cast a Vote

Alice votes on proposal `#42` using `5.0 VP`:

```
alice calls vote("alice", 42, "yes", "5.0000 VP")
```

- `5.0 VP` is deducted from Alice's accumulated vote power
- Alice's `5.0 VP` is added to the reward pool's participating total
- Her position on the reward accumulator is recorded — she will earn from all future fills

Alice is now **eligible to earn rewards** from future pot fills.

### 3. Fund the Reward Pot

Bob transfers `100 TLM` to the contract and calls `fillpot`:

```
bob transfers 100.0000 TLM → tokelore contract
bob calls fillpot("bob")
```

Suppose Alice is the only voter with `5.0 VP` committed. Since she holds 100% of the participating VP, she is entitled to the full `100 TLM`.

### 4. Claim Rewards

Alice calls `claimreward("alice")`. The contract calculates her share of every fill that occurred since she voted:

```
alice's reward = alice's VP ÷ total VP participating × fill amount
              = 5.0 ÷ 5.0 × 100 TLM
              = 100 TLM
```

Alice receives `100.0000 TLM` transferred to her account.

---

## Proportional Sharing Example

Three voters have committed different amounts of VP when Bob fills `300 TLM`:

| Voter     | VP Committed | Share    | Reward      |
| --------- | ------------ | -------- | ----------- |
| Alice     | 5.0 VP       | 50%      | 150 TLM     |
| Carol     | 3.0 VP       | 30%      | 90 TLM      |
| Dave      | 2.0 VP       | 20%      | 60 TLM      |
| **Total** | **10.0 VP**  | **100%** | **300 TLM** |

Each voter claims independently at any time — their reward accrues in the contract until claimed. Voters who wait and let multiple fills accumulate before claiming will capture more TLM than those who claim after each fill.

---

## Incentivised Behaviours

### Rewarded

| Behaviour                                         | Why it earns rewards                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Voting early on a proposal**                    | VP is committed sooner, so the voter participates in more pot fills                                                                |
| **Committing more VP per vote**                   | Larger share of `total_vp_participating` → proportionally larger reward slice                                                      |
| **Staking TLM long-term**                         | More time staked = more VP accrued = more voting firepower available                                                               |
| **Voting on many proposals**                      | Each vote adds to `vp_participating`, increasing cumulative reward share                                                           |
| **Delaying claims while the pot is being filled** | Rewards continue to accumulate across every fill — claiming resets your accrued balance, so patient voters capture more of the pot |
| **Keeping TLM staked**                            | Staked TLM continuously accrues VP, maintaining a supply of vote power to commit to future proposals                               |

### Not Rewarded (by design)

| Behaviour                          | Reason                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------- |
| **Staking but never voting**       | VP accrues but `vp_participating` stays at zero — no share of pot fills    |
| **Voting after a pot fill**        | `reward_per_vp_paid` is snapshotted at vote time — past fills are excluded |
| **Holding VP without spending it** | Unspent VP earns nothing; rewards go only to committed VP                  |

---

## Multiple Pot Fills

Rewards accumulate correctly across multiple fills. A voter who stays in earns from every fill after their last vote:

**Timeline:**

1. Alice votes, committing `3.0 VP`. Accumulator = `0`.
2. Bob fills `50 TLM`. Accumulator increases.
3. Carol votes, committing `2.0 VP`. Accumulator snapshotted for Carol.
4. Bob fills another `50 TLM`. Accumulator increases again.

**Result:**

- Alice earns from **both** fills (she was present for both)
- Carol earns only from the **second** fill (she committed VP after the first fill)

|                | Fill 1 (50 TLM)                   | Fill 2 (50 TLM) | Total      |
| -------------- | --------------------------------- | --------------- | ---------- |
| Alice (3.0 VP) | 50 TLM (100%)                     | 30 TLM (60%)    | **80 TLM** |
| Carol (2.0 VP) | 0 TLM (VP committed after fill 1) | 20 TLM (40%)    | **20 TLM** |

---

## Voting on Multiple Proposals

Each vote on a new proposal adds more VP to a voter's committed total, directly increasing their share of every future pot fill.

**Example:** Alice commits `3.0 VP` to proposal #1, then later commits `2.0 VP` to proposal #2. Her total `vp_participating` is now `5.0 VP`, and she earns based on that combined total for all subsequent fills.

Importantly, committed VP is **never removed from the reward pool** when a proposal concludes — it stays committed regardless of whether the proposal passes, fails, expires, or is cancelled. So voting on more proposals compounds a voter's reward share permanently (until they claim, which only resets the accrued balance, not the committed VP).

### Proposal Outcome and Speed Don't Matter

The speed at which a proposal is executed, or whether it passes or fails, has **no effect** on reward earnings. Once VP is committed via a vote, it remains in the reward pool indefinitely. A voter does not need to track their proposals or wait for outcomes — their reward share is locked in at the moment they vote.

---

## Patience and Compounding Rewards

### Delaying Claims

Rewards accumulate continuously — there is no deadline to claim and no penalty for waiting. A voter who holds their position across many pot fills will collect more TLM than one who claims after each fill, because their share of every subsequent fill keeps adding to the same accrued balance.

Crucially, claiming **resets** a voter's accrued balance to zero. This has a secondary effect: if some voters claim early and their `vp_participating` is not reduced (it isn't — VP committed to a proposal stays committed), the pot is still split the same way. But a voter who claimed no longer has any "stored credit" for past fills, so they only benefit from fills after their claim. Patient voters who haven't claimed keep their full accumulated balance and continue earning on top of it.

> In short: claiming is beneficial when you need the TLM, but waiting — while the pot continues to be filled — is the higher-earning strategy.

### Continuous VP Accrual

As long as TLM remains staked, VP accrues in the background — even while existing VP is committed to proposals. This means active voters always have a growing supply of vote power available to commit to new proposals, sustaining their presence in the reward pool over time without needing to unstake and restake.

---

## Key Contract Actions

| Action                                       | Who       | Purpose                                                      |
| -------------------------------------------- | --------- | ------------------------------------------------------------ |
| `receive` (token notify)                     | Anyone    | Transfer TLM to contract for staking/fees/pot filling        |
| `stake(account)`                             | Staker    | Convert deposited TLM into staked balance, begin accruing VP |
| `unstake(account)`                           | Staker    | Withdraw staked TLM back to deposits table                   |
| `refund(account)`                            | Depositor | Return uninvested deposit to sender                          |
| `vote(voter, proposal_id, vote, vote_power)` | Voter     | Cast vote, commit VP to proposal, begin earning rewards      |
| `fillpot(filler)`                            | Funder    | Distribute deposited TLM pro-rata to current voters          |
| `claimreward(voter)`                         | Voter     | Withdraw accrued TLM reward to voter's account               |

---

## On-Chain Tables

| Table         | Contents                                                                               |
| ------------- | -------------------------------------------------------------------------------------- |
| `deposits`    | Pending TLM deposits awaiting `stake` or `fillpot`                                     |
| `voters2`     | Per-voter staked TLM, accumulated VP, last claim time                                  |
| `voterreward` | Per-voter reward tracking: `vp_participating`, `reward_per_vp_paid`, `rewards_accrued` |
| `globals2`    | System config: duration, fee, quorum thresholds, VP accrual rate                       |
| `rewardglob`  | Global reward state: `reward_pot`, `reward_per_vp_stored`, `total_vp_participating`    |

---

## Edge Cases

**No voters when pot is filled**
If `total_vp_participating == 0` when `fillpot` is called, the TLM is added to `reward_pot` but the accumulator is not updated. The funds will be distributed when voters commit VP to proposals and a subsequent fill occurs.

**Single voter**
A sole voter claims the entire pot fill, as their share is 100%.

**Claiming with nothing accrued**
`claimreward` will fail with `ERR::NOTHING_TO_CLAIM` if there are no rewards to collect.

**Double-claiming**
After a successful `claimreward`, `rewards_accrued` is reset to zero and `reward_per_vp_paid` is brought up to date. A second claim in the same block will fail.
