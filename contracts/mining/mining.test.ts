import 'dotenv/config';
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
  EOSManager,
  sleep,
  assertBalanceEqual,
  Asset,
} from 'lamington';
import { Atomicassets } from '../atomicassets-contracts/src/atomicassets';
import { SharedTestObjects } from '../TestHelpers';
const chai = require('chai');
import { Mining } from './mining';
import { get_nonce } from './client/client_mine_testing';
let mining: Mining;
let atomicassets: Atomicassets;
let miner1: Account;
let miner2: Account;
let miner3: Account;

let miner4: Account;
let filler: Account;
let anybody: Account;
let yeomenwarder: Account;
let shared: SharedTestObjects;
const { Serialize } = require('eosjs');
const Uint64LE = require('int64-buffer').Uint64LE;
const Int64LE = require('int64-buffer').Int64LE;
import * as moment from 'moment';

// Add reference time variable
let ref_block_time: Date;

// Add helper function for creating properly formatted UTC timestamps (timezone-safe)
const referenceTimeWithAddedHours = async (hours: number) => {
  // Work in UTC to avoid host TZ skew (e.g., Melbourne/DST)
  return moment
    .utc(ref_block_time)
    .startOf('day')
    .add(hours, 'hours')
    .format('YYYY-MM-DDTHH:mm:ss');
};

const seconds = 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

