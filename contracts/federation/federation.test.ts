import {
  ContractDeployer,
  assertRowsEqual,
  AccountManager,
  Account,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  EOSManager,
  debugPromise,
  assertRowsEqualStrict,
  assertRowCount,
  UpdateAuth,
} from 'lamington';
import * as chai from 'chai';

import { Federation } from './federation';
import { SharedTestObjects } from '../TestHelpers';
import * as moment from 'moment';
chai.use(require('chai-datetime'));

let shared: SharedTestObjects;
let auth_account: Account;
const planet_1 = 'neri.world';
const planet_2 = 'kavian.world';
const planet_3 = 'bina.world';

const binance_daily = 2400000 / 30;
const satellite_from_binance_daily = 1600000 / 30;
const BINANCE_PLANET_NAME = 'bina.world';
let binance_account: Account;
let symbol = '4,MONEYF';

// const epsilon = 0.0001;

// const dac_accounts = new Map([
//   ['eyeke.world', 'eyeke.wp.dac'],
//   ['kavian.world', 'kavan.wp.dac'],
//   ['magor.world', 'magor.wp.dac'],
//   ['naron.world', 'naron.wp.dac'],
//   ['neri.world', 'neri.wp.dac'],
//   ['veles.world', 'veles.wp.dac'],
// ]);

