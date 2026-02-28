# Alien Worlds Competitions System

## Overview

The Alien Worlds Competitions system is a smart contract that enables tournament admins to create and manage competitive tournaments within the Alien Worlds ecosystem. This system allows for structured competitions with prize pools, player registration, live scoring, and automated reward distribution.

## Key Features

- **Multi-stage competition lifecycle**: Preparing → Playing → Processing → Auditing → Rewarding → Complete
- **Flexible prize allocation**: TLM token prizes and shard rewards
- **Player registration and management**: With minimum/maximum player limits
- **Live scoring system**: Real-time score updates during competitions
- **Dispute resolution**: Built-in auditing and approval workflow
- **Late registration support**: Optional late player registration during playing state
- **Admin controls**: Comprehensive management functions for competition administrators

## Competition States

| State      | Code           | Description                                          |
| ---------- | -------------- | ---------------------------------------------------- |
| Preparing  | `preparing`    | Competition is being set up and players can register |
| Playing    | `1.playing`    | Competition is active and live scoring is enabled    |
| Processing | `2.processing` | Competition has ended, processing results            |
| Auditing   | `3.auditing`   | Results are being reviewed for disputes              |
| Rewarding  | `4.rewarding`  | Winners can claim their rewards                      |
| Complete   | `5.complete`   | Competition has finished and all rewards distributed |
| Rejected   | `rejected`     | Competition was rejected and funds returned          |
| Expired    | `expired`      | Competition expired due to insufficient players      |
| Deleting   | `deleting`     | Competition is being deleted from the system         |

## Core Data Structures

### Competition Table

```cpp
struct comp_item {
    uint64_t id;                            // Unique competition ID
    eosio::name admin;                      // Competition administrator
    string title;                           // Competition title
    string description;                     // Competition description
    eosio::asset winnings_budget;           // Total TLM prize pool
    eosio::asset winnings_claimed;          // TLM already claimed
    uint16_t winnings_allocated_perc_x_100; // Percentage of winnings allocated
    uint16_t admin_pay_perc_x_100;          // Admin's percentage of winnings
    uint32_t shards_budget;                 // Total shard prize pool
    uint32_t shards_claimed;                // Shards already claimed
    uint16_t shards_allocated_perc_x_100;   // Percentage of shards allocated
    time_point_sec start_time;              // Competition start time
    time_point_sec end_time;                // Competition end time
    uint16_t min_players;                   // Minimum required players
    uint16_t max_players;                   // Maximum allowed players
    uint16_t num_players;                   // Current number of registered players
    name state;                             // Current competition state
    string notice;                          // Admin notice/communication
    std::map<std::string, state_value_variant> extra_configs; // Additional configuration
};
```

### Player Table

```cpp
struct player_item {
    eosio::name player;                   // Player account name
    uint16_t reward_perc_x_100;           // Percentage of winnings allocated
    uint16_t shards_perc_x_100;           // Percentage of shards allocated
    uint32_t live_score;                  // Current live score
    bool claimed;                         // Whether rewards have been claimed
};
```

## Competition Lifecycle

### 1. Competition Creation

#### `initcomp` Action

**Purpose**: Initialize a new competition

**Parameters**:

- `admin`: Administrator account name
- `title`: Competition title
- `description`: Competition description
- `admin_pay_perc_x_100`: Admin's percentage of winnings (0-10000 for 0-100%)
- `start_time`: Competition start time
- `end_time`: Competition end time
- `min_players`: Minimum required players
- `max_players`: Maximum allowed players
- `allow_late_reg`: Allow late registration after start time
- `image`: Competition image URL (HTTPS only, max 512 chars)
- `url`: Competition URL (HTTPS only, max 512 chars)

**Requirements**:

- Start time must be in the future and after minimum prepare duration
- End time must be after start time
- Image and URL must use HTTPS protocol
- Admin account must exist

### 2. Player Registration

#### `regplayer` Action

**Purpose**: Register a player for a competition

**Parameters**:

- `id`: Competition ID
- `player`: Player account name
- `current_time`: Current timestamp

**Requirements**:

- Competition must be in `preparing` state
- Player must not already be registered
- Competition must not have started (unless late registration is allowed for competition)
- Maximum player limit must not be reached
- For late registration: competition allows late reg and is in `playing` state

### 3. Adding Prizes

#### `addshards` Action to add to the shard prize pool

**Purpose**: Add shard prizes to a competition

**Parameters**:

- `id`: Competition ID
- `shards`: Number of shards to add

**Requirements**:

- Competition must be in `preparing` or `playing` state
- Must be called by the competitions contract account

#### `TLM transfer` for TLM Prize Funding

**Purpose**: Add TLM prizes to a competition

Prizes are funded through standard TLM token transfers to the `comp.worlds` contract with the competition id as the memo. Each tournament could have many sponsors and the total prize pool is the sum of all TLM transferred to the `comp.worlds` contract with the competition id as the memo.

_**Note:**
If a competition is rejected, the prize TLM will be returned to each of the accounts that sent the TLM to the `comp.worlds` contract. This is designed to provide confidence for any tournmant sponsors that their funds will be returned if the competition is not completed or is fraudulent._

