import {
  ContractDeployer,
  assertRowsEqual,
  AccountManager,
  Account,
  Contract,
  sleep,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  EOSManager,
  debugPromise,
  assertRowsEqualStrict,
  assertRowCount,
  UpdateAuth,
} from 'lamington';
import * as chai from 'chai';
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const ERR_PLANET_DOES_NOT_EXIST =
  'ERR:PLANET_DOES_NOT_EXIST: Planet is not part of the federation';

import { Staking } from './staking';
import { SharedTestObjects } from '../TestHelpers';

let shared: SharedTestObjects;
let anybody: Account;
let auth_account: Account;
let auth_account2: Account;

const planet_1 = 'ftestplanet2';
const planet_2 = 'testplanet3';
let symbol = '4,MONEYS';
describe('AWStaking', async () => {
  let dacId = 'stakedac';
  let user1: Account;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    anybody = await AccountManager.createAccount('anybody');
    user1 = await AccountManager.createAccount('stakuser1');

    auth_account = await AccountManager.createAccount('stakauth2');
    auth_account2 = await AccountManager.createAccount('stakauth3');
    await initDac(dacId, symbol, auth_account);

    await shared.createPlanet(planet_1, symbol);
    await shared.createPlanet(planet_2, symbol);

    await setupPermissions();
    await createToken();
  });

  context('staking', async () => {
    before(async () => {
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user1.name,
        '5687676.9471 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );
    });
    context('with wrong auth', async () => {
      it('should throw auth error', async () => {
        await assertMissingAuthority(
          shared.staking.stake(user1.name, planet_1, '10.0000 TLM')
        );
      });
    });
    context('with right permissions', async () => {
      context('without deposit', async () => {
        it('should throw No deposit found error', async () => {
          await assertEOSErrorIncludesMessage(
            shared.staking.stake(user1.name, planet_1, '10.0000 TLM', {
              from: user1,
            }),
            'No deposit found'
          );
        });
      });
      context('with deposit', async () => {
        before(async () => {
          await shared.eosioToken.transfer(
            user1.name,
            shared.staking.name,
            '5687676.9471 TLM',
            'some money',
            { from: user1 }
          );
        });
        it('establish stake before', async () => {
          const res = await shared.planets.planetsTable();
          const planet = res.rows.find((x) => x.planet_name == planet_1);
          chai.expect(planet.total_stake).to.equal(0);
        });
        it('before changing the issuer, should fail', async () => {
          await assertEOSErrorIncludesMessage(
            shared.staking.stake(user1.name, planet_1, '668302.6034 TLM', {
              from: user1,
            }),
            'ERR:ISSUE_INVALID_RECIPIENT'
          );
        });
        it('chngissuer should work', async () => {
          await shared.dac_token_contract.chngissuer();
        });
        it('before, it should have nothing staked', async () => {
          const res = await shared.planets.planetsTable();
          const planet = res.rows.find((x) => x.planet_name == planet_1);
          chai.expect(planet.total_stake).to.equal(0);
        });
        it('after issuer change, should work', async () => {
          console.log('planet_1: ', planet_1);
          await shared.staking.stake(user1.name, planet_1, '668302.6034 TLM', {
            from: user1,
          });
        });
        it('chngissuer again should fail', async () => {
          await sleep(5000);
          await assertEOSErrorIncludesMessage(
            shared.dac_token_contract.chngissuer(),
            'ERR::CHNGISSUER_ALREADY_SET::'
          );
        });
        it('should update planets stake for both contracts', async () => {
          const res = await shared.planets.planetsTable();
          const planet = res.rows.find((x) => x.planet_name == planet_1);
          chai.expect(planet.total_stake).to.equal('6683026034');
        });
        it('should transfer dac tokens to user', async () => {
          const balance = await shared.getBalance(
            user1,
            shared.dac_token_contract,
            'MONEYS'
          );
          chai.expect(balance).to.equal(668302.6034);
        });
        it('depositing dac tokens should work', async () => {
          await shared.dac_token_contract.transfer(
            user1.name,
            shared.staking.name,
            '100.0000 MONEYS',
            'some money',
            { from: user1 }
          );
        });
        it('should decrease planet stake', async () => {
          const res = await shared.planets.planetsTable();
          const planet = res.rows.find((x) => x.planet_name == planet_1);
          chai.expect(planet.total_stake).to.equal('6682026034');
        });
        it('should transfer tlm back to user', async () => {
          const balance = await shared.getBalance(user1, shared.eosioToken);
          chai.expect(balance).to.equal(100.0);
        });
      });
    });

    context('with stake-DAOs', async () => {
      let stakeDao: Account;
      let user5: Account;

      before(async () => {
        stakeDao = await AccountManager.createAccount('stakedao');
        user5 = await AccountManager.createAccount('user5');
        await initDac(stakeDao.name, '4,DAO', auth_account2);
        await shared.staking.addstakedao(stakeDao.name, '4,DAO');
        await shared.dac_token_contract.create(
          shared.staking.name,
          '1000000.0000 DAO',
          false,
          { from: shared.dac_token_contract.account }
        );
        await shared.eosioToken.transfer(
          shared.tokenIssuer.name,
          user5.name,
          '1000.0000 TLM',
          'some money',
          { from: shared.tokenIssuer }
        );
        await shared.eosioToken.transfer(
          user5.name,
          shared.staking.name,
          '1000.0000 TLM',
          'for staking',
          { from: user5 }
        );
      });

      it('should stake to a stake-DAO', async () => {
        await shared.staking.stake(user5.name, stakeDao.name, '500.0000 TLM', {
          from: user5,
        });

        const balance = await shared.getBalance(
          user5,
          shared.dac_token_contract,
          'DAO'
        );
        chai.expect(balance).to.equal(500.0);

        const res = await shared.staking.depositsTable();
        const deposit = res.rows.find((x) => x.account == user5.name);
        chai.expect(deposit.quantity).to.equal('500.0000 TLM');
      });

      it('should fail to stake more than deposited', async () => {
        await assertEOSErrorIncludesMessage(
          shared.staking.stake(user5.name, stakeDao.name, '600.0000 TLM', {
            from: user5,
          }),
          'You do not have enough deposited Trilium'
        );
      });
      it('should have transferred dao tokens to staker', async () => {
        const balance = await shared.getBalance(
          user5,
          shared.dac_token_contract,
          'DAO'
        );
        chai.expect(balance).to.equal(500.0);
      });
      it('transfering back to unstake should work', async () => {
        await shared.dac_token_contract.transfer(
          user5.name,
          shared.staking.name,
          '500.0000 DAO',
          'for unstaking',
          { from: user5 }
        );
      });

      it('should remove a stake-DAO', async () => {
        await shared.staking.rmvstakedao(stakeDao.name);

        const stakeDaos = await shared.staking.stakedaosTable();
        const removedStakeDao = stakeDaos.rows.find(
          (row) => row.dac_id === stakeDao.name
        );

        chai.expect(removedStakeDao).to.be.undefined;
      });
      it('should fail to remove a non-existent stake-DAO', async () => {
        await assertEOSErrorIncludesMessage(
          shared.staking.rmvstakedao('nonexistent'),
          'ERR::STAKE_DAO_NOT_FOUND::'
        );
      });

      it('should add a stake-DAO', async () => {
        await shared.staking.addstakedao(stakeDao.name, '4,DAOX');

        const stakeDaos = await shared.staking.stakedaosTable();
        const addedStakeDao = stakeDaos.rows.find(
          (row) => row.dac_id === stakeDao.name
        );

        chai.expect(addedStakeDao).to.not.be.undefined;
        chai.expect(addedStakeDao.dac_symbol).to.equal('4,DAOX');
      });

      it('should fail to add or remove stake-DAO without proper authorization', async () => {
        await assertMissingAuthority(
          shared.staking.addstakedao(stakeDao.name, '4,DAOX', { from: anybody })
        );

        await assertMissingAuthority(
          shared.staking.rmvstakedao(stakeDao.name, { from: anybody })
        );
      });
    });
  });
  context('stake', async () => {
    let user2: Account;
    let deposit_before, deposit_after;
    before(async () => {
      user2 = await AccountManager.createAccount('feduser4');
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user2.name,
        '1000.0000 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );
    });
    it('transfering should add deposit', async () => {
      await shared.eosioToken.transfer(
        user2.name,
        shared.staking.account,
        '1000.0000 TLM',
        'for staking',
        { from: user2 }
      );
      const res = await shared.staking.depositsTable();
      deposit_before = res.rows.find((x) => x.account == user2.name).quantity;
      chai.expect(deposit_before).to.equal('1000.0000 TLM');
    });
    it('should succeed', async () => {
      await shared.staking.stake(user2.name, planet_1, '1.0000 TLM', {
        from: user2,
      });
    });
    it('should reduce deposited balance', async () => {
      const res = await shared.staking.depositsTable();
      deposit_after = res.rows.find((x) => x.account == user2.name).quantity;
      chai.expect(deposit_after).to.equal('999.0000 TLM');
    });
  });
  context('deldeposit', async () => {
    let user3: Account;
    before(async () => {
      user3 = await AccountManager.createAccount('feduser3');
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user3.name,
        '1000.0000 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );
      await shared.eosioToken.transfer(
        user3.name,
        shared.staking.name,
        '1000.0000 TLM',
        'for staking',
        { from: user3 }
      );
    });
    it('should delete deposit', async () => {
      await shared.staking.deldeposit(user3.name);
      const res = await shared.staking.depositsTable();
      const deposit = res.rows.find((x) => x.account == user3.name);
      chai.expect(deposit).to.be.undefined;
    });
  });

  context('withdraw', async () => {
    let user4: Account;
    before(async () => {
      user4 = await AccountManager.createAccount('feduser4');
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user4.name,
        '1000.0000 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );
      await shared.eosioToken.transfer(
        user4.name,
        shared.staking.name,
        '1000.0000 TLM',
        'for staking',
        { from: user4 }
      );
    });
    it('should withdraw deposit', async () => {
      await shared.staking.withdraw(user4.name, { from: user4 });
      const res = await shared.staking.depositsTable();
      const deposit = res.rows.find((x) => x.account == user4.name);
      chai.expect(deposit).to.be.undefined;
    });
  });

  context('maintenance', async () => {
    it('should set maintenance mode', async () => {
      await shared.staking.maintenance(true);
      const res = await shared.staking.globalsTable();

      // Check if maintenance_mode is true (1) in the singleton
      const maintenanceMode = await shared.singleton_get(
        res,
        'maintenance_mode'
      );
      chai.expect(maintenanceMode).to.not.equal(null);
      chai.expect(['1', 1, true]).to.include(maintenanceMode);
    });
    it('stake should throw maintenance mode error', async () => {
      await assertEOSErrorIncludesMessage(
        shared.staking.stake(user1.name, planet_1, '10.0000 TLM', {
          from: user1,
        }),
        'Contract is in maintenance mode, please try again in a few minutes.'
      );
    });
    it('withdraw should throw maintenance mode error', async () => {
      await assertEOSErrorIncludesMessage(
        shared.staking.withdraw(user1.name, { from: user1 }),
        'Contract is in maintenance mode, please try again in a few minutes.'
      );
    });
    it('transfering money into the contract should throw maintenance mode error', async () => {
      const user = await AccountManager.createAccount();
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user.name,
        '1.0000 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );
      await assertEOSErrorIncludesMessage(
        shared.eosioToken.transfer(
          user.name,
          shared.staking.name,
          '1.0000 TLM',
          'some money',
          { from: user }
        ),
        'Contract is in maintenance mode, please try again in a few minutes.'
      );
    });

    it('should unset maintenance mode', async () => {
      await shared.staking.maintenance(false);
      const res = await shared.staking.globalsTable();

      // Check if maintenance_mode is false (0) in the singleton
      const maintenanceMode = await shared.singleton_get(
        res,
        'maintenance_mode'
      );
      chai.expect(maintenanceMode).to.not.equal(null);
      chai.expect(['0', 0, false]).to.include(maintenanceMode);
    });
  });
});

