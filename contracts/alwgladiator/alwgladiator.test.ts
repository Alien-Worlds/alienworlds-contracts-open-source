import { assert } from 'chai';
import {
  ContractDeployer,
  assertRowsEqual,
  AccountManager,
  Account,
  assertRowCount,
  UpdateAuth,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  debugPromise,
} from 'lamington';
import * as chai from 'chai';

import { Alwgladiator, AlwgladiatorPlanetConfig } from './alwgladiator';
import { TlmToken } from '../tlm.token/tlm.token';
import { Atomicassets } from '../atomicassets-contracts/src/atomicassets';
import { Orngwax } from '../orngwax/orngwax';
import { Federation } from '../federation/federation';

const PLANET1 = 'planet1';
type weapon = { attack: number; defence: number; id: string; type: number };
type minion = {
  id: string;
  type: number;
  race: number;
  attack: number;
  defence: number;
  movecost: number;
  name: string;
  num_matches: number;
  num_wins: number;
};
import { SharedTestObjects } from '../TestHelpers';
let alwgladiator: Alwgladiator;
let atomicassets: Atomicassets;
let orngwax: Orngwax;
let eosdacTokens: TlmToken;
let tokenIssuer: Account;
let federation: Federation;

// let eosdacTokens.account: Account;

let users: {
  account: Account;
  minion: minion;
  weapons: weapon[];
}[];
let shared: SharedTestObjects;

