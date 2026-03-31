#include "alwgladiator.hpp"
#include "../common/helpers.hpp"
#include <atomicassets-interface.hpp>
#include <atomicdata.hpp>
#include <eosio/crypto.hpp>
#include <eosio/eosio.hpp>
#include <eosio/multi_index.hpp>
#include <eosio/singleton.hpp>
#include <eosio/transaction.hpp>

#include <math.h>
#include <string>

using namespace eosio;
using namespace std;
using namespace alwgames;

CONTRACT alwgladiator : public contract {

  public:
    alwgladiator(name self, name code, datastream<const char *> ds)
        : contract(self, code, ds), _queue(self, self.value), _players(self, self.value), _matches(self, self.value),
          _combatData(self, self.value), _planet_configs(self, self.value) {
        _configs = config_singleton(self, self.value).get_or_create(self);
        _state   = state_singleton(self, self.value).get_or_create(self);
    }

    ~alwgladiator() {
        config_singleton(get_self(), get_self().value).set(_configs, get_self());
        state_singleton(get_self(), get_self().value).set(_state, get_self());
    }

    /**
     * @brief Set config on the contract including params for:
     *  - kValue used calculate the rating - default 40
     *  - starter rating for new players added to the game - default 1000
     *  - matchRating the closeness of rating required to match an opponent into a pending match
     *  - numberOfGamesPerRound in order to batch and re-use random number fetches matches are grouped into rounds.
     *  - deposit_required the amount of Trilium required to join a fight.
     * more.
     *
     * When numberOfGamesPerRound of pending matches has been queued this would trigger a random number request.
     *
     * @param newconfig
     */
    ACTION setconfig(configs newconfig) {
        require_auth(get_self());

        _configs = newconfig;
    }

    /**
     * @brief This action is meant intended for setting configs for a particular planet. At this stage the only varible
     * specific to a planet is the `arena_chance_to_win` which relates to each planet's chance of winning an NFT after
     * winning a game.
     *
     * @param config this is the config object to set. This requires the auth of the contract owner to set for a planet
     * for now.
     */
    ACTION setplntconf(PlanetConfig config) {
        require_auth(get_self());

        auto configItr = _planet_configs.find(config.planet_id.value);

        auto planetConfigSetter = [&](PlanetConfig &c) {
            c.planet_id           = config.planet_id;
            c.arena_chance_to_win = config.arena_chance_to_win;
        };

        if (configItr == _planet_configs.end()) {
            _planet_configs.emplace(get_self(), planetConfigSetter);
        } else {
            _planet_configs.modify(configItr, same_payer, planetConfigSetter);
        }
    }

    void request_rand(uint64_t matchRoundId) {

        print_f("request_rand: %", matchRoundId);

        auto     size   = transaction_size();
        char    *buffer = (char *)(512 < size ? malloc(size) : alloca(size));
        uint32_t read   = read_transaction(buffer, size);
        check(size == read, "ERR::READ_TRANSACTION_FAILED::read_transaction failed");
        checksum256 trx_id = sha256(buffer, read);

        uint64_t signing_value = 0;
        auto     trx_bytes     = trx_id.extract_as_byte_array();
        signing_value += (uint64_t)trx_bytes[0] << (7 * 8);
        signing_value += (uint64_t)trx_bytes[1] << (6 * 8);
        signing_value += (uint64_t)trx_bytes[2] << (5 * 8);
        signing_value += (uint64_t)trx_bytes[3] << (4 * 8);
        signing_value += (uint64_t)trx_bytes[4] << (3 * 8);
        signing_value += (uint64_t)trx_bytes[5] << (2 * 8);
        signing_value += (uint64_t)trx_bytes[6] << 8;
        signing_value += (uint64_t)trx_bytes[7];

        print_f("requesting rand %", matchRoundId);

        action(permission_level{get_self(), "random"_n}, RNG_CONTRACT, "requestrand"_n,
            make_tuple(matchRoundId, signing_value, get_self()))
            .send();
    }

    /**
     * @brief Actions to register a new player in the game. The player will be given a default rating based on the
     * game's current configs and a balance of 0 Trilium. On success a new record will added to the players table.
     * @throw Auth error Thrown without auth from the registering player.
     * @param player account name for a registering player
     */
    ACTION regplayer(name player) {
        require_auth(player);

        auto playerIdx = _players.find(player.value);
        if (playerIdx == _players.end()) {
            _players.emplace(player, [&](RatedPlayer &p) {
                p.player  = player;
                p.rating  = _configs.starterRating;
                p.balance = ZERO_TRILIUM;
            });
        }
    }

    /**
     * @brief Action to be called by player to join a match.
     * The player must own and provide the ids for a gladiator and 2 weapons.
     * The player will be added to the player queue until there is a matched opponent, according to rating.
     * When there is a matched opponent available this player and the first matched player will be added to the pending
     * matches table.
     * @throw Auth error Thrown without auth from the registering player.
     * @throw Player not is players table thrown if the player has not called regplayer first.
     * @throw Player must deposit to play thrown if the player has not transferred enough Trilium to play (based on the
     * configs)
     *
     * @param player - Eosio account name of the player. requires player's auth to perform this action.
     * @param avatarId - associated avatar id must be owned by the player
     * @param weapon1 - associated weapon id must be owned by the player
     * @param weapon2 - another associated weapon id must be owned by the player
     * @param planetName - The name of the planet for which they are choosing to fight for.
     */
    ACTION joinqueue(name player, name planetName, optional<uint64_t> minionId, optional<uint64_t> playerWeapon,
        optional<uint64_t> minionWeapon) {

        require_auth(player);

        combat_data_from_account(player, minionId, playerWeapon, minionWeapon, planetName);

        auto playerIdx = _players.require_find(player.value, "player must call 'regplayer' first");

        check(playerIdx->balance >= _configs.deposit_required,
            "Player must first deposit the required amount to play instead.");

        uint32_t rating = playerIdx->rating;

        auto queuePlayerIdx = _queue.find(player.value);
        if (queuePlayerIdx != _queue.end()) {
            _queue.modify(queuePlayerIdx, same_payer, [&](QueuedPlayer &p) {
                p.queueIdx = _state.nextQueuePosition++;
            });
        } else {
            queuePlayerIdx = _queue.emplace(player, [&](QueuedPlayer &p) {
                p.player   = player;
                p.rating   = rating;
                p.queueIdx = _state.nextQueuePosition++;
            });
        }

        auto playersByQueue = _queue.get_index<QUEUE_IDX>();
        auto ittr           = _queue.begin();

        while (ittr != _queue.end()) {
            uint32_t itrRating = ittr->rating;
            eosio::print(
                "rating: ", itrRating, "lowerband: ", rating - _configs.matchRating, " itrRating: ", itrRating);

            if (ittr->player == player || itrRating < rating - _configs.matchRating ||
                itrRating > rating + _configs.matchRating) {
                ittr++;
                continue;
            }
            _matches.emplace(get_self(), [&](PendingMatch &m) {
                m.id           = _matches.available_primary_key();
                m.player1      = player;
                m.player2      = ittr->player;
                m.matchRoundId = _state.matchRoundId;
            });

            _state.numberPendingMatches++;
            _queue.erase(ittr);
            _queue.erase(queuePlayerIdx);

            // If there are enough queued matches trigger getting getting a random number and move to the next
            // round.
            if (_state.numberPendingMatches == _configs.numberOfGamesPerRound) {
                request_rand(_state.matchRoundId);
                print("trigger match");
                _state.numberPendingMatches = 0;
                _state.matchRoundId++;
            }
            break;
        }
    }

    ACTION refund(name player) {
        require_auth(player);

        auto playerIdx = _players.require_find(player.value, "player unregistered.");

        check(playerIdx->balance > ZERO_TRILIUM, "Player must have a greater than 0 balance to get a refund");
        auto queuePlayerIdx = _queue.find(player.value);
        check(queuePlayerIdx == _queue.end(), "Player cannot get a refund while being queued for a match");

        bool matchFound   = false;
        auto matchesIndex = _matches.begin();
        while (matchesIndex != _matches.end() && !matchFound) {
            if (matchesIndex->player1 == player || matchesIndex->player2 == player) {
                matchFound = true;
            }
            matchesIndex++;
        }
        check(!matchFound, "Player cannot get a refund while in a pending match.");

        auto transferTuple =
            make_tuple(get_self(), player, playerIdx->balance, string("refund player Trilium from game"));
        action(permission_level{get_self(), "transfer"_n}, TOKEN_CONTRACT, "transfer"_n, transferTuple).send();
        _players.modify(playerIdx, same_payer, [&](RatedPlayer &p) {
            p.balance *= 0;
        });
    }

    /**
     * @brief After a match has run this action is called as a inline action to record the win for the player.
     * Also update the stats and rating for each player in the match. The rating is modified based on the common
     * ranking algorythm. The winner is then granted 1.8 x the staked Trilium for the game and
     * @throw Throws error if either player is not in the players table. This should never happen
     * @param player1Name The account name for player 1
     * @param player2Name The account name for player 2
     * @param player1Win A boolean of true if player 1 was the winner
     * @param nftAwarded A boolean of true if the winning player was awarded an NFT. This is only for logging
     * in the chain history.
     */
    ACTION recordwin(name player1Name, name player2Name, bool player1Win, bool nftAwarded) {
        require_auth(get_self());

        auto player1 = _players.require_find(player1Name.value, "Player 1 not found in the players tables");
        auto player2 = _players.require_find(player2Name.value, "Player 2 not found in the players tables");

        auto  kValue                = _configs.kValue;
        float probabilityPlayer2Win = Probability(player1->rating, player2->rating);
        float probabilityPlayer1Win = Probability(player2->rating, player1->rating);

        _players.modify(player1, same_payer, [&](RatedPlayer &p) {
            int probReference = player1Win ? 1 : 0;
            p.rating += kValue * (probReference - probabilityPlayer1Win);
            p.numberOfMatches++;
            p.numberOfWins += probReference;
            if (player1Win) {
                p.balance = p.balance * 18 / 10;
            } else {
                p.balance *= 0;
            }
        });

        _players.modify(player2, same_payer, [&](RatedPlayer &p) {
            int probReference = player1Win ? 0 : 1;
            p.rating += kValue * (probReference - probabilityPlayer2Win);
            p.numberOfMatches++;
            p.numberOfWins += probReference;
            if (!player1Win) {
                p.balance = p.balance * 18 / 10;

            } else {
                p.balance *= 0;
            }
        });
    }
    using recordwin_action = action_wrapper<"recordwin"_n, &alwgladiator::recordwin>;

    /**
     * @brief This action is called by the random number provider to run a round of matches.
     *
     * @param matchRoundId - this should be the match round ID that was provided in the trigger match action.
     * @param random_value - the random value used for match play.
     */
    ACTION receiverand(uint64_t matchRoundId, checksum256 random_value) {

        require_auth(RNG_CONTRACT);
        auto    bytes_array = random_value.extract_as_byte_array();
        uint8_t byte        = 0;

        auto matchRoundIdx = _matches.get_index<MATCH_ROUND_IDX>();
        auto itrr          = matchRoundIdx.find(matchRoundId);

        while (itrr != matchRoundIdx.end() && itrr->matchRoundId == matchRoundId && byte < 28) {
            double rand1 = ((double)bytes_array[byte++] / 256.0) * 10.0;
            double rand2 = ((double)bytes_array[byte++] / 256.0) * 10.0;

            print_f("random value found : % %", rand1, rand2);

            combatData_table::const_iterator player1CombatData =
                _combatData.require_find(itrr->player1.value, "CombatData for player1 not found.");
            combatData_table::const_iterator player2CombatData =
                _combatData.require_find(itrr->player2.value, "CombatData for player2 not found.");

            bool player1DidWin = match(*player1CombatData, *player2CombatData, rand1, rand2);

            bool nftWasAwarded = false;

            if (player1DidWin) {
                nftWasAwarded = processWinner(*player1CombatData, rand1);
            } else {
                nftWasAwarded = processWinner(*player2CombatData, rand1);
            }

            recordMinionData(*player1CombatData, player1DidWin);
            recordMinionData(*player2CombatData, !player1DidWin);

            recordwin_action(get_self(), permission_level{get_self(), "recordwin"_n})
                .send(itrr->player1, itrr->player2, player1DidWin, nftWasAwarded);
            itrr = matchRoundIdx.erase(itrr);
            _combatData.erase(player1CombatData);
            _combatData.erase(player2CombatData);
        }
    }

    [[eosio::on_notify("atomicassets::logtransfer")]] void logtransfer(
        name collection_name, name from, name to, vector<uint64_t> asset_ids, string memo) {

        if (collection_name == NFT_COLLECTION) {
            auto fromItrr = _combatData.find(from.value);
            if (fromItrr != _combatData.end()) {
                for (auto id : asset_ids) {
                    check(
                        fromItrr->minion.id != id && fromItrr->playerWeapon.id != id && fromItrr->minionWeapon.id != id,
                        "Asset cannot be transferred while part of a match.");
                }
            }
        }
    }

    [[eosio::on_notify("*::transfer")]] void receive_token_transfer(name from, name to, asset quantity, string memo) {
        if (to != get_self() || from == get_self()) {
            return;
        }

        if (memo == "fightstake" && get_first_receiver() == TOKEN_CONTRACT && quantity.symbol == TLM_SYM) {
            auto playerIdx = _players.find(from.value);
            check(playerIdx != _players.end(), "player must register with regplayer before depositing TLM");
            _players.modify(playerIdx, same_payer, [&](RatedPlayer &p) {
                p.balance += quantity;
            });
        }
    }

  private:
    /**
     * @brief Awards an NFT to the winner if the supplied random number permits.
     *
     * @param winnerData This is the details for the winner that may receive winner's NFT.
     * @param randomValue
     * @return Returns true if an NFT was awarded - false otherwise.
     */
    bool processWinner(CombatData winnerData, uint8_t randomValue) {
        uint8_t chance = getArenaPercentageChance(winnerData.planetName);
        if (randomValue % 100 > chance) {
            return false;
        }
        awardNFT(winnerData.player, randomValue);

        return true;
    }

    void awardNFT(name player, uint8_t randomValue) {

        atomicdata::ATTRIBUTE_MAP immutable_attrs;
        atomicdata::ATTRIBUTE_MAP mutable_attrs;
        name                      schema;
        int32_t                   templateId;

        if (true /* create mionion NFT */) {
            schema     = MINION_SCHEMA;
            templateId = MINION_TEMPLATE_ID;
            minion newMinion{};
            immutable_attrs = newMinion.immutableAttributes();
            mutable_attrs   = newMinion.mutableAttributes();
        }

        vector<asset> quantities_to_back = {};

        // Mint the new asset, the mintassset listener will then set the avatar
        action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "mintasset"_n,
            make_tuple(get_self(), NFT_COLLECTION, schema, templateId, player, immutable_attrs, mutable_attrs,
                quantities_to_back))
            .send();
    }

    void recordMinionData(CombatData combatData, bool win) {
        auto minion = combatData.minion;
        minion.num_matches += 1;
        minion.num_wins += (win ? 1 : 0);

        atomicdata::ATTRIBUTE_MAP attrs = minion.mutableAttributes();

        action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "setassetdata"_n,
            make_tuple(get_self(), combatData.player, minion.id, attrs))
            .send();
    }

    /**
     * @brief Get the Arena Percentage Chance for winning an NFT
     *
     * @param planetName
     * @return uint8_t Returns the percentage chance for winning an NFT for the winner.
     */
    uint8_t getArenaPercentageChance(name planetName) {
        auto config =
            _planet_configs.get(planetName.value, "Planet config not found - must be set first via `setplntconf`");
        return config.arena_chance_to_win;
    };

    uint32_t weaponVsWeaponTypes(CombatData player1, CombatData player2, WeaponType p1Weapon, WeaponType p2Weapon) {
        uint32_t player1Score = 0, adv = 4;
        if (player1.playerWeapon.type == p1Weapon && player2.playerWeapon.type == p2Weapon)
            player1Score += adv;
        if (player1.minionWeapon.type == p1Weapon && player2.playerWeapon.type == p2Weapon)
            player1Score += adv;
        if (player1.playerWeapon.type == p1Weapon && player2.minionWeapon.type == p2Weapon)
            player1Score += adv;
        if (player1.minionWeapon.type == p1Weapon && player2.minionWeapon.type == p2Weapon)
            player1Score += adv;
        return player1Score;
    }

    uint32_t minionVsMinionTypes(CombatData player1, CombatData player2, WeaponType m1Type, WeaponType m2Type) {
        uint32_t player1Score = 0, adv = 4;
        if (player1.minion.type == m1Type && player2.minion.type == m2Type)
            player1Score += adv;
        return player1Score;
    }

    uint32_t minionVsMinionSpecies(CombatData player1, CombatData player2, Race m1Race, Race m2Race) {
        uint32_t player1Score = 0, adv = 3;
        if (player1.minion.race == m1Race && player2.minion.race == m2Race)
            player1Score += adv;
        return player1Score;
    }

    uint32_t minionVsWeaponTypes(CombatData player1, CombatData player2, WeaponType m1Type, WeaponType m2Type) {
        uint32_t player1Score = 0, adv = 3;
        if (player1.minion.type == m1Type && player2.playerWeapon.type == m2Type)
            player1Score += adv;
        if (player1.minion.type == m1Type && player2.minionWeapon.type == m2Type)
            player1Score += adv;
        if (player1.minion.type == m2Type && player2.playerWeapon.type == m1Type)
            player1Score -= adv;
        if (player1.minion.type == m2Type && player2.minionWeapon.type == m1Type)
            player1Score -= adv;
        return player1Score;
    }

    uint32_t allWeaponVsWeapon(CombatData p1, CombatData p2) {
        uint32_t p1Score = 0, adv = 3;
        p1Score += weaponVsWeaponTypes(p1, p2, NATURE, GEM);
        p1Score += weaponVsWeaponTypes(p1, p2, FIRE, METAL);
        p1Score += weaponVsWeaponTypes(p1, p2, GEM, AIR);
        p1Score += weaponVsWeaponTypes(p1, p2, AIR, FIRE);
        p1Score += weaponVsWeaponTypes(p1, p2, METAL, NATURE);
        return p1Score;
    }

    uint32_t allMinionVsMinionTypes(CombatData p1, CombatData p2) {
        uint32_t p1Score = 0;
        p1Score += minionVsMinionTypes(p1, p2, NATURE, GEM);
        p1Score += minionVsMinionTypes(p1, p2, FIRE, METAL);
        p1Score += minionVsMinionTypes(p1, p2, GEM, AIR);
        p1Score += minionVsMinionTypes(p1, p2, AIR, FIRE);
        p1Score += minionVsMinionTypes(p1, p2, METAL, NATURE);
        return p1Score;
    }

    uint32_t allMinionVsMinionSpecies(CombatData p1, CombatData p2) {
        uint32_t p1Score = 0;
        p1Score += minionVsMinionSpecies(p1, p2, Grey, Nordic);
        p1Score += minionVsMinionSpecies(p1, p2, Nordic, LGP);
        p1Score += minionVsMinionSpecies(p1, p2, LGP, Reptiloid);
        p1Score += minionVsMinionSpecies(p1, p2, Reptiloid, robotron);
        p1Score += minionVsMinionSpecies(p1, p2, robotron, Grey);
        return p1Score;
    }

    uint32_t allMinionVsWeaponType(CombatData p1, CombatData p2) {
        uint32_t p1Score = 0;
        p1Score += minionVsWeaponTypes(p1, p2, NATURE, GEM);
        p1Score += minionVsWeaponTypes(p1, p2, FIRE, METAL);
        p1Score += minionVsWeaponTypes(p1, p2, GEM, AIR);
        p1Score += minionVsWeaponTypes(p1, p2, AIR, FIRE);
        p1Score += minionVsWeaponTypes(p1, p2, METAL, NATURE);
        return p1Score;
    }

    uint32_t thunderdomePhase(CombatData player, WeaponType currentPhase) {
        uint32_t playerScore = 0;
        if (player.minion.type == currentPhase)
            playerScore += 3;
        if (player.playerWeapon.type == currentPhase)
            playerScore += 2;
        if (player.minionWeapon.type == currentPhase)
            playerScore += 2;
        return playerScore;
    }

    uint32_t generalContest(CombatData p1, CombatData p2, uint8_t randValue) {
        return randValue + p1.playerWeapon.attack + p1.minionWeapon.attack - p2.playerWeapon.defence -
               p2.minionWeapon.defence + p1.minion.attack + (p1.minion.defence * 1.3) - p1.minion.movecost;
    }

    WeaponType getCurrentPhase() {
        auto currentTimeHours = int32_t((time_point_sec().sec_since_epoch()) / 60.0);
        // WeaponType phase            = WeaponType((currentTimeHours % 6) + 1);
        WeaponType phase = WeaponType::METAL;
        print("Current phase: ", int32_t(phase));
        return phase;
    }

    bool match(CombatData player1, CombatData player2, uint8_t random1, uint8_t random2) {

        WeaponType currentPhase = getCurrentPhase();

        uint32_t player1Score = 0, player2Score = 0;

        // Weapon type vs Weapon type modifiers
        player1Score += allWeaponVsWeapon(player1, player2);
        player2Score += allWeaponVsWeapon(player2, player1);

        // Minion v Minion type Modifiers
        player1Score += allMinionVsMinionTypes(player1, player2);
        player2Score += allMinionVsMinionTypes(player2, player1);

        // Minion v Minion Species Modifiers
        player1Score += allMinionVsMinionSpecies(player1, player2);
        player2Score += allMinionVsMinionSpecies(player2, player1);

        // Minion and Weapon consistency modifier
        if (player1.minion.type == player1.minionWeapon.type)
            player1Score += 2;
        if (player2.minion.type == player2.minionWeapon.type)
            player2Score += 2;

        // Minion v Weapons type modifiers
        player1Score += allMinionVsWeaponType(player1, player2);
        player2Score += allMinionVsWeaponType(player2, player1);

        // Thunderdome Phase bonus
        player1Score += thunderdomePhase(player1, currentPhase);
        player2Score += thunderdomePhase(player2, currentPhase);

        // General contest
        print_f("rand1: % rand2: %", random1, random2);

        player1Score += generalContest(player1, player2, random1);
        player2Score += generalContest(player2, player1, random2);

        return player1Score >= player2Score;
    }

    struct data_with_schema {
        vector<uint8_t>            data;
        vector<atomicdata::FORMAT> format_lines;
    };

    weapon weapon_data_from_account(name account, uint64_t weaponId) {

        weapon wp;

        wp.id      = weaponId;
        auto attrs = get_data_with_schema(account, weaponId, WEAPONS_SCHEMA);
        for (auto attr : attrs) {
            if (attr.first == "type") {
                wp.type = std::get<uint8_t>(attr.second);
            } else if (attr.first == "attack") {
                wp.attack = std::get<uint8_t>(attr.second);
            } else if (attr.first == "defence") {
                wp.defence = std::get<uint8_t>(attr.second);
            }
        }

        return wp;
    }

    minion minion_from_account(name account, uint64_t minionId) {

        // data_with_schema dataAndSchema = get_data_with_schema(account, minionId, MINION_SCHEMA);

        minion m;
        m.id       = minionId;
        auto attrs = get_data_with_schema(account, minionId, MINION_SCHEMA);
        for (auto attr : attrs) {
            if (attr.first == "name") {
                m.name = std::get<string>(attr.second);
            } else if (attr.first == "type") {
                m.type = std::get<uint8_t>(attr.second);
            } else if (attr.first == "race") {
                m.race += std::get<uint8_t>(attr.second);
            } else if (attr.first == "attack") {
                m.attack = std::get<uint8_t>(attr.second);
            } else if (attr.first == "defence") {
                m.defence = std::get<uint8_t>(attr.second);
            } else if (attr.first == "movecost") {
                m.movecost = std::get<uint8_t>(attr.second);
            } else if (attr.first == "nummatches") {
                m.num_matches = std::get<uint32_t>(attr.second);
            } else if (attr.first == "numwins") {
                m.num_wins = std::get<uint32_t>(attr.second);
            }
        }
        return m;
    }

    void combat_data_from_account(name account, optional<uint64_t> minionId, optional<uint64_t> playerWeapon,
        optional<uint64_t> minionWeapon, name planetName) {
        CombatData cd;

        if (minionId.has_value()) {
            cd.minion = minion_from_account(account, minionId.value());
        } else {
            cd.minion = minion();
        }
        if (playerWeapon.has_value()) {
            cd.playerWeapon = weapon_data_from_account(account, playerWeapon.value());
        } else {
            cd.playerWeapon = weapon();
        }
        if (minionId.has_value()) {
            cd.minionWeapon = weapon_data_from_account(account, minionWeapon.value());
        } else {
            cd.minionWeapon = weapon();
        }

        auto combatDataIdx = _combatData.find(account.value);
        if (combatDataIdx == _combatData.end()) {
            _combatData.emplace(get_self(), [&](CombatData &c) {
                c.player       = account;
                c.minion       = cd.minion;
                c.playerWeapon = cd.playerWeapon;
                c.minionWeapon = cd.minionWeapon;
                c.planetName   = planetName;
            });
        } else {
            _combatData.modify(combatDataIdx, same_payer, [&](CombatData &c) {
                c.minion       = cd.minion;
                c.playerWeapon = cd.playerWeapon;
                c.minionWeapon = cd.minionWeapon;
                c.planetName   = planetName;
            });
        }
    }

    float Probability(int rating1, int rating2) { return 1.0 / (1 + 1.0 * pow(10, 1.0 * (rating1 - rating2) / 400)); }

    players_table       _players;
    queue_table         _queue;
    matches_table       _matches;
    state               _state;
    configs             _configs;
    combatData_table    _combatData;
    planet_config_table _planet_configs;
};