describe('Federation', async () => {
  let user1: Account;
  let dacId = 'feddac';
  before(async () => {
    shared = await SharedTestObjects.getInstance();
  });
  context('setavatar', async () => {
    let user2: Account;
    let avatar_id: number;
    before(async () => {
      user2 = await AccountManager.createAccount('feduser.wam');
      avatar_id = 1; // male avatar
    });

    // context('with non wcw account', async () => {
    //   let user3: Account;
    //   before(async () => {
    //     user3 = await AccountManager.createAccount();
    //   });
    //   it('should fail', async () => {
    //     await assertEOSErrorIncludesMessage(
    //       shared.federation.setavatar(user3.name, avatar_id, {
    //         from: user3,
    //       }),
    //       'Only WCW accounts can play'
    //     );
    //   });
    // });

    context('with wrong auth', async () => {
      it('should throw auth error', async () => {
        await assertMissingAuthority(
          shared.federation.setavatar(user2.name, avatar_id, {
            from: user1,
          })
        );
      });
    });

    context('with right permissions', async () => {
      context('with non-default avatar', async () => {
        let user: Account;
        let asset: any;
        before(async () => {
          user = await AccountManager.createAccount('xxx123.wam');

          // mint some non-default avatar to a user
          await shared.atomicassets.mintasset(
            shared.eosioToken.account.name,
            shared.NFT_COLLECTION,
            shared.AVATAR_SCHEMA,
            shared.ALIEN_AVATAR_TEMPLATE_ID,
            user.name,
            '',
            '',
            [],
            { from: shared.eosioToken.account }
          );
          asset = (
            await shared.atomicassets.assetsTable({ scope: user.name })
          ).rows.find((x) => x.template_id === shared.ALIEN_AVATAR_TEMPLATE_ID);
        });

        it('should work', async () => {
          await shared.federation.setavatar(user.name, asset.asset_id, {
            from: user,
          });
        });

        it('should update avatar for the user', async () => {
          const res = await shared.federation.playersTable();
          const player = res.rows.find((x) => x.account == user.name);
          chai.expect(player.avatar).to.equal(asset.asset_id);
        });
      });

      context('with default avatar', async () => {
        it('should work', async () => {
          await shared.federation.setavatar(user2.name, avatar_id, {
            from: user2,
          });
        });

        it('should update avatar for the user', async () => {
          const res = await shared.federation.playersTable();
          const player = res.rows.find((x) => x.account == user2.name);
          chai.expect(player).to.not.equal(undefined);
        });
        it('should have minted avatar', async () => {
          const res = await shared.atomicassets.assetsTable({
            scope: user2.name,
          });

          const asset = (
            await shared.atomicassets.assetsTable({ scope: user2.name })
          ).rows.find((x) => x.template_id === shared.MALE_AVATAR_TEMPLATE_ID);
          chai.expect(asset).to.not.equal(undefined);
        });
      });

      context('with non-existing avatar', async () => {
        before(async () => {
          avatar_id = 999; // non-existing avatar
        });

        it('should throw error', async () => {
          await assertEOSErrorIncludesMessage(
            shared.federation.setavatar(user2.name, avatar_id, {
              from: user2,
            }),
            'ERR::MUST_OWN_AVATAR::You must own this avatar.'
          );
        });
      });

      context('with avatar from non-approved collection', async () => {
        let user: Account;
        let asset: any;
        before(async () => {
          user = await AccountManager.createAccount('xxx123.wam');
          await shared.atomicassets.createcol(
            shared.eosioToken.account.name,
            'unapproved12',
            true,
            [shared.eosioToken.account.name],
            [],
            '0.01',
            '',
            { from: shared.eosioToken.account }
          );

          await shared.atomicassets.createschema(
            shared.eosioToken.account.name,
            'unapproved12',
            shared.AVATAR_SCHEMA,
            [
              { name: 'cardid', type: 'uint16' },
              { name: 'name', type: 'string' },
            ],
            { from: shared.eosioToken.account }
          );

          await shared.atomicassets.createtempl(
            shared.eosioToken.account.name,
            'unapproved12',
            shared.AVATAR_SCHEMA,
            true,
            true,
            10,
            [
              { key: 'cardid', value: ['uint16', 3] },
              { key: 'name', value: ['string', 'Alien Avatar'] },
            ],
            { from: shared.eosioToken.account }
          );
          const template_id = await shared.getTemplateId(
            shared.AVATAR_SCHEMA,
            'Alien Avatar',
            'unapproved12'
          );

          // mint some non-default avatar to a user
          await shared.atomicassets.mintasset(
            shared.eosioToken.account.name,
            'unapproved12',
            shared.AVATAR_SCHEMA,
            template_id,
            user.name,
            '',
            '',
            [],
            { from: shared.eosioToken.account }
          );

          asset = (
            await shared.atomicassets.assetsTable({ scope: user.name })
          ).rows.find((x) => x.template_id === template_id);
        });

        it('should throw error', async () => {
          await assertEOSErrorIncludesMessage(
            shared.federation.setavatar(user.name, asset.asset_id, {
              from: user,
            }),
            'ERR::AVATAR_NOT_VALID::'
          );
        });
      });
    });

    context('with avatar from alienavatars collection', async () => {
      let user: Account;
      let asset: any;
      let collection_name = 'alienavatars';
      before(async () => {
        user = await AccountManager.createAccount('xxx124.wam');
        await shared.atomicassets.createcol(
          shared.eosioToken.account.name,
          collection_name,
          true,
          [shared.eosioToken.account.name],
          [],
          '0.01',
          '',
          { from: shared.eosioToken.account }
        );

        await shared.atomicassets.createschema(
          shared.eosioToken.account.name,
          collection_name,
          collection_name,
          [
            { name: 'cardid', type: 'uint16' },
            { name: 'name', type: 'string' },
          ],
          { from: shared.eosioToken.account }
        );

        await shared.atomicassets.createtempl(
          shared.eosioToken.account.name,
          collection_name,
          collection_name,
          true,
          true,
          10,
          [
            { key: 'cardid', value: ['uint16', 3] },
            { key: 'name', value: ['string', 'Alien Avatar'] },
          ],
          { from: shared.eosioToken.account }
        );
        const template_id = await shared.getTemplateId(
          collection_name,
          'Alien Avatar',
          collection_name
        );

        // mint some non-default avatar to a user
        await shared.atomicassets.mintasset(
          shared.eosioToken.account.name,
          collection_name,
          collection_name,
          template_id,
          user.name,
          '',
          '',
          [],
          { from: shared.eosioToken.account }
        );

        asset = (
          await shared.atomicassets.assetsTable({ scope: user.name })
        ).rows.find((x) => x.template_id === template_id);
      });

      it('should work', async () => {
        await shared.federation.setavatar(user.name, asset.asset_id, {
          from: user,
        });
      });
    });

    context('with existing player trying to set default avatar', async () => {
      let user: Account;
      let avatar_id: number;
      before(async () => {
        user = await AccountManager.createAccount('existing.wam');
        avatar_id = 1; // male avatar

        // Set avatar for the first time
        await shared.federation.setavatar(user.name, avatar_id, {
          from: user,
        });
      });

      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          shared.federation.setavatar(user.name, 2, {
            from: user,
          }),
          'Only new players can set to the default avatar'
        );
      });
    });
    context('with avatar from other collection', async () => {
      let user: Account;
      let asset: any;
      before(async () => {
        user = await AccountManager.createAccount('othercol.wam');

        // Create a new collection
        await shared.atomicassets.createcol(
          shared.eosioToken.account.name,
          'othercol1234',
          true,
          [shared.eosioToken.account.name],
          [],
          '0.01',
          '',
          { from: shared.eosioToken.account }
        );

        // Create a new schema in the new collection
        await shared.atomicassets.createschema(
          shared.eosioToken.account.name,
          'othercol1234',
          shared.AVATAR_SCHEMA,
          [
            { name: 'cardid', type: 'uint16' },
            { name: 'name', type: 'string' },
          ],
          { from: shared.eosioToken.account }
        );

        // Create a new template in the new schema
        await shared.atomicassets.createtempl(
          shared.eosioToken.account.name,
          'othercol1234',
          shared.AVATAR_SCHEMA,
          true,
          true,
          10,
          [
            { key: 'cardid', value: ['uint16', 3] },
            { key: 'name', value: ['string', 'Other Avatar'] },
          ],
          { from: shared.eosioToken.account }
        );

        const template_id = await shared.getTemplateId(
          shared.AVATAR_SCHEMA,
          'Other Avatar',
          'othercol1234'
        );

        // Mint an avatar to the user from the new collection
        await shared.atomicassets.mintasset(
          shared.eosioToken.account.name,
          'othercol1234',
          shared.AVATAR_SCHEMA,
          template_id,
          user.name,
          '',
          '',
          [],
          { from: shared.eosioToken.account }
        );

        asset = (
          await shared.atomicassets.assetsTable({ scope: user.name })
        ).rows.find((x) => x.template_id === template_id);
      });

      it('should throw error', async () => {
        await assertEOSErrorIncludesMessage(
          shared.federation.setavatar(user.name, asset.asset_id, {
            from: user,
          }),
          'ERR::AVATAR_NOT_VALID::Avatar must from an approved collection.'
        );
      });
    });
  });

  // context('staking', async () => {
  //   before(async () => {
  //     await shared.eosioToken.transfer(
  //       shared.tokenIssuer.name,
  //       user1.name,
  //       '5687676.9470 TLM',
  //       'some money',
  //       { from: shared.tokenIssuer }
  //     );

  //     // let res = await shared.federation.planetsTable({});
  //     // console.log(res, null, 2);
  //     // chai.expect(res.rows.length).to.equal(3);

  //     const res = await shared.planets.planetsTable({});
  //     // console.log(res, null, 2);
  //     chai.expect(res.rows.length).to.equal(3);
  //   });
  //   context('with wrong auth', async () => {
  //     it('should throw auth error', async () => {
  //       await assertMissingAuthority(
  //         shared.staking.stake(user1.name, planet_1, '10.0000 TLM')
  //       );
  //     });
  //   });
  //   context('with right permissions', async () => {
  //     context('without deposit', async () => {
  //       it('should throw No deposit found error', async () => {
  //         await assertEOSErrorIncludesMessage(
  //           shared.staking.stake(user1.name, planet_1, '10.0000 TLM', {
  //             from: user1,
  //           }),
  //           'No deposit found'
  //         );
  //       });
  //     });
  //     context('with deposit', async () => {
  //       before(async () => {
  //         await shared.eosioToken.transfer(
  //           user1.name,
  //           shared.staking.name,
  //           '5687676.9470 TLM',
  //           'some money',
  //           { from: user1 }
  //         );
  //       });
  //       it('should work', async () => {
  //         await shared.staking.stake(user1.name, planet_1, '668302.6034 TLM', {
  //           from: user1,
  //         });
  //       });
  //       it('should update planets stake', async () => {
  //         const res = await shared.planets.planetsTable();
  //         const planet = res.rows.find((x) => x.planet_name == planet_1);
  //         chai.expect(planet.total_stake).to.equal('6683026034');
  //       });
  //       // it('should update total state', async () => {
  //       //   const res = await shared.infl.stateTable();
  //       //   console.log(res, null, 2);
  //       //   const state = res.rows[0];
  //       //   chai.expect(state.total_stake).to.equal('6683026034');
  //       // });
  //       // it('calling fixstake should throw error that stake is already correct', async () => {
  //       //   await assertEOSErrorIncludesMessage(
  //       //     shared.infl.fixstake(),
  //       //     'Stake is already correct'
  //       //   );
  //       // });
  //     });
  //   });
  // });

  /*
  context('inflate', async () => {
    let landowner_account_balance_before, landowner_account_balance_after;
    let expected_amount, reserve_before;

    let expected_landowners_allocation, expected_satellite_allocation;
    let satellite_balance_before;

    before(async () => {
      landowner_account_balance_before = await shared.getBalance(
        shared.landholders_allocation_account
      );
      satellite_balance_before = await shared.getBalance(
        shared.satellite_account
      );
      const timestamp = shared
        .eosTime(new Date())
        .subtract(50, 'hours')
        .toDate();
      await shared.federation.setlandclaim(timestamp);
      await shared.federation.setreserve(42543682420728);
      await shared.federation.setmultipl(planet_1, 87979);
      await shared.federation.setmultipl(planet_2, 27979);
      await shared.planets.updatemult(planet_1, 87979);
      await shared.planets.updatemult(planet_2, 27979);

      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user1.name,
        '5687676.9470 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );
      await shared.eosioToken.transfer(
        user1.name,
        shared.staking.name,
        '5687676.9470 TLM',
        'some money',
        { from: user1 }
      );
      await shared.staking.stake(user1.name, planet_1, '5019374.3436 TLM', {
        from: user1,
      });

      const res = await shared.federation.reserveTable();
      reserve_before = res.rows[0].total / 10000;
      [expected_landowners_allocation, expected_satellite_allocation] =
        await calc_landfill_amount();
    });
    it('should work', async () => {
      await shared.federation.inflate();
    });
    it('should have transferred to landowners account', async () => {
      landowner_account_balance_after = await shared.getBalance(
        shared.landholders_allocation_account
      );

      const actual_landowners_allocation =
        landowner_account_balance_after - landowner_account_balance_before;

      assert_close_enough(
        actual_landowners_allocation,
        expected_landowners_allocation,
        0.0002
      );
    });
    it('should have transferred to satellite account', async () => {
      const satellite_balance_after = await shared.getBalance(
        shared.satellite_account
      );
      const actual_satellite_allocation =
        satellite_balance_after - satellite_balance_before;

      assert_close_enough(
        actual_satellite_allocation,
        expected_satellite_allocation,
        0.0002
      );
    });
    it('should reduce reserve amount', async () => {
      const res = await shared.federation.reserveTable();
      const reserve_after = res.rows[0].total / 10000;
    });
  });
  context('claim', async () => {
    let reserve_payout_balance: number,
      mining_payout_balance: number,
      dac_payout_balance: number;
    let bucket_total_before: number;
    let initial_balance: number, balance_after: number;
    before(async () => {
      initial_balance = await shared.getBalance(
        shared.planet_accounts[planet_1]
      );
      let res = await shared.federation.payoutsTable();
      const payout = res.rows.find((x) => x.planet_name == planet_1);
      reserve_payout_balance = parseFloat(payout.reserve);
      mining_payout_balance = parseFloat(payout.mining);

      const res2 = await shared.federation.dacpayoutsTable();
      const dac_name = dac_accounts.get(planet_1);
      const payout2 = res2.rows.find((x) => x.dac_account == dac_name);

      dac_payout_balance = parseFloat(payout2.amount);

      res = await shared.mining.state3Table({ scope: planet_1 });
      const x = res.rows[0];
      if (x) {
        bucket_total_before = parseFloat(x.bucket_total);
      } else {
        bucket_total_before = 0;
      }
    });
    it('should fail with wrong permissions', async () => {
      await assertMissingAuthority(
        shared.federation.claim(planet_1, {
          from: shared.planet_accounts[planet_2],
        })
      );
    });
    it('should work', async () => {
      await shared.federation.claim(planet_1, {
        from: shared.planet_accounts[planet_1],
      });
    });
    it('should transfer reserve to planet account', async () => {
      balance_after = await shared.getBalance(shared.planet_accounts[planet_1]);
      const amount_transferred = balance_after - initial_balance;
      chai
        .expect(Math.abs(amount_transferred - reserve_payout_balance))
        .to.lessThan(epsilon);
    });
    it('should fill up mining bucket', async () => {
      const res = await shared.mining.state3Table({ scope: planet_1 });
      const x = res.rows[0];

      const expected_bucket_amount =
        bucket_total_before + mining_payout_balance;

      chai
        .expect(parseFloat(x.bucket_total) - expected_bucket_amount)
        .to.be.lessThan(0.0001);
    });
    it('should delete payout from table', async () => {
      const res = await shared.federation.payoutsTable();
      const payout = res.rows.find((x) => x.planet_name == planet_1);
      chai.expect(payout).to.equal(undefined);
    });
    it('should transfer to dac account', async () => {
      const dac_name = dac_accounts.get(planet_1);
      const balance_after = await shared.getBalance(dac_name);
      chai
        .expect(Math.abs(balance_after - dac_payout_balance))
        .to.lessThan(epsilon);
    });
    it('should delete dac payout from table', async () => {
      const dac_name = dac_accounts.get(planet_1);
      const res = await shared.federation.dacpayoutsTable();
      const payout = res.rows.find((x) => x.dac_account == dac_name);
      chai.expect(payout).to.equal(undefined);
    });
  });
  */
});
// function assert_close_enough(a, b, epsilon = 0.00011) {
//   chai.expect(Math.abs(a - b)).to.be.lessThan(epsilon);
// }