describe('Alwgladiator', () => {
  before(async () => {
    shared = await SharedTestObjects.getInstance();
    alwgladiator = shared.alwgladiator;
    atomicassets = shared.atomicassets;
    orngwax = shared.orngwax;
    eosdacTokens = shared.eosioToken;
    federation = shared.federation;
    tokenIssuer = shared.tokenIssuer;

    await createtestFighters();
    console.log('created test fighters');

    await configureAuths();
    console.log('configure auths');
  });

  context('configureNFTs', async () => {
    context('For Player Zero', async () => {
      context('create gladiator asset', async () => {
        it('should succeed', async () => {
          await mintAvatar(users[0].account, users[0].minion);
        });
      });

      context('create defence weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[0].account, users[0].weapons[0]);
        });
      });
      context('create attack weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[0].account, users[0].weapons[1]);
        });
      });
      context('create another attack weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[0].account, users[0].weapons[2]);
        });
      });
    });

    context('For Player 1', async () => {
      context('create gladiator asset', async () => {
        it('should succeed', async () => {
          await mintAvatar(users[1].account, users[1].minion);
        });
      });

      context('create defence weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[1].account, users[1].weapons[0]);
        });
      });
      context('create attack weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[1].account, users[1].weapons[1]);
        });
      });
    });

    context('For Player 2', async () => {
      context('create gladiator asset', async () => {
        it('should succeed', async () => {
          await mintAvatar(users[2].account, users[2].minion);
        });
      });

      context('create defence weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[2].account, users[2].weapons[0]);
        });
      });
      context('create attack weapon asset', async () => {
        it('should succeed', async () => {
          await mintWeapon(users[2].account, users[2].weapons[1]);
        });
      });
    });
  });

  context('adding a user to the queue', async () => {
    context('before registering', async () => {
      it('should fail with call regplayer first error', async () => {
        await assertEOSErrorIncludesMessage(
          alwgladiator.joinqueue(
            users[0].account.name,
            PLANET1,
            +users[0].minion.id,
            +users[0].weapons[0].id,
            +users[0].weapons[1].id,
            {
              from: users[0].account,
            }
          ),
          "player must call 'regplayer' first"
        );
      });
    });

    context('After registering', async () => {
      before(async () => {
        await registerPlayer(users[0].account);
      });
      context('before transferring enough', async () => {
        it('should fail with deposit first error', async () => {
          await assertEOSErrorIncludesMessage(
            alwgladiator.joinqueue(
              users[0].account.name,
              PLANET1,
              +users[0].minion.id,
              +users[0].weapons[0].id,
              +users[0].weapons[1].id,
              {
                from: users[0].account,
              }
            ),
            'Player must first deposit the required amount to play'
          );
        });
      });

      context('Refund before player being queued', async () => {
        before(async () => {
          await stakeTokens(users[0].account);
        });
        it('player should have transferred amount into game contract from their account', async () => {
          await assertRowsEqual(
            eosdacTokens.accountsTable({ scope: alwgladiator.account.name }),
            [{ balance: '40.0000 TLM' }]
          );
          await assertRowsEqual(
            eosdacTokens.accountsTable({ scope: users[0].account.name }),
            [{ balance: '0.0000 TLM' }]
          );
        });

        it('player should be populated with TLM', async () => {
          await assertRowsEqual(
            alwgladiator.playersTable({ scope: alwgladiator.account.name }),
            [
              {
                player: users[0].account.name,
                rating: 1000,
                numberOfWins: 0,
                numberOfMatches: 0,
                balance: '40.0000 TLM',
              },
            ]
          );
        });
        it('Should allow refund', async () => {
          await alwgladiator.refund(users[0].account.name, {
            from: users[0].account,
          });
        });
        it('player should have zero TLM in playersTable after refund', async () => {
          await assertRowsEqual(
            alwgladiator.playersTable({ scope: alwgladiator.account.name }),
            [
              {
                player: users[0].account.name,
                rating: 1000,
                numberOfWins: 0,
                numberOfMatches: 0,
                balance: '0.0000 TLM',
              },
            ]
          );
          await assertRowsEqual(
            eosdacTokens.accountsTable({ scope: alwgladiator.account.name }),
            [{ balance: '0.0000 TLM' }]
          );
          await assertRowsEqual(
            eosdacTokens.accountsTable({ scope: users[0].account.name }),
            [{ balance: '40.0000 TLM' }]
          );
        });
      });

      context('after transferring enough', async () => {
        before(async () => {
          await stakeTokens(users[0].account);
        });

        it('should succeed', async () => {
          await alwgladiator.joinqueue(
            users[0].account.name,
            PLANET1,
            +users[0].minion.id,
            +users[0].weapons[0].id,
            +users[0].weapons[1].id,
            {
              from: users[0].account,
            }
          );
        });

        context('Refund after player has been queued', async () => {
          it('Should fail to refund', async () => {
            await assertEOSErrorIncludesMessage(
              alwgladiator.refund(users[0].account.name, {
                from: users[0].account,
              }),
              'Player cannot get a refund while being queued for a match'
            );
          });
        });

        it('Should add player to players table', async () => {
          await assertRowsEqual(
            alwgladiator.playersTable({ scope: alwgladiator.account.name }),
            [
              {
                player: users[0].account.name,
                rating: 1000,
                numberOfWins: 0,
                numberOfMatches: 0,
                balance: '40.0000 TLM',
              },
            ]
          );
        });
        it('Should add player to game queue', async () => {
          await assertRowsEqual(
            alwgladiator.matchqueueTable({ scope: alwgladiator.account.name }),
            [
              {
                player: users[0].account.name,
                queueIdx: 0,
                rating: 1000,
              },
            ]
          );
        });

        it('Should add combatdata to combat data table', async () => {
          await assertRowsEqual(
            alwgladiator.combatdataTable({ scope: alwgladiator.account.name }),
            [
              {
                planetName: 'planet1',
                player: users[0].account.name,
                minion: users[0].minion as any,
                playerWeapon: users[0].weapons[0] as any,
                minionWeapon: users[0].weapons[1] as any,
              } as any,
            ]
          );
        });
      });
    });
  });

  context('When adding the same player to the queue again', async () => {
    before(async () => {
      await alwgladiator.joinqueue(
        users[0].account.name,
        PLANET1,
        +users[0].minion.id,
        +users[0].weapons[0].id,
        +users[0].weapons[2].id,
        {
          from: users[0].account,
        }
      );
    });
    it('Should not add another user to the players table if one exists for this player', async () => {
      await assertRowsEqual(
        alwgladiator.playersTable({ scope: alwgladiator.account.name }),
        [
          {
            player: users[0].account.name,
            rating: 1000,
            numberOfWins: 0,
            numberOfMatches: 0,
            balance: '40.0000 TLM',
          },
        ]
      );
    });
    it('should update an existing record with new weapons and queueidx', async () => {
      await assertRowsEqual(
        alwgladiator.matchqueueTable({ scope: alwgladiator.account.name }),
        [
          {
            player: users[0].account.name,
            queueIdx: 1,
            rating: 1000,
          },
        ]
      );
    });

    it('Should update combatdata to hold the changed weapon', async () => {
      await assertRowsEqual(
        alwgladiator.combatdataTable({ scope: alwgladiator.account.name }),
        [
          {
            planetName: 'planet1',
            player: users[0].account.name,
            minion: users[0].minion as any,
            playerWeapon: users[0].weapons[0] as any,
            minionWeapon: users[0].weapons[2] as any,
          } as any,
        ]
      );
    });

    it('should not add any players to the pendingMatches table', async () => {
      await assertRowCount(
        alwgladiator.pendmatchesTable({ scope: alwgladiator.account.name }),
        0
      );
    });
  });

  context('When changing the config', async () => {
    before(async () => {
      await alwgladiator.setconfig(
        {
          numberOfGamesPerRound: 1,
          kValue: 40,
          starterRating: 500,
          matchRating: 40,
          deposit_required: '20.0000 TLM',
        },
        { from: alwgladiator.account }
      );
    });
    it('Should change the config', async () => {
      await assertRowsEqual(
        alwgladiator.configsTable({ scope: alwgladiator.account.name }),
        [
          {
            kValue: 40,
            matchRating: 40,
            numberOfGamesPerRound: 1,
            starterRating: 500,
            deposit_required: '20.0000 TLM',
          },
        ]
      );
    });
  });

  context('When adding an non-matched player', async () => {
    before(async () => {
      await registerPlayer(users[1].account);
      await stakeTokens(users[1].account);

      await alwgladiator.joinqueue(
        users[1].account.name,
        PLANET1,
        +users[1].minion.id,
        +users[1].weapons[0].id,
        +users[1].weapons[1].id,
        {
          from: users[1].account,
        }
      );
    });

    it('should add a second player to the players table', async () => {
      await assertRowsEqual(
        alwgladiator.playersTable({ scope: alwgladiator.account.name }),
        [
          {
            player: users[0].account.name,
            rating: 1000,
            numberOfWins: 0,
            numberOfMatches: 0,
            balance: '40.0000 TLM',
          },
          {
            player: users[1].account.name,
            rating: 500,
            numberOfWins: 0,
            numberOfMatches: 0,
            balance: '40.0000 TLM',
          },
        ]
      );
    });

    it('should now have 2 unmatched players in the players queue table', async () => {
      await assertRowsEqual(
        alwgladiator.matchqueueTable({ scope: alwgladiator.account.name }),
        [
          {
            player: users[1].account.name,
            rating: 500,
            queueIdx: 2,
          },
          {
            player: users[0].account.name,
            rating: 1000,
            queueIdx: 1,
          },
        ]
      );
    });

    it('Should add combatdata to combat data table', async () => {
      await assertRowsEqual(
        alwgladiator.combatdataTable({ scope: alwgladiator.account.name }),
        [
          {
            planetName: 'planet1',
            player: users[1].account.name,
            minion: users[1].minion as any,
            playerWeapon: users[1].weapons[0] as any,
            minionWeapon: users[1].weapons[1] as any,
          } as any,
          {
            planetName: 'planet1',
            player: users[0].account.name,
            minion: users[0].minion as any,
            playerWeapon: users[0].weapons[0] as any,
            minionWeapon: users[0].weapons[2] as any,
          } as any,
        ]
      );
    });

    it('should not yet add 2 players to the pending matches table', async () => {
      await assertRowCount(
        alwgladiator.pendmatchesTable({ scope: alwgladiator.account.name }),
        0
      );
    });
  });

  context('When adding another matched player', async () => {
    before(async () => {
      await registerPlayer(users[2].account);
      await stakeTokens(users[2].account);

      await alwgladiator.joinqueue(
        users[2].account.name,
        PLANET1,
        +users[2].minion.id,
        +users[2].weapons[0].id,
        +users[2].weapons[1].id,
        {
          from: users[2].account,
        }
      );
    });

    it('should add a third player to the players table', async () => {
      await assertRowsEqual(
        alwgladiator.playersTable({ scope: alwgladiator.account.name }),
        [
          {
            player: users[0].account.name,
            rating: 1000,
            numberOfWins: 0,
            numberOfMatches: 0,
            balance: '40.0000 TLM',
          },
          {
            player: users[1].account.name,
            rating: 500,
            numberOfWins: 0,
            numberOfMatches: 0,
            balance: '40.0000 TLM',
          },
          {
            player: users[2].account.name,
            rating: 500,
            numberOfWins: 0,
            numberOfMatches: 0,
            balance: '40.0000 TLM',
          },
        ]
      );
    });

    it('Should add a third combatdata to combat data table', async () => {
      await assertRowsEqual(
        alwgladiator.combatdataTable({ scope: alwgladiator.account.name }),
        [
          {
            planetName: 'planet1',
            player: users[0].account.name,
            minion: users[0].minion as any,
            playerWeapon: users[0].weapons[0] as any,
            minionWeapon: users[0].weapons[2] as any,
          } as any,
          {
            planetName: 'planet1',
            player: users[1].account.name,
            minion: users[1].minion as any,
            playerWeapon: users[1].weapons[0] as any,
            minionWeapon: users[1].weapons[1] as any,
          } as any,
          {
            planetName: 'planet1',
            player: users[2].account.name,
            minion: users[2].minion as any,
            playerWeapon: users[2].weapons[0] as any,
            minionWeapon: users[2].weapons[1] as any,
          } as any,
        ]
      );
    });

    it('should add 2 players to the pending matches table', async () => {
      await assertRowsEqual(
        alwgladiator.pendmatchesTable({ scope: alwgladiator.account.name }),
        [
          {
            id: 0,
            matchRoundId: 0,
            player1: users[2].account.name,
            player2: users[1].account.name,
          },
        ]
      );
    });

    context('Refund after player has moved to a pending match', async () => {
      it('Should fail to refund', async () => {
        await assertEOSErrorIncludesMessage(
          alwgladiator.refund(users[1].account.name, {
            from: users[1].account,
          }),
          'Player cannot get a refund while in a pending match.'
        );
      });
    });

    it('should now have only 1 unmatched player in the players queue table', async () => {
      await assertRowsEqual(
        alwgladiator.matchqueueTable({ scope: alwgladiator.account.name }),
        [
          {
            player: users[0].account.name,
            rating: 1000,
            queueIdx: 1,
          },
        ]
      );
    });
  });

  context('When a random number is injected', async () => {
    context('Before configuring planet', async () => {
      it('should fail with planet config error', async () => {
        await assertEOSErrorIncludesMessage(
          orngwax.sendbackrand(
            alwgladiator.account.name,
            0,
            '9970013ed4987ac3bc573d1667c6102f79b35d2138518e1e11ae2af4342d8016'
          ),
          'Planet config not found'
        );
      });
    });
    context('Set planet config', async () => {
      let config: AlwgladiatorPlanetConfig = {
        planet_id: PLANET1,
        arena_chance_to_win: 34,
      };
      context('without correct auth', async () => {
        it('should fail with auth error', async () => {
          await assertMissingAuthority(
            alwgladiator.setplntconf(config, { from: users[1].account })
          );
        });
      });
      context('with correct auth', async () => {
        it('should succeed', async () => {
          await alwgladiator.setplntconf(config, {
            from: alwgladiator.account,
          });
        });
      });
    });
    context('After setting Planet config', async () => {
      it('should succeed', async () => {
        await orngwax.sendbackrand(
          alwgladiator.account.name,
          0,
          '9970013ed4987ac3bc573d1667c6102f79b35d2138518e1e11ae2af4342d8016'
        );
      });
      it('pending matches should be removed', async () => {
        await assertRowCount(
          alwgladiator.pendmatchesTable({ scope: alwgladiator.account.name }),
          0
        );
      });
      it('player ratings should get updated for the matched player 1 and 2', async () => {
        await assertRowsEqual(
          alwgladiator.playersTable({
            scope: alwgladiator.account.name,
            indexPosition: 4,
            keyType: 'i64',
          }),
          [
            {
              balance: '0.0000 TLM',
              numberOfMatches: 1,
              numberOfWins: 0,
              player: users[1].account.name,
              rating: 480,
            },
            {
              balance: '40.0000 TLM',
              numberOfMatches: 0,
              numberOfWins: 0,
              player: users[0].account.name,
              rating: 1000,
            },
            {
              balance: '72.0000 TLM',
              numberOfMatches: 1,
              numberOfWins: 1,
              player: users[2].account.name,
              rating: 520,
            },
          ]
        );
      });
    });
  });

  context('Re-match with previous players', async () => {
    context('without staking more tokens', async () => {
      it('joinqueue should fail with not staking error', async () => {
        await assertEOSErrorIncludesMessage(
          alwgladiator.joinqueue(
            users[1].account.name,
            PLANET1,
            +users[1].minion.id,
            +users[1].weapons[0].id,
            +users[1].weapons[1].id,
            {
              from: users[1].account,
            }
          ),
          'Player must first deposit the required amount to play'
        );
      });
    });
    context('after staking more tokens', async () => {
      before(async () => {
        await stakeTokens(users[1].account);
      });
      it('should succeed to join queue', async () => {
        await alwgladiator.joinqueue(
          users[1].account.name,
          PLANET1,
          +users[1].minion.id,
          +users[1].weapons[0].id,
          +users[1].weapons[1].id,
          {
            from: users[1].account,
          }
        );
      });
    });
    context('after adding 2 matching players', async () => {
      before(async () => {
        await alwgladiator.joinqueue(
          users[2].account.name,
          PLANET1,
          +users[2].minion.id,
          +users[2].weapons[0].id,
          +users[2].weapons[1].id,
          {
            from: users[2].account,
          }
        );
      });
      it('should add 2 players to the pending matches table', async () => {
        await assertRowsEqual(
          alwgladiator.pendmatchesTable({ scope: alwgladiator.account.name }),
          [
            {
              id: 0,
              matchRoundId: 1,
              player1: users[2].account.name,
              player2: users[1].account.name,
            },
          ]
        );
      });

      it('should now have only 1 unmatched player in the players queue table', async () => {
        await assertRowsEqual(
          alwgladiator.matchqueueTable({ scope: alwgladiator.account.name }),
          [
            {
              player: users[0].account.name,
              rating: 1000,
              queueIdx: 1,
            },
          ]
        );
      });
    });
  });

  context('When a random number is injected', async () => {
    before(async () => {
      await orngwax.sendbackrand(
        alwgladiator.account.name,
        1,
        '14f5ffffed4987ac3bc573d1667c6102f79b35d2138518e1e11aeaf4342d80e6'
      );
    });
    it('remove pending matches', async () => {
      await assertRowCount(
        alwgladiator.pendmatchesTable({ scope: alwgladiator.account.name }),
        0
      );
    });
    it('updates player ratings', async () => {
      await assertRowsEqual(
        alwgladiator.playersTable({
          scope: alwgladiator.account.name,
          indexPosition: 4,
          keyType: 'i64',
        }),
        [
          {
            balance: '0.0000 TLM',
            numberOfMatches: 2,
            numberOfWins: 1,
            player: users[2].account.name,
            rating: 497,
          },
          {
            balance: '40.0000 TLM',
            numberOfMatches: 0,
            numberOfWins: 0,
            player: users[0].account.name,
            rating: 1000,
          },
          {
            balance: '72.0000 TLM',
            numberOfMatches: 2,
            numberOfWins: 1,
            player: users[1].account.name,
            rating: 502,
          },
        ]
      );
    });

    it('should create NFT for userZero', async () => {
      await assertRowCount(
        atomicassets.assetsTable({ scope: users[0].account.name }),
        4
      );
    });

    it('should create NFT for winner', async () => {
      await assertRowCount(
        atomicassets.assetsTable({ scope: users[1].account.name }),
        4
      );
    });

    it('Should remove combatdata from the combat data table', async () => {
      await assertRowsEqual(
        alwgladiator.combatdataTable({ scope: alwgladiator.account.name }),
        [
          {
            planetName: 'planet1',
            player: users[0].account.name,
            minion: users[0].minion as any,
            playerWeapon: users[0].weapons[0] as any,
            minionWeapon: users[0].weapons[2] as any,
          } as any,
        ]
      );
    });
  });
});

