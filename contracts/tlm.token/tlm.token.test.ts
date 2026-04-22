import * as l from 'lamington';
import { expect } from 'chai';
import { SharedTestObjects } from '../TestHelpers';
import { TlmToken } from './tlm.token';

describe('tlm.token', () => {
  let tokenContract: TlmToken;
  let issuer: l.Account;
  let otherAccount: l.Account;
  let shared: SharedTestObjects;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    tokenContract = shared.eosioToken;
    issuer = await l.AccountManager.createAccount();
    otherAccount = await l.AccountManager.createAccount();
  });

  context('create action', async () => {
    it('should create a new token', async () => {
      await tokenContract.create(issuer.name, '1000000.0000 TOK');
      const stats = await tokenContract.statTable({ scope: 'TOK' });
      expect(stats.rows).to.deep.include({
        supply: '0.0000 TOK',
        max_supply: '1000000.0000 TOK',
        issuer: issuer.name,
      });
    });

    it('should fail to create a token with the same symbol', async () => {
      await l.assertEOSErrorIncludesMessage(
        tokenContract.create(issuer.name, '1000000.0000 TOK'),
        'token with symbol already exists'
      );
    });

    it('should fail to create a token with invalid maximum supply', async () => {
      await l.assertEOSErrorIncludesMessage(
        tokenContract.create(issuer.name, '-1000.0000 TOK'),
        'max-supply must be positive'
      );
    });
  });

  context('issue action', async () => {
    it('should issue new tokens to the issuer', async () => {
      await tokenContract.issue(issuer.name, '1000.0000 TOK', 'Issue tokens', {
        from: issuer,
      });

      await l.assertRowsEqual(
        tokenContract.accountsTable({
          scope: issuer.name,
        }),
        [{ balance: '1000.0000 TOK' }]
      );
    });

    it('should fail to issue tokens to a non-issuer account', async () => {
      await l.assertEOSErrorIncludesMessage(
        tokenContract.issue(
          otherAccount.name,
          '1000.0000 TOK',
          'Issue tokens',
          { from: issuer }
        ),
        'tokens can only be issued to issuer account'
      );
    });

    it('should fail to issue tokens exceeding the maximum supply', async () => {
      await l.assertEOSErrorIncludesMessage(
        tokenContract.issue(issuer.name, '1000001.0000 TOK', 'Issue tokens', {
          from: issuer,
        }),
        'quantity exceeds available supply'
      );
    });
  });

  context('transfer action', async () => {
    it('should transfer tokens between accounts', async () => {
      await tokenContract.transfer(
        issuer.name,
        otherAccount.name,
        '100.0000 TOK',
        'Transfer tokens',
        { from: issuer }
      );
      const accounts = await tokenContract.accountsTable({
        scope: otherAccount.name,
      });
      await l.assertRowsEqual(
        tokenContract.accountsTable({
          scope: issuer.name,
        }),
        [{ balance: '900.0000 TOK' }]
      );
      await l.assertRowsEqual(
        tokenContract.accountsTable({
          scope: otherAccount.name,
        }),
        [{ balance: '100.0000 TOK' }]
      );
    });

    it('should fail to transfer more tokens than the balance', async () => {
      await l.assertEOSErrorIncludesMessage(
        tokenContract.transfer(
          issuer.name,
          otherAccount.name,
          '1000.0000 TOK',
          'Transfer tokens',
          { from: issuer }
        ),
        'overdrawn balance'
      );
    });
  });

  context('addvesting action', async () => {
    it('with wrong permissions, should raise an error', async () => {
      const anybody = await l.AccountManager.createAccount();
      await l.assertMissingAuthority(
        tokenContract.addvesting(issuer.name, new Date(), 5, '100.0000 TOK', {
          from: anybody,
        })
      );
    });
    it('should add a vesting schedule to an account', async () => {
      const now = new Date();
      await tokenContract.addvesting(issuer.name, now, 5, '100.0000 TOK');
      const vestings = await tokenContract.vestingsTable();
      const vesting = vestings.rows[0];
      expect(vesting.account).to.equal(issuer.name);
      expect(vesting.vesting_length).to.equal(5);
      expect(vesting.vesting_quantity).to.equal('100.0000 TOK');
    });
  });

  context('pause action', async () => {
    context('with wrong permissions', async () => {
      it('should raise auth error', async () => {
        const anybody = await l.AccountManager.createAccount();
        await l.assertMissingAuthority(tokenContract.pause({ from: anybody }));
      });
    });

    context('when contract is paused', async () => {
      before(async () => {
        await tokenContract.pause();
      });

      it('should prevent creating a new token', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.create(issuer.name, '1000.0000 TOK'),
          'Contract is paused'
        );
      });

      it('should prevent issuing new tokens', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.issue(issuer.name, '100.0000 TOK', 'Issue tokens', {
            from: issuer,
          }),
          'Contract is paused'
        );
      });

      it('should prevent transferring tokens', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.transfer(
            issuer.name,
            otherAccount.name,
            '10.0000 TOK',
            'Transfer tokens',
            { from: issuer }
          ),
          'Contract is paused'
        );
      });

      it('should prevent burning tokens', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.burn(issuer.name, '10.0000 TOK', 'Burn tokens', {
            from: issuer,
          }),
          'Contract is paused'
        );
      });

      it('should prevent opening an account', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.open(
            otherAccount.name,
            '4,TOK',
            shared.eosioToken.name
          ),
          'Contract is paused'
        );
      });

      it('should prevent closing an account', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.close(otherAccount.name, '4,TOK', {
            from: otherAccount,
          }),
          'Contract is paused'
        );
      });

      it('should prevent adding vesting to an account', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.addvesting(issuer.name, new Date(), 5, '100.0000 TOK'),
          'Contract is paused'
        );
      });
      it('trying to pause again should raise an error', async () => {
        await l.sleep(3000); // Prevent duplicate transaction error
        await l.assertEOSErrorIncludesMessage(
          tokenContract.pause(),
          'already paused'
        );
      });
    });

    context('when contract is unpaused', async () => {
      before(async () => {
        await tokenContract.unpause();
      });

      it('should allow creating a new token', async () => {
        await tokenContract.create(issuer.name, '1000.0000 TOKX');
      });

      it('should allow issuing new tokens', async () => {
        await tokenContract.issue(
          issuer.name,
          '100.0000 TOKX',
          'Issue tokens',
          {
            from: issuer,
          }
        );
      });

      it('should allow transferring tokens', async () => {
        await tokenContract.transfer(
          issuer.name,
          otherAccount.name,
          '10.0000 TOKX',
          'Transfer tokens',
          { from: issuer }
        );
      });

      it('should allow burning tokens', async () => {
        await tokenContract.burn(issuer.name, '10.0000 TOKX', 'Burn tokens', {
          from: issuer,
        });
      });

      it('should allow opening an account', async () => {
        await tokenContract.open(
          otherAccount.name,
          '4,TOKX',
          shared.eosioToken.name
        );
      });

      it('should allow closing an account', async () => {
        await l.assertEOSErrorIncludesMessage(
          tokenContract.close(otherAccount.name, '4,TOKX', {
            from: otherAccount,
          }),
          'Cannot close because the balance is not zero'
        );
      });

      it('should allow adding vesting to an account', async () => {
        await tokenContract.addvesting(
          issuer.name,
          new Date(),
          5,
          '100.0000 TOKX'
        );
      });
    });
  });
  describe('unpause action', async () => {
    context('with wrong permissions', async () => {
      it('should raise an auth error when unauthorized account tries to unpause', async () => {
        const unauthorizedAccount = await l.AccountManager.createAccount();
        await l.assertMissingAuthority(
          tokenContract.unpause({ from: unauthorizedAccount })
        );
      });
    });

    context('when contract is unpaused', async () => {
      it('should raise an error when trying to unpause an already unpaused contract', async () => {
        await l.sleep(3000); // Prevent duplicate transaction error
        await l.assertEOSErrorIncludesMessage(
          tokenContract.unpause(),
          'already unpaused'
        );
      });
    });
  });

  context('chngissuer action', async () => {
    it('with wrong permissions should raise auth error', async () => {
      const anybody = await l.AccountManager.createAccount();
      await l.assertMissingAuthority(
        tokenContract.chngissuer({ from: anybody })
      );
    });

    it('fails when TLM does not exist', async () => {
      const altToken = await l.ContractDeployer.deployWithName<TlmToken>(
        'tlm.token',
        'alt.token'
      );
      await l.assertEOSErrorIncludesMessage(
        altToken.chngissuer({ from: altToken.account }),
        'ERR::CHNGISSUER_NON_EXISTING_SYMBOL'
      );
    });

    it('changes issuer to inflt.worlds once TLM exists', async () => {
      const alt2Token = await l.ContractDeployer.deployWithName<TlmToken>(
        'tlm.token',
        'alt2.token'
      );
      await alt2Token.create(issuer.name, '1000.0000 TLM' as any, {
        from: alt2Token.account,
      });
      await alt2Token.chngissuer({ from: alt2Token.account });
      const stats = await alt2Token.statTable({ scope: 'TLM' });
      expect(stats.rows[0].issuer).to.equal('inflt.worlds');
    });

    it('fails if already set', async () => {
      await l.sleep(3000); // Prevent duplicate transaction error
      await l.assertEOSErrorIncludesMessage(
        tokenContract.chngissuer(),
        'ERR::CHNGISSUER_ALREADY_SET'
      );
    });
  });
});