async function add_custom_permission(
  account,
  name,
  parent = 'active',
  forContract = null
) {
  if (account.account) {
    account = account.account;
  }
  if (forContract && forContract.account) {
    forContract = forContract.account;
  }
  await UpdateAuth.execUpdateAuth(
    account.active,
    account.name,
    name,
    parent,
    UpdateAuth.AuthorityToSet.forContractCode(
      forContract ? forContract : account
    )
  );
}
async function linkauth(
  permission_owner,
  permission_name,
  action_owner,
  action_names
) {
  if (permission_owner.account) {
    permission_owner = permission_owner.account;
  }
  if (action_owner.account) {
    action_owner = action_owner.account;
  }
  if (!Array.isArray(action_names)) {
    action_names = [action_names];
  }
  for (const action_name of action_names) {
    await UpdateAuth.execLinkAuth(
      permission_owner.active,
      permission_owner.name,
      action_owner.name,
      action_name,
      permission_name
    );
  }
}
async function add_custom_permission_and_link(
  permission_owner,
  permission_name,
  action_owner,
  action_names,
  forContract = null
) {
  await add_custom_permission(
    permission_owner,
    permission_name,
    'active',
    forContract
  );
  await linkauth(permission_owner, permission_name, action_owner, action_names);
}

async function setupPermissions() {
  console.log('setupPermissions 1');
  await add_custom_permission_and_link(
    shared.dac_token_contract,
    'issue',
    shared.dac_token_contract,
    ['issue', 'transfer'],
    shared.federation
  );
  console.log('setupPermissions 2');

  await add_custom_permission_and_link(
    shared.federation,
    'issue',
    shared.eosioToken,
    'issue'
  );
  console.log('setupPermissions 3');
  await add_custom_permission_and_link(
    shared.federation,
    'xfer',
    shared.eosioToken,
    'transfer'
  );
  console.log('setupPermissions 4');
  await linkauth(shared.federation, 'xfer', shared.mining, 'fill');
  console.log('setupPermissions 5');

  await add_custom_permission_and_link(
    shared.dac_token_contract,
    'notify',
    shared.stakevote_contract,
    'balanceobsv',
    shared.dac_token_contract
  );
  console.log('setupPermissions 6');

  await add_custom_permission_and_link(
    shared.federation,
    'log',
    shared.federation,
    'logclaim'
  );
  console.log('setupPermissions 7');

  /* NEW PERMISSIONS */
  await add_custom_permission_and_link(
    shared.federation,
    'updatemult',
    shared.planets,
    'updatemult'
  );
  console.log('setupPermissions 8');
  // await add_custom_permission_and_link(
  //   shared.planets,
  //   'updatestake',
  //   shared.planets,
  //   'updatestake',
  //   shared.staking
  // );
  console.log('setupPermissions 9');
}

