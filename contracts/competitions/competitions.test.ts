import {
  Account,
  AccountManager,
  Asset,
  ContractDeployer,
  EOSManager,
  UpdateAuth,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  assertRowCount,
  assertRowsEqual,
  sleep,
} from 'lamington';

import { Competitions } from './competitions';
import { TlmToken } from '../tlm.token/tlm.token';
import { assert } from 'chai';
import { SharedTestObjects } from '../TestHelpers';

const COMP_STATE_PREPARING = 'preparing';
const COMP_STATE_1_PLAYING = '1.playing';
const COMP_STATE_2_PROCESSING = '2.processing';
const COMP_STATE_3_AUDITING = '3.auditing';
const COMP_STATE_4_REWARDING = '4.rewarding';
const COMP_STATE_5_COMPLETE = '5.complete';
const COMP_STATE_REJECTED = 'rejected';

const TEST_IMAGE = 'https://test.com/image.jpg';
const TEST_URL = 'https://test.com';

import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

function timePlusSeconds(current: dayjs.Dayjs, seconds: number): Date {
  return current.add(seconds, 'seconds').utc(false).toDate();
}
function timePlusSecondsWithLocalOffset(
  current: dayjs.Dayjs,
  seconds: number
): Date {
  const offset = new Date().getTimezoneOffset() * 60 * 1000;
  return current
    .add(seconds, 'seconds')
    .subtract(offset)
    .utc(false)
    .set('millisecond', 0)
    .toDate();
}