describe('Mining', () => {
  let authorizer: Account;
  let notify_account: Account;
  before(async () => {
    shared = await SharedTestObjects.getInstance();
    EOSManager.initWithDefaults();
    await createTestAccounts();
    await shared.createPlanet(shared.testplanet, '4,WHATX');
    await mining.insertclaims(miner1.name, [1, 2, 3, 4, 5, 9996], {
      from: mining.account,
    });

    await mining.insertclaims(miner2.name, [11, 12, 13, 14, 15, 16], {
      from: mining.account,
    });

    await mining.insertclaims(miner3.name, [21, 22, 23, 22, 25, 26], {
      from: mining.account,
    });

    authorizer = await AccountManager.createAccount('eye.unn.dac');
    notify_account = await AccountManager.createAccount();

    // Set reference block time
    let info = await EOSManager.api.rpc.get_info();
    ref_block_time = new Date(`2022-07-07T00:00:00.000Z`);
  });
  context('addnotify', async () => {
    before(async () => {});
    context('with wrong auth', async () => {
      it('should fail with missing auth error', async () => {
        await assertMissingAuthority(
          mining.addnotify(
            authorizer.name,
            shared.testplanet,
            notify_account.name,
            {
              from: anybody,
            }
          )
        );
      });
    });
    context('with correct auth', async () => {
      it('but non-existent planet should fail', async () => {
        await assertEOSErrorIncludesMessage(
          mining.addnotify(
            authorizer.name,
            'nonexistent',
            notify_account.name,
            {
              from: authorizer,
            }
          ),
          'ERR::UNKNOWN_PLANET:'
        );
      });
      it('should work', async () => {
        await mining.addnotify(
          authorizer.name,
          shared.testplanet,
          notify_account.name,
          {
            from: authorizer,
          }
        );
      });
      it('should add entry to whitelist table', async () => {
        await assertRowsEqual(
          mining.whitelistTable({ scope: shared.testplanet }),
          [
            {
              account: notify_account.name,
              authorizer: authorizer.name,
            },
          ]
        );
      });
      it('calling again should fail', async () => {
        await assertEOSErrorIncludesMessage(
          mining.addnotify(
            authorizer.name,
            shared.testplanet,
            notify_account.name,
            {
              from: authorizer,
            }
          ),
          'ERR::ON_MINE_WHITELIST::The account is already on the whitelist.'
        );
      });
    });
  });

  context('rmvnotify', async () => {
    context('with wrong auth', async () => {
      it('should fail with missing auth error', async () => {
        await assertMissingAuthority(
          mining.rmvnotify(
            authorizer.name,
            shared.testplanet,
            notify_account.name,
            {
              from: anybody,
            }
          )
        );
      });
    });
    context('with correct auth', async () => {
      it('should work', async () => {
        await mining.rmvnotify(
          authorizer.name,
          shared.testplanet,
          notify_account.name,
          {
            from: authorizer,
          }
        );
      });
      it('should remove entry from whitelist table', async () => {
        await assertRowCount(
          mining.whitelistTable({ scope: shared.testplanet }),
          0
        );
      });
      it('calling again should fail', async () => {
        await assertEOSErrorIncludesMessage(
          mining.rmvnotify(
            authorizer.name,
            shared.testplanet,
            notify_account.name,
            {
              from: authorizer,
            }
          ),
          'ERR::NOT_ON_WHITELIST::The provided account is not whitelisted to remove.'
        );
      });
    });
  });
  context('setland', async () => {
    let land_asset, land_asset_2;
    let landowner;
    let setlandminer: Account;
    let number_of_assets_after_setland: Number;
    before(async () => {
      setlandminer = await AccountManager.createAccount('setlandminer');

      landowner = shared.landowners[1];
      const res = await atomicassets.assetsTable({
        scope: landowner.name,
      });
      land_asset = res.rows.find((x) => x.schema_name == shared.LAND_SCHEMA);
    });
    context('with wrong auth', async () => {
      it('should fail with missing auth error', async () => {
        await assertMissingAuthority(
          mining.setland(setlandminer.name, land_asset.asset_id, {
            from: miner1,
          })
        );
      });
    });
    context('with correct auth', async () => {
      it('should work', async () => {
        await mining.setland(setlandminer.name, land_asset.asset_id, {
          from: setlandminer,
        });
      });
      it('should issue starter shovel', async () => {
        const res = await atomicassets.assetsTable({
          scope: setlandminer.name,
        });
        number_of_assets_after_setland = res.rows.length;
        const asset = res.rows[0];
        chai.expect(asset.template_id).to.equal(shared.SHOVEL_TEMPLATE_ID);
        chai.expect(asset.schema_name).to.equal(shared.TOOL_SCHEMA);
      });
      it('should populate miners table', async () => {
        const res = await mining.minersTable({
          scope: mining.name,
          lower: setlandminer.name,
        });
        const x = res.rows[0];
        chai.expect(x).to.exist;
        chai.expect(x.miner).to.equal(setlandminer.name);
        chai
          .expect(x.last_mine_tx)
          .to.equal(
            '0000000000000000000000000000000000000000000000000000000000000000'
          );
        chai.expect(x.current_land).to.equal(land_asset.asset_id);
      });
    });
    context('changing land', async () => {
      it('when land is different should work', async () => {
        const res = await atomicassets.assetsTable({
          scope: landowner.name,
        });
        land_asset_2 = res.rows.filter(
          (x) => x.schema_name == shared.LAND_SCHEMA
        )[1];
        await mining.setland(setlandminer.name, land_asset_2.asset_id, {
          from: setlandminer,
        });
      });
      it('should update land id in table', async () => {
        const res = await mining.minersTable({
          scope: mining.name,
          lower: setlandminer.name,
        });
        const x = res.rows[0];
        chai.expect(x).to.exist;
        chai.expect(x.miner).to.equal(setlandminer.name);
        chai
          .expect(x.last_mine_tx)
          .to.equal(
            '0000000000000000000000000000000000000000000000000000000000000000'
          );
        chai.expect(x.current_land).to.equal(land_asset_2.asset_id);
      });
      it('should not issue another shovel', async () => {
        await assertRowCount(
          atomicassets.assetsTable({
            scope: setlandminer.name,
          }),
          number_of_assets_after_setland
        );
      });
    });
  });
  context('setlandnick', async () => {
    let landowner: Account;
    let land_asset: string;
    before(async () => {
      landowner = shared.landowners[1];
      const res = await atomicassets.assetsTable({
        scope: landowner.name,
      });
      land_asset = res.rows.find((x) => x.schema_name == shared.LAND_SCHEMA);
    });
    context('with wrong permissions', async () => {
      it('should fail with missing auth error', async () => {
        await assertMissingAuthority(
          shared.landholders.setlandnick(
            landowner.name,
            land_asset.asset_id,
            'mynewnick'
          )
        );
      });
    });
    context('with correct permissions', async () => {
      it('should work', async () => {
        await shared.landholders.setlandnick(
          landowner.name,
          land_asset.asset_id,
          'mynewnick',
          { from: landowner }
        );
      });
      it('should update mutable data of nft', async () => {
        const atomic = shared.get_atomic();
        const asset = await atomic.getAsset(
          landowner.name,
          land_asset.asset_id
        );
        const data = await asset.mutableData();
        chai.expect(data.nickname).to.equal('mynewnick');
      });
    });
  });

  context('claimnfts', async () => {
    context('with invalid template ids as per above', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          mining.claimnfts(miner1.name),
          'MINING_NFT_TEMPLATE_NOT_FOUND'
        );
      });
    });
    context('with existing tempate ids', async () => {
      before(async () => {
        await mining.insertclaims(miner4.name, [1, 2, 3, 4, 1, 2], {
          from: mining.account,
        });
      });
      it('should work', async () => {
        await mining.claimnfts(miner4.name, { from: anybody });
      });
      it('should issue nfts', async () => {
        const res = await atomicassets.assetsTable({ scope: miner4.name });
        chai
          .expect(res.rows.filter((x) => x.template_id == 1))
          .to.have.lengthOf(2);
        chai
          .expect(res.rows.filter((x) => x.template_id == 2))
          .to.have.lengthOf(2);
        chai
          .expect(res.rows.filter((x) => x.template_id == 3))
          .to.have.lengthOf(1);
        chai
          .expect(res.rows.filter((x) => x.template_id == 4))
          .to.have.lengthOf(1);
      });
    });
  });

  context('setbag', async () => {
    context('with assets not owned by miner', async () => {
      it('should fail with must own error', async () => {
        const res = await atomicassets.assetsTable({ scope: miner2.name });
        const asset = res.rows[0];
        await assertEOSErrorIncludesMessage(
          mining.setbag(miner1.name, [asset.asset_id], { from: miner1 }),
          'BAG_MUST_OWN'
        );
      });
    });
    context('without correct auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(mining.setbag(miner1.name, []));
      });
    });
    context('with owned item', async () => {
      let asset;
      it('should succeed', async () => {
        const res = await atomicassets.assetsTable({ scope: miner1.name });
        asset = res.rows[0];
        await mining.setbag(miner1.name, [asset.asset_id], { from: miner1 });
      });
      it('should update the bags table', async () => {
        await assertRowsEqual(mining.bagsTable({ scope: mining.name }), [
          {
            account: miner1.name,
            items: [asset.asset_id],
            locked: false,
          },
        ]);
      });
      it('removing item should update bags table', async () => {
        await mining.setbag(miner1.name, [], { from: miner1 });
        await assertRowsEqual(mining.bagsTable({ scope: mining.name }), [
          {
            account: miner1.name,
            items: [],
            locked: false,
          },
        ]);
      });
    });
  });
  context('fill', async () => {
    let filler: Account;
    before(async () => {
      filler = await AccountManager.createAccount('filler1');
    });
    context('with wrong auth', async () => {
      it('should fail with missing auth error', async () => {
        await assertMissingAuthority(
          mining.fill(filler.name, shared.testplanet)
        );
      });
    });
    context('without deposit', async () => {
      it('should fail with missing deposit error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.fill(filler.name, shared.testplanet, {
            auths: [
              { actor: filler.name, permission: 'active' },
              { actor: shared.federation.account.name, permission: 'active' },
            ],
          }),
          'NO_DEPOSIT'
        );
      });
    });
    context('with deposit', async () => {
      let bucket_total_before: Asset;
      let expected_bucket_total_after: Asset;
      before(async () => {
        await shared.eosioToken.transfer(
          shared.tokenIssuer.name,
          filler.name,
          '10.0000 TLM',
          'some money',
          {
            from: shared.tokenIssuer,
          }
        );

        await shared.eosioToken.transfer(
          filler.name,
          mining.account.name,
          '10.0000 TLM',
          'deposit',
          { from: filler }
        );
      });
      it('should update deposits table', async () => {
        const res = await mining.depositsTable({ scope: mining.name });
        await assertRowsEqual(mining.depositsTable({ scope: mining.name }), [
          {
            account: 'filler1',
            quantity: '10.0000 TLM',
          },
        ]);
      });
      it('should fail with unknown planet', async () => {
        await assertEOSErrorIncludesMessage(
          mining.fill(filler.name, 'nonexistent', {
            auths: [
              { actor: filler.name, permission: 'active' },
              { actor: shared.federation.account.name, permission: 'active' },
            ],
          }),
          'ERR:PLANET_DOES_NOT_EXIST'
        );
      });
      it('should work', async () => {
        const res = await mining.state3Table({ scope: shared.testplanet });
        const entry = res.rows[0];
        if (entry) {
          console.log('entry: ', JSON.stringify(entry, null, 2));
          bucket_total_before = new Asset(entry.bucket_total);
          console.log('bucket_total_before: ', bucket_total_before.toString());
          expected_bucket_total_after = bucket_total_before.add(
            new Asset('10.0000 TLM')
          );
          console.log(
            'expected_bucket_total_after: ',
            expected_bucket_total_after.toString()
          );
        } else {
          expected_bucket_total_after = new Asset('10.0000 TLM');
        }

        await mining.fill(filler.name, shared.testplanet, {
          auths: [
            { actor: filler.name, permission: 'active' },
            { actor: shared.federation.account.name, permission: 'active' },
          ],
        });
      });
      it('should update stats', async () => {
        const res = await mining.state3Table({ scope: shared.testplanet });
        const entry = res.rows[0];
        chai.expect(entry.bucket_total).to.equal('10.0000 TLM');
        chai.expect(entry.mine_bucket).to.equal('0.0000 TLM');

        function calculate_fill_rate() {
          const bucket_asset = new Asset(entry.bucket_total);
          return bucket_asset.amount_raw() / SECONDS_PER_DAY;
        }
        chai
          .expect(parseFloat(entry.fill_rate))
          .to.equal(calculate_fill_rate());
      });
      it('should delete deposit table entry', async () => {
        await assertRowCount(mining.depositsTable({ scope: mining.name }), 0);
      });
    });
  });
  context('Mine action', async () => {
    before(async () => {
      await mining.setpoolrates(
        [
          {
            key: 'Abundant',
            value: 50.0,
          },
          {
            key: 'Common',
            value: 25.0,
          },
          {
            key: 'Rare',
            value: 25.0,
          },
          // {
          //   key: 'Epic',
          //   value: 25.0,
          // },
          // {
          //   key: 'Legendary',
          //   value: 25.0,
          // },
          // {
          //   key: 'Mythical',
          //   value: 25.0,
          // },
        ],
        shared.testplanet
      );
    });
    context('without correct auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner2,
          })
        );
      });
    });
    context('with empty bag', async () => {
      it('should assert with not bag error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner1,
          }),
          'MINER_NOT_INIT'
        );
      });
    });
    context('with bag', async () => {
      it('should assert with not bag error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner1,
          }),
          'MINER_NOT_INIT'
        );
      });
    });
    context('without setting land', async () => {
      before(async () => {
        const res = await atomicassets.assetsTable({ scope: miner1.name });
        const asset = res.rows[0];
        await mining.setbag(miner1.name, [asset.asset_id], { from: miner1 });
      });
      it('should fail with MINER_NOT_INIT error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner1,
          }),
          'MINER_NOT_INIT'
        );
      });
    });

    context('with setting 0 land', async () => {
      before(async () => {
        await mining.setland(miner1.name, 0, {
          from: miner1,
        });
      });
      it('should fail with LAND_NOT_SELECTED error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner1,
          }),
          'LAND_NOT_SELECTED'
        );
      });
    });
    context('with setting non-existing land', async () => {
      before(async () => {
        await mining.setland(miner1.name, 234, {
          from: miner1,
        });
      });
      it('should fail with LAND_NOT_FOUND error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner1,
          }),
          'LAND_NOT_FOUND'
        );
      });
    });
    context("with setting nft that's not a land", async () => {
      before(async () => {
        const res = await atomicassets.assetsTable({
          scope: miner1.name,
        });
        const tool = res.rows.find((x) => x.schema_name == shared.TOOL_SCHEMA);

        await mining.setland(miner1.name, tool.asset_id, {
          from: miner1,
        });
      });
      it('should fail with LAND_NOT_FOUND error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.mine(miner1.name, 'babababababababa', undefined, {
            from: miner1,
          }),
          'LAND_NOT_FOUND'
        );
      });
    });

    context('after setting land', async () => {
      let land_asset;
      let landowner;
      before(async () => {
        landowner = shared.landowners[0];
        land_asset = await get_land(landowner);
        await mining.setland(miner1.name, land_asset.asset_id, {
          from: miner1,
        });
        // Ensure the land has a commission attribute so mining does not throw
        await shared.landholders.setprofitshr(
          landowner.name,
          land_asset.asset_id,
          1000, // 10%
          { from: landowner }
        );
      });
      context('without correct proof of work', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            mining.mine(miner1.name, 'babababababababa', undefined, {
              from: miner1,
            }),
            'INVALID_HASH'
          );
        });
      });
      context(
        'with correct proof of work but no terms of service',
        async () => {
          context('with empty bucket', async () => {
            it('should throw nothing to mine error', async () => {
              const nonce = await get_nonce(
                miner1.name,
                landowner.name,
                EOSManager
              );
              await assertEOSErrorIncludesMessage(
                mining.mine(miner1.name, nonce, undefined, { from: miner1 }),
                'NOTHING_TO_MINE'
              );
            });
          });
          context('with filled bucket', async () => {
            let miner_state_before;
            let miner1_initial_balance: Number;
            let landowner_initial_balance: Number;
            let expected_mine_amount: Number;
            let expected_profit_share: Number;
            let expected_pool_buckets;
            before(async () => {
              await shared.eosioToken.transfer(
                shared.tokenIssuer.name,
                filler.name,
                '1000000.0000 TLM',
                'some money',
                {
                  from: shared.tokenIssuer,
                }
              );

              await shared.eosioToken.transfer(
                filler.name,
                mining.account.name,
                '1000000.0000 TLM',
                'deposit',
                {
                  from: filler,
                }
              );

              await mining.fill(filler.name, shared.testplanet, {
                auths: [
                  { actor: filler.name, permission: 'active' },
                  {
                    actor: shared.federation.account.name,
                    permission: 'active',
                  },
                ],
              });

              // Mine amount depends on time since fill. Wait 60 seconds for a more precise mine_amount calculation in javascript. This gets the error consistently below 5%. For higher precision, longer wait periods are necessary.
              await sleep(60 * seconds);

              miner1_initial_balance = await shared.getBalance(miner1);
              landowner_initial_balance = await shared.getBalance(landowner);

              let res = await mining.minersTable({ scope: mining.name });
              miner_state_before = res.rows.find((x) => x.miner == miner1.name);

              // set land commission to 25%
              await shared.landholders.setprofitshr(
                landowner.name,
                land_asset.asset_id,
                2500,
                { from: landowner }
              );

              // but we set the maximum commission to 9% so that's what it should use
              // await shared.landholders.setmaxlndcom(shared.testplanet, 900, {
              //   from: authorizer,
              // });

              // or we can set the maximum to 8.1% that also works
              // await shared.landholders.stgmaxlndcom(810);

              // or we set the minimum commission to something higher
              await shared.landholders.stgmaxlndcom(3200); // 32%
              await shared.landholders.stgminlndcom(3100); // 31%
            });
            it('should work', async () => {
              const nonce = await get_nonce(
                miner1.name,
                landowner.name,
                EOSManager
              );
              [
                expected_mine_amount,
                expected_profit_share,
                expected_pool_buckets,
              ] = await mine_profit_amount(
                shared.testplanet,
                landowner,
                land_asset,
                miner1
              );
              console.log('shared.testplanet: ', shared.testplanet);
              const pool_before = (
                await mining.poolsTable({ scope: shared.testplanet })
              ).rows[0].pool_buckets;
              await mining.mine(miner1.name, nonce, undefined, {
                from: miner1,
              });
            });
            it('should update pool state', async () => {
              const pool_after = (
                await mining.poolsTable({ scope: shared.testplanet })
              ).rows[0].pool_buckets;
              for (const [key, value] of Object.entries(to_dict(pool_after))) {
                const actual_money = new Asset(value);
                let deviation = Math.abs(
                  actual_money.amount - expected_pool_buckets[key].amount
                );
                let deviation_percent =
                  deviation / expected_pool_buckets[key].amount;
                chai.expect(deviation_percent).to.be.lessThan(0.07);
              }
            });
            it('should update miner state', async () => {
              const res = await mining.minersTable({ scope: mining.name });
              const miner_state_after = res.rows.find(
                (x) => x.miner == miner1.name
              );
              chai
                .expect(miner_state_after.miner)
                .to.equal(miner_state_before.miner);
              chai
                .expect(miner_state_after.last_mine_tx)
                .to.not.equal(miner_state_before.last_mine_tx);
              chai
                .expect(shared.get_utc_time() - miner_state_after.last_mine)
                .to.be.at.most(1.5 * seconds);
              chai
                .expect(miner_state_after.current_land)
                .to.equal(miner_state_before.current_land);
            });
            it('mining again too soon should throw too soon error', async () => {
              const nonce = await get_nonce(
                miner1.name,
                landowner.name,
                EOSManager
              );
              await assertEOSErrorIncludesMessage(
                mining.mine(miner1.name, nonce, undefined, { from: miner1 }),
                'MINE_TOO_SOON'
              );
            });
            it('should update tooluse', async () => {
              const res = await mining.bagsTable({ scope: mining.name });
              const bag = res.rows.find((x) => x.account == miner1.name);
              const tool_res = await mining.tooluseTable({
                scope: mining.name,
              });
              for (const id of bag.items) {
                const tooluse_entry = tool_res.rows.find(
                  (x) => x.asset_id == id
                );
                chai
                  .expect(shared.seconds_since_epoch() - tooluse_entry.last_use)
                  .to.be.at.most(10);
              }
            });
            it('should create minerclaim table entries', async () => {
              const res = await mining.minerclaimTable({
                lowerBound: miner1.name,
                upperBound: miner1.name,
                limit: 1,
              });
              const claim = res.rows[0];
              chai.expect(parseFloat(claim.amount)).to.be.above(0);
            });
            it('should create commclaims table entries', async () => {
              const res = await mining.landcommsTable({
                lowerBound: landowner.name,
                upperBound: landowner.name,
                limit: 1,
              });
              const claim = res.rows[0];
              chai.expect(parseFloat(claim.comms)).to.be.above(0);
            });
            it('claimmines claiming should work', async () => {
              await mining.claimmines(miner1.name, { from: miner1 });
            });
            it('should transfer money to miner', async () => {
              const new_balance = await shared.getBalance(miner1);
              chai.expect(new_balance).to.be.above(miner1_initial_balance);

              const mined_amount = new_balance - miner1_initial_balance;
              const deviation = 1 - expected_mine_amount / mined_amount;
              console.log('mined_amount: ', mined_amount);
              console.log('expected_mine_amount: ', expected_mine_amount);
              // The mining amount can only be approximated in Javascript, so we accept a 5% deviation as okay
              chai.expect(Math.abs(deviation)).to.be.below(0.065);
            });
            it('claimcomms claiming should work', async () => {
              await mining.claimcomms(landowner.name, { from: landowner });
            });
            it('should transfer fee to landowner', async () => {
              const new_balance = await shared.getBalance(landowner);
              chai.expect(new_balance).to.be.above(landowner_initial_balance);
              const paid_profit = new_balance - landowner_initial_balance;
              const deviation = 1 - expected_profit_share / paid_profit;
              chai.expect(Math.abs(deviation)).to.be.below(0.065);
            });
            it('should not add userpoints', async () => {
              const res = await shared.userpoints.userpointsTable({
                scope: shared.userpoints.name,
              });
              const our_userpoints = res.rows.filter(
                (x) => x.user == miner1.name
              );
              chai.expect(our_userpoints).to.be.empty;
            });
          });
        }
      );
      context('when has accepted terms', async () => {
        let miner1_initial_balance: Number;
        let landowner_initial_balance: Number;
        before(async () => {
          await sleep(8000);

          miner1_initial_balance = await shared.getBalance(miner1);
          landowner_initial_balance = await shared.getBalance(landowner);

          await shared.mintDrill(miner1.name);

          await shared.federation.agreeterms(
            miner1.name,
            1,
            '1212121212121212121212121212121212121212121212121212121212121212',
            {
              from: miner1,
            }
          );
          await shared.userpoints.reguser(miner1.name, { from: miner1 });
          const res = await atomicassets.assetsTable({
            scope: miner1.name,
          });
          const shovels = res.rows
            .filter((x) => x.template_id == shared.SHOVEL_TEMPLATE_ID)
            .slice(0, 2);
          const asset_ids = shovels.map((x) => x.asset_id);
          const drill = res.rows.find(
            (x) => x.template_id == shared.DRILL_TEMPLATE_ID
          );
          asset_ids.push(drill.asset_id);
          for (const id of asset_ids) {
            const data = await get_data(miner1, id);
          }
          await mining.setbag(miner1.name, asset_ids, { from: miner1 });

          const nonce = await get_nonce(
            miner1.name,
            landowner.name,
            EOSManager
          );
          await mining.mine(miner1.name, nonce, undefined, { from: miner1 });
        });
        it('should add userpoints', async () => {
          const expected_luck = await get_miner_luck(
            miner1,
            landowner,
            land_asset
          );
          const res = await shared.userpoints.userpointsTable({
            scope: shared.userpoints.name,
          });
          const x = res.rows.find((y) => y.user == miner1.name);
          chai.expect(x).not.to.be.undefined;
          chai.expect(x.user).to.equal(miner1.name);
          chai.expect(x.total_points).to.equal(expected_luck);
          chai.expect(x.redeemable_points).to.equal(expected_luck);
          chai.expect(x.daily_points).to.equal(expected_luck);
          chai.expect(x.weekly_points).to.equal(expected_luck);
          chai.expect(x.top_level_claimed).to.equal(1);
          chai.expect(x.milestones).to.be.empty;
        });
        it('should create minerclaim table entries', async () => {
          const res = await mining.minerclaimTable({
            lowerBound: miner1.name,
            upperBound: miner1.name,
            limit: 1,
          });
          const claim = res.rows[0];
          chai.expect(parseFloat(claim.amount)).to.be.above(0);
        });
        it('should create commclaims table entries', async () => {
          const res = await mining.landcommsTable({
            lowerBound: landowner.name,
            upperBound: landowner.name,
            limit: 1,
          });
          const claim = res.rows[0];
          chai.expect(parseFloat(claim.comms)).to.be.above(0);
        });
        it('claimmines claiming should work', async () => {
          await mining.claimmines(miner1.name, { from: miner1 });
        });
        it('should transfer money to miner', async () => {
          const new_balance = await shared.getBalance(miner1);
          chai.expect(new_balance).to.be.above(miner1_initial_balance);
        });
        it('claimcomms claiming should work', async () => {
          await mining.claimcomms(landowner.name, { from: landowner });
        });
        it('should transfer fee to landowner', async () => {
          const new_balance = await shared.getBalance(landowner);
          chai.expect(new_balance).to.be.above(landowner_initial_balance);
        });
      });
      context('without setting bag', async () => {
        before(async () => {
          landowner = shared.landowners[1];
          const res = await atomicassets.assetsTable({
            scope: landowner.name,
          });
          land_asset = res.rows.find(
            (x) => x.schema_name == shared.LAND_SCHEMA
          );

          await mining.setland(miner2.name, land_asset.asset_id, {
            from: miner2,
          });
        });
        it('should fail with MUST_SET_BAG error', async () => {
          const nonce = await get_nonce(
            miner2.name,
            landowner.name,
            EOSManager
          );
          await assertEOSErrorIncludesMessage(
            mining.mine(miner2.name, nonce, undefined, { from: miner2 }),
            'ERR::MUST_SET_BAG'
          );
        });
      });
      context('wit empty bag', async () => {
        before(async () => {
          await mining.setland(miner3.name, land_asset.asset_id, {
            from: miner3,
          });
          await mining.setbag(miner3.name, [], { from: miner3 });
        });
        it('should fail with BAG_EMPTY error', async () => {
          const nonce = await get_nonce(
            miner3.name,
            landowner.name,
            EOSManager
          );
          await assertEOSErrorIncludesMessage(
            mining.mine(miner3.name, nonce, undefined, { from: miner3 }),
            'ERR::BAG_EMPTY'
          );
        });
      });
      context('with bag items not owned', async () => {
        before(async () => {
          await sleep(8000);

          const res = await atomicassets.assetsTable({
            scope: miner2.name,
            limit: 3,
          });
          const asset_ids = res.rows.map((x) => x.asset_id);
          await mining.setbag(miner1.name, asset_ids, { from: miner1 });
        });
      });
      context('when landowner is blocked for fees', async () => {
        let excluded_landowners;
        let miners = [];
        before(async () => {
          excluded_landowners = [
            shared.mining.account,
            await AccountManager.createAccount('atomicmarket'),
            await AccountManager.createAccount('atomictoolsx'),
            await AccountManager.createAccount('s.rplanet'),
          ];

          for (const owner of excluded_landowners) {
            const land = await shared.mintLand(owner.name);
            const miner = await AccountManager.createAccount();
            setupMiner(miner, land);
            miners.push(miner);
          }
        });
        it('should work', async () => {
          for (const [landowner, miner] of zip(excluded_landowners, miners)) {
            const nonce = await get_nonce(
              miner.name,
              landowner.name,
              EOSManager
            );
            await mining.mine(miner.name, nonce, undefined, { from: miner });
          }
        });
        it('claimmines claiming should work', async () => {
          await sleep(5 * seconds);
          for (const miner of miners) {
            await mining.claimmines(miner.name, { from: miner });
          }
        });
        it('claimcomms claiming should fail with pending pay not found error', async () => {
          for (const landowner of excluded_landowners) {
            await assertEOSErrorIncludesMessage(
              mining.claimcomms(landowner.name, { from: landowner }),
              'Pending pay not found for supplied receiver'
            );
          }
        });
        it('should transfer money to miner', async () => {
          for (const miner of miners) {
            const new_balance = await shared.getBalance(miner);
            chai.expect(new_balance).to.be.above(0);
          }
        });
      });
    });
    context('when yeomen is disabled', async () => {
      let land;
      before(async () => {});
    });

    context('when commission is set too high', async () => {
      let landowner;
      let greedyowner;
      before(async () => {
        landowner = shared.landowners[0];
        const land = await get_land(landowner);

        greedyowner = await AccountManager.createAccount('greedyowner');
        await setupMiner(greedyowner, land);
        await shared.landholders.setprofitshr(
          landowner.name,
          land.asset_id,
          2501,
          { from: landowner }
        );
      });
      it('should work throw LAND_COMMISSION_HIGH error', async () => {
        const nonce = await get_nonce(
          greedyowner.name,
          landowner.name,
          EOSManager
        );
        await assertEOSErrorIncludesMessage(
          mining.mine(greedyowner.name, nonce, undefined, {
            from: greedyowner,
          }),
          'ERR::LAND_COMMISSION_HIGH'
        );
      });
      after(async () => {
        landowner = shared.landowners[0];
        const land = await get_land(landowner);

        await shared.landholders.setprofitshr(
          landowner.name,
          land.asset_id,
          1000,
          { from: landowner }
        );
      });
    });
  });

  context('claimmines', async () => {
    let landowner;
    let miner, somebody;
    before(async () => {
      landowner = shared.landowners[0];
      const land = await get_land(landowner);

      miner = await AccountManager.createAccount();
      somebody = await AccountManager.createAccount();

      await shared.mintDrill(miner.name);
      await setupMiner(miner, land);

      const nonce = await get_nonce(miner.name, landowner.name, EOSManager);
      await mining.mine(miner.name, nonce, undefined, { from: miner });

      await mining.setconfig('claimmines_delay_secs', ['uint32', 5]);
    });
    it('should create commclaims table entries', async () => {
      const res = await mining.minerclaimTable({
        lowerBound: miner.name,
        upperBound: miner.name,
        limit: 1,
      });
      const claim = res.rows[0];
      chai.expect(parseFloat(claim.amount)).to.be.above(0);
    });
    context('without proper auth', async () => {
      it('should throw auth error', async () => {
        await assertMissingAuthority(
          mining.claimmines(miner.name, { from: somebody })
        );
      });
    });
    context('with contract auth', async () => {
      it('should work', async () => {
        await sleep(3 * seconds);
        await mining.claimmines(miner.name);
      });
    });
    context('too soon', async () => {
      it('should fail', async () => {
        await sleep(2 * seconds);
        await assertEOSErrorIncludesMessage(
          mining.claimmines(miner.name),
          'ERR::MINE_CLAIM_LOCKED::'
        );
      });
    });
    context('after timeout', async () => {
      before(async () => {
        await sleep(4 * seconds);
      });
      it('should work', async () => {
        await assertEOSErrorIncludesMessage(
          mining.claimmines(miner.name),
          'ERR::MINE_CLAIM_ZERO::'
        );
      });
    });
  });

  context('claimcomms', async () => {
    let landowner;
    let miner, somebody;
    before(async () => {
      landowner = shared.landowners[0];
      const land = await get_land(landowner);
      miner = await AccountManager.createAccount();
      somebody = await AccountManager.createAccount();

      await shared.mintDrill(miner.name);
      await setupMiner(miner, land);

      const nonce = await get_nonce(miner.name, landowner.name, EOSManager);
      await mining.mine(miner.name, nonce, undefined, { from: miner });
    });
    it('should create landcomms table entries', async () => {
      const res = await mining.landcommsTable({
        lowerBound: landowner.name,
        upperBound: landowner.name,
        limit: 1,
      });
      const claim = res.rows[0];
      chai.expect(parseFloat(claim.comms)).to.be.above(0);
    });
    context('without proper auth', async () => {
      it('should throw auth error', async () => {
        await assertMissingAuthority(
          mining.claimcomms(landowner.name, { from: somebody })
        );
      });
    });
    context('with contract auth', async () => {
      it('should work', async () => {
        await mining.claimcomms(landowner.name);
      });
      it('should delete table entry', async () => {
        await assertRowCount(
          mining.landcommsTable({
            lowerBound: landowner.name,
            upperBound: landowner.name,
            limit: 1,
          }),
          0
        );
      });
    });
  });

  context('resetstate', async () => {
    let row_before: any;
    before(async () => {
      const res = await mining.state3Table({ scope: shared.testplanet });
      row_before = res.rows[0];
    });
    context('without proper auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          mining.resetstate(shared.testplanet, { from: anybody })
        );
      });
    });
    context('with proper auth', async () => {
      it('should work', async () => {
        await mining.resetstate(shared.testplanet);
      });
      it('should clear the table', async () => {
        const res = await mining.state3Table({ scope: shared.testplanet });
        const x = res.rows[0];

        chai.expect(x.fill_rate).to.equal('0.00000000000000000');
        chai.expect(x.bucket_total).to.equal('0.0000 TLM');
        chai.expect(x.mine_bucket).to.equal('0.0000 TLM');
      });
    });
  });
  context('clearminers', async () => {
    context('without proper auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(mining.clearminers({ from: anybody }));
      });
    });
    context('with proper auth', async () => {
      it('should work', async () => {
        await mining.clearminers();
      });
      it('should clear the miners table', async () => {
        await assertRowCount(mining.minersTable({ scope: mining.name }), 0);
      });
    });
  });
  context('clearbags', async () => {
    context('without proper auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(mining.clearbags({ from: anybody }));
      });
    });
    context('with proper auth', async () => {
      it('should work', async () => {
        await mining.clearbags();
      });
      it('should clear the miners table', async () => {
        await assertRowCount(mining.bagsTable({ scope: mining.name }), 0);
      });
    });
  });
  context('delnft', async () => {
    context('without proper auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          mining.delnft(miner1.name, { from: anybody })
        );
      });
    });
    context('with proper auth', async () => {
      before(async () => {
        it('miner should have a claims table entry', async () => {
          const res = await mining.claimsTable({ scope: mining.name });
          const miner_row = res.rows.filter((x) => x.miner == miner2.name);
          chai.expect(miner_row).not.to.be.empty;
        });
      });
      it('should work', async () => {
        await mining.delnft(miner2.name);
      });
      it('should clear the claims table for the miner', async () => {
        const res = await mining.claimsTable({ scope: mining.name });
        const miner_row = res.rows.filter((x) => x.miner == miner2.name);
        chai.expect(miner_row).to.be.empty;
      });
    });
    context('when miner has no claims', async () => {
      it('should throw claim not found error', async () => {
        await assertEOSErrorIncludesMessage(
          mining.delnft(miner2.name),
          'Claim not found'
        );
      });
    });
  });
  context('clearnftmine', async () => {
    let landowner, land_asset;
    before(async () => {
      landowner = shared.landowners[0];
      land_asset = await get_land(landowner);
    });
    context('without proper auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          mining.clearnftmine(landowner.name, land_asset.asset_id, {
            from: anybody,
          })
        );
      });
    });
    context('with proper auth', async () => {
      it('should work', async () => {
        await mining.clearnftmine(landowner.name, land_asset.asset_id);
      });
      it('should update mutable data of nft', async () => {
        const atomic = shared.get_atomic();
        const asset = await atomic.getAsset(
          landowner.name,
          land_asset.asset_id
        );
        const data = await asset.mutableData();
        chai.expect(data).to.deep.equal({});
      });
    });
  });
  context('reclaim', async () => {
    // Helper function to set up claims for users with specific amounts and timestamps
    async function setupClaimsForUsers(
      users: Account[],
      amounts: string[],
      timestamps: Date[]
    ) {
      for (let i = 0; i < users.length; i++) {
        await mining.instmineclms(users[i].name, amounts[i], timestamps[i], {
          from: mining.account,
        });
      }
    }

    // Helper function to create a miner with specific last_mine timestamp using new test action
    async function createMinerWithLastMine(
      account: Account,
      landAsset: any,
      lastMineDate: Date
    ) {
      await mining.testminer(account.name, landAsset.asset_id, lastMineDate, {
        from: mining.account,
      });
    }

    context('activity-based reclaim logic', async () => {
      let testUsers: Account[];
      let landAsset: any;
      let landowner: Account;
      let reclaim_receiver: Account;

      before(async () => {
        // Create test accounts
        testUsers = [
          await AccountManager.createAccount('actuser1'),
          await AccountManager.createAccount('actuser2'),
          await AccountManager.createAccount('actuser3'),
          await AccountManager.createAccount('actuser4'),
        ];

        reclaim_receiver = await AccountManager.createAccount('reclminerwds');

        // Get a land asset for testing
        landowner = shared.landowners[0];
        const res = await atomicassets.assetsTable({
          scope: landowner.name,
        });
        landAsset = res.rows.find((x) => x.schema_name == shared.LAND_SCHEMA);

        // Fund the mining contract for testing
        await shared.eosioToken.transfer(
          shared.tokenIssuer.name,
          mining.account.name,
          '100.0000 TLM',
          'fund for test',
          { from: shared.tokenIssuer }
        );
      });

      it('should test miners table activity checking', async () => {
        // Set up test users with different activity states
        const currentDate = await referenceTimeWithAddedHours(0);

        // User 1: Active miner (recent last_mine within 180 days)
        const recentDate = await referenceTimeWithAddedHours(-24 * 100); // 100 days ago
        await createMinerWithLastMine(testUsers[0], landAsset, recentDate);
        await setupClaimsForUsers([testUsers[0]], ['2.0000 TLM'], [recentDate]);

        // User 2: Inactive miner (old last_mine beyond 180 days)
        const oldDate = await referenceTimeWithAddedHours(-24 * 200); // 200 days ago
        await createMinerWithLastMine(testUsers[1], landAsset, oldDate);
        await setupClaimsForUsers([testUsers[1]], ['3.0000 TLM'], [oldDate]);

        // User 3: No miner entry but has claim
        await setupClaimsForUsers([testUsers[2]], ['4.0000 TLM'], [oldDate]);

        // User 4: Miner entry but no claim (should be skipped)
        await createMinerWithLastMine(testUsers[3], landAsset, oldDate);

        const balance_before = await shared.getBalance(reclaim_receiver.name);

        // Call reclaim
        await mining.reclaim(
          testUsers.map((user) => user.name),
          false,
          currentDate,
          { from: mining.account }
        );

        const balance_after = await shared.getBalance(reclaim_receiver.name);
        const transferred_amount = balance_after - balance_before;

        // Should reclaim User 2 (3.0000 TLM) and User 3 (4.0000 TLM)
        // User 1 should NOT be reclaimed (active within 180 days)
        // User 4 should be skipped (no claims)
        const expected_amount = 3.0 + 4.0; // User 2 + User 3
        chai
          .expect(Math.abs(transferred_amount - expected_amount))
          .to.be.lessThan(0.0001);

        // Verify specific users' claims were handled correctly
        const user1_claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: testUsers[0].name,
          upperBound: testUsers[0].name,
          limit: 1,
        });
        chai.expect(user1_claims.rows.length).to.equal(1); // Should NOT be reclaimed (active)

        const user2_claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: testUsers[1].name,
          upperBound: testUsers[1].name,
          limit: 1,
        });
        chai.expect(user2_claims.rows.length).to.equal(0); // Should be reclaimed (inactive)

        const user3_claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: testUsers[2].name,
          upperBound: testUsers[2].name,
          limit: 1,
        });
        chai.expect(user3_claims.rows.length).to.equal(0); // Should be reclaimed (no miner entry)
      });

      it('should verify miners with no miner entry are reclaimed', async () => {
        // Create a user with no miner entry but with claim
        const user_no_miner = await AccountManager.createAccount('nominer1');
        await setupClaimsForUsers(
          [user_no_miner],
          ['5.0000 TLM'],
          [await referenceTimeWithAddedHours(-24 * 200)]
        );

        const balance_before = await shared.getBalance(reclaim_receiver.name);
        const current_date = await referenceTimeWithAddedHours(0);

        await mining.reclaim([user_no_miner.name], true, current_date, {
          from: mining.account,
        });

        const balance_after = await shared.getBalance(reclaim_receiver.name);
        const transferred_amount = balance_after - balance_before;

        // Should reclaim the full amount
        chai.expect(Math.abs(transferred_amount - 5.0)).to.be.lessThan(0.0001);

        // Verify claim was removed
        const claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: user_no_miner.name,
          upperBound: user_no_miner.name,
          limit: 1,
        });
        chai.expect(claims.rows.length).to.equal(0);
      });
    });

    context('inactivity threshold testing', async () => {
      let testUsers: Account[];
      let landAsset: any;
      let landowner: Account;
      let reclaim_receiver: Account;

      before(async () => {
        // Create test accounts
        testUsers = [
          await AccountManager.createAccount('threshuser1'),
          await AccountManager.createAccount('threshuser2'),
          await AccountManager.createAccount('threshuser3'),
        ];

        reclaim_receiver = await AccountManager.createAccount('reclminerwds');

        // Get a land asset for testing
        landowner = shared.landowners[0];
        const res = await atomicassets.assetsTable({
          scope: landowner.name,
        });
        landAsset = res.rows.find((x) => x.schema_name == shared.LAND_SCHEMA);

        // Fund the mining contract for testing
        await shared.eosioToken.transfer(
          shared.tokenIssuer.name,
          mining.account.name,
          '100.0000 TLM',
          'fund for test',
          { from: shared.tokenIssuer }
        );
      });

      it('should test 180-day threshold boundary conditions', async () => {
        const currentDate = await referenceTimeWithAddedHours(0);

        // Based on the contract logic: current_time <= last_mine + 180_days means NOT reclaimed
        // So: current_time > last_mine + 180_days means reclaimed

        // User 1: Exactly 180 days ago (should NOT be reclaimed - still on boundary)
        const exactly180Days = await referenceTimeWithAddedHours(-24 * 180);
        await createMinerWithLastMine(testUsers[0], landAsset, exactly180Days);
        await setupClaimsForUsers(
          [testUsers[0]],
          ['2.0000 TLM'],
          [exactly180Days]
        );

        // User 2: 179 days ago (should NOT be reclaimed - still active)
        const days179 = await referenceTimeWithAddedHours(-24 * 179);
        await createMinerWithLastMine(testUsers[1], landAsset, days179);
        await setupClaimsForUsers([testUsers[1]], ['3.0000 TLM'], [days179]);

        // User 3: 180 days + 1 hour ago (should be reclaimed - beyond boundary)
        const days180Plus1Hour = await referenceTimeWithAddedHours(
          -24 * 180 - 1
        );
        await createMinerWithLastMine(
          testUsers[2],
          landAsset,
          days180Plus1Hour
        );
        await setupClaimsForUsers(
          [testUsers[2]],
          ['4.0000 TLM'],
          [days180Plus1Hour]
        );

        const balance_before = await shared.getBalance(reclaim_receiver.name);

        // Call reclaim
        await mining.reclaim(
          testUsers.map((user) => user.name),
          false,
          currentDate,
          { from: mining.account }
        );

        const balance_after = await shared.getBalance(reclaim_receiver.name);
        const transferred_amount = balance_after - balance_before;

        // Should only reclaim User 3 (4.0000 TLM)
        // User 1 and User 2 should NOT be reclaimed (within 180 day threshold)
        const expected_amount = 4.0; // Only User 3
        chai
          .expect(Math.abs(transferred_amount - expected_amount))
          .to.be.lessThan(0.0001);

        // Verify specific boundary behavior
        const user1_claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: testUsers[0].name,
          upperBound: testUsers[0].name,
          limit: 1,
        });
        chai.expect(user1_claims.rows.length).to.equal(1); // Exactly 180 days should NOT be reclaimed

        const user2_claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: testUsers[1].name,
          upperBound: testUsers[1].name,
          limit: 1,
        });
        chai.expect(user2_claims.rows.length).to.equal(1); // 179 days should NOT be reclaimed

        const user3_claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: testUsers[2].name,
          upperBound: testUsers[2].name,
          limit: 1,
        });
        chai.expect(user3_claims.rows.length).to.equal(0); // 180 days + 1 hour should be reclaimed
      });
    });

    context('basic reclaim test', async () => {
      let miner_with_claim: Account;
      let miner_without_claim: Account;
      let reclaim_receiver: Account;
      let initial_claim_amount: number;
      let inactive_date: Date;

      before(async () => {
        // Create test users using AccountManager
        miner_with_claim = await AccountManager.createAccount('mckfmtstsys');
        miner_without_claim = await AccountManager.createAccount('mckfmtsts2');
        reclaim_receiver = await AccountManager.createAccount('reclminerwds');

        // Send funds to the mining contract for testing
        await shared.eosioToken.transfer(
          shared.tokenIssuer.name,
          mining.account.name,
          '100.0000 TLM',
          'fund for test',
          { from: shared.tokenIssuer }
        );

        // Get inactive date (older than the cutoff period to ensure reclaim works)
        inactive_date = await referenceTimeWithAddedHours(-24 * 200); // 200 days in the past

        // Manually insert a claim for the miner using the inactive date
        await mining.instmineclms(
          miner_with_claim.name,
          '5.0000 TLM',
          inactive_date,
          {
            from: mining.account,
          }
        );

        // Get the initial claim amount to verify later
        const claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: miner_with_claim.name,
          upperBound: miner_with_claim.name,
          limit: 1,
        });
        initial_claim_amount = parseFloat(claims.rows[0].amount.toString());
      });

      it('should reclaim inactive accounts and transfer funds', async () => {
        // Get balance before reclaim
        const balance_before_reclaim = await shared.getBalance(
          reclaim_receiver.name
        );

        // Get current date for reclaim
        const current_date = await referenceTimeWithAddedHours(0); // current time

        // Call reclaim with users array and current date
        await mining.reclaim(
          [miner_with_claim.name, miner_without_claim.name],
          true,
          current_date,
          {
            from: mining.account,
          }
        );

        // Check that claim has been removed
        const claims = await mining.minerclaimTable({
          scope: mining.name,
          lowerBound: miner_with_claim.name,
          upperBound: miner_with_claim.name,
          limit: 1,
        });

        chai.expect(claims.rows.length).to.equal(0);

        // Check that funds were transferred
        const balance_after = await shared.getBalance(reclaim_receiver.name);
        chai.expect(balance_after).to.be.above(balance_before_reclaim);

        // The difference should be approximately equal to the initial claim amount
        const difference = balance_after - balance_before_reclaim;
        chai
          .expect(Math.abs(difference - initial_claim_amount))
          .to.be.lessThan(0.0001);
      });
    });
  });

  context('pltdtapset', async () => {
    context('with invalid params', async () => {
      it('should fail with invalid claim rate', async () => {
        await assertEOSErrorIncludesMessage(
          mining.pltdtapset('eyeke.world', 2600, 'reclminerwds', {
            from: authorizer,
          }),
          'ERR::INVALID_CLAIM_RATE'
        );
      });
      it('should fail with invalid auth', async () => {
        await assertMissingAuthority(
          mining.pltdtapset('eyeke.world', 300, 'reclminerwds', {
            from: miner1,
          })
        );
      });
      it('should fail with invalid destination', async () => {
        await assertEOSErrorIncludesMessage(
          mining.pltdtapset('eyeke.world', 300, 'invalidacc', {
            from: authorizer,
          }),
          'ERR::INVALID_DESTINATION'
        );
      });
    });
    context('with correct params - first time', async () => {
      const claim_rate = 300;
      it('should work', async () => {
        await mining.pltdtapset('eyeke.world', claim_rate, miner1.name, {
          from: authorizer,
        });
      });

      it('should adjust pool rates after setting claim rate', async () => {});

      it('should fail when claiming with no claim bucket', async () => {
        await assertEOSErrorIncludesMessage(
          mining.pltdtapclaim(shared.testplanet, { from: authorizer }),
          'ERR::NO_CLAIM_BUCKET::No claim bucket found'
        );
      });

      context('with correct params - change claim rate', async () => {
        const claim_rate = 500;
        it('should work', async () => {
          await mining.pltdtapset('eyeke.world', claim_rate, miner1.name, {
            from: authorizer,
          });
        });

        // Helper for repeated DTAP claim bucket tests
        async function mine_and_check_claim_bucket({
          planet,
          claim_rate,
          landowner,
          land,
          miner_name,
        }) {
          // Wait for mine bucket to accrue
          await sleep(120 * seconds);

          // Prepare a new miner first
          await shared.landholders.setprofitshr(
            landowner.name,
            land.asset_id,
            1000,
            { from: landowner }
          );
          const miner = await AccountManager.createAccount(miner_name);
          await shared.mintShovel(miner.name);
          await sleep(500);
          await setupMiner(miner, land);

          // Bucket amount before mining
          const conf_before = await mining.pltdtapconfTable({ scope: planet });
          const bucket_before_variant = conf_before.rows[0].data.find(
            (x) => x.key === 'claim_bucket'
          );
          const bucket_before_asset = new Asset(bucket_before_variant.value[1]);

          // Snapshot state immediately before mining
          const state_before_res = await mining.state3Table({ scope: planet });
          const state_before = state_before_res.rows[0];
          const new_to_mine_bucket =
            calculate_mine_bucket_allocation(state_before);

          const nonce = await get_nonce(miner.name, landowner.name, EOSManager);
          await mining.mine(miner.name, nonce, undefined, { from: miner });

          // Fetch the planet dtap config and verify the claim bucket
          const conf_res = await mining.pltdtapconfTable({ scope: planet });
          const conf_data_list = conf_res.rows[0].data;
          const claim_bucket_variant = conf_data_list.find(
            (x) => x.key === 'claim_bucket'
          );
          chai.expect(claim_bucket_variant).to.not.be.undefined;
          const claim_bucket_asset = new Asset(claim_bucket_variant.value[1]);

          // Calculate increment
          const actual_inc_amount =
            claim_bucket_asset.amount - bucket_before_asset.amount;
          // Expected increment with integer truncation (precision 4 decimals, amount represented in units of 1e-4)
          const expected_inc_units = Math.floor(
            (new_to_mine_bucket.amount * claim_rate) / 10000
          );
          const expected_ratio = expected_inc_units / new_to_mine_bucket.amount;
          const actual_ratio = actual_inc_amount / new_to_mine_bucket.amount;
          chai
            .expect(Math.abs(actual_ratio - expected_ratio))
            .to.be.lessThan(0.02); // allow 2% deviation due to rounding/time drift

          return claim_bucket_asset.amount;
        }

        it('should correctly update the planet claim bucket after mining', async () => {
          // Fund & fill the pool
          const deposit_amount = '1000000.0000 TLM';
          await shared.eosioToken.transfer(
            shared.tokenIssuer.name,
            filler.name,
            deposit_amount,
            'fund bucket',
            {
              from: shared.tokenIssuer,
            }
          );
          await shared.eosioToken.transfer(
            filler.name,
            mining.account.name,
            deposit_amount,
            'deposit',
            {
              from: filler,
            }
          );

          await mining.fill(filler.name, shared.testplanet, {
            auths: [
              { actor: filler.name, permission: 'active' },
              { actor: shared.federation.account.name, permission: 'active' },
            ],
          });

          const landowner = shared.landowners[0];
          const land = await get_land(landowner);
          await mine_and_check_claim_bucket({
            planet: shared.testplanet,
            claim_rate,
            landowner,
            land,
            miner_name: 'dtapminer1',
          });
        });

        it('should correctly update the planet claim bucket after two consecutive mines', async () => {
          const landowner = shared.landowners[0];
          const land = await get_land(landowner);
          await mine_and_check_claim_bucket({
            planet: shared.testplanet,
            claim_rate,
            landowner,
            land,
            miner_name: 'dtapminer2',
          });
          // Second mine
          await mine_and_check_claim_bucket({
            planet: shared.testplanet,
            claim_rate,
            landowner,
            land,
            miner_name: 'dtapminer3',
          });
        });
      });
    });

    context('pltdtapclaim', async () => {
      it('should transfer the planet claim bucket to the configured destination', async () => {
        const conf_before = await mining.pltdtapconfTable({
          scope: shared.testplanet,
        });
        const claim_bucket_variant = conf_before.rows[0].data.find(
          (d) => d.key === 'claim_bucket'
        );
        chai.expect(
          claim_bucket_variant,
          'claim_bucket not found in pltdtapconf singleton'
        ).to.not.be.undefined;
        const bucket_before_asset = new Asset(claim_bucket_variant.value[1]);

        const balance_before = await shared.getBalance(miner1);

        await mining.pltdtapclaim(shared.testplanet, { from: authorizer });

        const balance_after = await shared.getBalance(miner1);
        const diff = balance_after - balance_before;
        chai
          .expect(Math.abs(diff - bucket_before_asset.amount))
          .to.be.lessThan(0.0001);
      });
    });

    context('pltdtapclaim - missing auth', async () => {
      it('should fail with missing auth error when called by unauthorized account', async () => {
        await assertMissingAuthority(
          mining.pltdtapclaim(shared.testplanet, { from: anybody })
        );
      });
    });
  });
});

