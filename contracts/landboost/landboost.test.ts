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
} from 'lamington';
import * as chai from 'chai';
import { SharedTestObjects } from '../TestHelpers';

describe('LandBoost', () => {
  let shared: SharedTestObjects;
  let user1: Account;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    user1 = await AccountManager.createAccount();
    await shared.eosioToken.transfer(
      shared.tokenIssuer.name,
      user1.name,
      '1000.0000 TLM',
      'test money',
      { from: shared.tokenIssuer }
    );
  });

  context('Deposit', async () => {
    context('with invalid parameter', async () => {
      before(async () => {
        await shared.eosioToken.create(shared.tokenIssuer.name, '10.0000 ABC', {
          from: new Account(shared.NFT_COLLECTION),
        });

        await shared.eosioToken.issue(
          shared.tokenIssuer.name,
          '10.0000 ABC',
          'initial issue',
          {
            from: shared.tokenIssuer,
          }
        );
        await shared.eosioToken.transfer(
          shared.tokenIssuer.name,
          user1.name,
          '10.0000 ABC',
          'wrong token',
          { from: shared.tokenIssuer }
        );
      });
      it('wrong symbol should fail', async () => {
        await assertEOSErrorIncludesMessage(
          shared.eosioToken.transfer(
            user1.name,
            shared.landboost.account.name,
            '1.0000 ABC',
            'deposit',
            { from: user1 }
          ),
          'ftransfer: We only accept 4,TLM tokens, not 4,ABC'
        );
      });
    });
    context('with correct TLM token', async () => {
      it('should succeed', async () => {
        await shared.eosioToken.transfer(
          user1.name,
          shared.landboost.account.name,
          '100.0000 TLM',
          'deposit',
          { from: user1 }
        );
      });
      it('should increase balance', async () => {
        await assertRowsEqual(
          shared.eosioToken.accountsTable({
            scope: shared.landboost.account.name,
          }),
          [{ balance: '100.0000 TLM' }]
        );
      });
      it('should register the deposit with the landholders contract', async () => {
        await assertRowsEqual(
          shared.landholders.depositsTable({
            scope: shared.landholders.account.name,
          }),
          [{ account: user1.name, quantity: '100.0000 TLM' }]
        );
      });
    });
    context('Withdraw', async () => {
      it('should fail without proper auth', async () => {
        await assertMissingAuthority(
          shared.landboost.withdraw(user1.name, '101.0000 TLM')
        );
      });
      it('should not be able to withdraw more than deposited', async () => {
        await assertEOSErrorIncludesMessage(
          shared.landboost.withdraw(user1.name, '101.0000 TLM', {
            from: user1,
          }),
          'Overdrawn balance'
        );
      });
      it('partial withdraw should succeed', async () => {
        await shared.landboost.withdraw(user1.name, '50.0000 TLM', {
          from: user1,
        });
      });
      it('should reduce deposit', async () => {
        await assertRowsEqual(
          shared.landholders.depositsTable({
            scope: shared.landholders.account.name,
          }),
          [{ account: user1.name, quantity: '50.0000 TLM' }]
        );
      });
      it('full withdraw should succeed', async () => {
        await shared.landboost.withdraw(user1.name, '50.0000 TLM', {
          from: user1,
        });
      });
      it('should delete deposit table entry', async () => {
        await assertRowsEqual(
          shared.landholders.depositsTable({
            scope: shared.landholders.account.name,
          }),
          []
        );
      });
    });
  });
});