### 4. Competition Management

#### `updatestate` Action

**Purpose**: Update competition state based on time and conditions

**Parameters**:

- `id`: Competition ID
- `current_time`: Current timestamp

**State Transitions**:

- `preparing` → `playing`: When start time is reached and minimum players are registered
- `playing` → `processing`: When end time is reached
- `processing` → `auditing`: After results are processed
- `auditing` → `rewarding`: After approval
- `rewarding` → `complete`: When all rewards are claimed

### 5. Live Scoring

#### `scoreset` Action

**Purpose**: Set live scores for multiple players

**Parameters**:

- `id`: Competition ID
- `scores`: Array of {player, score} pairs
- `current_time`: Current timestamp

#### `scoreincr` Action

**Purpose**: Increment scores for multiple players

**Parameters**:

- `id`: Competition ID
- `increments`: Array of {player, increment} pairs
- `current_time`: Current timestamp

**Requirements**:

- Competition must be in `playing` state
- Must be called by the tournament admin (admin)

### 6. Winner Declaration

#### `declwinner` Action

**Purpose**: Declare winners and allocate prizes

**Parameters**:

- `id`: Competition ID
- `winner`: Winning player account name
- `winnings_perc_x_100`: Percentage of winnings for the winner
- `shards_perc_x_100`: Percentage of shards for the winner

**Requirements**:

- Competition must be in `processing` state
- Total allocation must not exceed budget
- Must be called by the tournament admin (admin)

### 7. Reward Processing

#### `claimreward` Action

**Purpose**: Allow players to claim their rewards

**Parameters**:

- `id`: Competition ID
- `player`: Player account name

**Requirements**:

- Competition must be in `rewarding` state
- Player must have rewards allocated
- Player must not have already claimed

#### `completeproc` Action

**Purpose**: Complete the competition processing

**Parameters**:

- `id`: Competition ID

**Requirements**:

- Competition must be in `rewarding` state
- All prizes must be fully allocated
- Must be called by the tournament admin (admin)

### 8. Dispute Resolution

#### `dispute` Action

**Purpose**: Initiate a dispute during auditing

**Parameters**:

- `id`: Competition ID
- `reason`: Dispute reason

**Requirements**:

- Competition must be in `auditing` state
- Must be called by the tournament admin (admin) or delegated auditor

#### `approve` Action

**Purpose**: Approve competition results after auditing

**Parameters**:

- `id`: Competition ID

**Requirements**:

- Competition must be in `auditing` state
- Must be called by the tournament admin (admin) or delegated auditor

### 9. Competition Rejection

#### `reject` Action

**Purpose**: Reject a competition and return funds

**Parameters**:

- `id`: Competition ID
- `reason`: Rejection reason

**Requirements**:

- Competition must not be in `complete` state
- Must be called by the tournament admin (admin) or delegated auditor

### 10. Competition Deletion

#### `deletecomp` Action

**Purpose**: Delete a competition from the system

**Parameters**:

- `id`: Competition ID
- `delay`: Deletion delay in seconds

**Requirements**:

- Competition must be in `rejected` or `complete` state
- Must be called by the tournament admin (admin)

## Admin Functions

### Global Configuration

#### `setmindur` Action

**Purpose**: Set minimum preparation duration for competitions

**Parameters**:

- `seconds`: Minimum preparation duration in seconds

### Communication

#### `postnotice` Action

**Purpose**: Post a notice to competition participants

**Parameters**:

- `id`: Competition ID
- `message`: Notice message

## Best Practices for Administrators

### Competition Setup

1. **Plan timing carefully**: Ensure sufficient preparation time and clear end time
2. **Set appropriate player limits**: Balance competition size with prize pool
3. **Use clear descriptions**: Help players understand competition rules
4. **Test thoroughly**: Use the test environment before deploying to production

### Prize Management

1. **Fund prizes early**: Transfer TLM and shards before competition starts
2. **Monitor allocations**: Ensure prizes are fully allocated before completion
3. **Consider shard distribution**: Plan how shards will be distributed among players

### Player Management

1. **Communicate clearly**: Use notices to keep players informed
2. **Monitor registration**: Ensure minimum player requirements are met
3. **Handle disputes promptly**: Address any issues during the auditing phase

### Security Considerations

1. **Use HTTPS URLs**: Ensure all image and URL links are secure
2. **Validate inputs**: Check all parameters before processing
3. **Monitor state transitions**: Ensure competitions follow the correct lifecycle

## Tournament User Interface

The Alien Worlds Tournament UI provides a centralized hub for players to discover, join, and claim rewards from competitions.

### 1. Tournament Discovery

Tournaments are categorized into functional tabs based on their current state in the contract:

- **Upcoming**: Displays tournaments in the `preparing` state that are open for registration or scheduled to start.
- **Live**: Displays tournaments in the `playing` state that the user is either already registered for, or can still join (if `allow_late_reg` is true).
- **Processing**: Covers tournaments in `processing` and `auditing` states where the user was a participant.
- **Get Rewards**: Matches the `rewarding` state. This tab is filtered to show only tournaments where the current user is registered and eligible for prizes.
- **Completed**: Lists finished tournaments in the `complete` state that the user participated in.