async function createtestFighters() {
  users = [
    {
      account: await AccountManager.createAccount('userzero'),
      minion: {
        id: '1099511627776',
        race: 6,
        movecost: 10,
        type: 4,
        defence: 7,
        attack: 12,
        name: 'toughguy',
        num_matches: 0,
        num_wins: 0,
      },
      weapons: [
        {
          attack: 33,
          defence: 72,
          id: '1099511627777',
          type: 45,
        },
        {
          attack: 23,
          defence: 37,
          id: '1099511627778',
          type: 19,
        },
        {
          attack: 83,
          defence: 79,
          id: '1099511627779',
          type: 56,
        },
      ],
    },
    {
      account: await AccountManager.createAccount('user1'),
      minion: {
        id: '1099511627780',
        race: 1,
        movecost: 2,
        type: 4,
        defence: 7,
        attack: 21,
        name: 'toughguy',
        num_matches: 0,
        num_wins: 0,
      },
      weapons: [
        {
          attack: 2,
          defence: 3,
          id: '1099511627781',
          type: 8,
        },
        {
          attack: 7,
          defence: 8,
          id: '1099511627782',
          type: 9,
        },
      ],
    },
    {
      account: await AccountManager.createAccount('user2'),
      minion: {
        id: '1099511627783',
        race: 3,
        movecost: 9,
        type: 6,
        defence: 5,
        attack: 10,
        name: 'toughguy',
        num_matches: 0,
        num_wins: 0,
      },
      weapons: [
        {
          attack: 5,
          defence: 14,
          id: '1099511627784',
          type: 3,
        },
        {
          attack: 17,
          defence: 5,
          id: '1099511627785',
          type: 6,
        },
      ],
    },
  ];
}