// async function createToken() {
//   await shared.dac_token_contract.create(
//     shared.staking.account.name,
//     '10000000.0000 MONEYF',
//     false,
//     { from: shared.dac_token_contract.account }
//   );
// }

// async function initDac(dacId, tokenSymbol) {
//   export enum Account_type {
//     TREASURY = 1,
//     CUSTODIAN = 2,
//     MSIGOWNED = 3,
//     SERVICE = 5,
//     PROPOSALS = 6,
//     ESCROW = 7,
//     VOTING = 8,
//     EXTERNAL = 254,
//     OTHER = 255,
//   }
//   let accounts = [
//     {
//       key: Account_type.VOTING,
//       value: shared.stakevote_contract.account.name,
//     },
//   ];
//   await shared.dacdirectory_contract.regdac(
//     auth_account.name,
//     dacId,
//     {
//       contract: shared.dac_token_contract.account.name,
//       sym: tokenSymbol,
//     },
//     'dac_title',
//     [],
//     accounts,
//     {
//       auths: [{ actor: auth_account.name, permission: 'active' }],
//     }
//   );
// }

// async function calc_total_pay_amount(planet_name, reserve = null) {
//   chai.expect(planet_name).to.not.equal(null);
//   if (planet_name == 'bina.world') {
//     return 0;
//   }
//   let res = await shared.planets.planetsTable({ limit: 100 });
//   const number_planets = res.rows.length;