async function get_land(landowner) {
  const res = await atomicassets.assetsTable({
    scope: landowner.name,
  });
  const lands = res.rows.filter((x) => x.schema_name == shared.LAND_SCHEMA);

  return lands[0];
}

async function createTestAccounts() {
  miner1 = await AccountManager.createAccount('mminer1');
  miner2 = await AccountManager.createAccount('mminer2');
  miner3 = await AccountManager.createAccount('mminer3');
  miner4 = await AccountManager.createAccount('mminer4');

  filler = await AccountManager.createAccount('filler');
  anybody = await AccountManager.createAccount();
  yeomenwarder = await AccountManager.createAccount('yeomenwarder');

  shared = await SharedTestObjects.getInstance();
  mining = shared.mining;
  atomicassets = shared.atomicassets;
  await shared.mintShovel(miner1.name);
  await sleep(500);
  await shared.mintShovel(miner1.name);
  await sleep(500);
  await shared.mintShovel(miner1.name);
  await sleep(500);
  await shared.mintShovel(miner2.name);
  await sleep(500);
  await shared.mintShovel(miner2.name);
  await sleep(500);
  await shared.mintShovel(miner2.name);
}

async function setupMiner(miner, land) {
  await mining.setland(miner.name, land.asset_id, {
    from: miner,
  });
  const assets_res = await atomicassets.assetsTable({
    scope: miner.name,
  });
  const assets = assets_res.rows.slice(0, 3);
  const asset_ids = assets.map((x) => x.asset_id);
  await mining.setbag(miner.name, asset_ids, { from: miner });
}