async function configureAuths() {
  await UpdateAuth.execUpdateAuth(
    [{ actor: orngwax.account.name, permission: 'active' }],
    orngwax.account.name,
    'sendcode',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(orngwax.account)
  );

  // Set eosio.code permission AND a direct key premission on alwgladiator
  await UpdateAuth.execUpdateAuth(
    [{ actor: orngwax.account.name, permission: 'active' }],
    orngwax.account.name,
    'active',
    'owner',
    UpdateAuth.AuthorityToSet.explicitAuthorities(
      1,
      [
        {
          permission: {
            permission: 'eosio.code',
            actor: orngwax.account.name,
          },
          weight: 1,
        },
      ],
      [{ key: orngwax.account.publicKey || 'unknown key', weight: 1 }]
    )
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: alwgladiator.account.name, permission: 'active' }],
    alwgladiator.account.name,
    'recordwin',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(alwgladiator.account)
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: alwgladiator.account.name, permission: 'active' }],
    alwgladiator.account.name,
    'issue',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(alwgladiator.account)
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: alwgladiator.account.name, permission: 'active' }],
    alwgladiator.account.name,
    'random',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(alwgladiator.account)
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: alwgladiator.account.name, permission: 'active' }],
    alwgladiator.account.name,
    'transfer',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(alwgladiator.account)
  );

  UpdateAuth.execUpdateAuth(
    [{ actor: alwgladiator.account.name, permission: 'active' }],
    alwgladiator.account.name,
    'awardnft',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(alwgladiator.account)
  );

  await UpdateAuth.execLinkAuth(
    alwgladiator.account.active,
    alwgladiator.account.name,
    orngwax.account.name,
    'requestrand',
    'random'
  );

  await UpdateAuth.execLinkAuth(
    alwgladiator.account.active,
    alwgladiator.account.name,
    alwgladiator.account.name,
    'recordwin',
    'recordwin'
  );

  await UpdateAuth.execLinkAuth(
    alwgladiator.account.active,
    alwgladiator.account.name,
    atomicassets.account.name,
    'mintasset',
    'issue'
  );

  await UpdateAuth.execLinkAuth(
    alwgladiator.account.active,
    alwgladiator.account.name,
    atomicassets.account.name,
    'setassetdata',
    'issue'
  );

  await UpdateAuth.execLinkAuth(
    alwgladiator.account.active,
    alwgladiator.account.name,
    federation.account.name,
    'awardnft',
    'awardnft'
  );

  await UpdateAuth.execLinkAuth(
    alwgladiator.account.active,
    alwgladiator.account.name,
    eosdacTokens.account.name,
    'transfer',
    'transfer'
  );
}