describe('Competitions', () => {
  let competitions: Competitions;
  let tlmToken: TlmToken;
  let gamedev: Account;
  let player1: Account;
  let returnAccount: Account;
  let description =
    'Battle Royale game: Up to 10 players can compete for the full TLM prize. The winner will receive 50% off the shards and 50% of the TLM winnings. The remaining 50% will be distributed among the other players at the discretion of the game dev. The game will last for at least 60 minutes.';
  // let minDuration = 5;
  let minPlayers = 3;
  let maxPlayers = 10;
  let id = 1;
  let shards = 1000;
  let adminPay = 100; // 1% of winning budget
  let players: Account[];
  let shared: SharedTestObjects;
  let minPrepareDuration = 4;
  let currentBlockTime: dayjs.Dayjs;

  before(async () => {
    currentBlockTime = dayjs().utc();
    shared = await SharedTestObjects.getInstance();

    competitions = await ContractDeployer.deployWithName<Competitions>(
      'competitions',
      'competitions'
    );
    tlmToken = shared.eosioToken;

    await linkAuthsForCompetionsContract();

    gamedev = await AccountManager.createAccount('gamedev');
    player1 = await AccountManager.createAccount('player1');
    returnAccount = await AccountManager.createAccount('arena.worlds');
    players = await Promise.all(
      [...Array(11)].map(async (i) => {
        return await AccountManager.createAccount();
      })
    );
  });

  context('setMinPrepareDuration', async () => {
    it('should fail when not authorized', async () => {
      await assertMissingAuthority(
        competitions.setmindur(minPrepareDuration, { from: player1 })
      );
    });

    it('should set the min prepare duration', async () => {
      await competitions.setmindur(minPrepareDuration);

      await assertRowsEqual(competitions.globalsTable(), [
        {
          data: [
            {
              key: 'min_prepare_dur_seconds',
              value: ['uint32', minPrepareDuration],
            },
            // { key: 'next_id', value: ['uint64', 0] },
          ],
        },
      ]);
    });
  });

  context('initcomp', () => {
    it('should fail when admin account does not exist', async () => {
      await assertMissingAuthority(
        competitions.initcomp(
          'nonexistent',
          'title',
          description,
          adminPay,
          currentBlockTime.toDate(),
          currentBlockTime.toDate(),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          TEST_URL,
          { from: gamedev }
        )
      );
    });

    it('should fail with the wrong auth', async () => {
      await assertMissingAuthority(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          currentBlockTime.toDate(),
          currentBlockTime.toDate(),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          TEST_URL,
          { from: player1 }
        )
      );
    });

    it('should fail if start time is too soon', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 3),
          timePlusSeconds(currentBlockTime, 2),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          TEST_URL,
          { from: gamedev }
        ),
        'ERR::Start time must be in the future and after min prepare duration'
      );
    });

    it('should fail if start time later than end data', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 15),
          timePlusSeconds(currentBlockTime, 9),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          TEST_URL,
          { from: gamedev }
        ),
        'ERR::End time must be after start time'
      );
    });

    it('should initialize a new competition', async () => {
      await competitions.initcomp(
        gamedev.name,
        'title',
        description,
        adminPay,
        timePlusSeconds(currentBlockTime, 16),
        timePlusSeconds(currentBlockTime, 45),
        minPlayers,
        maxPlayers,
        false,
        timePlusSeconds(currentBlockTime, 0),
        TEST_IMAGE,
        TEST_URL,
        { from: gamedev }
      );
    });

    it('regplayer when game has already started: should fail', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.regplayer(
          id,
          player1.name,
          timePlusSeconds(currentBlockTime, 35),
          { from: player1 }
        ),
        'ERR::Competition has already started'
      );
    });

    it('should fail if image URL is not https', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 16),
          timePlusSeconds(currentBlockTime, 45),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          'http://test.com/image.jpg',
          TEST_URL,
          { from: gamedev }
        ),
        'ERR::Image URL must start with https://'
      );
    });

    it('should fail if image URL is too long', async () => {
      const longUrl = 'https://' + 'a'.repeat(512) + '.com';
      await assertEOSErrorIncludesMessage(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 16),
          timePlusSeconds(currentBlockTime, 45),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          longUrl,
          TEST_URL,
          { from: gamedev }
        ),
        'ERR::Image URL exceeds 512 characters'
      );
    });

    it('should fail if URL is not https', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 16),
          timePlusSeconds(currentBlockTime, 45),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          'http://test.com',
          { from: gamedev }
        ),
        'ERR::URL must start with https://'
      );
    });

    it('should fail if URL is too long', async () => {
      const longUrl = 'https://' + 'a'.repeat(512) + '.com';
      await assertEOSErrorIncludesMessage(
        competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 16),
          timePlusSeconds(currentBlockTime, 45),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          longUrl,
          { from: gamedev }
        ),
        'ERR::URL exceeds 512 characters'
      );
    });
  });

  context('addshards', () => {
    it('should add shards when in starting or playing state', async () => {
      assertMissingAuthority(
        competitions.addshards(id, shards, { from: player1 })
      );
    });
    it('should add shards', async () => {
      await competitions.addshards(id, shards, { from: competitions.account });
    });
  });

  context('update state', () => {
    it('should succeed', async () => {
      await competitions.updatestate(id, timePlusSeconds(currentBlockTime, 1), {
        from: gamedev,
      });
    });

    it('should update the state of the comp', async () => {
      await assertRowsEqual(
        competitions.compsTable({ scope: competitions.account.name }),
        [
          {
            id,
            admin: 'gamedev',
            title: 'title',
            description:
              'Battle Royale game: Up to 10 players can compete for the full TLM prize. The winner will receive 50% off the shards and 50% of the TLM winnings. The remaining 50% will be distributed among the other players at the discretion of the game dev. The game will last for at least 60 minutes.',
            winnings_budget: '0.0000 TLM',
            winnings_claimed: '0.0000 TLM',
            winnings_allocated_perc_x_100: 100,
            admin_pay_perc_x_100: 100,
            shards_budget: 1000,
            shards_allocated_perc_x_100: 0,
            shards_claimed: 0,
            start_time: timePlusSecondsWithLocalOffset(currentBlockTime, 16),
            end_time: timePlusSecondsWithLocalOffset(currentBlockTime, 45),
            min_players: 3,
            max_players: 10,
            num_players: 0,
            state: 'preparing',
            notice: '',
            extra_configs: [
              { key: 'image', value: ['string', TEST_IMAGE] },
              { key: 'url', value: ['string', TEST_URL] }
            ],
          },
        ]
      );
    });
  });

  context('transfer', () => {
    context('With unknown comp', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          tlmToken.transfer(
            shared.tokenIssuer.name,
            competitions.account.name,
            '1000.0000 TLM',
            '10',
            { from: shared.tokenIssuer }
          ),
          'ERR::COMP_NOT_FOUND::'
        );
      });
    });

    context('With valid comp', async () => {
      it('should succeed', async () => {
        await tlmToken.transfer(
          shared.tokenIssuer.name,
          competitions.account.name,
          '1000.0000 TLM',
          '1',
          { from: shared.tokenIssuer }
        );
        const competition = (await competitions.compsTable()).rows[0];
        assert.equal(competition.winnings_budget, '1000.0000 TLM');
      });
    });
  });

  context('regplayer', () => {
    it('should register a player when in starting state', async () => {
      await competitions.regplayer(
        id,
        player1.name,
        currentBlockTime.toDate(),
        {
          from: player1,
        }
      );
    });
    it('should have registered the player', async () => {
      await assertRowsEqual(
        competitions.playersTable({ scope: id.toString() }),
        [
          {
            player: player1.name,
            reward_perc_x_100: 0,
            shards_perc_x_100: 0,
            live_score: 0,
            claimed: false,
          },
        ]
      );
    });

    it('should fail when player already registered', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.regplayer(id, player1.name, currentBlockTime.toDate(), {
          from: player1,
        }),
        'ERR::Player is already registered for this competition.'
      );
    });
    it('should fail when after start time', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.regplayer(
          id,
          players[8].name,
          timePlusSeconds(currentBlockTime, 17),
          {
            from: players[8],
          }
        ),
        'ERR::Competition has already started.'
      );
    });
  });

  context('update live score before start play', async () => {
    it('should fail with complete error', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.scoreset(
          id,
          [
            { first: players[0].name, second: 10 },
            { first: players[1].name, second: 11 },
          ],
          timePlusSeconds(currentBlockTime, 10),
          { from: gamedev }
        ),
        'ERR::NOT_STARTED::Competition has not yet started.'
      );
    });
  });

  context('updatestate to reject comp', () => {
    before(async () => {
      await competitions.initcomp(
        gamedev.name,
        'title',
        description,
        adminPay,
        timePlusSeconds(currentBlockTime, 5),
        timePlusSeconds(currentBlockTime, 45),
        minPlayers,
        maxPlayers,
        false,
        timePlusSeconds(currentBlockTime, 0),
        TEST_IMAGE,
        TEST_URL,
        { from: gamedev }
      );
      // without enough players this should reject
      await competitions.updatestate(2, timePlusSeconds(currentBlockTime, 6), {
        from: gamedev,
      });
    });
    context('without enough players', () => {
      it('should update the state of the comp to rejected', async () => {
        await assertRowsEqual(
          competitions.compsTable({
            scope: competitions.account.name,
            lowerBound: 2,
            upperBound: 2,
          }),
          [
            {
              id: 2,
              admin: 'gamedev',
              title: 'title',
              description:
                'Battle Royale game: Up to 10 players can compete for the full TLM prize. The winner will receive 50% off the shards and 50% of the TLM winnings. The remaining 50% will be distributed among the other players at the discretion of the game dev. The game will last for at least 60 minutes.',
              winnings_budget: '0.0000 TLM',
              winnings_allocated_perc_x_100: 100,
              winnings_claimed: '0.0000 TLM',
              admin_pay_perc_x_100: 100,
              shards_budget: 0,
              shards_allocated_perc_x_100: 0,
              shards_claimed: 0,
              start_time: timePlusSecondsWithLocalOffset(currentBlockTime, 5),
              end_time: timePlusSecondsWithLocalOffset(currentBlockTime, 45),
              min_players: 3,
              max_players: 10,
              num_players: 0,
              state: 'rejected',
              notice: '',
              extra_configs: [
                { key: 'image', value: ['string', TEST_IMAGE] },
                { key: 'url', value: ['string', TEST_URL] }
              ],
            },
          ]
        );
      });
    });
  });

  context('after registering enough players to start', () => {
    before(async () => {
      for (let idx = 0; idx < 9; idx++) {
        await competitions.regplayer(
          id,
          players[idx].name,
          timePlusSeconds(currentBlockTime, 5),
          {
            from: players[idx],
          }
        );
      }
    });
    context('with max players', () => {
      it('register payer should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.regplayer(
            id,
            players[10].name,
            timePlusSeconds(currentBlockTime, 5),
            { from: players[10] }
          ),
          'ERR:: The maximum number of players are already registered.'
        );
      });
      it('should still be preparing', async () => {
        await competitions.updatestate(
          id,
          timePlusSeconds(currentBlockTime, 10),
          { from: gamedev }
        );
        const competition = (
          await competitions.compsTable({ lowerBound: 1, upperBound: 1 })
        ).rows[0];
        assert.equal(competition.state, COMP_STATE_PREPARING);
      });
    });
    context('with enough players registered and start time passed', () => {
      it('should start play', async () => {
        await competitions.updatestate(
          id,
          timePlusSeconds(currentBlockTime, 17),
          { from: gamedev }
        );
        const competition = (
          await competitions.compsTable({ lowerBound: 1, upperBound: 1 })
        ).rows[0];
        assert.equal(competition.state, COMP_STATE_1_PLAYING);
      });
    });
  });

  // add tests for updating live scores during play
  context('update live score during play', async () => {
    let id: number;
    before(async () => {
      const competition = (
        await competitions.compsTable({ lowerBound: 1, upperBound: 1 })
      ).rows[0];
      id = competition.id as number;
    });
    context('with wrong auth ', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          competitions.scoreset(
            id,
            [
              { first: players[0].name, second: 10 },
              { first: players[1].name, second: 11 },
            ],
            timePlusSeconds(currentBlockTime, 15),
            { from: player1 }
          )
        );
      });
      it('should fail', async () => {
        await assertMissingAuthority(
          competitions.scoreincr(
            id,
            [
              { first: players[0].name, second: 3 },
              { first: players[1].name, second: 4 },
            ],
            timePlusSeconds(currentBlockTime, 15),
            { from: player1 }
          )
        );
      });
    });
    context('with correct auth', () => {
      it('should succeed', async () => {
        await competitions.scoreset(
          id,
          [
            { first: players[0].name, second: 10 },
            { first: players[1].name, second: 11 },
          ],
          timePlusSeconds(currentBlockTime, 17),
          { from: gamedev }
        );
        await competitions.scoreincr(
          id,
          [
            { first: players[0].name, second: 3 },
            { first: players[1].name, second: 4 },
          ],
          timePlusSeconds(currentBlockTime, 18),
          { from: gamedev }
        );
      });
      it('should update players table', async () => {
        let playersTable = await competitions.playersTable({
          scope: id.toString(),
          lowerBound: players[0].name,
          upperBound: players[0].name,
        });
        assert.equal(playersTable.rows[0].live_score, 13);
        playersTable = await competitions.playersTable({
          scope: id.toString(),
          lowerBound: players[1].name,
          upperBound: players[1].name,
        });
        assert.equal(playersTable.rows[0].live_score, 15);
      });
    });
  });
  context('update live score after complete play', async () => {
    it('should fail with complete error', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.scoreset(
          id,
          [
            { first: players[0].name, second: 10 },
            { first: players[1].name, second: 11 },
          ],
          timePlusSeconds(currentBlockTime, 50),
          { from: gamedev }
        ),
        'ERR::ENDED::Competition has completed playing.'
      );
    });
  });

  context('after comp time has passed', () => {
    it('should succeed', async () => {
      await competitions.updatestate(
        id,
        timePlusSeconds(currentBlockTime, 50),
        { from: gamedev }
      );
    });
    it('should move to the processing state', async () => {
      const competition = (await competitions.compsTable()).rows[0];
      assert.equal(competition.state, COMP_STATE_2_PROCESSING);
    });

    context('When not in preparing or playing state', () => {
      it('adding shards should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.addshards(id, shards),
          'ERR:: Invalid state to add to the winnings'
        );
      });
      it('adding TLM to winnings should fail', async () => {
        await assertEOSErrorIncludesMessage(
          tlmToken.transfer(
            shared.tokenIssuer.name,
            competitions.account.name,
            '1000.0000 TLM',
            id.toString(),
            { from: shared.tokenIssuer }
          ),
          'ERR:: Invalid state to add to the winnings'
        );
      });
      it('should fail to claim reward', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.claimreward(id, player1.name, { from: player1 }),
          'ERR::Not in the required state of `rewarding`.'
        );
      });
    });
  });

  context('process rewards', () => {
    context('with wrong permissions', () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          competitions.declwinner(
            id,
            players[2].name,
            5000, // 50%
            1000,
            timePlusSeconds(currentBlockTime, 55),
            {
              from: player1,
            }
          )
        );
      });
    });
    context('for unknown comp', () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.declwinner(
            10,
            players[2].name,
            5000, // 50%
            1000, // 10%
            timePlusSeconds(currentBlockTime, 55),
            {
              from: gamedev,
            }
          ),
          'ERR::No competition with the provided ID'
        );
      });
    });
    context('for known comp', () => {
      it('should succeed', async () => {
        await competitions.declwinner(
          id,
          player1.name,
          5000, // 50%
          1000, // 10%
          timePlusSeconds(currentBlockTime, 55),
          {
            from: gamedev,
          }
        );
      });
    });
    context('when not in rewarding state', () => {
      it('should fail to claim reward', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.claimreward(id, player1.name, { from: player1 }),
          'ERR::Not in the required state of `rewarding`.'
        );
      });
    });
    context('when in rewarding state', () => {
      it('should fail fail to reg player', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.regplayer(
            id,
            player1.name,
            timePlusSeconds(currentBlockTime, 56),
            { from: player1 }
          ),
          'ERR::Not in the required state of `preparing`'
        );
      });
    });
  });

  context('completeproc', () => {
    context('with wrong permissions', () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          competitions.completeproc(id, { from: player1 })
        );
      });
    });
    context('for unknown comp', () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.completeproc(10, { from: gamedev }),
          'ERR::No competition with the provided ID'
        );
      });
    });
    context('Without enough TLM distributed', () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.completeproc(id, { from: gamedev }),
          'ERR::Winnings have not been fully allocated. Missing: 49.000000%'
        );
      });
    });
    context('With enough TLM distributed', () => {
      before(async () => {
        await competitions.declwinner(
          id,
          players[2].name,
          4900, // 49%
          0,
          timePlusSeconds(currentBlockTime, 57),
          {
            from: gamedev,
          }
        );
      });
      it('should fail with shard distribution error', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.completeproc(id, { from: gamedev }),
          'ERR::Shards have not been fully allocated. Missing: 90.000000%'
        );
      });
    });
    context('Adding more TLM than budgeted', () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.declwinner(
            id,
            players[3].name,
            2000,
            1000,
            timePlusSeconds(currentBlockTime, 57),
            {
              from: gamedev,
            }
          ),
          'ERR:Exceeded winnings_budget allocation'
        );
      });
    });
    context('Adding more shards than budgeted', () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.declwinner(
            id,
            players[3].name,
            0,
            20000,
            timePlusSeconds(currentBlockTime, 57),
            {
              from: gamedev,
            }
          ),
          'ERR:Exceeded shard allocation'
        );
      });
    });
    context('when not in rewarding state', () => {
      it('should fail to claim reward', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.claimreward(id, player1.name, { from: player1 }),
          'ERR::Not in the required state of `rewarding`.'
        );
      });
    });
    context('With enough TLM and Shard distributed', () => {
      before(async () => {
        await competitions.declwinner(
          id,
          players[4].name,
          0,
          9000, // 90%
          timePlusSeconds(currentBlockTime, 57),
          {
            from: gamedev,
          }
        );
      });
      it('should succeed', async () => {
        await competitions.completeproc(id, { from: gamedev });
        const competition = (await competitions.compsTable()).rows[0];
        assert.equal(competition.state, COMP_STATE_3_AUDITING);
      });
    });

    context('when not in rewarding state', () => {
      it('should fail to claim reward', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.claimreward(id, player1.name, { from: player1 }),
          'ERR::Not in the required state of `rewarding`.'
        );
      });
    });
  });

  context('dispute', () => {
    it('should fail with wrong permissions', async () => {
      await assertMissingAuthority(
        competitions.dispute(id, "Doesn't look fair", { from: gamedev })
      );
    });
    it('should move to disputing state when in auditing state', async () => {
      await competitions.dispute(id, "Doesn't look fair");
      const competition = (await competitions.compsTable()).rows[0];
      assert.equal(competition.state, COMP_STATE_2_PROCESSING);
    });
    it('should allow moving to auditing state again', async () => {
      await competitions.completeproc(id, { from: gamedev });
      const competition = (await competitions.compsTable()).rows[0];
      assert.equal(competition.state, COMP_STATE_3_AUDITING);
      assert.equal(competition.notice, "Doesn't look fair");
    });
  });

  context('approve', () => {
    context('with wrong permissions', () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          competitions.approve(id, { from: gamedev })
        );
      });
    });
    context('when in auditing state', () => {
      it('should move to rewarding state', async () => {
        await competitions.approve(id);
        const competition = (await competitions.compsTable()).rows[0];
        assert.equal(competition.state, COMP_STATE_4_REWARDING);
      });
    });
    context('when not in auditing state', () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          competitions.approve(id),
          'ERR::Not in the required state of `auditing`.'
        );
      });
    });
  });

  context('claim reward', () => {
    let reason = 'rejecting the comp for a good reason';
    it('should reward the winner', async () => {
      const playerBefore = (
        await competitions.playersTable({
          scope: id.toString(),
          lowerBound: player1.name,
          upperBound: player1.name,
        })
      ).rows[0];
      assert.equal(playerBefore.claimed, false);
      await competitions.claimreward(id, player1.name, { from: player1 });
      const playerAfter = (
        await competitions.playersTable({
          scope: id.toString(),
          lowerBound: player1.name,
          upperBound: player1.name,
        })
      ).rows[0];
      assert.equal(playerAfter.claimed, true);
    });
    it('should not yet complete the comp', async () => {
      const competition = (await competitions.compsTable()).rows[0];
      assert.equal(competition.state, COMP_STATE_4_REWARDING);
    });

    it('should fail when player has already claimed reward', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.claimreward(id, player1.name, { from: player1 }),
        'ERR::Player has already claimed their reward.'
      );
    });
    it('should fail when player is not a winner', async () => {
      await assertEOSErrorIncludesMessage(
        competitions.claimreward(id, players[5].name, { from: players[5] }),
        'ERR::Player has no rewards to claim.'
      );
    });
    context('After the remaining winners have claimed', () => {
      before(async () => {
        await competitions.claimreward(id, players[2].name, {
          from: players[2],
        });
        await competitions.claimreward(id, players[4].name, {
          from: players[4],
        });
      });

      it('should complete the competition', async () => {
        const competition = (await competitions.compsTable()).rows[0];
        assert.equal(competition.state, COMP_STATE_5_COMPLETE);
      });
      it('should no longer be possible to reject', async () => {
        const competition = (await competitions.compsTable()).rows[0];
        await assertEOSErrorIncludesMessage(
          competitions.reject(competition.id, reason, {
            from: gamedev,
          }),
          'ERR::Cannot reject a complete competition.'
        );
      });
    });
    context('reject', () => {
      let competitionId: number;

      beforeEach(async () => {
        // Initialize a new competition for each test case
        await competitions.initcomp(
          gamedev.name,
          'title',
          description,
          adminPay,
          timePlusSeconds(currentBlockTime, 5),
          timePlusSeconds(currentBlockTime, 10),
          minPlayers,
          maxPlayers,
          false,
          timePlusSeconds(currentBlockTime, 0),
          TEST_IMAGE,
          TEST_URL,
          { from: gamedev }
        );
        competitionId = (await competitions.compsTable()).rows.pop().id;
      });

      it('should fail to reject a completed competition', async () => {
        await competitions.regplayer(
          competitionId,
          player1.name,
          timePlusSeconds(currentBlockTime, 1),
          {
            from: player1,
          }
        );
        for (let idx = 0; idx < 3; idx++) {
          await competitions.regplayer(
            competitionId,
            players[idx].name,
            timePlusSeconds(currentBlockTime, 1),
            {
              from: players[idx],
            }
          );
        }

        await tlmToken.transfer(
          shared.tokenIssuer.name,
          competitions.account.name,
          '1000.0000 TLM',
          competitionId.toString(),
          { from: shared.tokenIssuer }
        );

        //start play
        await competitions.updatestate(
          competitionId,
          timePlusSeconds(currentBlockTime, 6),
          { from: gamedev }
        );
        //end play
        await competitions.updatestate(
          competitionId,
          timePlusSeconds(currentBlockTime, 11),
          { from: gamedev }
        );
        await competitions.declwinner(
          competitionId,
          player1.name,
          9900, // 99%
          0,
          timePlusSeconds(currentBlockTime, 20),
          {
            from: gamedev,
          }
        );
        await competitions.completeproc(competitionId, { from: gamedev });
        await competitions.approve(competitionId);
        await competitions.claimreward(competitionId, player1.name, {
          from: player1,
        });
        await assertEOSErrorIncludesMessage(
          competitions.reject(competitionId, reason, {
            from: gamedev,
          }),
          'ERR::Cannot reject a complete competition.'
        );
      });
      context('with no declared winnings', () => {
        let rejectedCompId: number;
        before(async () => {
          // Create a new competition for testing rejection
          await competitions.initcomp(
            gamedev.name,
            'title',
            'test no declared winnings return',
            adminPay,
            timePlusSeconds(currentBlockTime, 5),
            timePlusSeconds(currentBlockTime, 15),
            minPlayers,
            maxPlayers,
            false,
            timePlusSeconds(currentBlockTime, 0),
            TEST_IMAGE,
            TEST_URL,
            { from: gamedev }
          );
          rejectedCompId = (await competitions.compsTable()).rows.find(
            (comp) => comp.description === 'test no declared winnings return'
          )!.id;
        });

        it('should fail when not authorized', async () => {
          await assertMissingAuthority(
            competitions.reject(rejectedCompId, reason, { from: player1 })
          );
        });

        it('should reject the competition and change the state to COMP_STATE_REJECTED', async () => {
          await competitions.reject(rejectedCompId, reason, {
            from: gamedev,
          });
          const competition = (await competitions.compsTable()).rows.find(
            (comp) => comp.id === rejectedCompId
          );
          assert.equal(competition.state, COMP_STATE_REJECTED);
        });
      });
      context('with declared winnings', () => {
        let rejectedCompId: number;
        before(async () => {
          await competitions.initcomp(
            gamedev.name,
            'title',
            'test declared winnings return',
            adminPay,
            timePlusSeconds(currentBlockTime, 5),
            timePlusSeconds(currentBlockTime, 15),
            minPlayers,
            maxPlayers,
            false,
            timePlusSeconds(currentBlockTime, 0),
            TEST_IMAGE,
            TEST_URL,
            { from: gamedev }
          );

          const res = await competitions.compsTable();
          rejectedCompId = res.rows.find(
            (comp) => comp.description === 'test declared winnings return'
          )!.id;

          await competitions.regplayer(
            rejectedCompId,
            player1.name,
            timePlusSeconds(currentBlockTime, 2),
            {
              from: player1,
            }
          );
          for (let idx = 0; idx < 3; idx++) {
            await competitions.regplayer(
              rejectedCompId,
              players[idx].name,
              timePlusSeconds(currentBlockTime, 2),
              {
                from: players[idx],
              }
            );
          }

          await tlmToken.transfer(
            shared.tokenIssuer.name,
            competitions.account.name,
            '1000.0000 TLM',
            rejectedCompId.toString(),
            { from: shared.tokenIssuer }
          );

          await tlmToken.transfer(
            player1.name,
            competitions.account.name,
            '550.0000 TLM',
            rejectedCompId.toString(),
            { from: player1 }
          );

          //start play
          await competitions.updatestate(
            rejectedCompId,
            timePlusSeconds(currentBlockTime, 6),
            { from: gamedev }
          );
          //end play
          await competitions.updatestate(
            rejectedCompId,
            timePlusSeconds(currentBlockTime, 16),
            { from: gamedev }
          );

          await competitions.declwinner(
            rejectedCompId,
            player1.name,
            5000, // 50%
            0,
            timePlusSeconds(currentBlockTime, 45),
            {
              from: gamedev,
            }
          );
        });
        context('Post notice before rejecting', () => {
          it('should fail when not authorized', async () => {
            await assertMissingAuthority(
              competitions.postnotice(rejectedCompId, 'test', {
                from: player1,
              })
            );
          });
          it('should post a notice on the competition', async () => {
            await competitions.postnotice(rejectedCompId, 'test', {
              from: gamedev,
            });
            const competition = (await competitions.compsTable()).rows.find(
              (comp) => comp.id === rejectedCompId
            );
            assert.equal(competition.notice, 'test');
          });
        });
        context('When not in right state, deletecomp', () => {
          it('should fail', async () => {
            await assertEOSErrorIncludesMessage(
              competitions.deletecomp(rejectedCompId, 6, { from: gamedev }),
              'ERR::Cannot delete a competition that is not in the rejected or completed state'
            );
          });
        });
        context('After allocate and declare winners', async () => {
          let balanceBeforeRejectFederation: number;
          let balanceBeforeRejectPlayer1: number;

          before(async () => {
            balanceBeforeRejectFederation = await shared.getBalance(
              shared.tokenIssuer,
              tlmToken
            );

            balanceBeforeRejectPlayer1 = await shared.getBalance(
              player1,
              tlmToken
            );
          });
          it('should reject', async () => {
            await competitions.reject(rejectedCompId, reason, {
              from: gamedev,
            });
          });
          it('should transfer the winnings back to the correct return address', async () => {
            const returnBalanceFederation = await shared.getBalance(
              shared.tokenIssuer,
              tlmToken
            );
            assert.equal(
              balanceBeforeRejectFederation + 1000,
              returnBalanceFederation
            );

            const returnBalancePlayer1 = await shared.getBalance(
              player1,
              tlmToken
            );
            assert.equal(
              balanceBeforeRejectPlayer1 + 550,
              returnBalancePlayer1
            );
          });
          it('should reject the competition and change the state to COMP_STATE_REJECTED', async () => {
            const competition = (await competitions.compsTable()).rows.find(
              (comp) => comp.id === rejectedCompId
            );
            assert.equal(competition.state, COMP_STATE_REJECTED);
            assert.equal(competition.notice, reason);
          });
          it('should fail to post notice on rejected comp', async () => {
            await assertEOSErrorIncludesMessage(
              competitions.postnotice(rejectedCompId, 'test', {
                from: gamedev,
              }),
              'ERR::POST_NOTICE_COMPLETED'
            );
          });
        });
        context('deletecomp', () => {
          it('with wrong permissions should fail', async () => {
            await assertMissingAuthority(
              competitions.deletecomp(rejectedCompId, 6, { from: player1 })
            );
          });
          it('with right permissions should work', async () => {
            await assertRowCount(
              competitions.playersTable({
                scope: rejectedCompId.toString(),
              }),
              4
            );
            await competitions.deletecomp(rejectedCompId, 6, { from: gamedev });
            await assertRowCount(
              competitions.compsTable({
                lowerBound: rejectedCompId,
                upperBound: rejectedCompId,
              }),
              0
            );
            await assertRowCount(
              competitions.playersTable({
                scope: rejectedCompId.toString(),
              }),
              0
            );
          });
        });
      });
    });
    context('transfer', () => {
      it('should fail with invalid memo', async () => {
        await assertEOSErrorIncludesMessage(
          tlmToken.transfer(
            shared.tokenIssuer.name,
            competitions.account.name,
            '1000.0000 TLM',
            'test',
            {
              from: shared.tokenIssuer,
            }
          ),
          'ERR::INVALID_MEMO::'
        );
      });
    });
  });

  context('allow late reg competition', async () => {
    before(async () => {
      id = 17;
      await competitions.initcomp(
        gamedev.name,
        'title',
        description,
        adminPay,
        timePlusSeconds(currentBlockTime, 16),
        timePlusSeconds(currentBlockTime, 45),
        minPlayers,
        maxPlayers,
        true, // allow late reg
        timePlusSeconds(currentBlockTime, 0),
        TEST_IMAGE,
        TEST_URL,
        { from: gamedev }
      );
    });

    it('should update the state of the comp', async () => {
      await assertRowsEqual(
        competitions.compsTable({
          scope: competitions.account.name,
          lowerBound: id,
          upperBound: id,
        }),
        [
          {
            id,
            admin: 'gamedev',
            title: 'title',
            description:
              'Battle Royale game: Up to 10 players can compete for the full TLM prize. The winner will receive 50% off the shards and 50% of the TLM winnings. The remaining 50% will be distributed among the other players at the discretion of the game dev. The game will last for at least 60 minutes.',
            winnings_budget: '0.0000 TLM',
            winnings_claimed: '0.0000 TLM',
            winnings_allocated_perc_x_100: 100,
            admin_pay_perc_x_100: 100,
            shards_budget: 0,
            shards_allocated_perc_x_100: 0,
            shards_claimed: 0,
            start_time: timePlusSecondsWithLocalOffset(currentBlockTime, 16),
            end_time: timePlusSecondsWithLocalOffset(currentBlockTime, 45),
            min_players: 3,
            max_players: 10,
            num_players: 0,
            state: 'preparing',
            notice: '',
            extra_configs: [
              { key: 'allow_late_registration', value: [1, 'bool'] },
              { key: 'image', value: ['string', TEST_IMAGE] },
              { key: 'url', value: ['string', TEST_URL] }
            ],
          },
        ]
      );
    });

    it('should register min num of players initially', async () => {
      for (let idx = 0; idx < 3; idx++) {
        await competitions.regplayer(
          id,
          players[idx].name,
          timePlusSeconds(currentBlockTime, 5),
          {
            from: players[idx],
          }
        );
      }
    });

    it('should succeed and allow late reg', async () => {
      await competitions.regplayer(
        id,
        players[8].name,
        timePlusSeconds(currentBlockTime, 18),
        {
          from: players[8],
        }
      );
    });
  });

  async function linkAuthsForCompetionsContract() {
    await UpdateAuth.execUpdateAuth(
      competitions.account.active,
      competitions.account.name,
      'xfer',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(competitions.account)
    );

    await UpdateAuth.execLinkAuth(
      competitions.account.active,
      competitions.account.name,
      shared.eosioToken.name,
      'transfer',
      'xfer'
    );
    await UpdateAuth.execUpdateAuth(
      shared.userpoints.account.active,
      shared.userpoints.account.name,
      'usrpoints',
      'active',
      UpdateAuth.AuthorityToSet.explicitAuthorities(1, [
        {
          permission: {
            actor: shared.mining.account.name,
            permission: 'eosio.code',
          },
          weight: 1,
        },
        {
          permission: {
            actor: 'competitions',
            permission: 'eosio.code',
          },
          weight: 1,
        },
      ])
    );
  }
});