function zip(a, b) {
  return a.map((x, y) => [x, b[y]]);
}

async function get_miner_luck(miner, landowner, land) {
  const all_bags = (await mining.bagsTable({ scope: mining.name })).rows;
  const bag = all_bags.find((x) => x.account == miner.name);
  chai.expect(bag).not.to.be.undefined;
  const luck = await Promise.all(
    bag.items.map(async (asset_id) => {
      const data = await get_data(miner, asset_id);
      if (data.rarity == 'Abundant') {
        return 0;
      } else {
        return data.luck;
      }
    })
  );
  const land_data = await get_data(landowner, land.asset_id);
  return Math.floor((land_data.luck * sum(luck)) / 10);
}

async function get_data(owner, asset_id) {
  const atomic = shared.get_atomic();
  const asset = await atomic.getAsset(owner.name, asset_id);
  return asset.data();
}

function sum(list) {
  return list.reduce((a, b) => a + b);
}

async function get_miner_ease(miner, land_data) {
  const all_bags = (await mining.bagsTable({ scope: mining.name })).rows;
  const bag = all_bags.find((x) => x.account == miner.name);
  chai.expect(bag).not.to.be.undefined;
  const eases = await Promise.all(
    bag.items.map(async (asset_id) => {
      const data = await get_data(miner, asset_id);
      const ease = (data.ease * land_data.ease) / 10;
      return { rarity: data.rarity, ease };
    })
  );
  return eases;
}