### 2. Tournament Cards

Each tournament is represented by a card showing:

- **Title & ID**: The name and unique contract ID of the competition.
- **Status & Timing**: Start and end dates.
- **Rewards**: The total TLM and Shard prize pools.
- **Participation**: Current number of registered players vs. the maximum limit.

### 3. Detailed View

Clicking "View details" on any tournament card opens a modal with:

- **Full Description**: Detailed rules and goals as set during `initcomp`.
- **Exact Timestamps**: Precise start and end times in UTC.
- **Tournament Link**: An external link to the specific game or platform where the competition takes place.
- **Prize Breakdown**: Detailed information on how rewards are distributed.

### 4. Player Actions

- **Registering and Participating**: The **"Visit"** button directs players to the external tournament URL where they can register for the competition (if in the `preparing` state) and participate in the gameplay.
- **Claiming Rewards**: While available rewards are listed in the **"Get Rewards"** tab, players must use the **"Visit"** button to navigate to the external tournament interface to trigger the `claimreward` action.

# Competition Admin Life Cycle Tutorial

This tutorial guides administrators through the complete competition management process:

### 1. Creating a Competition

**Step 1**: Use the `initcomp` action to create a new competition

```javascript
const current_time = Math.floor(Date.now() / 1000);

const action = contract.action('initcomp', {
  admin: 'gamedev',
  title: 'Battle Royale',
  description:
    'Up to 10 players compete for TLM prizes. The winner gets 50% of the prize pool, the second place gets 25%, and the third place gets 12.5%.',
  admin_pay_perc_x_100: 1500, // 1.5% of the prize pool goes to the admin
  start_time: current_time + 3600 * 24 * 7,
  end_time: current_time + 3600 * 24 * 14,
  min_players: 10,
  max_players: 40,
  allow_late_reg: true, // allows players to join after the competition has started
  image: 'https://example.com/battle.jpg',
  url: 'https://example.com/battle',
});
```

**Key Considerations**:

- Set realistic time windows
- Allocate appropriate prize percentages
- Enable late registration if it makes sense for the competition to have players join after the competition has started.
- Add a description that is clear and concise and helps players understand the competition rules. This will also guide the auditor in determining if the competition was run fairly before approving the player rewards.

### 2. Starting the Competition

Once the minimum players register and start time is reached, the competition will automatically transition to the Playing state. This should be triggered by a periodic cronjob that updates the state of all competitions so should not be a concern for the tournament admin.

### 3. Live Scoring

During the Playing state, use `scoreset` or `scoreincr` to update player scores. This is for transparently updating the scores of the players in the competition. The tournament admin can call this as often as needed during the competition. The scores could be used to help determine the winners of the competition but there is not direct logic coupled to this action. The tournament admin can use this data to determine the winners and then use the `declwinner` action to allocate the prizes. This data may be surfaced by the community to create leaderboards for the competition in a re-usable way.

```javascript
const action = contract.action('scoreset', {
  id: 1,
  scores: [
    { player: 'player1', score: 100 },
    { player: 'player2', score: 95 },
  ],
  current_time: current_time,
});
```

```javascript
const action = contract.action('scoreincr', {
  id: 1,
  increments: [
    { player: 'player1', increment: 5 },
    { player: 'player2', increment: 3 },
  ],
  current_time: current_time,
});
```

### 4. Declaring Winners

After the competition ends, use `declwinner` to allocate prizes

```javascript
const action = contract.action('declwinner', {
  id: 1,
  winner: 'player1',
  winnings_perc_x_100: 5000,
  shards_perc_x_100: 5000,
});
```

**Allocation Rules**:

- Total winnings allocation must not exceed 100%
- The competition cannot transition to the complete state until 100% of the rewards have been declared (minus the admin's cut).

### 5. Completing Processing

Call `completeproc` to finalize the competition

```javascript
const action = contract.action('completeproc', { id: 1 });
```

### 6. Handling Disputes

If an auditor disputes the results, they can use `dispute` to revert to `Processing` state.

Then the tournament admin can resolve the issue by using `declwinner` to fix the scores and winners. While in the processing state, the tournament admin can call this many times as needed to resolve the issue.
Use `approve` to move to `Auditing` again for the auditor to review the changes and approve the results.

In extreme cases the auditor can use `reject` to reject the competition and return the funds to the tournament sponsors. This should only be reserved for extreme circumstances such as fraudulent activity.

### 7. Claiming Rewards

Players claim rewards using `claimreward`. This can be done by the player or the tournament admin for convenience.

```javascript
const action = contract.action('claimreward', { id: 1, player: 'player1' });
```

Once all rewards are claimed, the competition will automatically transition to the `Complete` state.

**Requirements**:

- Competition must be in Rewarding state
- Player must have allocated rewards

## Conclusion

This tutorial provides a complete walkthrough of competition administration in the Alien Worlds ecosystem. By following these steps, tournament administrators can effectively manage competitions from creation through reward distribution while maintaining system integrity and player satisfaction.
