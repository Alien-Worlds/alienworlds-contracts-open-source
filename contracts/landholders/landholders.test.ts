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
} from 'lamington';
import * as chai from 'chai';
import { SharedTestObjects, Asset } from '../TestHelpers';

import { Landholders } from './landholders';
import { Federation } from '../federation/federation';
import { TlmToken } from '../tlm.token/tlm.token';
import { Atomicassets } from '../atomicassets-contracts/src/atomicassets';
import { alr, setassetdata } from '../federation/setup/add_landrating_to_nfts';
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

// Helper to emit an unambiguous UTC timestamp string (no timezone suffix)
const isoUtc = (d: any) => dayjs.utc(d).format('YYYY-MM-DDTHH:mm:ss');

let shared: SharedTestObjects;

let landholders: Landholders;
let federation: Federation;
let eosioToken: TlmToken;
let owners: { [name: string]: Account } = {};
let atomicassets: Atomicassets;

let first_id: number = 2 ** 40;
function asset_id(n: number) {
  return String(n + first_id - 1);
}

enum CycleState {
  Idle = 0,
  CalculatingLandPayment,
  WaitingForPayment,
  ProcessingPayouts,
}
const skippedAccounts = ['owner4'];

const now = dayjs.utc();
const today = isoUtc(now);
const tomorrow = isoUtc(now.add(1, 'day'));
const day_after_tomorrow = isoUtc(now.add(2, 'day'));