//   if (reserve == null) {
//     res = await shared.federation.reserveTable();
//     reserve = res.rows[0].total / 10000;
//   }

//   res = await shared.federation.stateTable();
//   const state = res.rows[0];
//   const total_planet_nft_multiplier = state.nft_total;
//   const planet = await get_planet(planet_name);
//   const planet_nft_multiplier = planet.nft_multiplier;

//   const nft_mod = 0.2;
//   let nft_pay;
//   const total_daily = reserve * (13.0 + number_planets * 1.9);
//   if (total_planet_nft_multiplier > 0) {
//     nft_pay =
//       0.8 *
//       ((total_daily * nft_mod) / 100000.0) *
//       (planet_nft_multiplier / total_planet_nft_multiplier);
//   } else {
//     nft_pay = 0;
//   }

//   const planet_staked_tlm = planet.total_stake;
//   const total_planet_staked_tlm = state.total_stake;

//   let stake_pay;
//   if (total_planet_staked_tlm > 0) {
//     stake_pay =
//       0.8 *
//       ((total_daily * (1.0 - nft_mod)) / 100000.0) *
//       (planet_staked_tlm / total_planet_staked_tlm);
//   } else {
//     stake_pay = 0;
//   }
//   const binance_daily_adjustment =
//     (binance_daily + satellite_from_binance_daily) *
//     (planet_staked_tlm / total_planet_staked_tlm);