function calculate_mine_bucket_allocation(state) {
  const seconds_since_fill =
    moment.utc().unix() - moment.utc(state.last_fill_time).unix();
  const new_tokens_amount = parseFloat(state.fill_rate) * seconds_since_fill;
  const new_tokens = new Asset(new_tokens_amount / 10000, 'TLM');
  const bucket = new Asset(state.bucket_total);
  return new_tokens.amount < bucket.amount ? new_tokens : bucket;
}

async function mine_profit_amount(planet, landowner, land, miner) {
  const [state_res, land_data, pools_data] = await Promise.all([
    mining.state3Table({ scope: planet }),
    get_data(landowner, land.asset_id),
    mining.poolsTable({ scope: planet }),
  ]);
  const eases = await get_miner_ease(miner, land_data);
  const state = state_res.rows[0];

  const rates_dict = to_dict(pools_data.rows[0].rates);
  for (const key in rates_dict) {
    rates_dict[key] = parseFloat(rates_dict[key]);
  }

  let mine_amount = calculate_mine_bucket_allocation(state);

  // distribute mine_amount to pools according to their rates
  let pool_buckets = to_dict(pools_data.rows[0].pool_buckets);

  for (const [rarity, rate] of Object.entries(rates_dict)) {
    if (pool_buckets[rarity] === undefined) {
      pool_buckets[rarity] = new Asset('0.0000 TLM');
    }
    const value = pool_buckets[rarity].amount;

    pool_buckets[rarity] = new Asset(
      value + (mine_amount.amount * rate) / 100,
      'TLM'
    );
  }

  let is_bot = false;
  let mined_asset = 0;
  for (const { rarity, ease } of Object.values(eases)) {
    console.log({ rarity, ease });
    const ease_bucket = pool_buckets[rarity];
    let pool_amount = (ease_bucket.amount * ease) / 1000;
    if (is_bot) {
      pool_amount /= 1000;
    }
    pool_amount = Math.min(pool_amount, ease_bucket.amount);
    pool_buckets[rarity] = new Asset(
      pool_buckets[rarity].amount - pool_amount,
      'TLM'
    );
    mined_asset += pool_amount;
  }

  const profit = await profit_share(mined_asset, landowner, land, planet);
  mined_asset -= profit;
  return [mined_asset, profit, pool_buckets];
}

async function profit_share(mined_amount, landowner, land, planet_name) {
  const global_config = await shared.landholders.plntconfigsTable();
  const planet_config = await shared.landholders.plntconfigsTable({
    scope: planet_name,
  });
  const data = await get_data(landowner, land.asset_id);

  const global_max =
    (await shared.singleton_get(global_config, 'max_commission')) || 10000;

  const global_min =
    (await shared.singleton_get(global_config, 'min_commission')) || 0;

  const planet_max =
    (await shared.singleton_get(planet_config, 'max_commission')) || 10000;
  const planet_min =
    (await shared.singleton_get(planet_config, 'min_commission')) || 0;

  const min_commission = Math.max(planet_min, global_min);
  const max_commission = Math.min(planet_max, global_max);
  const commission = clamp(data.commission, min_commission, max_commission);
  console.log('profit_share calculation using commission: ', commission);

  const share = (mined_amount * commission) / 10000;
  return share;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function to_dict(list) {
  let out = {};
  for (const x of list) {
    out[x.key] = x.value;
  }
  return out;
}