describe('LandHolders', () => {
  let common_land: any;
  let rare_land: any;
  let epic_land: any;
  let legendary_land: any;
  let common_owner: any;
  let rare_owner: any;
  let epic_owner: any;
  let legendary_owner: any;
  let anybody: Account;
  let testplanet: Account;
  let authorizedAccount: Account;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    landholders = shared.landholders;
    federation = shared.federation;
    eosioToken = shared.eosioToken;
    atomicassets = shared.atomicassets;

    let initial_balance = await shared.getBalance(landholders.account);
    console.log('initial_balance', initial_balance);
    if (initial_balance > 0) {
      await eosioToken.transfer(
        landholders.account,
        'eosio',
        `${initial_balance.toFixed(4)} TLM`,
        'make sure landholders has 0 initial balance',
        { from: landholders.account }
      );
    }

    await seedAccounts();
    await configureAuths();
    // await seedLandRegs();
    await issueTokens();
    await landholders.setinitials();

    anybody = await AccountManager.createAccount();
    testplanet = await shared.createPlanet('veles.world', '4,VELES');
    authorizedAccount = await AccountManager.createAccount('veles.dac');
  });

  context('adding additional attributes to nfts', async () => {
    let mutable_attrs_before = {};
    let expected_attrs_after = {};
    it('testdep', async () => {
      await landholders.testdep();
    });
    it('should succeed', async () => {
      const atomic = await shared.get_atomic();
      const results = await landholders.landregsTable({ limit: 100 });
      for (const { owner, id } of results.rows) {
        const asset = await shared.get_atomic().getAsset(owner, id);
        mutable_attrs_before[id] = await asset.mutableData();
        expected_attrs_after[id] = Object.assign(
          JSON.parse(JSON.stringify(mutable_attrs_before[id])),
          {
            landrating: '1000000',
            openslots: 1,
            MinBoostAmount: '0',
            BoostLastUsedDay: 0,
            UsedBoostsDay: 0,
          }
        );
      }

      const results2 = await atomicassets.assetsTable({
        scope: 'owner1',
        limit: 1,
      });
      first_id = parseInt(results2.rows[0].asset_id, 10);
      await alr(EOSManager);
    });
    it('should have added the mutable attributes', async () => {
      const results = await landholders.landregsTable({ limit: 100 });
      for (const { owner, id } of results.rows) {
        const asset = await shared.get_atomic().getAsset(owner, id);
        const mutableData = await asset.mutableData();
        chai.expect(mutableData).to.deep.equal(expected_attrs_after[id]);
      }
    });
  });

  context('When changing the config', async () => {
    context('With incorrect auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          landholders.setconfig(21, ['owner4'], '150000.0000 TLM', {
            from: owners['owner4'],
          })
        );
      });
    });
    context('with correct auth', async () => {
      it('should succeed', async () => {
        await landholders.setconfig(21, ['owner4'], '150000.0000 TLM', {
          from: landholders.account,
        });
      });
      it('should change the globals', async () => {
        await assertRowsEqual(
          landholders.globalTable({ scope: landholders.account.name }),
          [
            {
              numberOfLands: 21,
              cycleState: CycleState.Idle,
              batchCursorOfLandNFT: 0,
              payAmountPerLand: '0.0000 TLM',
              payment_id: 0,
              pendingPayout: '0.0000 TLM',
              totalPayment: '0.0000 TLM',
              skippedAccounts: ['owner4'],
              startPayThreshold: '150000.0000 TLM',
              payAmountPerMLandRatingPoints: '0.0000 TLM',
              totalLandRating: 0,
            },
          ]
        );
      });
    });
  });

  context('run pay batch', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          landholders.run(5, { from: owners['owner1'] })
        );
      });
    });
    context('with correct auth', async () => {
      context('starting landrating calculation', async () => {
        it('should succeed', async () => {
          await landholders.run(5);
        });
        it('should update the globals', async () => {
          await assertRowsEqual(
            landholders.globalTable({ scope: landholders.account.name }),
            [
              {
                numberOfLands: 21,
                cycleState: CycleState.CalculatingLandPayment,
                batchCursorOfLandNFT: asset_id(1),
                payAmountPerLand: '0.0000 TLM',
                payment_id: 0,
                pendingPayout: '0.0000 TLM',
                totalPayment: '0.0000 TLM',
                skippedAccounts: skippedAccounts,
                startPayThreshold: '150000.0000 TLM',
                payAmountPerMLandRatingPoints: '0.0000 TLM',
                totalLandRating: 0,
              },
            ]
          );
        });
        it('should have populated the landratings table', async () => {
          await landholders.run(6);
          await landholders.run(3);
          await landholders.run(7);
          await landholders.run(8);
          await assertRowCount(
            landholders.landratingsTable({ limit: 100 }),
            shared.landowners.length - skippedAccounts.length
          );
        });
        it('batch process should have switched to WaitingForPayment', async () => {
          const res = await landholders.globalTable({
            scope: landholders.account.name,
          });
          chai
            .expect(res.rows[0].cycleState)
            .to.equal(CycleState.WaitingForPayment);
        });
        // it('should update totalLandRating', async () => {
        //   const res = await landholders.global2Table({
        //     scope: landholders.account.name,
        //   });
        //   chai.expect(res.rows[0].totalLandRating).to.equal(2 * 10 ** 7);
        // });
      });

      context('with no pay to distribute', async () => {
        it('start pay batch should fail with no pay error', async () => {
          await assertEOSErrorIncludesMessage(
            landholders.run(5),
            'Not enough pay to distribute.'
          );
        });
      });

      context('with pay to distribute', async () => {
        before(async () => {
          await sendDailyPay();
        });
        it('start pay batch should succeed', async () => {
          await landholders.run(5);
        });

        it('should update the globals', async () => {
          await assertRowsEqual(
            landholders.globalTable({ scope: landholders.account.name }),
            [
              {
                numberOfLands: 21,
                cycleState: CycleState.ProcessingPayouts,
                batchCursorOfLandNFT: asset_id(1),
                payAmountPerLand: '0.0000 TLM',
                payment_id: 0,
                pendingPayout: '0.0000 TLM',
                totalPayment: '0.0000 TLM',
                skippedAccounts: skippedAccounts,
                startPayThreshold: '150000.0000 TLM',
                payAmountPerMLandRatingPoints: '49999.9550 TLM',
                totalLandRating: 2 * 10 ** 7,
              },
            ]
          );
        });
        // it('should update the globals2', async () => {
        //   await assertRowsEqual(
        //     landholders.global2Table({ scope: landholders.account.name }),
        //     [
        //       {
        //         payAmountPerMLandRatingPoints: '49999.9550 TLM',
        //         totalLandRating: 2 * 10 ** 7,
        //       },
        //     ]
        //   );
        // });
        context(
          'After start pay has succeeded first process batch',
          async () => {
            it('should succeed', async () => {
              await landholders.run(5);
            });
            it('should update payments for landholders', async () => {
              await assertRowsEqual(landholders.payoutsTable({ limit: 50 }), [
                {
                  receiver: 'owner1',
                  payoutAmount: '99999.9100 TLM',
                },
                {
                  receiver: 'owner2',
                  payoutAmount: '99999.9100 TLM',
                },
                {
                  receiver: 'owner3',
                  payoutAmount: '49999.9550 TLM',
                },
              ]);
            });
            it('should update global fields', async () => {
              await assertRowsEqual(landholders.globalTable(), [
                {
                  numberOfLands: 21,
                  cycleState: CycleState.ProcessingPayouts,
                  batchCursorOfLandNFT: asset_id(7),
                  payAmountPerLand: '0.0000 TLM',
                  payment_id: 0,
                  pendingPayout: '249999.7750 TLM',
                  totalPayment: '249999.7750 TLM',
                  skippedAccounts: ['owner4'],
                  startPayThreshold: '150000.0000 TLM',
                  payAmountPerMLandRatingPoints: '49999.9550 TLM',
                  totalLandRating: 2 * 10 ** 7,
                },
              ]);
            });
          }
        );
      });
    });
  });
  context('when user claims pay', async () => {
    context('with no pending pay', async () => {
      it('should fail with not found error for the receiver', async () => {
        await assertEOSErrorIncludesMessage(
          landholders.claimpay('owner21', { from: owners['owner21'] }),
          'Pending pay not found for supplied receiver.'
        );
      });
    });
    context('with a pending pay', async () => {
      context('with wrong auth', async () => {
        it('should fail with an auth error', async () => {
          await assertMissingAuthority(
            landholders.claimpay('owner1', { from: owners['owner2'] })
          );
        });
      });
      context('with correct auth', async () => {
        it('should process payment', async () => {
          await landholders.claimpay('owner1', { from: owners['owner1'] });
        });
        it('should remove pendingPay row', async () => {
          await assertRowsEqual(landholders.payoutsTable({ limit: 50 }), [
            // {
            //   receiver: 'owner1',
            //   payoutAmount: '95238.0094 TLM',
            // },
            {
              receiver: 'owner2',
              payoutAmount: '99999.9100 TLM',
            },
            {
              receiver: 'owner3',
              payoutAmount: '49999.9550 TLM',
            },
          ]);
        });
        it('should update balance for claimer/receiver', async () => {
          await assertRowsEqual(
            eosioToken.accountsTable({ limit: 50, scope: 'owner1' }),
            [
              {
                balance: '99999.9100 TLM',
              },
            ]
          );
        });
        it('should update globals pending pay amount 1', async () => {
          await assertRowsEqual(landholders.globalTable(), [
            {
              numberOfLands: 21,
              cycleState: CycleState.ProcessingPayouts,
              batchCursorOfLandNFT: asset_id(7),
              payAmountPerLand: '0.0000 TLM',
              payment_id: 0,
              pendingPayout: '149999.8650 TLM',
              totalPayment: '249999.7750 TLM',
              skippedAccounts: ['owner4'],
              startPayThreshold: '150000.0000 TLM',
              payAmountPerMLandRatingPoints: '49999.9550 TLM',
              totalLandRating: 2 * 10 ** 7,
            },
          ]);
        });
      });
    });
  });
  context('when processing the next batch', async () => {
    it('should succeed', async () => {
      await landholders.run(5);
    });
    it('should update globals pending pay amount 2', async () => {
      await assertRowsEqual(landholders.globalTable(), [
        {
          numberOfLands: 21,
          cycleState: CycleState.ProcessingPayouts,
          batchCursorOfLandNFT: asset_id(12),
          payAmountPerLand: '0.0000 TLM',
          payment_id: 0,
          pendingPayout: '399999.6400 TLM',
          totalPayment: '499999.5500 TLM',
          skippedAccounts: ['owner4'],
          startPayThreshold: '150000.0000 TLM',
          payAmountPerMLandRatingPoints: '49999.9550 TLM',
          totalLandRating: 2 * 10 ** 7,
        },
      ]);
    });
    context(
      'when processing the remaining batches with remaining records to process',
      async () => {
        it('should process all successfully', async () => {
          await landholders.run(5);
          await landholders.run(6);
        });
        it('should update globals pending pay amount 3', async () => {
          await assertRowsEqual(landholders.globalTable(), [
            {
              numberOfLands: 21,
              cycleState: CycleState.Idle,
              batchCursorOfLandNFT: asset_id(17),
              payAmountPerLand: '0.0000 TLM',
              payment_id: 0,
              pendingPayout: '899999.1900 TLM',
              totalPayment: '999999.1000 TLM',
              skippedAccounts: ['owner4'],
              startPayThreshold: '150000.0000 TLM',
              payAmountPerMLandRatingPoints: '49999.9550 TLM',
              totalLandRating: 2 * 10 ** 7,
            },
          ]);
        });
        it('should have deleted all landrating table entries', async () => {
          await assertRowCount(landholders.landratingsTable({ limit: 100 }), 0);
        });
      }
    );
  });
  context('when processing next cycle', async () => {
    it('should succeed to start next landrating calculation', async () => {
      await landholders.run(10);
    });
    it('should update the global table for the next landrating calculation', async () => {
      await assertRowsEqual(landholders.globalTable(), [
        {
          numberOfLands: 21,
          cycleState: CycleState.CalculatingLandPayment,
          batchCursorOfLandNFT: asset_id(1),
          payment_id: 0,
          payAmountPerLand: '0.0000 TLM',
          pendingPayout: '899999.1900 TLM',
          totalPayment: '999999.1000 TLM',
          skippedAccounts: ['owner4'],
          startPayThreshold: '150000.0000 TLM',
          payAmountPerMLandRatingPoints: '49999.9550 TLM',
          totalLandRating: 0,
        },
      ]);
    });
    it('should have populated the landrating table', async () => {
      await landholders.run(11);
      await landholders.run(12);
      await assertRowCount(
        landholders.landratingsTable({ limit: 100 }),
        shared.landowners.length - skippedAccounts.length
      );
    });
    it('should update batch process state to WaitingForPayment', async () => {
      const res = await landholders.globalTable({
        scope: landholders.account.name,
      });
      chai
        .expect(res.rows[0].cycleState)
        .to.equal(CycleState.WaitingForPayment);
    });
    // it('should have updated totalLandRating', async () => {
    //   const res = await landholders.global2Table({
    //     scope: landholders.account.name,
    //   });
    //   chai.expect(res.rows[0].totalLandRating).to.equal(2 * 10 ** 7);
    // });
    it('without enough pay it should fail with error', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.run(5),
        'Not enough pay to distribute.'
      );
    });
    it('with enough pay should succeed', async () => {
      await sendDailyPay();
      await landholders.run(1);
      const res = await landholders.globalTable({
        scope: landholders.account.name,
      });
      chai
        .expect(res.rows[0].cycleState)
        .to.equal(CycleState.ProcessingPayouts);
    });
    it('should succeed to process next pay first batch', async () => {
      await landholders.run(10);
      await assertRowsEqual(landholders.globalTable(), [
        {
          numberOfLands: 21,
          cycleState: CycleState.ProcessingPayouts,
          batchCursorOfLandNFT: asset_id(12),
          payAmountPerLand: '0.0000 TLM',
          payment_id: 0,
          pendingPayout: '1399999.1900 TLM',
          totalPayment: '1499999.1000 TLM',
          skippedAccounts: ['owner4'],
          startPayThreshold: '150000.0000 TLM',
          payAmountPerMLandRatingPoints: '50000.0000 TLM',
          totalLandRating: 2 * 10 ** 7,
        },
      ]);
    });
    it('should update payments table', async () => {
      await assertRowsEqual(landholders.payoutsTable({ limit: 50 }), [
        {
          receiver: 'owner11',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner12',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner13',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          payoutAmount: '99999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
          receiver: 'owner14',
        },
        {
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
          receiver: 'owner15',
        },
        {
          payoutAmount: '199999.9100 TLM', // sum of 2 land NFTs from Pay 1 and Pay 2
          receiver: 'owner2',
        },
        {
          receiver: 'owner21',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner22',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner23',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner24',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner25',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner3',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner31',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner32',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          receiver: 'owner33',
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
        },
        {
          payoutAmount: '49999.9550 TLM', // 1 NFT from Pay 1. No Pay 2 yet because it's part way through cycle
          receiver: 'owner34',
        },
        // {
        //   receiver: 'owner4',
        //   payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        // },
        {
          receiver: 'owner5',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner1',
          payoutAmount: '100000.0000 TLM',
        },
      ]);
    });
    it('then should succeed to process next pay batch', async () => {
      await landholders.run(15);
      await assertRowsEqual(landholders.globalTable(), [
        {
          numberOfLands: 21,
          cycleState: CycleState.Idle,
          batchCursorOfLandNFT: asset_id(12),
          payAmountPerLand: '0.0000 TLM',
          payment_id: 0,
          pendingPayout: '1899999.1900 TLM',
          totalPayment: '1999999.1000 TLM',
          skippedAccounts: ['owner4'],
          startPayThreshold: '150000.0000 TLM',
          payAmountPerMLandRatingPoints: '50000.0000 TLM',
          totalLandRating: 2 * 10 ** 7,
        },
      ]);
    });
    it('should update all payments', async () => {
      await assertRowsEqual(landholders.payoutsTable({ limit: 50 }), [
        {
          receiver: 'owner12',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner1',
          payoutAmount: '100000.0000 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner11',
          payoutAmount: '99999.9550 TLM', // sum of 2 land NFTs from Pay 2 after claiming pay from Pay 1
        },
        {
          receiver: 'owner13',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner14',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner15',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner2',
          payoutAmount: '199999.9100 TLM', // sum of 2 land NFTs from Pay 1 and Pay 2
        },
        {
          receiver: 'owner21',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner22',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner23',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner24',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner25',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner3',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner31',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner32',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner33',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner34',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner5',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
      ]);
    });
  });
  context('with accumulated pays', async () => {
    it('should claim accumulated pay', async () => {
      await landholders.claimpay('owner12', { from: owners['owner12'] });
    });
    it('should update all payments', async () => {
      await assertRowsEqual(landholders.payoutsTable({ limit: 50 }), [
        {
          receiver: 'owner11',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        // {
        //   receiver: 'owner12',
        //   payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        // },
        {
          receiver: 'owner13',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner14',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner15',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner2',
          payoutAmount: '199999.9100 TLM', // sum of 2 land NFTs from Pay 1 and Pay 2
        },
        {
          receiver: 'owner21',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner22',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner23',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner24',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner25',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner3',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner31',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner32',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner33',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner34',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner5',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner1',
          payoutAmount: '100000.0000 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
      ]);
    });
    it('should update the global table for the start next pay run', async () => {
      await assertRowsEqual(landholders.globalTable(), [
        {
          numberOfLands: 21,
          cycleState: 0,
          batchCursorOfLandNFT: asset_id(12),
          payAmountPerLand: '0.0000 TLM',
          payment_id: 0,
          pendingPayout: '1799999.2350 TLM',
          totalPayment: '1999999.1000 TLM',
          skippedAccounts: ['owner4'],
          startPayThreshold: '150000.0000 TLM',
          payAmountPerMLandRatingPoints: '50000.0000 TLM',
          totalLandRating: 2 * 10 ** 7,
        },
      ]);
    });
    it('balance should be slightly greater than the pendingPayout amount to avoid overpayment', async () => {
      await assertRowsEqual(
        eosioToken.accountsTable({
          limit: 50,
          scope: landholders.account.name,
        }),
        [
          {
            balance: '1800000.2350 TLM',
          },
        ]
      );
    });
    it('should update balance for claimer', async () => {
      await assertRowsEqual(
        eosioToken.accountsTable({ limit: 50, scope: 'owner12' }),
        [
          {
            balance: '99999.9550 TLM',
          },
        ]
      );
    });
  });
  context('claimpay from self permission', async () => {
    it('should claim accumulated pay', async () => {
      await landholders.claimpay('owner13', { from: landholders.account });
    });
    it('should update all payments', async () => {
      await assertRowsEqual(landholders.payoutsTable({ limit: 50 }), [
        {
          receiver: 'owner11',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        // {
        //   receiver: 'owner12',
        //   payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        // },
        // {
        //   receiver: 'owner13',
        //   payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        // },
        {
          receiver: 'owner14',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner15',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner2',
          payoutAmount: '199999.9100 TLM', // sum of 2 land NFTs from Pay 1 and Pay 2
        },
        {
          receiver: 'owner21',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner22',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner23',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner24',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner25',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner3',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner31',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner32',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner33',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner34',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner5',
          payoutAmount: '99999.9550 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
        {
          receiver: 'owner1',
          payoutAmount: '100000.0000 TLM', // sum of 1 land NFT drop from Pay 1 and then Pay 2
        },
      ]);
    });
  });
  context('Openslot', async () => {
    let land: any;
    let mutable_attrs_before, expected_mutable_attrs_after;
    before(async () => {
      const results = await landholders.landregsTable({ limit: 1 });
      land = results.rows[0];

      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      mutable_attrs_before = await asset.mutableData();
      expected_mutable_attrs_after = Object.assign(
        JSON.parse(JSON.stringify(mutable_attrs_before)),
        {
          landrating: '1000000',
          openslots: 2,
          MinBoostAmount: '0',
          BoostLastUsedDay: 0,
          UsedBoostsDay: 0,
        }
      );
    });
    it('without owner auth should fail', async () => {
      await assertMissingAuthority(landholders.openslot(land.owner, land.id));
    });
    it('without deposit should fail', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.openslot(land.owner, land.id, {
          from: owners[land.owner],
        }),
        'No deposit found'
      );
    });
    it('without insufficient deposit should fail', async () => {
      await eosioToken.transfer(
        land.owner,
        shared.landboost.account.name,
        '1.0000 TLM',
        'Too little',
        { from: owners[land.owner] }
      );
      await assertEOSErrorIncludesMessage(
        landholders.openslot(land.owner, land.id, {
          from: owners[land.owner],
        }),
        'Overdrawn balance'
      );
    });
    // it('skipping number should fail', async () => {
    //   await assertEOSErrorIncludesMessage(
    //     landholders.openslot(land.owner, land.id, 3, {
    //       from: owners[land.owner],
    //     }),
    //     "You can't skip numbers"
    //   );
    // });
    it('with sufficient deposit should work', async () => {
      await eosioToken.transfer(
        land.owner,
        shared.landboost.account.name,
        '159.0000 TLM',
        'Just enough',
        { from: owners[land.owner] }
      );
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
    });
    it('deposit should have been erased', async () => {
      await assertRowCount(landholders.depositsTable(), 0);
    });
    it('should increase openslots of NFT', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      const mutableData = await asset.mutableData();
      chai.expect(mutableData).to.deep.equal(expected_mutable_attrs_after);
    });
    it('openslot next level should work', async () => {
      await eosioToken.transfer(
        shared.tokenIssuer.name,
        land.owner,
        '300000.0000 TLM',
        'Whale subsidy',
        { from: shared.tokenIssuer }
      );
      await eosioToken.transfer(
        land.owner,
        shared.landboost.account.name,
        '209061.0000 TLM',
        '1 TLM too much',
        { from: owners[land.owner] }
      );
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
      await sleep(500);
      await landholders.openslot(land.owner, land.id, {
        from: owners[land.owner],
      });
    });
    it('openslot should fail when at level 15', async () => {
      await sleep(500);
      await assertEOSErrorIncludesMessage(
        landholders.openslot(land.owner, land.id, {
          from: owners[land.owner],
        }),
        'ERROR::OPEN_SLOT::'
      );
    });
    it('should deduct the total cost from the deposit', async () => {
      await assertRowsEqual(landholders.depositsTable(), [
        { account: 'owner1', quantity: '1.0000 TLM' },
      ]);
    });
  });
  context('Boost', async () => {
    let land: any;
    let mutable_attrs_before, expected_attrs_after;
    before(async () => {
      const results = await landholders.landregsTable({ limit: 1 });
      land = results.rows[0];

      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      mutable_attrs_before = await asset.mutableData();
      expected_attrs_after = Object.assign(
        JSON.parse(JSON.stringify(mutable_attrs_before)),
        {
          landrating: '1000000',
          openslots: 15,
          MinBoostAmount: '80000',
          BoostLastUsedDay: 0,
          UsedBoostsDay: 0,
        }
      );
    });
    it('setminboost without proper auth should fail', async () => {
      await assertMissingAuthority(
        landholders.setminboost(land.owner, land.id, '8.0000 TLM')
      );
    });
    it('setminboost should succeed', async () => {
      await landholders.setminboost(land.owner, land.id, '8.0000 TLM', {
        from: owners[land.owner],
      });
    });
    it('setminboost should update MinBoostAmount', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      const mutableData = await asset.mutableData();
      chai.expect(mutableData).to.deep.equal(expected_attrs_after);
    });
    it('with invalid level should fail', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.boost(land.id, '8.0001 TLM', land.owner, today, 1, {
          from: owners[land.owner],
        }),
        'No boost possible for exactly 8.0001 TLM'
      );
    });
    it('with level lower than MinBoostAmount should fail', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.boost(land.id, '4.0000 TLM', land.owner, today, 1, {
          from: owners[land.owner],
        }),
        'Trying to boost with 4.0000 TLM but MinBoostAmount is set to 8.0000 TLM'
      );
    });
    it('without enough deposited should fail', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.boost(land.id, '8.0000 TLM', land.owner, today, 1, {
          from: owners[land.owner],
        }),
        'Overdrawn balance'
      );
    });
    it('with wrong symbol should fail', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.boost(land.id, '8.0000 ABC', land.owner, today, 1, {
          from: owners[land.owner],
        }),
        'Wrong symbol, can only use TLM to boost'
      );
    });
    it('with sufficiently high deposit should work', async () => {
      await eosioToken.transfer(
        land.owner,
        shared.landboost.account.name,
        '1000.0000 TLM',
        'deposit',
        { from: owners[land.owner] }
      );
      await assertRowsEqual(landholders.depositsTable(), [
        { account: 'owner1', quantity: '1001.0000 TLM' },
      ]);

      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      mutable_attrs_before = await asset.mutableData();
      expected_attrs_after = Object.assign(
        JSON.parse(JSON.stringify(mutable_attrs_before)),
        {
          landrating: '1000500',
          openslots: 15,
          MinBoostAmount: '80000',
          BoostLastUsedDay: get_day(),
          UsedBoostsDay: 1,
        }
      );

      await landholders.boost(land.id, '8.0000 TLM', land.owner, today, 1, {
        from: owners[land.owner],
      });
    });
    it('should have increased landrating', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      const mutableData = await asset.mutableData();
      chai.expect(mutableData).to.deep.equal(expected_attrs_after);
    });
    it('should have deducted amount from deposited balance', async () => {
      await assertRowsEqual(landholders.depositsTable(), [
        { account: 'owner1', quantity: '993.0000 TLM' },
      ]);
    });
    it('too many times should fail', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      mutable_attrs_before = await asset.mutableData();
      expected_attrs_after = Object.assign(
        JSON.parse(JSON.stringify(mutable_attrs_before)),
        {
          landrating: '1007521',
          openslots: 15,
          MinBoostAmount: '80000',
          BoostLastUsedDay: get_day(),
          UsedBoostsDay: 15,
        }
      );

      const now = today;
      for (let nonce = 2; nonce < 16; nonce++) {
        await landholders.boost(land.id, '8.0000 TLM', land.owner, now, nonce, {
          from: owners[land.owner],
        });
      }
      await assertEOSErrorIncludesMessage(
        landholders.boost(land.id, '8.0000 TLM', land.owner, now, 16, {
          from: owners[land.owner],
        }),
        'You have already boosted 15 times'
      );
    });
    it('should have increased landrating even more', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      const mutableData = await asset.mutableData();
      chai.expect(mutableData).to.deep.equal(expected_attrs_after);
    });
    context('1 day later', async () => {
      let mutable_attrs_before, expected_attrs_after;
      before(async () => {
        const day_now = get_day(now);
        const asset = await shared.get_atomic().getAsset(land.owner, land.id);
        mutable_attrs_before = await asset.mutableData();
        expected_attrs_after = Object.assign(
          JSON.parse(JSON.stringify(mutable_attrs_before)),
          {
            landrating: '1008024',
            openslots: 15,
            MinBoostAmount: '80000',
            BoostLastUsedDay: get_day(tomorrow),
            UsedBoostsDay: 1,
          }
        );
      });
      it('it should work again', async () => {
        await landholders.boost(
          land.id,
          '8.0000 TLM',
          land.owner,
          tomorrow,
          1,
          { from: owners[land.owner] }
        );
      });
      it('should have increased landrating again', async () => {
        const asset = await shared.get_atomic().getAsset(land.owner, land.id);
        const mutableData = await asset.mutableData();
        console.log('mutableData: ', JSON.stringify(mutableData, null, 2));
        console.log('mutableData.TopReachedAt: ', mutableData.TopReachedAt);
        chai.expect(mutableData).to.deep.equal(expected_attrs_after);
      });
      it('boosting too many times should fail again', async () => {
        const asset = await shared.get_atomic().getAsset(land.owner, land.id);
        mutable_attrs_before = await asset.mutableData();
        const day_tomorrow = get_day(tomorrow);
        expected_attrs_after = Object.assign(
          JSON.parse(JSON.stringify(mutable_attrs_before)),
          {
            landrating: '1015098',
            openslots: 15,
            MinBoostAmount: '80000',
            BoostLastUsedDay: get_day(tomorrow),
            UsedBoostsDay: 15,
          }
        );

        for (let nonce = 2; nonce < 16; nonce++) {
          await landholders.boost(
            land.id,
            '8.0000 TLM',
            land.owner,
            tomorrow,
            nonce,
            { from: owners[land.owner] }
          );
        }
        await assertEOSErrorIncludesMessage(
          landholders.boost(land.id, '8.0000 TLM', land.owner, tomorrow, 16, {
            from: owners[land.owner],
          }),
          'You have already boosted 15 times'
        );

        const asset = await shared.get_atomic().getAsset(land.owner, land.id);
        const mutableData = await asset.mutableData();
        chai.expect(mutableData).to.deep.equal(expected_attrs_after);
      });
    });

    context('boost for somebody else', async () => {
      let someuser: Account;
      let day: Date;
      before(async () => {
        someuser = await AccountManager.createAccount('someuser');
        await eosioToken.transfer(
          shared.tokenIssuer.name,
          someuser.name,
          '100.0000 TLM',
          'some money',
          { from: shared.tokenIssuer }
        );
        const now = dayjs.utc();
        day = isoUtc(now.add(48, 'hours'));

        const asset = await shared.get_atomic().getAsset(land.owner, land.id);
        mutable_attrs_before = await asset.mutableData();
        expected_attrs_after = Object.assign(
          JSON.parse(JSON.stringify(mutable_attrs_before)),
          {
            landrating: '1015605',
            openslots: 15,
            MinBoostAmount: '80000',
            BoostLastUsedDay: get_day(day),
            UsedBoostsDay: 1,
          }
        );
      });
      it('without authorization from payer should fail', async () => {
        await assertMissingAuthority(
          landholders.boost(land.id, '8.0000 TLM', someuser.name, day, 1)
        );
      });
      it('without deposit should fail', async () => {
        await assertEOSErrorIncludesMessage(
          landholders.boost(land.id, '8.0000 TLM', someuser.name, day, 1, {
            from: someuser,
          }),
          'No deposit found'
        );
      });
      it('with deposit should work', async () => {
        await eosioToken.transfer(
          someuser.name,
          shared.landboost.account.name,
          '100.0000 TLM',
          'deposit',
          { from: someuser }
        );

        await assertRowsEqual(landholders.depositsTable(), [
          { account: 'owner1', quantity: '761.0000 TLM' },
          {
            account: 'someuser',
            quantity: '100.0000 TLM',
          },
        ]);

        await landholders.boost(land.id, '8.0000 TLM', someuser.name, day, 1, {
          from: someuser,
        });
      });
      it('should have increased landrating for landowner', async () => {
        const asset = await shared.get_atomic().getAsset(land.owner, land.id);
        const mutableData = await asset.mutableData();
        chai.expect(mutableData).to.deep.equal(expected_attrs_after);
      });
      it("should have deducted the money from payer's deposit", async () => {
        await assertRowsEqual(landholders.depositsTable(), [
          { account: 'owner1', quantity: '761.0000 TLM' },
          {
            account: 'someuser',
            quantity: '92.0000 TLM',
          },
        ]);
      });
    });
  });

  context('Boost Rare Lands', async () => {
    let land: any;
    let owner: any;
    let mutable_attrs_before, expected_attrs_after;
    let deposit_before;
    before(async () => {
      common_owner = await AccountManager.createAccount('commonowner');
      rare_owner = await AccountManager.createAccount('rareowner');
      epic_owner = await AccountManager.createAccount('epicowner');
      legendary_owner = await AccountManager.createAccount('legendaryow');
      shared.landowners.push(common_owner);
      shared.landowners.push(rare_owner);
      shared.landowners.push(epic_owner);
      shared.landowners.push(legendary_owner);

      await shared.mintLand(common_owner.name, 'Common');
      await shared.mintLand(rare_owner.name, 'Rare');
      await shared.mintLand(epic_owner.name, 'Epic');
      await shared.mintLand(legendary_owner.name, 'Legendary');

      const results = await landholders.landregsTable({ limit: 100 });

      rare_land = results.rows.find((x) => x.owner === rare_owner.name);
      epic_land = results.rows.find((x) => x.owner === epic_owner.name);
      legendary_land = results.rows.find(
        (x) => x.owner === legendary_owner.name
      );
      common_land = results.rows.find((x) => x.owner === common_owner.name);

      // add additional attributes to the lands
      await setassetdata(
        [common_land, rare_land, epic_land, legendary_land],
        EOSManager
      );
    });
    it('check landrating boost for different rarities', async () => {
      await boost_and_check(rare_owner, rare_land);
      await boost_and_check(epic_owner, epic_land);
      await boost_and_check(legendary_owner, legendary_land);
    });
  });
  context('Boost 1 day later with cap enabled', async () => {
    let land: any;
    let mutableData: any;
    let expected_attrs_after: any;
    let mutable_attrs_before: any;
    before(async () => {
      const results = await landholders.landregsTable({ limit: 1 });
      land = results.rows[0];
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);

      mutable_attrs_before = await asset.mutableData();

      expected_attrs_after = Object.assign(
        JSON.parse(JSON.stringify(mutable_attrs_before)),
        {
          landrating: '1015098',
          openslots: 15,
          MinBoostAmount: '80000',
          BoostLastUsedDay: get_day(day_after_tomorrow),
          UsedBoostsDay: 2,
          TopReachedAt: dayjs.utc().unix(),
        }
      );

      await landholders.setiscapped(true);
    });
    it('should work', async () => {
      await landholders.boost(
        land.id,
        '8.0000 TLM',
        land.owner,
        day_after_tomorrow,
        1,
        {
          from: owners[land.owner],
        }
      );
    });
    it('should update metadata', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);

      const mutableData = await asset.mutableData();
      chai
        .expect(mutableData.openslots)
        .to.equal(expected_attrs_after.openslots);
      chai
        .expect(mutableData.MinBoostAmount)
        .to.equal(expected_attrs_after.MinBoostAmount);
      chai
        .expect(mutableData.BoostLastUsedDay)
        .to.equal(expected_attrs_after.BoostLastUsedDay);
      chai
        .expect(mutableData.UsedBoostsDay)
        .to.equal(expected_attrs_after.UsedBoostsDay);
      SharedTestObjects.assert_close_enough(
        mutableData.TopReachedAt,
        expected_attrs_after.TopReachedAt,
        5
      );
    });

    it('should fail to boost', async () => {
      await assertEOSErrorIncludesMessage(
        landholders.boost(
          land.id,
          '8.0000 TLM',
          land.owner,
          day_after_tomorrow,
          2,
          {
            from: owners[land.owner],
          }
        ),
        'Landrating is already at the top'
      );
    });
  });

  context('megaboost/superboost', async () => {
    let mega_land: any;
    let super_land: any;
    let mega_owner: any;
    let super_owner: any;
    let mutable_attrs_before, expected_attrs_after;
    let deposit_before;
    let initial_landrating;
    let avg_landrating;
    let top_landrating;
    let megaboost_asset;
    let superboost_asset;
    before(async () => {
      mega_owner = await AccountManager.createAccount('megaowner');
      super_owner = await AccountManager.createAccount('superowner');
      shared.landowners.push(mega_owner);

      await shared.mintLand(mega_owner.name, 'Common');
      await shared.mintLand(super_owner.name, 'Common');

      const results = await landholders.landregsTable({ limit: 100 });

      mega_land = results.rows.find((x) => x.owner === mega_owner.name);
      super_land = results.rows.find((x) => x.owner === super_owner.name);

      // add additional attributes to the lands
      await setassetdata([super_land, mega_land], EOSManager);

      await shared.createBoostSchema();
      await shared.createMegaboostTemplate();
      await shared.createSuperboostTemplate();

      await shared.mintMegaboost(mega_owner);
      await shared.mintSuperboost(super_owner);

      megaboost_asset = (
        await shared.atomicassets.assetsTable({ scope: mega_owner.name })
      ).rows.find((x) => x.template_id === shared.MEGABOOST_TEMPLATE_ID);
      console.log('megaboost_asset: ', JSON.stringify(megaboost_asset));
      superboost_asset = (
        await shared.atomicassets.assetsTable({ scope: super_owner.name })
      ).rows.find((x) => x.template_id === shared.SUPERBOOST_TEMPLATE_ID);

      await landholders.setconfig2(
        shared.MEGABOOST_TEMPLATE_ID,
        shared.SUPERBOOST_TEMPLATE_ID
      );
    });

    it('establish initial landrating', async () => {
      let asset = await shared
        .get_atomic()
        .getAsset(mega_owner.name, mega_land.id);
      let mutableData = await asset.mutableData();
      initial_landrating = mutableData.landrating;

      asset = await shared
        .get_atomic()
        .getAsset(super_owner.name, super_land.id);
      mutableData = await asset.mutableData();
      chai.expect(initial_landrating).to.equal(mutableData.landrating);

      let res = await shared.landholders.global2Table();
      avg_landrating = await shared.singleton_get(res, 'avg_landrating');
      top_landrating = await shared.singleton_get(res, 'top_landrating');
    });
    context('megaboost', async () => {
      context('without owner auth', async () => {
        it('should fail', async () => {
          await assertMissingAuthority(landholders.megaboost(mega_land.id));
        });
      });
      context('without owning a megaboost nft', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            landholders.megaboost(mega_land.id, { from: mega_owner }),
            'No nft found for owner'
          );
        });
      });
      context('when owning a megaboost nft', async () => {
        before(async () => {
          console.log(
            `transferring asset ${megaboost_asset.asset_id} from ${mega_owner.name} to ${landholders.account.name}`
          );
          await shared.atomicassets.transfer(
            mega_owner,
            landholders.account,
            [megaboost_asset.asset_id],
            'deposit',
            { from: mega_owner }
          );
        });
        it('with owner auth should work', async () => {
          await landholders.megaboost(mega_land.id, { from: mega_owner });
        });
        it('should boost landrating', async () => {
          let asset = await shared
            .get_atomic()
            .getAsset(mega_owner.name, mega_land.id);
          let mutableData = await asset.mutableData();
          console.log('mutableData: ', JSON.stringify(mutableData, null, 2));
          const landrating_after = mutableData.landrating;
          chai.expect(landrating_after).to.equal(String(avg_landrating));
          console.log(
            `initial_landrating: ${initial_landrating} landrating_after ${landrating_after} avg_landrating: ${avg_landrating} top_landrating: ${top_landrating}`
          );
        });
        it('should burn the megaboost NFT', async () => {
          const res = await shared.atomicassets.assetsTable({
            scope: landholders.account.name,
          });
          console.log('assetsTable: ', JSON.stringify(res, null, 2));
          chai.expect(
            res.rows.find((x) => x.asset_id === megaboost_asset.asset_id)
          ).to.be.undefined;
        });
        it('should erase from the deposit table', async () => {
          const res = await landholders.nftdepositsTable();
          console.log('nftdepositsTable: ', JSON.stringify(res, null, 2));
          chai.expect(
            res.rows.find((x) => x.asset_id === megaboost_asset.asset_id)
          ).to.be.undefined;
        });
      });
    });
    context('superboost', async () => {
      context('without owner auth', async () => {
        it('should fail', async () => {
          await assertMissingAuthority(landholders.superboost(super_land.id));
        });
      });
      context('without owning a superboost nft', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            landholders.superboost(super_land.id, { from: super_owner }),
            'No nft found for owner'
          );
        });
      });
      context('when owning a superboost nft', async () => {
        before(async () => {
          console.log(
            `transferring asset ${superboost_asset.asset_id} from ${super_owner.name} to ${landholders.account.name}`
          );
          await shared.atomicassets.transfer(
            super_owner,
            landholders.account,
            [superboost_asset.asset_id],
            'deposit',
            { from: super_owner }
          );
        });
        it('with owner auth should work', async () => {
          await landholders.superboost(super_land.id, { from: super_owner });
        });
        it('should boost landrating', async () => {
          let asset = await shared
            .get_atomic()
            .getAsset(super_owner.name, super_land.id);
          let mutableData = await asset.mutableData();
          console.log('mutableData: ', JSON.stringify(mutableData, null, 2));
          const landrating_after = mutableData.landrating;
          const expected_landrating = Math.floor(
            (parseInt(top_landrating, 10) + parseInt(initial_landrating, 10)) /
              2
          );
          chai.expect(landrating_after).to.equal(String(expected_landrating));
        });
        it('should burn the superboost NFT', async () => {
          const res = await shared.atomicassets.assetsTable({
            scope: landholders.account.name,
          });
          chai.expect(
            res.rows.find((x) => x.asset_id === superboost_asset.asset_id)
          ).to.be.undefined;
        });
        it('should erase from the deposit table', async () => {
          const res = await landholders.nftdepositsTable();
          chai.expect(
            res.rows.find((x) => x.asset_id === superboost_asset.asset_id)
          ).to.be.undefined;
        });
        it('resetrating should work and be able to lower the avg landrating', async () => {
          let res = await shared.landholders.global2Table();
          const avg_landrating_before = await shared.singleton_get(
            res,
            'avg_landrating'
          );
          const top_landrating_before = await shared.singleton_get(
            res,
            'top_landrating'
          );

          await landholders.resetrating(super_land.id);

          res = await shared.landholders.global2Table();
          const avg_landrating_after = await shared.singleton_get(
            res,
            'avg_landrating'
          );
          const top_landrating_after = await shared.singleton_get(
            res,
            'top_landrating'
          );

          console.log(
            `avg_landrating_before: ${avg_landrating_before} avg_landrating_after: ${avg_landrating_after} top_landrating_before: ${top_landrating_before} top_landrating_after: ${top_landrating_after}`
          );
          chai
            .expect(avg_landrating_after)
            .to.be.lessThan(avg_landrating_before);
          chai.expect(top_landrating_after).to.equal(top_landrating_before);
        });
      });
    });
    context('withdrboost', async () => {
      let withdrawer;
      let somebody;
      let megaboost_asset;
      before(async () => {
        withdrawer = await AccountManager.createAccount();
        somebody = await AccountManager.createAccount();
        await shared.mintMegaboost(withdrawer);
        megaboost_asset = (
          await shared.atomicassets.assetsTable({ scope: withdrawer.name })
        ).rows.find((x) => x.template_id === shared.MEGABOOST_TEMPLATE_ID);
      });
      context('with owner auth and nothing deposited', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            landholders.withdrboost(megaboost_asset.asset_id, {
              from: withdrawer,
            }),
            'NFT deposit not found'
          );
        });
      });
      context('without owner auth and something deposited', async () => {
        before(async () => {
          await shared.atomicassets.transfer(
            withdrawer,
            landholders.account,
            [megaboost_asset.asset_id],
            'deposit',
            { from: withdrawer }
          );
        });
        it('should fail', async () => {
          await assertMissingAuthority(
            landholders.withdrboost(megaboost_asset.asset_id, {
              from: somebody,
            })
          );
        });
      });
      context('with correct owner auth', async () => {
        it('should work', async () => {
          await landholders.withdrboost(megaboost_asset.asset_id, {
            from: withdrawer,
          });
        });
        it('should erase from the deposit table', async () => {
          const res = await landholders.nftdepositsTable();
          chai.expect(
            res.rows.find((x) => x.asset_id === megaboost_asset.asset_id)
          ).to.be.undefined;
        });
        it('should transfer the NFT to the owner', async () => {
          const res = await shared.atomicassets.assetsTable({
            scope: withdrawer.name,
          });
          chai.expect(
            res.rows.find((x) => x.asset_id === megaboost_asset.asset_id)
          ).to.not.be.undefined;
        });
      });
    });
  });

  context('setprofitshr', async () => {
    let land: any;
    it('should work', async () => {
      const results = await landholders.landregsTable({ limit: 1 });
      land = results.rows[0];
      await shared.landholders.setprofitshr(land.owner, land.id, 234, {
        from: owners[land.owner],
      });
    });
    it('should require owner auth', async () => {
      await assertMissingAuthority(
        shared.landholders.setprofitshr(land.owner, land.id, 234)
      );
    });
    it('should update landrating mutable attr', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      const mutableData = await asset.mutableData();
      chai.expect(mutableData).to.deep.equal(
        Object.assign(JSON.parse(JSON.stringify(mutableData)), {
          commission: 234,
        })
      );
    });
  });
  context('setlandnick', async () => {
    let land: any;
    it('should work', async () => {
      const results = await landholders.landregsTable({ limit: 1 });
      land = results.rows[0];
      await shared.landholders.setlandnick(land.owner, land.id, 'xyz123', {
        from: owners[land.owner],
      });
    });
    it('should require owner auth', async () => {
      await assertMissingAuthority(
        shared.landholders.setlandnick(land.owner, land.id, 'xyz123')
      );
    });
    it('should update landrating mutable attr', async () => {
      const asset = await shared.get_atomic().getAsset(land.owner, land.id);
      const mutableData = await asset.mutableData();
      chai.expect(mutableData).to.deep.equal(
        Object.assign(JSON.parse(JSON.stringify(mutableData)), {
          nickname: 'xyz123',
        })
      );
    });
  });
  context('setminlndcom', async () => {
    let minLandCommission = 500; // 5% commission
    let maxLandCommission = 2000; // 20% commission

    before(async () => {
      await landholders.setmaxlndcom(testplanet.name, maxLandCommission, {
        from: authorizedAccount,
      });
    });

    context('without proper authorization', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          landholders.setminlndcom(testplanet.name, minLandCommission, {
            from: anybody,
          })
        );
      });
    });

    context('with proper authorization', async () => {
      it('should succeed', async () => {
        await landholders.setminlndcom(testplanet.name, minLandCommission, {
          from: authorizedAccount,
        });
      });

      it('should update the minimum land commission', async () => {
        // Fetch the updated planet configuration
        const planetConfigs = await landholders.plntconfigsTable({
          scope: testplanet.name,
        });
        const minCommission = await shared.singleton_get(
          planetConfigs,
          'min_commission'
        );
        chai.expect(minCommission).to.equal(minLandCommission);
      });
    });

    context('setting minimum land commission higher than maximum', async () => {
      it('should fail', async () => {
        let higherMinLandCommission = 2100; // 21%
        await assertEOSErrorIncludesMessage(
          landholders.setminlndcom(testplanet.name, higherMinLandCommission, {
            from: authorizedAccount,
          }),
          'ERR::MIN_LAND_COMMISSION_GREATER_THAN_MAX::'
        );
      });
    });
  });

  context('stgminlndcom', async () => {
    let globalMinLandCommission = 300; // 3% commission

    context('without proper authorization', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          landholders.stgminlndcom(globalMinLandCommission, {
            from: anybody,
          })
        );
      });
    });

    context('with proper authorization', async () => {
      context('with max land comm set', async () => {
        before(async () => {
          await landholders.stgmaxlndcom(2000); // 20%
        });

        it('should succeed', async () => {
          await landholders.stgminlndcom(globalMinLandCommission);
        });

        it('should update the global minimum land commission', async () => {
          // Fetch the updated global configuration
          const globalConfigs = await landholders.plntconfigsTable({
            scope: landholders.account.name,
          });
          const minCommission = await shared.singleton_get(
            globalConfigs,
            'min_commission'
          );
          chai.expect(minCommission).to.equal(globalMinLandCommission);
        });
      });
    });

    context(
      'setting global minimum land commission higher than maximum',
      async () => {
        it('should fail', async () => {
          let higherGlobalMinLandCommission = 2100; // 21%
          await assertEOSErrorIncludesMessage(
            landholders.stgminlndcom(higherGlobalMinLandCommission),
            'ERR::MIN_LAND_COMMISSION_GREATER_THAN_MAX::'
          );
        });
      }
    );
  });
  context('setmaxlndcom', async () => {
    let maxLandCommission = 2000; // 20% commission
    let minLandCommission = 500; // 5% commission

    context('without proper authorization', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          landholders.setmaxlndcom(testplanet.name, maxLandCommission, {
            from: anybody,
          })
        );
      });
    });

    context('with proper authorization', async () => {
      it('should succeed', async () => {
        await landholders.setmaxlndcom(testplanet.name, maxLandCommission, {
          from: authorizedAccount,
        });
      });

      it('should update the maximum land commission', async () => {
        // Fetch the updated planet configuration
        const planetConfigs = await landholders.plntconfigsTable({
          scope: testplanet.name,
        });
        const maxCommission = await shared.singleton_get(
          planetConfigs,
          'max_commission'
        );
        chai.expect(maxCommission).to.equal(maxLandCommission);
      });
    });

    context('setting maximum land commission lower than minimum', async () => {
      before(async () => {
        await landholders.setminlndcom(testplanet.name, minLandCommission, {
          from: authorizedAccount,
        });
      });
      it('should fail', async () => {
        let lowerMaxLandCommission = 400;
        await assertEOSErrorIncludesMessage(
          landholders.setmaxlndcom(testplanet.name, lowerMaxLandCommission, {
            from: authorizedAccount,
          }),
          'ERR::MAX_LAND_COMMISSION_LESS_THAN_MIN::'
        );
      });
    });

    context('setting maximum land commission higher than 100%', async () => {
      it('should fail', async () => {
        let higherMaxLandCommission = 10001; // 100.01% commission
        await assertEOSErrorIncludesMessage(
          landholders.setmaxlndcom(testplanet.name, higherMaxLandCommission, {
            from: authorizedAccount,
          }),
          'ERR::MAX_LAND_COMMISSION_OVER_100::'
        );
      });
    });
  });

  context('stgmaxlndcom', async () => {
    let globalMaxLandCommission = 2000; // 20% commission

    context('without proper authorization', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          landholders.stgmaxlndcom(globalMaxLandCommission, {
            from: anybody,
          })
        );
      });
    });

    context('with proper authorization', async () => {
      it('should succeed', async () => {
        await landholders.stgmaxlndcom(globalMaxLandCommission);
      });

      it('should update the global maximum land commission', async () => {
        // Fetch the updated global configuration
        const globalConfigs = await landholders.plntconfigsTable({
          scope: landholders.account.name,
        });
        const maxCommission = await shared.singleton_get(
          globalConfigs,
          'max_commission'
        );
        chai.expect(maxCommission).to.equal(globalMaxLandCommission);
      });
    });

    context(
      'setting global maximum land commission lower than minimum',
      async () => {
        before(async () => {
          await shared.landholders.stgminlndcom(500);
        });
        it('should fail', async () => {
          let lowerGlobalMaxLandCommission = 400;
          await assertEOSErrorIncludesMessage(
            landholders.stgmaxlndcom(lowerGlobalMaxLandCommission),
            'ERR::MAX_LAND_COMMISSION_LESS_THAN_MIN::'
          );
        });
      }
    );

    context(
      'setting global maximum land commission higher than 100%',
      async () => {
        it('should fail', async () => {
          let higherGlobalMaxLandCommission = 10001; // 100.01% commission
          await assertEOSErrorIncludesMessage(
            landholders.stgmaxlndcom(higherGlobalMaxLandCommission),
            'ERR::MAX_LAND_COMMISSION_OVER_100::'
          );
        });
      }
    );
  });
});

