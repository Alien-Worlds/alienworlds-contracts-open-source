import {
  assertRowsEqual,
  AccountManager,
  Account,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  EOSManager,
  debugPromise,
  assertRowsEqualStrict,
  assertRowCount,
  sleep,
} from 'lamington';
import * as chai from 'chai';
import * as dotenv from 'dotenv';
import { config } from 'dotenv';

import { Userpoints } from './userpoints';
import { Federation } from '../federation/federation';
import * as moment from 'moment';
import { SharedTestObjects } from '../TestHelpers';
chai.use(require('chai-datetime'));

let userpoints: Userpoints;
let federation: Federation;

let miner1: Account;
let miner2: Account;
let miner3: Account;
let miner4: Account;
let shared: SharedTestObjects;

const index_users = [
  'idxuserefd1',
  'idxuserefdl1',
  'idxuserefd2',
  'idxuserefdl2',
  'idxuserefdw1',
  'idxuserefdw2',
  'idxuserefd21',
];
const all_users = [...index_users, ...['miner1', 'miner2', 'miner3', 'miner4']];

let ref_block_time: Date;

// Build deterministic UTC timestamps (avoid host timezone/DST skew). Return ISO string without TZ suffix.
const referenceTimeWithAddedHours = async (hours: number) => {
  return moment
    .utc(ref_block_time)
    .startOf('day')
    .add(hours, 'hours')
    .format('YYYY-MM-DDTHH:mm:ss');
};

// Convert stored ISO string/Date-like to a Date at the same UTC instant
const withLocalOffset = (date: any) => moment.utc(date).toDate();

// Helper function to call the open action
async function openUser(user: Account) {
  await userpoints.reguser(user.name, { from: user });
}