async function registerPlayer(account: Account) {
  await alwgladiator.regplayer(account.name, {
    from: account,
  });
}

async function distributeTokens(account: Account, qty: string = '40.0000 TLM') {
  await eosdacTokens.transfer(
    tokenIssuer.name,
    account.name,
    qty,
    'transfer TLM from issuer',
    {
      from: tokenIssuer,
    }
  );
}

async function stakeTokens(fromAccount: Account, qty: string = '40.0000 TLM') {
  await distributeTokens(fromAccount);
  await eosdacTokens.transfer(
    fromAccount.name,
    alwgladiator.account.name,
    qty,
    'fightstake',
    {
      from: fromAccount,
    }
  );
}

async function mintAvatar(user: Account, newAvatar: minion) {
  await atomicassets.mintasset(
    eosdacTokens.account.name,
    shared.NFT_COLLECTION,
    shared.MINION_SCHEMA,
    -1,
    user.name,
    [
      { key: 'name', value: ['string', 'toughguy'] },
      { key: 'type', value: ['uint8', newAvatar.type] },
      { key: 'race', value: ['uint8', newAvatar.race] },
      {
        key: 'movecost',
        value: ['uint8', newAvatar.movecost],
      },
      { key: 'defence', value: ['uint8', newAvatar.defence] },
      { key: 'attack', value: ['uint8', newAvatar.attack] },
    ] as any,
    [
      // { key: 'nummatches', value: ['uint32', 0] },
      // { key: 'numwins', value: ['uint32', 0] },
    ] as any,
    [],
    { from: eosdacTokens.account }
  );

  let user_object = users.find((x) => x.account.name == user.name);
  const res = await atomicassets.assetsTable({ scope: user.name });
  const nft = res.rows.find((x) => x.schema_name == shared.MINION_SCHEMA);
  user_object.minion.id = nft.asset_id;
}

async function mintWeapon(user: Account, newWeapon: weapon) {
  await atomicassets.mintasset(
    eosdacTokens.account.name,
    shared.NFT_COLLECTION,
    shared.WEAPON_SCHEMA,
    -1,
    user.name,
    [
      { key: 'name', value: ['string', 'sheild'] },
      { key: 'attack', value: ['uint8', newWeapon.attack] },
      { key: 'defence', value: ['uint8', newWeapon.defence] },
      { key: 'type', value: ['uint8', newWeapon.type] },
    ] as any,
    '',
    [],
    { from: eosdacTokens.account }
  );
  await updateWeapons(user);
  // console.log(`users: ${JSON.stringify(users, null, 2)}`);
}

async function updateWeapons(user: Account) {
  let user_object = users.find((x) => x.account.name == user.name);
  const res = await atomicassets.assetsTable({ scope: user.name });
  const nfts = res.rows.filter((x) => x.schema_name == shared.WEAPON_SCHEMA);
  let i = 0;
  for (const nft of nfts) {
    // x.id = nfts[i].asset_id;
    user_object.weapons[i].id = nft.asset_id;
    i++;
  }
  // user_object.minion.id = nft.asset_id;
}