let nonce = 0;
async function boost_and_check(owner, land) {
  await eosioToken.transfer(
    shared.tokenIssuer.name,
    owner,
    '1000.0000 TLM',
    'inital balance',
    { from: shared.tokenIssuer }
  );
  const asset = await shared.get_atomic().getAsset(owner.name, land.id);

  let mutable_attrs_before = await asset.mutableData();

  let expected_attrs_after = Object.assign(
    JSON.parse(JSON.stringify(mutable_attrs_before)),
    {
      landrating: await calc_land_rating_after_boost(land, 80000),
      UsedBoostsDay: mutable_attrs_before.UsedBoostsDay + 1,
      BoostLastUsedDay: get_day(),
    }
  );

  await eosioToken.transfer(
    owner,
    shared.landboost.account.name,
    '8.0000 TLM',
    'deposit',
    { from: owner }
  );
  await landholders.boost(land.id, '8.0000 TLM', land.owner, today, nonce++, {
    from: owner,
  });

  let asset_after = await shared.get_atomic().getAsset(land.owner, land.id);
  let mutableData_after = await asset_after.mutableData();
  chai.expect(mutableData_after).to.deep.equal(expected_attrs_after);
}

async function configureAuths() {
  await UpdateAuth.execUpdateAuth(
    [{ actor: landholders.account.name, permission: 'active' }],
    landholders.account.name,
    'distribpay',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(landholders.account)
  );

  await UpdateAuth.execLinkAuth(
    landholders.account.active,
    landholders.account.name,
    eosioToken.account.name,
    'transfer',
    'distribpay'
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: landholders.account.name, permission: 'active' }],
    landholders.account.name,
    'burn',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(landholders.account)
  );
  await UpdateAuth.execLinkAuth(
    landholders.account.active,
    landholders.account.name,
    atomicassets.account.name,
    'burnasset',
    'burn'
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: landholders.account.name, permission: 'active' }],
    landholders.account.name,
    'xfer',
    'active',
    UpdateAuth.AuthorityToSet.forContractCode(landholders.account)
  );
  await UpdateAuth.execLinkAuth(
    landholders.account.active,
    landholders.account.name,
    atomicassets.account.name,
    'transfer',
    'xfer'
  );
}