describe('Userpoints', async () => {
  let refDate1: string;
  let refDate1Later: string;
  let refDate2: string;
  let refDate2Later: string;
  let refDate3: string;
  let refDate8: string;
  let refDate9Later: string;
  let refDate21: string;

  before(async () => {
    shared = await SharedTestObjects.getInstance();

    let info = await EOSManager.api.rpc.get_info();
    ref_block_time = new Date(`2022-07-07T00:00:00.000Z`);

    refDate1 = await referenceTimeWithAddedHours(0);
    refDate1Later = await referenceTimeWithAddedHours(1);
    refDate2 = await referenceTimeWithAddedHours(25);
    refDate2Later = await referenceTimeWithAddedHours(36);
    refDate3 = await referenceTimeWithAddedHours(2 * 25);
    refDate8 = await referenceTimeWithAddedHours(8 * 25 + 1);
    refDate9Later = await referenceTimeWithAddedHours(12 * 24);
    refDate21 = await referenceTimeWithAddedHours(24 * 24);
    await seedAccounts();
  });

  context('addpoints', async () => {
    context('with wrong auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          userpoints.addpoints(miner1.name, 10, refDate1, { from: miner2 })
        );
      });
    });
    context('with correct auth', async () => {
      context('without calling open first', async () => {
        let unopenedUser: Account;
        before(async () => {
          unopenedUser = await AccountManager.createAccount('unopenedusr');
          // DO NOT call openUser(unopenedUser);
          await acceptTerms(unopenedUser);
        });
      });
      context('without accepting terms', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 10, refDate1, {
            from: userpoints.account,
          });
        });
        it('should not add points', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.find((x) => x.user == miner1.name);
          chai.expect(miner1_rows.total_points).to.equal(0);
        });
      });
      context('with accepting terms', async () => {
        before(async () => {
          await acceptTerms(miner1);
        });
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 10, refDate1, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 10,
              redeemable_points: 10,
              last_action_timestamp: withLocalOffset(refDate1),
              milestones: [],
              total_points: 10,
              user: miner1.name,
              weekly_points: 10,
              top_level_claimed: 1,
            },
          ]);
        });
      });
      context('later today', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 11, refDate1Later, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 21,
              redeemable_points: 21,
              last_action_timestamp: withLocalOffset(refDate1Later),
              milestones: [],
              total_points: 21,
              user: miner1.name,
              weekly_points: 21,
              top_level_claimed: 1,
            },
          ]);
        });
      });
      context('tomorrow', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 12, refDate2, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 12,
              redeemable_points: 33,
              last_action_timestamp: withLocalOffset(refDate2),
              milestones: [],
              total_points: 33,
              user: miner1.name,
              weekly_points: 33,
              top_level_claimed: 1,
            },
          ]);
        });
      });

      context('later tomorrow', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 5, refDate2Later, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 17,
              redeemable_points: 38,
              last_action_timestamp: withLocalOffset(refDate2Later),
              milestones: [],
              total_points: 38,
              user: miner1.name,
              weekly_points: 38,
              top_level_claimed: 1,
            },
          ]);
        });
      });
      context('day after tomorrow', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 5, refDate3, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 5,
              redeemable_points: 43,
              last_action_timestamp: withLocalOffset(refDate3),
              milestones: [],
              total_points: 43,
              user: miner1.name,
              weekly_points: 43,
              top_level_claimed: 1,
            },
          ]);
        });
      });
      context('next week', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 12, refDate8, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 12,
              redeemable_points: 55,
              last_action_timestamp: withLocalOffset(refDate8),
              milestones: [],
              total_points: 55,
              user: miner1.name,
              weekly_points: 12,
              top_level_claimed: 1,
            },
          ]);
        });
      });
      context('later next week', async () => {
        it('should succeed', async () => {
          await userpoints.addpoints(miner1.name, 2, refDate9Later, {
            from: userpoints.account,
          });
        });
        it('should update table', async () => {
          const res = await userpoints.userpointsTable();
          const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
          chai.expect(miner1_rows).to.deep.equal([
            {
              daily_points: 2,
              redeemable_points: 57,
              last_action_timestamp: withLocalOffset(refDate9Later),
              milestones: [],
              total_points: 57,
              user: miner1.name,
              weekly_points: 14,
              top_level_claimed: 1,
            },
          ]);
        });
      });
    });
  });

  context('setptsreward', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          userpoints.setptsreward(123, refDate1, refDate2, 123455, 5432, {
            from: miner1,
          })
        );
      });
    });
    context('with valid auth', async () => {
      context('with invalid start and end dates', async () => {
        it('should fail with date error', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.setptsreward(123, refDate2, refDate1, 123455, 5432, {
              from: userpoints.account,
            }),
            'End date earlier than start date.'
          );
        });
      });

      context('with dates in the past', async () => {
        it('should succeed', async () => {
          await userpoints.setptsreward(
            123,
            await referenceTimeWithAddedHours(-2000),
            refDate2,
            123455,
            5432,
            { from: userpoints.account }
          );
        });
      });
      context('with valid params', async () => {
        it('should succeed', async () => {
          await debugPromise(
            userpoints.setptsreward(123, refDate2, refDate8, 123455, 5432, {
              from: userpoints.account,
            }),
            'set pts rewards:'
          );
        });
        it('should update the offers table', async () => {
          await assertRowsEqualStrict(userpoints.pointoffersTable(), [
            {
              id: 123,
              start: withLocalOffset(refDate2),
              end: withLocalOffset(refDate8),
              template_id: 123455,
              required: 5432,
            },
          ]);
        });
      });
      context('with existing offer', async () => {
        it('should update the existing offer', async () => {
          await userpoints.setptsreward(123, refDate2, refDate8, 123457, 5431, {
            from: userpoints.account,
          });
        });
        it('should update the offers table', async () => {
          await assertRowsEqualStrict(userpoints.pointoffersTable(), [
            {
              id: 123,
              start: withLocalOffset(refDate2),
              end: withLocalOffset(refDate8),
              template_id: 123457,
              required: 5431,
            },
          ]);
        });
      });
    });
  });

  context('delptsreward', async () => {
    before(async () => {
      await userpoints.setptsreward(321, refDate2, refDate8, 111111, 2222, {
        from: userpoints.account,
      });
    });
    context('with invalid auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          userpoints.delptsreward(321, { from: miner1 })
        );
      });
    });
    context('with valid auth', async () => {
      context('with no matching offer id', async () => {
        it('should fail with offer not found error', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.delptsreward(333, { from: userpoints.account }),
            'offer not found.'
          );
        });
      });
      context('with matching offer', async () => {
        it('should succeed to delete the offer', async () => {
          await userpoints.delptsreward(321, { from: userpoints.account });
        });
        it('should update the offers table', async () => {
          await assertRowsEqualStrict(userpoints.pointoffersTable(), [
            {
              id: 123,
              start: withLocalOffset(refDate2),
              end: withLocalOffset(refDate8),
              template_id: 123457,
              required: 5431,
            },
          ]);
        });
      });
    });
  });

  context('redeempntnft', async () => {
    context('with wrong auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          userpoints.redeempntnft(miner1.name, 12, refDate2Later, {
            from: miner2,
          })
        );
      });
    });
    context('with no matching offer', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          userpoints.redeempntnft(miner1.name, 111, refDate2Later, {
            from: miner1,
          }),
          'offer does not exist.'
        );
      });
    });
    context('with insufficient points', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          userpoints.redeempntnft(miner1.name, 123, refDate2Later, {
            from: miner1,
          }),
          'Not enough points available.'
        );
      });
    });
    context('with before started offer', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          userpoints.redeempntnft(
            miner1.name,
            123,
            await referenceTimeWithAddedHours(-3000),
            {
              from: miner1,
            }
          ),
          'Reward offer has not yet started'
        );
      });
    });
    context('with expired offer', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          userpoints.redeempntnft(miner1.name, 123, refDate21, {
            from: miner1,
          }),
          'Reward offer has expired.'
        );
      });
    });
    context('with correct auth', async () => {
      before(async () => {
        await userpoints.addpoints(miner1.name, 6000, refDate1, {
          from: userpoints.account,
        });
      });
      it('should succeed', async () => {
        await userpoints.redeempntnft(miner1.name, 123, refDate2Later, {
          from: miner1,
        });
      });
      it('should update table', async () => {
        const res = await userpoints.userpointsTable();
        const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
        chai.expect(miner1_rows).to.deep.equal([
          {
            daily_points: 6002,
            redeemable_points: 57 + 6000 - 5431,
            last_action_timestamp: withLocalOffset(refDate1),
            milestones: [],
            total_points: 6057,
            user: miner1.name,
            weekly_points: 6014,
            top_level_claimed: 1,
          },
        ]);
      });
    });
  });

  context('setlvlreward', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          userpoints.setlvlreward(2, 2, 123455, 5432, { from: miner1 })
        );
      });
    });
    context('with valid auth', async () => {
      context('with valid params', async () => {
        it('should succeed', async () => {
          await userpoints.setlvlreward(2, 2, 123455, 5432, {
            from: userpoints.account,
          });
        });
        it('should update the offers table', async () => {
          await assertRowsEqualStrict(userpoints.leveloffersTable(), [
            {
              id: 2,
              level: 2,
              template_id: 123455,
              required: 5432,
            },
          ]);
        });
      });
      context('with existing offer', async () => {
        it('should update the existing offer', async () => {
          await userpoints.setlvlreward(2, 2, 123458, 5432, {
            from: userpoints.account,
          });
        });
        it('should update the offers table', async () => {
          await assertRowsEqualStrict(userpoints.leveloffersTable(), [
            {
              id: 2,
              level: 2,
              template_id: 123458,
              required: 5432,
            },
          ]);
        });
      });
    });
  });

  context('redeemlvlnft', async () => {
    context('with wrong auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          userpoints.redeemlvlnft(miner1.name, 1, {
            from: miner2,
          })
        );
      });
    });
    context('with correct auth', async () => {
      context('with no matching level to claim', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.redeemlvlnft(miner1.name, 60, {
              from: miner1,
            }),
            'No level offer available with id: 60'
          );
        });
      });

      context('with an available level to claim', async () => {
        before(async () => {
          await userpoints.setlvlreward(1, 1, 123455, 6432, {
            from: userpoints.account,
          });
        });
        context('with insufficient points', async () => {
          it('should fail', async () => {
            await assertEOSErrorIncludesMessage(
              userpoints.redeemlvlnft(miner1.name, 1, {
                from: miner1,
              }),
              'Not enough points earned to claim next level reward.'
            );
          });
        });
        context('with enough points', async () => {
          before(async () => {
            await userpoints.addpoints(miner1.name, 1000, refDate1Later, {
              from: userpoints.account,
            });
          });
          context('with wrong current level to claim', async () => {
            it('should fail with wrong level to claim this reward', async () => {
              await assertEOSErrorIncludesMessage(
                userpoints.redeemlvlnft(miner1.name, 1, {
                  from: miner1,
                }),
                'User is only eligible to claim offer for level: 2. This offer is for level: 1'
              );
            });
          });
          context('with enough points for next level', async () => {
            it('should succeed', async () => {
              await userpoints.redeemlvlnft(miner1.name, 2, {
                from: miner1,
              });
            });
            it('should update table', async () => {
              const res = await userpoints.userpointsTable();
              const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
              chai.expect(miner1_rows).to.deep.equal([
                {
                  daily_points: 7002,
                  redeemable_points: 57 + 7000 - 5431,
                  last_action_timestamp: withLocalOffset(refDate1Later),
                  milestones: [],
                  total_points: 7057,
                  user: miner1.name,
                  weekly_points: 7014,
                  top_level_claimed: 2,
                },
              ]);
            });
          });
        });
      });
    });

    context('setmilestone', async () => {
      context('with wrong auth', async () => {
        it('should fail with auth error', async () => {
          await assertMissingAuthority(
            userpoints.setmilestone(miner1.name, 23, 23456, { from: miner1 })
          );
        });
      });
      context('with correct auth', async () => {
        context('with existing userpoints record', async () => {
          context('without existing value for key', async () => {
            it('should create new key value pair', async () => {
              await userpoints.setmilestone(miner1.name, 23, 23456, {
                from: userpoints.account,
              });
            });
            it('should update userpoints table', async () => {
              const res = await userpoints.userpointsTable();
              const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
              chai.expect(miner1_rows).to.deep.equal([
                {
                  daily_points: 7002,
                  redeemable_points: 57 + 7000 - 5431,
                  last_action_timestamp: withLocalOffset(refDate1Later),
                  milestones: [
                    {
                      key: 23,
                      value: 23456,
                    },
                  ],
                  total_points: 7057,
                  user: miner1.name,
                  weekly_points: 7014,
                  top_level_claimed: 2,
                },
              ]);
            });
          });
          context('with existing value', async () => {
            it('should update the value', async () => {
              await userpoints.setmilestone(miner1.name, 23, 6666, {
                from: userpoints.account,
              });
            });
            it('should update userpoints table', async () => {
              const res = await userpoints.userpointsTable();
              const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
              chai.expect(miner1_rows).to.deep.equal([
                {
                  daily_points: 7002,
                  redeemable_points: 57 + 7000 - 5431,
                  last_action_timestamp: withLocalOffset(refDate1Later),
                  milestones: [
                    {
                      key: 23,
                      value: 6666,
                    },
                  ],
                  total_points: 7057,
                  user: miner1.name,
                  weekly_points: 7014,
                  top_level_claimed: 2,
                },
              ]);
            });
          });
          context('when adding another value', async () => {
            it('should succeed', async () => {
              await userpoints.setmilestone(miner1.name, 21, 1212, {
                from: userpoints.account,
              });
            });
            it('should create an addition key value pair', async () => {
              const res = await userpoints.userpointsTable();
              const miner1_rows = res.rows.filter((x) => x.user == miner1.name);
              chai.expect(miner1_rows).to.deep.equal([
                {
                  daily_points: 7002,
                  redeemable_points: 57 + 7000 - 5431,
                  last_action_timestamp: withLocalOffset(refDate1Later),
                  milestones: [
                    {
                      key: 21,
                      value: 1212,
                    },
                    {
                      key: 23,
                      value: 6666,
                    },
                  ],
                  total_points: 7057,
                  user: miner1.name,
                  weekly_points: 7014,
                  top_level_claimed: 2,
                },
              ]);
            });
          });
        });
      });
    });

    context('secondary indexes', async () => {
      let [
        idxuserefDate1,
        idxuserefDate1Later,
        idxuserefDate2,
        idxuserefDate2Later,
        idxuserefDate8,
        idxuserefDate9,
        idxuserefDate21,
      ]: Account[] = [];

      before(async () => {
        [
          idxuserefDate1,
          idxuserefDate1Later,
          idxuserefDate2,
          idxuserefDate2Later,
          idxuserefDate8,
          idxuserefDate9,
          idxuserefDate21,
        ] = await Promise.all(
          [
            'idxuserefd1',
            'idxuserefdl1',
            'idxuserefd2',
            'idxuserefdl2',
            'idxuserefdw1',
            'idxuserefdw2',
            'idxuserefd21',
          ].map(async (name) => {
            const account = await AccountManager.createAccount(name);
            await acceptTerms(account);
            return account;
          })
        );
        await Promise.all(
          [
            userpoints.reguser(idxuserefDate1.name, { from: idxuserefDate1 }),
            userpoints.reguser(idxuserefDate1Later.name, {
              from: idxuserefDate1Later,
            }),
            userpoints.reguser(idxuserefDate2.name, { from: idxuserefDate2 }),
            userpoints.reguser(idxuserefDate2Later.name, {
              from: idxuserefDate2Later,
            }),
            userpoints.reguser(idxuserefDate8.name, { from: idxuserefDate8 }),
            userpoints.reguser(idxuserefDate9.name, { from: idxuserefDate9 }),
            userpoints.reguser(idxuserefDate21.name, {
              from: idxuserefDate21,
            }),
          ].map(async (promise) => {
            try {
              await promise;
            } catch (e) {
              console.error(`Error opening accounts: ${e}`);
              throw e;
            }
          })
        );
        await Promise.all(
          [
            userpoints.addpoints(idxuserefDate1.name, 1000, refDate1),
            userpoints.addpoints(idxuserefDate1Later.name, 101, refDate1Later),
            userpoints.addpoints(idxuserefDate2.name, 27, refDate2),
            userpoints.addpoints(idxuserefDate2Later.name, 2400, refDate2Later),

            userpoints.addpoints(idxuserefDate8.name, 80, refDate8),
            userpoints.addpoints(idxuserefDate9.name, 900, refDate9Later),
            userpoints.addpoints(idxuserefDate21.name, 21, refDate21),
          ].map(async (promise) => {
            // Wrap addpoints calls for index users
            try {
              await promise;
            } catch (e) {
              console.error(`Error adding points for index user: ${e}`);
              throw e;
            }
          })
        );
      });
      it('second index should sort by totalpoints', async () => {
        const res = await userpoints.userpointsTable({
          indexPosition: 2,
          keyType: 'i64',
          reverse: true,
          limit: 100,
        });
        const our_rows = res.rows.filter((x) => all_users.includes(x.user));
        chai.expect(our_rows).to.deep.equal([
          {
            user: 'miner1',
            total_points: 7057,
            redeemable_points: 1626,
            daily_points: 7002,
            weekly_points: 7014,
            top_level_claimed: 2,
            last_action_timestamp: withLocalOffset(refDate1Later),
            milestones: [
              {
                key: 21,
                value: 1212,
              },
              {
                key: 23,
                value: 6666,
              },
            ],
          },
          {
            user: 'idxuserefdl2',
            total_points: 2400,
            redeemable_points: 2400,
            daily_points: 2400,
            weekly_points: 2400,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate2Later),
            milestones: [],
          },

          {
            user: 'idxuserefd1',
            total_points: 1000,
            redeemable_points: 1000,
            daily_points: 1000,
            weekly_points: 1000,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate1),
            milestones: [],
          },
          {
            user: 'idxuserefdw2',
            total_points: 900,
            redeemable_points: 900,
            daily_points: 900,
            weekly_points: 900,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate9Later),
            milestones: [],
          },
          {
            user: 'idxuserefdl1',
            total_points: 101,
            redeemable_points: 101,
            daily_points: 101,
            weekly_points: 101,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate1Later),
            milestones: [],
          },
          {
            user: 'idxuserefdw1',
            total_points: 80,
            redeemable_points: 80,
            daily_points: 80,
            weekly_points: 80,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate8),
            milestones: [],
          },
          {
            user: 'idxuserefd2',
            total_points: 27,
            redeemable_points: 27,
            daily_points: 27,
            weekly_points: 27,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate2),
            milestones: [],
          },
          {
            daily_points: 21,
            last_action_timestamp: withLocalOffset(refDate21),
            milestones: [],
            redeemable_points: 21,
            top_level_claimed: 1,
            total_points: 21,
            user: 'idxuserefd21',
            weekly_points: 21,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner4',
            weekly_points: 0,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner3',
            weekly_points: 0,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner2',
            weekly_points: 0,
          },
        ]);
      });
      it('third index should sort by dailypoints grouped by day', async () => {
        const res = await userpoints.userpointsTable({
          indexPosition: 3,
          keyType: 'i64',
          reverse: true,
          limit: 100,
        });
        const our_rows = res.rows.filter((x) => all_users.includes(x.user));
        chai.expect(our_rows).to.deep.equal([
          {
            user: 'idxuserefd21',
            total_points: 21,
            redeemable_points: 21,
            daily_points: 21,
            weekly_points: 21,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate21),
            milestones: [],
          },
          {
            user: 'idxuserefdw2',
            total_points: 900,
            redeemable_points: 900,
            daily_points: 900,
            weekly_points: 900,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate9Later),
            milestones: [],
          },
          {
            user: 'idxuserefdw1',
            total_points: 80,
            redeemable_points: 80,
            daily_points: 80,
            weekly_points: 80,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate8),
            milestones: [],
          },
          {
            user: 'idxuserefdl2',
            total_points: 2400,
            redeemable_points: 2400,
            daily_points: 2400,
            weekly_points: 2400,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate2Later),
            milestones: [],
          },
          {
            user: 'idxuserefd2',
            total_points: 27,
            redeemable_points: 27,
            daily_points: 27,
            weekly_points: 27,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate2),
            milestones: [],
          },
          {
            user: 'miner1',
            total_points: 7057,
            redeemable_points: 1626,
            daily_points: 7002,
            weekly_points: 7014,
            top_level_claimed: 2,
            last_action_timestamp: withLocalOffset(refDate1Later),
            milestones: [
              {
                key: 21,
                value: 1212,
              },
              {
                key: 23,
                value: 6666,
              },
            ],
          },
          {
            user: 'idxuserefd1',
            total_points: 1000,
            redeemable_points: 1000,
            daily_points: 1000,
            weekly_points: 1000,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate1),
            milestones: [],
          },
          {
            user: 'idxuserefdl1',
            total_points: 101,
            redeemable_points: 101,
            daily_points: 101,
            weekly_points: 101,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate1Later),
            milestones: [],
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner4',
            weekly_points: 0,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner3',
            weekly_points: 0,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner2',
            weekly_points: 0,
          },
        ]);
      });
      it('forth index should sort by weekly grouped by week', async () => {
        const res = await userpoints.userpointsTable({
          indexPosition: 4,
          keyType: 'i64',
          reverse: true,
          limit: 50,
        });
        const our_rows = res.rows.filter((x) => all_users.includes(x.user));
        chai.expect(our_rows).to.deep.equal([
          {
            user: 'idxuserefd21',
            total_points: 21,
            redeemable_points: 21,
            daily_points: 21,
            weekly_points: 21,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate21),
            milestones: [],
          },
          {
            user: 'idxuserefdw2',
            total_points: 900,
            redeemable_points: 900,
            daily_points: 900,
            weekly_points: 900,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate9Later),
            milestones: [],
          },
          {
            user: 'idxuserefdw1',
            total_points: 80,
            redeemable_points: 80,
            daily_points: 80,
            weekly_points: 80,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate8),
            milestones: [],
          },
          {
            user: 'miner1',
            total_points: 7057,
            redeemable_points: 1626,
            daily_points: 7002,
            weekly_points: 7014,
            top_level_claimed: 2,
            last_action_timestamp: withLocalOffset(refDate1Later),
            milestones: [
              {
                key: 21,
                value: 1212,
              },
              {
                key: 23,
                value: 6666,
              },
            ],
          },
          {
            user: 'idxuserefdl2',
            total_points: 2400,
            redeemable_points: 2400,
            daily_points: 2400,
            weekly_points: 2400,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate2Later),
            milestones: [],
          },
          {
            user: 'idxuserefd1',
            total_points: 1000,
            redeemable_points: 1000,
            daily_points: 1000,
            weekly_points: 1000,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate1),
            milestones: [],
          },
          {
            user: 'idxuserefdl1',
            total_points: 101,
            redeemable_points: 101,
            daily_points: 101,
            weekly_points: 101,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate1Later),
            milestones: [],
          },
          {
            user: 'idxuserefd2',
            total_points: 27,
            redeemable_points: 27,
            daily_points: 27,
            weekly_points: 27,
            top_level_claimed: 1,
            last_action_timestamp: withLocalOffset(refDate2),
            milestones: [],
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner4',
            weekly_points: 0,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner3',
            weekly_points: 0,
          },
          {
            daily_points: 0,
            last_action_timestamp: new Date(0),
            milestones: [],
            redeemable_points: 0,
            top_level_claimed: 1,
            total_points: 0,
            user: 'miner2',
            weekly_points: 0,
          },
        ]);
      });
    });

    context(
      'addpoints with high values when adding to an existing daily',
      async () => {
        it('should cap at uint64::max', async () => {
          const res_before = await userpoints.userpointsTable({
            indexPosition: 4,
            keyType: 'i64',
            reverse: true,
            limit: 100,
          });
          // find miner1
          const miner1_row_before = res_before.rows.find(
            (x) => x.user === miner1.name
          );
          const high_value_points = 2 ** 16 + 100;
          await userpoints.addpoints(
            miner1.name,
            high_value_points,
            refDate1Later,
            {
              from: userpoints.account,
            }
          );

          const res = await userpoints.userpointsTable({
            indexPosition: 4,
            keyType: 'i64',
            reverse: true,
            limit: 100,
          });
          // find miner1
          const miner1_row = res.rows.find((x) => x.user === miner1.name);
          chai.expect(miner1_row.user).to.equal(miner1.name);
          chai.expect(miner1_row.daily_points).to.equal(2 ** 16 - 1);
          chai
            .expect(miner1_row.total_points)
            .to.equal(miner1_row_before.total_points + high_value_points);
          chai
            .expect(miner1_row.weekly_points)
            .to.equal(miner1_row_before.weekly_points + high_value_points);
          chai
            .expect(miner1_row.redeemable_points)
            .to.equal(miner1_row_before.redeemable_points + high_value_points);
        });
      }
    );
    context('addpoints with high values when setting daily', async () => {
      it('should cap at uint64::max', async () => {
        await userpoints.addpoints(miner4.name, 2 ** 16 + 100, refDate1Later, {
          from: userpoints.account,
        });

        const res = await userpoints.userpointsTable({
          indexPosition: 4,
          keyType: 'i64',
          reverse: true,
          limit: 100,
        });
        // find miner1
        const row = res.rows.find((x) => x.user === miner4.name);
        chai.expect(row.user).to.equal(miner4.name);
        chai.expect(row.daily_points).to.equal(2 ** 16 - 1);
      });
    });
  });

  context('Premintoffers', async () => {
    let nftowner1: Account;
    let nftowner2: Account;
    let creator1: Account;
    let creator2: Account;
    let asset_id1: string | number;
    let asset_id2: string | number;
    let asset_id3: string | number;

    context('crtpreoffer', async () => {
      before(async () => {
        creator1 = await AccountManager.createAccount('creator1');
        creator2 = await AccountManager.createAccount('creator2');
      });
      context('with invalid auth', async () => {
        it('should raise auth error', async () => {
          await assertMissingAuthority(
            userpoints.crtpreoffer(
              creator1.name,
              1,
              shared.NFT_COLLECTION,
              -1,
              1,
              'message',
              creator1.name,
              {
                auths: [
                  {
                    actor: creator1.name,
                    permission: 'active',
                  },
                ],
              }
            )
          );
        });
      });
      context('with valid auth', async () => {
        it('should create a premint offer', async () => {
          await userpoints.crtpreoffer(
            userpoints.account.name,
            1,
            shared.NFT_COLLECTION,
            -1,
            1,
            'message',
            creator1.name,
            {
              auths: [
                { actor: userpoints.account.name, permission: 'active' },
                {
                  actor: creator1.name,
                  permission: 'active',
                },
              ],
            }
          );
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows[0];
          chai.expect(offer).to.deep.equal({
            available_count: 0,
            next_asset_id: 0,
            offer_id: 1,
            creator: userpoints.account.name,
            required: 1,
            collection_name: shared.NFT_COLLECTION,
            template_id: -1,
            message: 'message',
            callback: creator1.name,
          });
        });
        it('calling again should reject with the same premint offer', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.crtpreoffer(
              userpoints.account.name,
              1,
              'changedcol',
              23,
              5,
              'message2',
              shared.userpoints.name,
              {
                from: userpoints.account,
              }
            ),
            'ERR:OFFER_EXISTS'
          );
        });
        it('calling update with the same premint offer should succeed', async () => {
          await userpoints.updpreoffer(
            userpoints.account.name,
            1,
            5,
            'message2',
            shared.userpoints.name,
            {
              from: userpoints.account,
            }
          );
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows[0];
          chai.expect(offer).to.deep.equal({
            available_count: 0,
            next_asset_id: 0,
            offer_id: 1,
            creator: userpoints.account.name,
            required: 5,
            collection_name: shared.NFT_COLLECTION,
            template_id: -1,
            message: 'message2',
            callback: shared.userpoints.name,
          });
        });
        it('updating somebody elses offer should fail', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.updpreoffer(creator2.name, 1, 0, 'message2', 'changed', {
              from: creator2,
            }),
            'ERR:PERMISSION_DENIED::'
          );
        });
        it('should create a second premint offer', async () => {
          await userpoints.crtpreoffer(
            userpoints.account.name,
            2,
            shared.NFT_COLLECTION,
            -1,
            1,
            'message',
            creator2.name,
            {
              from: userpoints.account,
            }
          );
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows[1];
          chai.expect(offer).to.deep.equal({
            available_count: 0,
            next_asset_id: 0,
            offer_id: 2,
            creator: userpoints.account.name,
            required: 1,
            collection_name: shared.NFT_COLLECTION,
            template_id: -1,
            message: 'message',
            callback: creator2.name,
          });
        });
      });
    });

    context('registering assets', async () => {
      before(async () => {
        nftowner1 = await AccountManager.createAccount('nftowner1');
        nftowner2 = await AccountManager.createAccount('nftowner2');
        await shared.atomicassets.mintasset(
          shared.eosioToken.account.name,
          shared.NFT_COLLECTION,
          shared.LAND_SCHEMA,
          -1,
          nftowner1.name,
          [{ key: 'cardid', value: ['uint16', 1] }] as any,
          '',
          [],
          { from: shared.eosioToken.account }
        );
        await shared.atomicassets.mintasset(
          shared.eosioToken.account.name,
          shared.NFT_COLLECTION,
          shared.LAND_SCHEMA,
          -1,
          nftowner1.name,
          [{ key: 'cardid', value: ['uint16', 2] }] as any,
          '',
          [],
          { from: shared.eosioToken.account }
        );
        await shared.atomicassets.mintasset(
          shared.eosioToken.account.name,
          shared.NFT_COLLECTION,
          shared.LAND_SCHEMA,
          -1,
          nftowner1.name,
          [{ key: 'cardid', value: ['uint16', 3] }] as any,
          '',
          [],
          { from: shared.eosioToken.account }
        );
        let res = await shared.atomicassets.assetsTable({
          scope: nftowner1.name,
        });
        asset_id1 = res.rows[0].asset_id;
        asset_id2 = res.rows[1].asset_id;
        asset_id3 = res.rows[2].asset_id;
      });
      it('depositing NFT with negative offer id should fail', async () => {
        await assertEOSErrorIncludesMessage(
          shared.atomicassets.transfer(
            nftowner1.name,
            shared.userpoints.account.name,
            [asset_id1],
            '-1',
            { from: nftowner1 }
          ),
          'ERR:INVALID_MEMO::'
        );
      });
      it('transferring NFT with malformed memo should fail', async () => {
        await assertEOSErrorIncludesMessage(
          shared.atomicassets.transfer(
            nftowner1.name,
            shared.userpoints.account.name,
            [asset_id1],
            'transfer',
            { from: nftowner1 }
          ),
          'ERR:INVALID_MEMO::'
        );
        await assertEOSErrorIncludesMessage(
          shared.atomicassets.transfer(
            nftowner1.name,
            shared.userpoints.account.name,
            [asset_id1],
            '1:transfer',
            { from: nftowner1 }
          ),
          'ERR:INVALID_MEMO::'
        );
      });
      it('transferring NFT with invalid offer id should fail', async () => {
        await assertEOSErrorIncludesMessage(
          shared.atomicassets.transfer(
            nftowner1.name,
            shared.userpoints.account.name,
            [asset_id1],
            '12345',
            { from: nftowner1 }
          ),
          'ERR:OFFER_DOES_NOT_EXIST::'
        );
      });
      it('transferring NFT with correct memo should work', async () => {
        await shared.atomicassets.transfer(
          nftowner1.name,
          shared.userpoints.account.name,
          [asset_id1],
          '1',
          { from: nftowner1 }
        );
      });

      it('should add premintasset and update premintoffrs entry', async () => {
        const preasset_res = await userpoints.preassetsTable();
        const asset = preasset_res.rows[0];
        chai.expect(asset).to.deep.equal({
          asset_id: asset_id1,
          offer_id: 1,
        });

        const res = await userpoints.premintoffrsTable();
        const offer = res.rows[0];
        chai.expect(offer).to.deep.equal({
          available_count: 1,
          next_asset_id: asset.asset_id,
          offer_id: 1,
          creator: userpoints.account.name,
          required: 5,
          collection_name: shared.NFT_COLLECTION,
          template_id: -1,
          message: 'message2',
          callback: shared.userpoints.name,
        });
      });
      it('transferring NFT 2 with correct memo should work', async () => {
        await shared.atomicassets.transfer(
          nftowner1.name,
          shared.userpoints.account.name,
          [asset_id2],
          '1',
          { from: nftowner1 }
        );
      });
      it('should add 2nd premintasset and update premintoffrs entry', async () => {
        const preasset_res = await userpoints.preassetsTable();
        const asset1 = preasset_res.rows[0];
        const asset2 = preasset_res.rows[1];
        chai.expect(asset1).to.deep.equal({
          asset_id: asset_id1,
          offer_id: 1,
        });
        chai.expect(asset2).to.deep.equal({
          asset_id: asset_id2,
          offer_id: 1,
        });

        const res = await userpoints.premintoffrsTable();
        const offer = res.rows[0];
        chai.expect(offer).to.deep.equal({
          available_count: 2,
          next_asset_id: asset1.asset_id,
          offer_id: 1,
          creator: userpoints.account.name,
          required: 5,
          collection_name: shared.NFT_COLLECTION,
          template_id: -1,
          message: 'message2',
          callback: shared.userpoints.name,
        });
      });
    });

    context('redeemprenft', async () => {
      context('without user auth', async () => {
        it('should fail', async () => {
          await assertMissingAuthority(
            userpoints.redeemprenft(nftowner1.name, '123')
          );
        });
      });
      context('with invalid asset_id', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.redeemprenft(nftowner1.name, '123', {
              from: nftowner1,
            }),
            'ERR:OFFER_DOES_NOT_EXIST::'
          );
        });
      });
      context('without any points', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.redeemprenft(nftowner1.name, 1, {
              from: nftowner1,
            }),
            'No points to redeem'
          );
        });
      });
      context('with an insufficient number of points', async () => {
        before(async () => {
          await openUser(nftowner1);
          await shared.acceptTerms(nftowner1);
          await userpoints.addpoints(nftowner1.name, 1, new Date());
        });
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            userpoints.redeemprenft(nftowner1.name, 1, {
              from: nftowner1,
            }),
            'Not enough points available'
          );
        });
      });
      context('with good parameters', async () => {
        before(async () => {
          await sleep(1000);
          await userpoints.addpoints(nftowner1.name, 5, new Date());
          await shared.atomicassets.transfer(
            nftowner1.name,
            shared.userpoints.name,
            [asset_id3],
            `1`,
            { from: nftowner1 }
          );
        });
        it('establish next_asset_id before redeemprenft', async () => {
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows[0];
          chai.expect(offer).to.deep.equal({
            available_count: 3,
            next_asset_id: asset_id1,
            offer_id: 1,
            creator: userpoints.account.name,
            required: 5,
            collection_name: shared.NFT_COLLECTION,
            template_id: -1,
            message: 'message2',
            callback: shared.userpoints.name,
          });
        });
        it('should work', async () => {
          await userpoints.redeemprenft(nftowner1.name, 1, {
            from: nftowner1,
          });
        });
        it('should have updated next_asset_id', async () => {
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows[0];
          chai.expect(offer).to.deep.equal({
            available_count: 2,
            next_asset_id: asset_id2,
            offer_id: 1,
            creator: userpoints.account.name,
            required: 5,
            collection_name: shared.NFT_COLLECTION,
            template_id: -1,
            message: 'message2',
            callback: shared.userpoints.name,
          });
        });
        it('should have transferred the NFT to the user', async () => {
          const res = await shared.atomicassets.assetsTable({
            scope: nftowner1.name,
          });
          const found_asset = res.rows.find((x) => x.asset_id === asset_id1);
          chai.expect(found_asset).to.not.be.undefined;
          chai.expect(found_asset.asset_id).to.equal(asset_id1);
        });
        it('should have deducted userpoints', async () => {
          const res = await userpoints.userpointsTable({
            lowerBound: nftowner1.name,
            upperBound: nftowner1.name,
          });
          chai.expect(res.rows[0].user).to.equal(nftowner1.name);
          chai.expect(res.rows[0].redeemable_points).to.equal(1);
        });
        it('should have notified callback', async () => {
          const res = await userpoints.logredeemTable();
          const data = res.rows[0].data;
          chai.expect(data[0].key).to.equal('count');
          chai.expect(data[0].value).to.deep.equal(['uint8', 1]);
        });
      });
    });

    context('remove pre offer', async () => {
      context('with invalid auth', async () => {
        it('should fail', async () => {
          await assertMissingAuthority(
            userpoints.rmvpreoffer('1', 1, miner1.name, {
              from: miner1,
            })
          );
        });
      });
      context('with valid auth', async () => {
        it('should have mulitple assets in the offer table', async () => {
          const assets = await userpoints.preassetsTable();
          chai.expect(assets.rows.length).to.equal(2);
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows.find((x) => x.offer_id == 1);
          chai.expect(offer.available_count).to.equal(2);
          chai.expect(offer.offer_id).to.equal(1);
          chai.expect(offer.creator).to.equal(userpoints.account.name);
          chai.expect(offer.required).to.equal(5);
          chai.expect(offer.collection_name).to.equal(shared.NFT_COLLECTION);
          chai.expect(offer.template_id).to.equal(-1);
        });
        it('should remove partial assets from offer', async () => {
          await userpoints.rmvpreoffer('1', 1, miner1.name, {
            from: userpoints.account,
          });
          const assets = await userpoints.preassetsTable();
          chai.expect(assets.rows.length).to.equal(1);
          const res = await userpoints.premintoffrsTable();
          const offer = res.rows[0];
          chai.expect(offer.available_count).to.equal(1);
          chai.expect(offer.offer_id).to.equal(1);
          chai.expect(offer.creator).to.equal(userpoints.account.name);
          chai.expect(offer.required).to.equal(5);
          chai.expect(offer.collection_name).to.equal(shared.NFT_COLLECTION);
          chai.expect(offer.template_id).to.equal(-1);
        });
        it('should remove all remove offer', async () => {
          await sleep(1000); // avoid duplicate txn
          await userpoints.rmvpreoffer('1', 1, miner1.name, {
            from: userpoints.account,
          });
        });
        it('should have no assets in the offer table', async () => {
          const assets = await userpoints.preassetsTable();
          chai.expect(assets.rows.length).to.equal(0);
        });
        it('should have remove offer from the table', async () => {
          const offer = await userpoints.premintoffrsTable({
            lowerBound: 1,
            upperBound: 1,
          });
          chai.expect(offer.rows.length).to.deep.equal(0);
        });
      });
    });
  });
  context('reclaim', async () => {
    let before_expiry: Date;
    let after_expiry: Date;
    let users_before: Number;
    before(async () => {
      before_expiry = await referenceTimeWithAddedHours(80 * 24);
      after_expiry = await referenceTimeWithAddedHours(190 * 24);
      users_before = (await userpoints.userpointsTable()).rows.length;
    });
    context('before exipry', async () => {
      it('reclaim should work', async () => {
        await userpoints.reclaim(
          [
            miner1.name,
            miner2.name,
            miner3.name,
            miner4.name,
            'idxuserefd1',
            'idxuserefdl1',
            'idxuserefd2',
            'idxuserefdl2',
            'idxuserefdw1',
            'idxuserefdw2',
            'idxuserefd21',
          ],
          before_expiry,
          {
            from: userpoints.account,
          }
        );
      });
      it('should NOT have removed the users', async () => {
        const res = await userpoints.userpointsTable();
        chai.expect(res.rows.length).to.equal(users_before);
      });
    });
    context('after exipry', async () => {
      it('reclaim should work', async () => {
        await userpoints.reclaim(
          [miner2.name, miner3.name, 'idxuserefdw2', 'idxuserefd21'],
          after_expiry,
          {
            from: userpoints.account,
          }
        );
      });
      it('should have removed all users except not expired ones', async () => {
        const res = await userpoints.userpointsTable();
        const users_after = res.rows.map((x) => x.user);
        const shouldRemain = [
          'idxuserefd1',
          'idxuserefd2',
          'idxuserefd21',
          'idxuserefdl1',
          'idxuserefdl2',
          'idxuserefdw1',
          'idxuserefdw2',
          'miner1',
          'miner4',
        ];
        const shouldBeRemoved = ['miner2', 'miner3'];

        // Survivors present
        shouldRemain.forEach((u) => chai.expect(users_after).to.include(u));
        // Expired users removed
        shouldBeRemoved.forEach((u) =>
          chai.expect(users_after).to.not.include(u)
        );
      });
    });
  });

  context('close', async () => {
    let userToClose: Account;
    let userWithPoints: Account;

    before(async () => {
      userToClose = await AccountManager.createAccount('closetestusr');
      userWithPoints = await AccountManager.createAccount('closewithpts');

      await openUser(userToClose);
      await acceptTerms(userToClose);

      await openUser(userWithPoints);
      await acceptTerms(userWithPoints);
      await userpoints.addpoints(userWithPoints.name, 50, new Date(), {
        from: userpoints.account,
      });
    });

    context('with wrong auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          userpoints.unreguser(userToClose.name, { from: miner1 })
        );
      });
    });

    context('when user points record does not exist', async () => {
      let nonExistentUser: Account;
      before(async () => {
        nonExistentUser = await AccountManager.createAccount('nonexistent');
        // Do not call openUser for nonExistentUser
      });
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          userpoints.unreguser(nonExistentUser.name),
          `User points not found for user ${nonExistentUser.name}`
        );
      });
    });

    context('with correct auth', async () => {
      it('should succeed', async () => {
        await userpoints.unreguser(userWithPoints.name);
      });

      it('should remove user record from table', async () => {
        const res = await userpoints.userpointsTable({
          lowerBound: userWithPoints.name,
          upperBound: userWithPoints.name,
        });
        chai.expect(res.rows.length).to.equal(0);
      });
    });
  });
});

async function seedAccounts() {
  userpoints = shared.userpoints;
  federation = shared.federation;

  miner1 = await AccountManager.createAccount('miner1');
  miner2 = await AccountManager.createAccount('miner2');
  await acceptTerms(miner2);

  miner3 = await AccountManager.createAccount('miner3');
  await acceptTerms(miner3);
  miner4 = await AccountManager.createAccount('miner4');
  await acceptTerms(miner4);

  // Call open for all seeded users
  await openUser(miner1);
  await openUser(miner2);
  await openUser(miner3);
  await openUser(miner4);
}
async function acceptTerms(user: Account) {
  await federation.agreeterms(
    user.name,
    1,
    '1212121212121212121212121212121212121212121212121212121212121212',
    {
      from: user,
    }
  );
}