async function createToken() {
  await shared.dac_token_contract.create(
    shared.tokenIssuer,
    '10000000.0000 MONEYS',
    false,
    { from: shared.dac_token_contract.account }
  );
}

async function initDac(dacId, tokenSymbol, owner) {
  enum Account_type {
    TREASURY = 1,
    CUSTODIAN = 2,
    MSIGOWNED = 3,
    SERVICE = 5,
    PROPOSALS = 6,
    ESCROW = 7,
    VOTING = 8,
    EXTERNAL = 254,
    OTHER = 255,
  }
  let accounts = [
    {
      key: Account_type.VOTING,
      value: shared.stakevote_contract.account.name,
    },
  ];
  await shared.dacdirectory_contract.regdac(
    owner.name,
    dacId,
    {
      contract: shared.dac_token_contract.account.name,
      sym: tokenSymbol,
    },
    'dac_title',
    [],
    accounts,
    {
      auths: [{ actor: owner.name, permission: 'active' }],
    }
  );
}

async function setupPermissions() {
  await SharedTestObjects.add_custom_permission_and_link(
    shared.dac_token_contract,
    'notify',
    shared.stakevote_contract,
    'balanceobsv',
    shared.staking
  );

  await SharedTestObjects.add_custom_permission_and_link(
    shared.infl,
    'log',
    shared.infl,
    'logclaim'
  );

  UpdateAuth.execUpdateAuth(
    shared.dac_token_contract.account.active,
    shared.dac_token_contract.account.name,
    'notify',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(shared.dac_token_contract.account)
  );
  await UpdateAuth.execLinkAuth(
    shared.dac_token_contract.account.active,
    shared.dac_token_contract.account.name,
    shared.dac_token_contract.account.name,
    'weightobsv',
    'notify'
  );

  /* NEW PERMISSIONS */
  await SharedTestObjects.add_custom_permission_and_link(
    shared.staking,
    'issue',
    shared.dac_token_contract,
    ['issue', 'transfer'],
    shared.staking
  );

  await SharedTestObjects.add_custom_permission_and_link(
    shared.planets,
    'updatestake',
    shared.planets,
    'updatestake',
    shared.staking
  );
  await SharedTestObjects.add_custom_permission_and_link(
    shared.staking,
    'xfer',
    shared.eosioToken,
    'transfer'
  );
}