async function seedAccounts() {
  const names = [
    'owner1',
    'owner2',
    'owner3',
    'owner4',
    'owner5',
    'owner11',
    'owner12',
    'owner13',
    'owner14',
    'owner15',
    'owner21',
    'owner22',
    'owner23',
    'owner24',
    'owner25',
    'owner31',
    'owner32',
    'owner33',
    'owner34',
    'owner35',
    'owner41',
  ];
  names.forEach(async (name) => {
    owners[name] = await AccountManager.createAccount(name);
  });
}

async function issueTokens() {
  await eosioToken.transfer(
    shared.tokenIssuer.name,
    landholders.account.name,
    '0.1000 TLM',
    'inital balance',
    { from: shared.tokenIssuer }
  );
}

async function sendDailyPay() {
  await eosioToken.transfer(
    shared.tokenIssuer.name,
    landholders.account.name,
    '1000000.0000 TLM',
    'day pay',
    { from: shared.tokenIssuer }
  );
}

function get_day(now = null) {
  const d = dayjs.utc(now || today);
  const SECONDS_PER_DAY = 24 * 60 * 60;
  return Math.floor(d.unix() / SECONDS_PER_DAY);
}

async function calc_land_rating_after_boost(land, boost_amount: Number) {
  const asset = await shared.get_atomic().getAsset(land.owner, land.id);
  const mutableData = await asset.mutableData();
  const immutableData = await asset.immutableData();
  const rarity = immutableData.rarity;
  const landrating = mutableData.landrating;

  const boost_levels = {
    40000: 0.03,
    80000: 0.05,
    160000: 0.08,
    320000: 0.13,
    640000: 0.21,
  };
  const rarity_extras = {
    Rare: 0.001,
    Epic: 0.002,
    Legendary: 0.003,
  };
  let increase = boost_levels[boost_amount];
  if (rarity in rarity_extras) {
    increase += rarity_extras[rarity];
  }

  const new_landrating = landrating * (1.0 + increase / 100.0);
  return String(Math.floor(new_landrating));
}
