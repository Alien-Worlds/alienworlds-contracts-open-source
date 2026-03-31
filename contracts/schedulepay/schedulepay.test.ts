import {
  ContractDeployer,
  assertRowsEqual,
  AccountManager,
  Account,
  assertRowCount,
  UpdateAuth,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  EOSManager,
  sleep,
  Asset,
} from 'lamington';
import * as chai from 'chai';
// import { Dayjs } from 'dayjs';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
dayjs.extend(utc);
import { SharedTestObjects } from '../TestHelpers';
import { Schedulepay } from './schedulepay';

describe('SchedulePay', () => {
  let shared: SharedTestObjects;
  let user1: Account;
  let user2: Account;
  let user3: Account;
  let anybody: Account;
  let points_manager1: Account;
  let points_manager2: Account;
  let now: Dayjs;
  let schedulePayContract: Schedulepay;

  before(async () => {
    now = dayjs.utc().millisecond(0);
    shared = await SharedTestObjects.getInstance();
    user1 = await AccountManager.createAccount('spuser1');
    user2 = await AccountManager.createAccount('spuser2');
    user3 = await AccountManager.createAccount('spuser3');
    anybody = await AccountManager.createAccount('anybody');
    schedulePayContract = await ContractDeployer.deployWithName<Schedulepay>(
      'schedulepay',
      'schedulepay'
    );

    await UpdateAuth.execUpdateAuth(
      schedulePayContract.account.active,
      schedulePayContract.name,
      'active',
      'owner',
      UpdateAuth.AuthorityToSet.explicitAuthorities(
        1,
        [
          {
            permission: {
              actor: schedulePayContract.account.name,
              permission: 'eosio.code',
            },
            weight: 1,
          },
        ],
        [{ key: schedulePayContract.account.publicKey!, weight: 1 }]
      )
    );
  });

  context('add schedule', async () => {
    // let now: Dayjs;
    before(async () => {
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        schedulePayContract.account.name,
        new Asset('10000.0000 TLM'),
        'for schedulepay',
        { from: shared.infl.account }
      );
    });
    context('without proper auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          schedulePayContract.addschedule(
            user1.name,
            { quantity: '1000.1234 TLM', contract: 'alien.worlds' },
            10,
            'memo string',
            { from: anybody }
          )
        );
      });
    });
    context('with non-existent to account', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          schedulePayContract.addschedule(
            'nonexistent',
            { quantity: '1000.4321 TLM', contract: 'alien.worlds' },
            10,
            'memo string',
            { from: schedulePayContract.account }
          ),
          'to account does not exist'
        );
      });
    });

    context('with too long memo', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          schedulePayContract.addschedule(
            user1.name,
            { quantity: '1000.1234 TLM', contract: 'alien.worlds' },
            10,
            'a'.repeat(257),
            { from: schedulePayContract.account }
          ),
          'memo has more than 256 bytes'
        );
      });
    });
    context('with valid input', async () => {
      it('should work', async () => {
        await schedulePayContract.addschedule(
          user1.name,
          { quantity: '10.5555 TLM', contract: 'alien.worlds' },
          10,
          'memo string',
          { from: schedulePayContract.account }
        );
      });
    });
    context('schedule table should be updated', async () => {
      it('should have added the schedule', async () => {
        await assertRowsEqual(schedulePayContract.schedulesTable(), [
          {
            id: 0,
            to: user1.name,
            quantity: { quantity: '10.5555 TLM', contract: 'alien.worlds' },
            frequency: 10,
            memo: 'memo string',
            last_pay_time: new Date(0),
            active: true,
          },
        ]);
      });
    });
  });
  context('set inactive', async () => {
    context('with wrong auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          schedulePayContract.setactive(0, false, { from: anybody })
        );
      });
    });
    context('with valid input', async () => {
      it('should work', async () => {
        await schedulePayContract.setactive(0, false, {
          from: schedulePayContract.account,
        });
      });
    });
    context('After setting active to false', async () => {
      it('should have updated the schedule to be inactive', async () => {
        await assertRowsEqual(schedulePayContract.schedulesTable(), [
          {
            id: 0,
            to: user1.name,
            quantity: { quantity: '10.5555 TLM', contract: 'alien.worlds' },
            frequency: 10,
            memo: 'memo string',
            last_pay_time: new Date(0),
            active: false,
          },
        ]);
      });
    });
  });
  context('remove', async () => {
    context('with invalid id', async () => {
      it('should fail with not found error', async () => {
        assertEOSErrorIncludesMessage(
          schedulePayContract.remove(1, {
            from: schedulePayContract.account,
          }),
          'schedule not found'
        );
      });
    });
    context('with valid id', async () => {
      context('with invalid auth', async () => {
        it('should fail with auth error', async () => {
          assertMissingAuthority(
            schedulePayContract.remove(0, { from: anybody })
          );
        });
      });
      context('with valid auth', async () => {
        it('should succeed', async () => {
          await schedulePayContract.remove(0, {
            from: schedulePayContract.account,
          });
        });
        it('should remove the schedle', async () => {
          await assertRowCount(schedulePayContract.schedulesTable(), 0);
        });
      });
    });
  });
  context('updateschedule', async () => {
    before(async () => {
      await schedulePayContract.addschedule(
        user1.name,
        { quantity: '10.2345 TLM', contract: 'alien.worlds' },
        10,
        'update schedule string',
        { from: schedulePayContract.account }
      );
    });
    context('with invalid auth', async () => {
      it('should fail with auth error', async () => {
        assertMissingAuthority(
          schedulePayContract.updschedule(0, null, null, null, null, {
            from: anybody,
          })
        );
      });
    });
    context('with nothing to update', async () => {
      it('should fail with nothing to update error', async () => {
        assertEOSErrorIncludesMessage(
          schedulePayContract.updschedule(0, null, null, null, null, {
            from: schedulePayContract.account,
          }),
          'nothing to update'
        );
      });
    });
    context('with invalid id', async () => {
      it('should fail with not found error', async () => {
        assertEOSErrorIncludesMessage(
          schedulePayContract.updschedule(1, user1.name, null, null, null, {
            from: schedulePayContract.account,
          }),
          'id not found'
        );
      });
    });
    context('account', async () => {
      context('with invalid account', async () => {
        it('should fail with invalid to account error', async () => {
          assertEOSErrorIncludesMessage(
            schedulePayContract.updschedule(0, 'invalid', null, null, null, {
              from: schedulePayContract.account,
            }),
            'to account does not exist'
          );
        });
      });
      context('with valid account', async () => {
        it('should succeed to update `to`', async () => {
          await schedulePayContract.updschedule(
            0,
            user2.name,
            null,
            null,
            null,
            {
              from: schedulePayContract.account,
            }
          );
        });
        it('should have updated the `to`', async () => {
          await assertRowsEqual(schedulePayContract.schedulesTable(), [
            {
              id: 0,
              to: user2.name,
              quantity: { quantity: '10.2345 TLM', contract: 'alien.worlds' },
              frequency: 10,
              memo: 'update schedule string',
              last_pay_time: new Date(0),
              active: true,
            },
          ]);
        });
      });
      context('with valid asset', async () => {
        it('should succeed to update `asset`', async () => {
          await schedulePayContract.updschedule(
            0,
            null,
            { quantity: '20.3453 TLM', contract: 'alien.worlds' },
            null,
            null,
            {
              from: schedulePayContract.account,
            }
          );
        });
        it('should have updated the `asset`', async () => {
          await assertRowsEqual(schedulePayContract.schedulesTable(), [
            {
              id: 0,
              to: user2.name,
              quantity: { quantity: '20.3453 TLM', contract: 'alien.worlds' },
              frequency: 10,
              memo: 'update schedule string',
              last_pay_time: new Date(0),
              active: true,
            },
          ]);
        });
      });
      context('with frequency', async () => {
        it('should succeed to update `frequency`', async () => {
          await schedulePayContract.updschedule(0, null, null, 20, null, {
            from: schedulePayContract.account,
          });
        });
        it('should have updated the `frequency`', async () => {
          await assertRowsEqual(schedulePayContract.schedulesTable(), [
            {
              id: 0,
              to: user2.name,
              quantity: { quantity: '20.3453 TLM', contract: 'alien.worlds' },
              frequency: 20,
              memo: 'update schedule string',
              last_pay_time: new Date(0),
              active: true,
            },
          ]);
        });
      });
      context('with memo', async () => {
        context('longer than 256 chars', async () => {
          it('should fail with length error', async () => {
            assertEOSErrorIncludesMessage(
              schedulePayContract.updschedule(
                0,
                null,
                null,
                null,
                'a'.repeat(257),
                {
                  from: schedulePayContract.account,
                }
              ),
              'memo has more than 256 bytes'
            );
          });
        });
        context('with valid string', async () => {
          it('should succeed to update `memo`', async () => {
            await schedulePayContract.updschedule(
              0,
              null,
              null,
              null,
              'new memo string',
              {
                from: schedulePayContract.account,
              }
            );
          });
          it('should have updated the `memo`', async () => {
            await assertRowsEqual(schedulePayContract.schedulesTable(), [
              {
                id: 0,
                to: user2.name,
                quantity: { quantity: '20.3453 TLM', contract: 'alien.worlds' },
                frequency: 20,
                memo: 'new memo string',
                last_pay_time: new Date(0),
                active: true,
              },
            ]);
          });
        });
      });
    });
  });
  context('claim', async () => {
    before(async () => {
      await schedulePayContract.addschedule(
        user1.name,
        { quantity: '10.2345 TLM', contract: 'alien.worlds' },
        10,
        'claim schedule string',
        { from: schedulePayContract.account }
      );
      await schedulePayContract.setactive(1, false, {
        from: schedulePayContract.account,
      });
    });
    context('with invalid schedule', async () => {
      it('should fail with not found error', async () => {
        await assertEOSErrorIncludesMessage(
          schedulePayContract.claim(5, { from: user1 }),
          'id not found'
        );
      });
    });
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        assertMissingAuthority(schedulePayContract.claim(1, { from: anybody }));
      });
    });
    context('with valid auth', async () => {
      context('with inactive schedule', async () => {
        it('should fail with inactive error', async () => {
          await assertEOSErrorIncludesMessage(
            schedulePayContract.claim(1, { from: user1 }),
            'schedule is not active'
          );
        });
      });
      context('with active schedule', async () => {
        before(async () => {
          await schedulePayContract.setactive(1, true, {
            from: schedulePayContract.account,
          });
        });
        it('should succeed', async () => {
          await schedulePayContract.claim(1, { from: user1 });
        });
      });
      context('table should update', async () => {
        it('should have updated the last_pay_time', async () => {
          const result = await schedulePayContract.schedulesTable({
            lowerBound: 1,
            upperBound: 1,
          });
          const last_pay_time = result.rows[0].last_pay_time;
          chai.expect(last_pay_time).to.be.greaterThan(new Date(0));
        });
        it('should update schedule pay balance', async () => {
          const balance = await shared.getBalance(schedulePayContract.account);
          chai.expect(balance).to.be.equal(10000 - 10.2345);
        });
        it('should update user1 balance', async () => {
          const balance = await shared.getBalance(user1);
          chai.expect(balance).to.be.equal(10.2345);
        });
      });
      context('claim again too soon', async () => {
        it('should fail with too soon error', async () => {
          assertEOSErrorIncludesMessage(
            schedulePayContract.claim(1, { from: user1 }),
            'too soon'
          );
        });
      });
      context('After waiting for time', async () => {
        before(async () => {
          await sleep(11000);
        });
        it('should succeed', async () => {
          await schedulePayContract.claim(1, { from: user1 });
        });
        it('should have updated the last_pay_time', async () => {
          const result = await schedulePayContract.schedulesTable({
            lowerBound: 1,
            upperBound: 1,
          });
          const last_pay_time = result.rows[0].last_pay_time;
          chai.expect(last_pay_time).to.be.greaterThan(new Date(0));
        });
        it('should update schedule pay balance', async () => {
          const balance = await shared.getBalance(schedulePayContract.account);
          chai.expect(balance).to.be.equal(10000 - 10.2345 * 2);
        });
        it('should update user1 balance', async () => {
          const balance = await shared.getBalance(user1);
          chai.expect(balance).to.be.equal(10.2345 * 2);
        });
      });
    });
  });

  context('claim with send_remainder_balance', async () => {
    before(async () => {
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        schedulePayContract.account.name,
        new Asset('20000.0000 TLM'),
        'reset balance for testing',
        { from: shared.infl.account }
      );

      await schedulePayContract.addschedule(
        user1.name,
        { quantity: '10000.0000 TLM', contract: 'alien.worlds' },
        10,
        'test send_remainder_balance',
        { from: schedulePayContract.account }
      );
      await schedulePayContract.setactive(2, true, {
        from: schedulePayContract.account,
      });

      await schedulePayContract.setpayremain(true, {
        from: schedulePayContract.account,
      });
    });

    it('should transfer the minimum of available balance and scheduled quantity when send_remainder_balance is true', async () => {
      const initialContractBalance = await shared.getBalance(
        schedulePayContract.account
      );
      const initialUserBalance = await shared.getBalance(user1);

      await schedulePayContract.claim(2, { from: user1 });

      const finalContractBalance = await shared.getBalance(
        schedulePayContract.account
      );
      const finalUserBalance = await shared.getBalance(user1);

      const expectedTransfer = Math.min(
        10000,
        parseFloat(initialContractBalance.toString())
      );
      const expectedContractBalance =
        parseFloat(initialContractBalance.toString()) - expectedTransfer;
      const expectedUserBalance =
        parseFloat(initialUserBalance.toString()) + expectedTransfer;

      chai
        .expect(parseFloat(finalContractBalance.toString()))
        .to.be.closeTo(expectedContractBalance, 0.0001);
      chai
        .expect(parseFloat(finalUserBalance.toString()))
        .to.be.closeTo(expectedUserBalance, 0.0001);
    });
    context('setpayremain', () => {
      it('should set send_remainder_balance to true', async () => {
        await schedulePayContract.setpayremain(true, {
          from: schedulePayContract.account,
        });
        const state = await schedulePayContract.globalsTable();
        const send_remainder_balance = await shared.singleton_get(
          state,
          'send_remainder_balance'
        );
        chai.expect(send_remainder_balance).to.equal(1);
      });

      it('should set send_remainder_balance to false', async () => {
        await schedulePayContract.setpayremain(false, {
          from: schedulePayContract.account,
        });
        const state = await schedulePayContract.globalsTable();
        const send_remainder_balance = await shared.singleton_get(
          state,
          'send_remainder_balance'
        );
        chai.expect(send_remainder_balance).to.be.undefined;
      });

      it('should fail when called by non-authorized user', async () => {
        await assertMissingAuthority(
          schedulePayContract.setpayremain(true, { from: user1 })
        );
      });
    });

    it('should transfer the scheduled quantity when send_remainder_balance is false', async () => {
      await sleep(12000);

      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        schedulePayContract.account.name,
        new Asset('20000.0000 TLM'),
        'reset balance for testing',
        { from: shared.infl.account }
      );
      await schedulePayContract.setpayremain(false, {
        from: schedulePayContract.account,
      });

      const initialContractBalance = await shared.getBalance(
        schedulePayContract.account
      );
      const initialUserBalance = await shared.getBalance(user1);

      console.log('Initial contract balance:', initialContractBalance);
      console.log('Initial user1 balance:', initialUserBalance);

      await schedulePayContract.claim(2, { from: user1 });

      const finalContractBalance = await shared.getBalance(
        schedulePayContract.account
      );
      const finalUserBalance = await shared.getBalance(user1);

      const expectedTransfer = 10000;
      const expectedContractBalance =
        parseFloat(initialContractBalance.toString()) - expectedTransfer;
      const expectedUserBalance =
        parseFloat(initialUserBalance.toString()) + expectedTransfer;

      chai
        .expect(parseFloat(finalContractBalance.toString()))
        .to.be.closeTo(expectedContractBalance, 0.0001);
      chai
        .expect(parseFloat(finalUserBalance.toString()))
        .to.be.closeTo(expectedUserBalance, 0.0001);
    });
  });
});