//   const x = Math.min(500000, nft_pay + stake_pay - binance_daily_adjustment);
//   return x;
// }

// async function calc_mining_asset(total_pay_amount) {
//   return 0.8 * total_pay_amount;
// }

// function get_satellite_asset(total_pay_amount) {
//   const raw_reserve_asset = 0.2 * total_pay_amount;
//   return raw_reserve_asset * 0.4;
// }

// function get_reserve_asset(planet_name, total_pay_amount) {
//   if (planet_name == 'bina.world') {
//     return binance_daily;
//   } else {
//     const raw_reserve_asset = 0.2 * total_pay_amount;
//     return raw_reserve_asset - get_satellite_asset(total_pay_amount);
//   }
// }

// async function get_planet(planet_name) {
//   let res = await shared.planets.planetsTable({ limit: 100 });
//   for (const planet of res.rows) {
//     if (planet.planet_name == planet_name) {
//       return planet;
//     }
//   }
//   throw Error(`planet ${planet_name} not found`);
// }

// async function calc_landfill_amount() {
//   let res = await shared.federation.reserveTable();
//   const reserve = res.rows[0].total;

//   let planets_res = await shared.planets.planetsTable({ limit: 100 });
//   const num_planets = planets_res.rows.length;

//   const inflation = (reserve * (13.0 + 1.9 * num_planets)) / 100000.0;
//   const landowners_allocation = inflation * 0.2;

//   let dtap = 0;
//   for (const planet of planets_res.rows) {
//     dtap += await calc_total_pay_amount(planet.planet_name, reserve);
//   }
//   const satellite_allocation = inflation * 0.1;

//   return [landowners_allocation / 10000.0, satellite_allocation / 10000.0];
// }

async function get_balance(
  token_contract: Account,
  account: Account,
  search_symbol: string
) {
  const res = await token_contract.accountsTable({
    scope: account.name,
  });
  for (const row of res.rows) {
    const bal = new Asset(row.balance);
    if (bal.symbol == search_symbol) {
      return bal.amount;
    }
  }
  return 0.0;
}
