import {
  ContractDeployer,
  assertRowsEqual,
  AccountManager,
  Account,
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

import { Infl } from './infl';
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

const epsilon = 0.0001;
const DAILY_INFLATION_CAP_UNITS = 8290295660;

const dac_accounts = new Map([
  ['eyeke.world', 'eyeke.wp.dac'],
  ['kavian.world', 'kavan.wp.dac'],
  ['magor.world', 'magor.wp.dac'],
  ['naron.world', 'naron.wp.dac'],
  ['neri.world', 'neri.wp.dac'],
  ['veles.world', 'veles.wp.dac'],
]);
describe('Infl migration', () => {
  let unauthorized: Account;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    unauthorized = await AccountManager.createAccount('inflmigrant');
  });

  it('should require infl auth to migrate', async () => {
    await assertMissingAuthority(shared.infl.migrate({ from: unauthorized }));
  });

  it('should copy federation defaults without mutating existing state', async () => {
    const stateBefore = await shared.infl.stateTable();
    const reserveBefore = await shared.infl.reserveTable();
    const payoutsBefore = await shared.infl.payoutsTable();
    const dacBefore = await shared.infl.dacpayoutsTable();

    await shared.infl.migrate();

    const stateAfter = await shared.infl.stateTable();
    const reserveAfter = await shared.infl.reserveTable();
    const payoutsAfter = await shared.infl.payoutsTable();
    const dacAfter = await shared.infl.dacpayoutsTable();

    if (stateBefore.rows.length) {
      chai.expect(stateAfter.rows).to.deep.equal(stateBefore.rows);
    } else {
      chai.expect(stateAfter.rows.length).to.be.at.least(1);
      const afterState = stateAfter.rows[0];
      chai.expect(afterState.total_stake).to.equal(0);
      chai.expect(afterState.nft_total).to.equal(0);
    }

    if (reserveBefore.rows.length) {
      chai.expect(reserveAfter.rows).to.deep.equal(reserveBefore.rows);
    } else {
      chai.expect(reserveAfter.rows.length).to.be.at.least(1);
      chai.expect(reserveAfter.rows[0].total).to.equal(0);
    }
    chai.expect(payoutsAfter.rows).to.deep.equal(payoutsBefore.rows);
    chai.expect(dacAfter.rows).to.deep.equal(dacBefore.rows);
  });

  it('should fail when migrate is called twice', async () => {
    await assertEOSErrorIncludesMessage(
      shared.infl.migrate(),
      'Already migrated'
    );
  });
});

describe('Infl inflate preconditions', () => {
  before(async () => {
    shared = await SharedTestObjects.getInstance();
  });

  it('should abort inflate when reserve is zero', async () => {
    const reserveRes = await shared.infl.reserveTable();
    const originalReserve = reserveRes.rows.length
      ? reserveRes.rows[0].total
      : null;
    const stateRes = await shared.infl.stateTable();
    const originalLastFill = stateRes.rows.length
      ? new Date(stateRes.rows[0].last_land_fill)
      : null;

    const tempPlanet = 'rzero.world';

    const timestamp = shared.eosTime(new Date()).subtract(48, 'hours').toDate();

    await shared.infl.setlandclaim(timestamp);

    try {
      // Ensure there is a planet with some stake so we hit the reserve=0 check
      await shared.createPlanet(tempPlanet, symbol);

      // Bump planet's stake directly to avoid DAC token setup
      await shared.planets.updatestake(tempPlanet, '1.0000 TLM');

      // Now set reserve to zero to trigger the expected error
      await shared.infl.setreserve(0);

      await assertEOSErrorIncludesMessage(
        shared.infl.inflate(),
        'Inflation must be positive'
      );

      // Cleanup stake so planet can be removed
      await shared.planets.updatestake(tempPlanet, '-1.0000 TLM');
    } finally {
      // Attempt to remove the temp planet; ignore if removal fails
      try {
        await shared.planets.removeplanet(tempPlanet);
      } catch (e) {}
      if (originalReserve !== null && originalReserve !== 0) {
        await shared.infl.setreserve(originalReserve);
      }
      if (
        originalLastFill &&
        timestamp.getTime() !== originalLastFill.getTime()
      ) {
        await shared.infl.setlandclaim(originalLastFill);
      }
    }
  });

  it('should abort inflate when no planets exist', async () => {
    const reserveRes = await shared.infl.reserveTable();
    const originalReserve = reserveRes.rows.length
      ? reserveRes.rows[0].total
      : null;
    const stateRes = await shared.infl.stateTable();
    const originalLastFill = stateRes.rows.length
      ? new Date(stateRes.rows[0].last_land_fill)
      : null;

    const planets = await shared.planets.planetsTable({ limit: 10 });
    chai.expect(planets.rows.length).to.equal(0);

    const timestamp = shared.eosTime(new Date()).subtract(48, 'hours').toDate();

    await shared.infl.setreserve(3200000000000);
    await shared.infl.setlandclaim(timestamp);

    try {
      await assertEOSErrorIncludesMessage(
        shared.infl.inflate(),
        'Total staked TLM must be greater than 0'
      );
    } finally {
      if (originalReserve !== null && originalReserve !== 3200000000000) {
        await shared.infl.setreserve(originalReserve);
      }
      if (
        originalLastFill &&
        timestamp.getTime() !== originalLastFill.getTime()
      ) {
        await shared.infl.setlandclaim(originalLastFill);
      }
    }
  });

  it('should abort inflate when total stake is zero', async () => {
    const reserveRes = await shared.infl.reserveTable();
    const originalReserve = reserveRes.rows.length
      ? reserveRes.rows[0].total
      : null;
    const stateRes = await shared.infl.stateTable();
    const originalLastFill = stateRes.rows.length
      ? new Date(stateRes.rows[0].last_land_fill)
      : null;

    const tempPlanet = 'stzero.world';

    // Set last_land_fill in the past and a small positive reserve
    const timestamp = shared.eosTime(new Date()).subtract(48, 'hours').toDate();

    try {
      await shared.createPlanet(tempPlanet, symbol);
      await shared.infl.setlandclaim(timestamp);
      await shared.infl.setreserve(1_000_000_000); // 100,000.0000 TLM
      // Ensure nft_total > 0 so we hit the stake guard first
      await shared.infl.setmultipl(tempPlanet, 1);

      await assertEOSErrorIncludesMessage(
        shared.infl.inflate(),
        'Total staked TLM must be greater than 0'
      );
    } finally {
      // Restore nft_total and remove the temporary planet
      try {
        await shared.infl.setmultipl(tempPlanet, -1);
      } catch (e) {}
      try {
        await shared.planets.removeplanet(tempPlanet);
      } catch (e) {}
      if (originalReserve !== null && originalReserve !== 1_000_000_000) {
        await shared.infl.setreserve(originalReserve);
      }
      if (
        originalLastFill &&
        timestamp.getTime() !== originalLastFill.getTime()
      ) {
        await shared.infl.setlandclaim(originalLastFill);
      }
    }
  });
});

describe('Infl planet cap guard', () => {
  const planetNames = [
    'aaaaa.world',
    'bbbbb.world',
    'ccccc.world',
    'ddddd.world',
    'eeeee.world',
    'fffff.world',
    'ggggg.world',
    'hhhhh.world',
  ];
  let planetsAdded: string[] = [];
  before(async () => {
    // Ensure shared is initialized (singleton reuses existing instance)
    shared = await SharedTestObjects.getInstance();
  });
  after(async () => {
    // delete planets created for this test
    for (const planetName of planetsAdded) {
      await shared.planets.removeplanet(planetName);
    }
  });

  it('should abort inflate when number of planets exceeds 7', async () => {
    // Ensure planet count > 7
    let res = await shared.planets.planetsTable({ limit: 100 });
    let count = res.rows.length;

    let idx = 0;
    while (count <= 7 && idx < planetNames.length) {
      try {
        await shared.createPlanet(planetNames[idx], symbol);
        planetsAdded.push(planetNames[idx]);
      } catch (e) {
        // If planet exists already, ignore and continue
      }
      idx++;
      res = await shared.planets.planetsTable({ limit: 200 });
      count = res.rows.length;
    }

    // Make sure 24h guard passes
    const timestamp = shared.eosTime(new Date()).subtract(50, 'hours').toDate();
    await shared.infl.setlandclaim(timestamp);

    await assertEOSErrorIncludesMessage(
      shared.infl.inflate(),
      'Too many planets'
    );
  });
});
describe('Infl', async () => {
  let user1: Account;
  let dacId = 'feddac';
  let binance_balance_before: number;
  let binance_balance_after: number;

  before(async () => {
    shared = await SharedTestObjects.getInstance();

    await shared.createPlanet(planet_1, symbol);
    await shared.createPlanet(planet_2, symbol);
    await shared.createPlanet(planet_3, symbol);

    binance_account = await AccountManager.createAccount(BINANCE_PLANET_NAME);
    user1 = await AccountManager.createAccount('feduser1');
    auth_account = await AccountManager.createAccount('fedauth');
    await initDac(dacId, symbol);
    await setupPermissions();
    await createToken();

    dac_accounts.forEach((value, key) => {
      AccountManager.createAccount(value);
    });
  });

  context('staking', async () => {
    before(async () => {
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user1.name,
        '5687676.9470 TLM',
        'some money',
        { from: shared.tokenIssuer }
      );

      // let res = await shared.federation.planetsTable({});
      // console.log(res, null, 2);
      // chai.expect(res.rows.length).to.equal(3);

      const res = await shared.planets.planetsTable({});
      // console.log(res, null, 2);
      chai.expect(res.rows.length).to.equal(3);
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
            '5687676.9470 TLM',
            'some money',
            { from: user1 }
          );
        });
        it('should work', async () => {
          await shared.staking.stake(user1.name, planet_1, '668302.6034 TLM', {
            from: user1,
          });
        });
        it('should update planets stake', async () => {
          const res = await shared.planets.planetsTable();
          const planet = res.rows.find((x) => x.planet_name == planet_1);
          chai.expect(planet.total_stake).to.equal('6683026034');
        });
      });
    });
  });

  context('inflate', async () => {
    let landowner_account_balance_before: number,
      landowner_account_balance_after: number;
    let expected_amount, reserve_before;
    let last_land_fill_before: Date;
    let infl_balance_before: number;

    let expected_landowners_allocation: number,
      expected_satellite_allocation: number;
    let satellite_balance_before: number;
    let satellite_balance_after: number;

    before(async () => {
      landowner_account_balance_before = await shared.getBalance(
        shared.landholders_allocation_account
      );
      satellite_balance_before = await shared.getBalance(
        shared.satellite_account
      );
      binance_balance_before = await shared.getBalance(BINANCE_PLANET_NAME);
      const timestamp = shared
        .eosTime(new Date())
        .subtract(50, 'hours')
        .toDate();
      await shared.infl.setlandclaim(timestamp);
      const stateBefore = await shared.infl.stateTable();
      chai.expect(stateBefore.rows.length).to.be.greaterThan(0);
      last_land_fill_before = new Date(stateBefore.rows[0].last_land_fill);
      await shared.infl.setreserve(3200000000000);
      await shared.infl.setmultipl(planet_1, 87979);
      await shared.infl.setmultipl(planet_2, 27979);
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

      infl_balance_before = await shared.getBalance(shared.infl.account.name);

      const res = await shared.infl.reserveTable();
      reserve_before = res.rows[0].total / 10000;
      [expected_landowners_allocation, expected_satellite_allocation] =
        await calc_landfill_amount();
    });

    it('should not work when paused', async () => {
      await shared.infl.pause({ from: shared.infl.account });
      await assertEOSErrorIncludesMessage(
        shared.infl.inflate(),
        'Contract is paused'
      );
    });

    it('should work when unpaused', async () => {
      await shared.infl.unpause({ from: shared.infl.account });
      await shared.infl.inflate();
    });

    it('should increment last_land_fill by exactly 24 hours', async () => {
      const state = await shared.infl.stateTable();
      chai.expect(state.rows.length).to.be.greaterThan(0);
      const updatedLastFill = new Date(state.rows[0].last_land_fill);
      const diffSeconds =
        (updatedLastFill.getTime() - last_land_fill_before.getTime()) / 1000;
      chai.expect(Math.round(diffSeconds)).to.equal(60 * 60 * 24);
    });

    it('should have transferred to binance account (DTAB)', async () => {
      binance_balance_after = await shared.getBalance(BINANCE_PLANET_NAME);
      const actual_dtab = binance_balance_after - binance_balance_before;

      // Compute expected DTAB: 7% of inflation based on reserve_before and current number of planets
      const planets_res = await shared.planets.planetsTable({ limit: 200 });
      const num_planets = planets_res.rows.length;
      const inflation =
        (reserve_before * (13.0 + 1.9 * num_planets)) / 100000.0;
      const expected_dtab = inflation * 0.07;
      assert_close_enough(actual_dtab, expected_dtab, 0.015);
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
      satellite_balance_after = await shared.getBalance(
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
      const res = await shared.infl.reserveTable();
      const reserve_after = res.rows[0].total / 10000;
    });

    it('should retain DTAP allocations on infl balance until claimed', async () => {
      const inflBalanceAfter = await shared.getBalance(
        shared.infl.account.name
      );
      const balanceDelta = inflBalanceAfter - infl_balance_before;

      const payouts = await shared.infl.payoutsTable();
      const dacp = await shared.infl.dacpayoutsTable();
      const dtapSumPlanets = payouts.rows.reduce(
        (acc, row) => acc + parseFloat(row.mining) + parseFloat(row.reserve),
        0
      );
      const dtapSumDac = dacp.rows.reduce(
        (acc, row) => acc + parseFloat(row.amount),
        0
      );
      const dtapAfterRounding = dtapSumPlanets + dtapSumDac;

      assert_close_enough(balanceDelta, dtapAfterRounding, 0.015);
    });

    it('should satisfy DTAP accounting invariant (sum of payouts ≈ 63% of inflation)', async () => {
      // Sum planet payouts (mining + reserve) and DAC payouts
      const payouts = await shared.infl.payoutsTable();
      const dacp = await shared.infl.dacpayoutsTable();
      const dtap_sum_planets = payouts.rows.reduce(
        (acc, r) => acc + parseFloat(r.mining) + parseFloat(r.reserve),
        0
      );
      const dtap_sum_dac = dacp.rows.reduce(
        (acc, r) => acc + parseFloat(r.amount),
        0
      );
      const dtap_sum = dtap_sum_planets + dtap_sum_dac;

      const planets_res = await shared.planets.planetsTable({ limit: 200 });
      const num_planets = planets_res.rows.length;
      const inflation =
        (reserve_before * (13.0 + 1.9 * num_planets)) / 100000.0;
      const expected_dtap = inflation * 0.63;
      chai.expect(Math.abs(dtap_sum - expected_dtap)).to.be.lessThan(0.015);
    });

    it('should reduce reserve by exactly the minted total', async () => {
      const res = await shared.infl.reserveTable();
      const reserve_after = res.rows[0].total / 10000;
      const reserve_delta = reserve_before - reserve_after;

      // Recompute actuals from balances/tables
      const landowners_after = await shared.getBalance(
        shared.landholders_allocation_account
      );
      const actual_dtal = landowners_after - landowner_account_balance_before;

      const actual_dtas = satellite_balance_after - satellite_balance_before;
      const actual_dtab = binance_balance_after - binance_balance_before;

      const payouts = await shared.infl.payoutsTable();
      const dacp = await shared.infl.dacpayoutsTable();
      const dtap_sum_planets = payouts.rows.reduce(
        (acc, r) => acc + parseFloat(r.mining) + parseFloat(r.reserve),
        0
      );
      const dtap_sum_dac = dacp.rows.reduce(
        (acc, r) => acc + parseFloat(r.amount),
        0
      );
      const dtap_after_rounding = dtap_sum_planets + dtap_sum_dac;

      const minted_total =
        dtap_after_rounding + actual_dtal + actual_dtas + actual_dtab;
      chai.expect(Math.abs(reserve_delta - minted_total)).to.be.lessThan(0.015);
    });

    // Happy path: verify a normal inflate run (after rounding and splitting into
    // DTAP/DTAL/DTAS/DTAB) keeps the total minted amount under the on-chain cap.
    // We reconstruct the minted total from payouts + balance deltas. This
    // complements the separate over-cap test that must abort on compute.
    it('should keep minted total under the configured daily cap', async () => {
      const landowners_after = await shared.getBalance(
        shared.landholders_allocation_account
      );
      const satellite_after = await shared.getBalance(shared.satellite_account);
      const binance_after = await shared.getBalance(BINANCE_PLANET_NAME);

      const actual_dtal = landowners_after - landowner_account_balance_before;
      const actual_dtas = satellite_after - satellite_balance_before;
      const actual_dtab = binance_after - binance_balance_before;

      const toUnits = (val: number) =>
        Math.round((val + Number.EPSILON) * 10000);

      const payouts = await shared.infl.payoutsTable();
      const dacp = await shared.infl.dacpayoutsTable();
      const dtapUnitsPlanets = payouts.rows.reduce(
        (acc, row) =>
          acc +
          toUnits(parseFloat(row.mining)) +
          toUnits(parseFloat(row.reserve)),
        0
      );
      const dtapUnitsDac = dacp.rows.reduce(
        (acc, row) => acc + toUnits(parseFloat(row.amount)),
        0
      );

      const mintedUnits =
        dtapUnitsPlanets +
        dtapUnitsDac +
        toUnits(actual_dtal) +
        toUnits(actual_dtas) +
        toUnits(actual_dtab);

      chai.expect(mintedUnits).to.be.at.most(DAILY_INFLATION_CAP_UNITS);
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
      let res = await shared.infl.payoutsTable();
      const payout = res.rows.find((x) => x.planet_name == planet_1);
      reserve_payout_balance = parseFloat(payout.reserve);
      mining_payout_balance = parseFloat(payout.mining);

      const res2 = await shared.infl.dacpayoutsTable();
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
        shared.infl.claim(planet_1, {
          from: shared.planet_accounts[planet_2],
        })
      );
    });
    it('should work', async () => {
      await shared.infl.claim(planet_1, {
        from: shared.planet_accounts[planet_1],
      });
    });
    it('should fail when claiming the same planet again', async () => {
      await sleep(500);
      await assertEOSErrorIncludesMessage(
        shared.infl.claim(planet_1, { from: shared.planet_accounts[planet_1] }),
        'No payout found'
      );
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
      const res = await shared.infl.payoutsTable();
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
      const res = await shared.infl.dacpayoutsTable();
      const payout = res.rows.find((x) => x.dac_account == dac_name);
      chai.expect(payout).to.equal(undefined);
    });
    it('should reject claiming while paused and succeed after unpause', async () => {
      const planetAccount = shared.planet_accounts[planet_2];
      const payoutsBefore = await shared.infl.payoutsTable();
      const payout = payoutsBefore.rows.find((x) => x.planet_name == planet_2);
      chai.expect(payout).to.not.equal(undefined);

      const balanceBefore = await shared.getBalance(planetAccount);

      await shared.infl.pause({ from: shared.infl.account });
      try {
        await assertEOSErrorIncludesMessage(
          shared.infl.claim(planet_2, { from: planetAccount }),
          'Contract is paused'
        );
      } finally {
        await shared.infl.unpause({ from: shared.infl.account });
      }

      const balanceAfterPause = await shared.getBalance(planetAccount);
      chai
        .expect(Math.abs(balanceAfterPause - balanceBefore))
        .to.be.lessThan(epsilon);

      await shared.infl.claim(planet_2, { from: planetAccount });

      const balanceAfter = await shared.getBalance(planetAccount);
      chai.expect(balanceAfter).to.be.greaterThan(balanceBefore);

      const payoutsAfter = await shared.infl.payoutsTable();
      const remaining = payoutsAfter.rows.find(
        (x) => x.planet_name == planet_2
      );
      chai.expect(remaining).to.equal(undefined);
    });
    it('should not create dac payout for planet without DAC mapping', async () => {
      const payouts = await shared.infl.payoutsTable();
      const entry = payouts.rows.find((x) => x.planet_name == planet_3);
      if (entry) {
        chai.expect(parseFloat(entry.mining)).to.equal(0);
        chai.expect(parseFloat(entry.reserve)).to.equal(0);
      }

      const dac_entries = await shared.infl.dacpayoutsTable();
      const has_unmapped = dac_entries.rows.find(
        (x) => x.dac_account == planet_3
      );
      chai.expect(has_unmapped).to.equal(undefined);

      await assertEOSErrorIncludesMessage(
        shared.infl.claim(planet_3, { from: shared.planet_accounts[planet_3] }),
        'must transfer positive quantity'
      );
    });
  });
});

describe('Infl NFT preconditions', () => {
  const tmpPlanet = 'tmp.world';
  let originalMultipliers: { planet_name: string; multiplier: number }[] = [];
  before(async () => {
    shared = await SharedTestObjects.getInstance();
    try {
      await shared.createPlanet(tmpPlanet, symbol);
    } catch (e) {
      // ignore if exists
    }
    const timestamp = shared.eosTime(new Date()).subtract(50, 'hours').toDate();
    await shared.infl.setlandclaim(timestamp);
    await shared.infl.setreserve(1_000_000_000); // some reserve
    const planets = await shared.planets.planetsTable({ limit: 100 });
    for (const row of planets.rows) {
      const multiplier = parseInt(row.nft_multiplier, 10);
      originalMultipliers.push({ planet_name: row.planet_name, multiplier });
      if (multiplier !== 0) {
        await shared.infl.setmultipl(row.planet_name, -multiplier);
      }
    }
  });
  after(async () => {
    try {
      await shared.planets.removeplanet(tmpPlanet);
    } catch (e) {}
    for (const entry of originalMultipliers) {
      if (entry.multiplier !== 0) {
        await shared.infl.setmultipl(entry.planet_name, entry.multiplier);
      }
    }
    originalMultipliers = [];
  });
  it('should abort inflate when nft_total == 0', async () => {
    await assertEOSErrorIncludesMessage(
      shared.infl.inflate(),
      'Total planet nft multiplier is 0'
    );
  });
});

describe('Infl inflation cap guard', () => {
  before(async () => {
    // Ensure shared is initialized (singleton reuses existing instance)
    shared = await SharedTestObjects.getInstance();
  });

  it('should abort when computed inflation exceeds 829,029.5660 TLM', async () => {
    // Get last_land_fill time before
    const state_res = await shared.infl.stateTable();
    const state = state_res.rows[0];
    const last_land_fill_time = state.last_land_fill;

    const timestamp = shared.eosTime(new Date()).subtract(50, 'hours').toDate();
    await shared.infl.setlandclaim(timestamp);

    // Set a very large reserve to push inflation over the cap (units: x10000)
    await shared.infl.setreserve(50_000_000_000_000);

    await assertEOSErrorIncludesMessage(
      shared.infl.inflate(),
      'Inflation exceeds daily cap'
    );

    // Restore last_land_fill so other suites are not affected if they run after this
    await shared.infl.setlandclaim(last_land_fill_time);
  });
});

describe('Infl auth and pause/unpause guards', () => {
  before(async () => {
    shared = await SharedTestObjects.getInstance();
  });
  it('should require infl auth for dev-only actions', async () => {
    const timestamp = shared.eosTime(new Date()).subtract(50, 'hours').toDate();
    await assertMissingAuthority(
      shared.infl.setreserve(12345, {
        from: await AccountManager.createAccount('nauser1'),
      })
    );
    await assertMissingAuthority(
      shared.infl.setmultipl('eyeke.world', 1, {
        from: await AccountManager.createAccount('nauser2'),
      })
    );
    await assertMissingAuthority(
      shared.infl.setlandclaim(timestamp, {
        from: await AccountManager.createAccount('nauser3'),
      })
    );
  });
  it('should reject duplicate pause/unpause and require auth', async () => {
    // Unauthorized
    const unauth = await AccountManager.createAccount('unauthpz');
    await assertMissingAuthority(shared.infl.pause({ from: unauth }));
    await assertMissingAuthority(shared.infl.unpause({ from: unauth }));

    // Duplicate pause
    await shared.infl.pause({ from: shared.infl.account });
    await sleep(500);
    await assertEOSErrorIncludesMessage(
      shared.infl.pause({ from: shared.infl.account }),
      'already paused'
    );
    await sleep(500);
    await shared.infl.unpause({ from: shared.infl.account });
    await sleep(500);
    await assertEOSErrorIncludesMessage(
      shared.infl.unpause({ from: shared.infl.account }),
      'already unpaused'
    );
  });
});

describe('Infl extended coverage', () => {
  before(async () => {
    shared = await SharedTestObjects.getInstance();
  });

  context('dev setters', () => {
    let originalReserve: number | null;
    let originalLastFill: Date | null;

    beforeEach(async () => {
      const reserveRes = await shared.infl.reserveTable();
      originalReserve = reserveRes.rows.length
        ? reserveRes.rows[0].total
        : null;

      const stateRes = await shared.infl.stateTable();
      originalLastFill = stateRes.rows.length
        ? new Date(stateRes.rows[0].last_land_fill)
        : null;
    });

    afterEach(async () => {
      if (originalReserve !== null) {
        await shared.infl.setreserve(originalReserve);
      }
      if (originalLastFill) {
        await shared.infl.setlandclaim(originalLastFill);
      }
    });

    it('should reject setmultipl on unknown planet', async () => {
      await assertEOSErrorIncludesMessage(
        shared.infl.setmultipl('ghost.world', 10),
        'ERR:PLANET_DOES_NOT_EXIST'
      );
    });

    it('should update reserve via setreserve', async () => {
      const newReserve = 9876543210;
      await shared.infl.setreserve(newReserve);
      const reserve = await shared.infl.reserveTable();
      chai.expect(Number(reserve.rows[0].total)).to.equal(newReserve);
    });

    it('should update last_land_fill via setlandclaim', async () => {
      const currentState = await shared.infl.stateTable();
      chai.expect(currentState.rows.length).to.be.greaterThan(0);
      const base = new Date(currentState.rows[0].last_land_fill);
      const custom = new Date(base.getTime() + 60 * 60 * 1000);

      await shared.infl.setlandclaim(custom);

      const state = await shared.infl.stateTable();
      const storedTime = new Date(state.rows[0].last_land_fill).getTime();
      const expectedTime =
        custom.getTime() - custom.getTimezoneOffset() * 60000;
      chai.expect(storedTime).to.equal(expectedTime);
    });
  });

  context('planet cap boundary', () => {
    const addedPlanets: {
      name: string;
      account: Account;
    }[] = [];
    let originalReserve: number;
    let originalLastFill: Date;

    before(async () => {
      const reserveRes = await shared.infl.reserveTable();
      originalReserve = reserveRes.rows[0].total;

      const stateRes = await shared.infl.stateTable();
      originalLastFill = new Date(stateRes.rows[0].last_land_fill);

      const payoutsExisting = await shared.infl.payoutsTable();
      for (const payout of payoutsExisting.rows) {
        const totalAmount =
          parseFloat(payout.mining) + parseFloat(payout.reserve);
        if (totalAmount > 0) {
          const planetAccount = shared.planet_accounts[payout.planet_name];
          if (planetAccount) {
            try {
              await shared.infl.claim(payout.planet_name, {
                from: planetAccount,
              });
            } catch (e) {
              // ignore cleanup errors
            }
          }
        }
      }

      const planetsRes = await shared.planets.planetsTable({ limit: 50 });
      let currentCount = planetsRes.rows.length;
      let idx = 0;
      while (currentCount < 7) {
        const suffix = String.fromCharCode(97 + idx);
        const planetName = `capp${suffix}plnt`;
        const planetAccount = await shared.createPlanet(planetName, symbol);
        addedPlanets.push({ name: planetName, account: planetAccount });
        currentCount++;
        idx++;
      }

      const timestamp = shared
        .eosTime(new Date())
        .subtract(48, 'hours')
        .toDate();
      await shared.infl.setlandclaim(timestamp);
      await shared.infl.setreserve(3200000000000);
      const pauseState = await shared.infl.pausableTable();
      const isPaused =
        pauseState.rows.length > 0 ? pauseState.rows[0].paused : false;
      if (isPaused) {
        await shared.infl.unpause({ from: shared.infl.account });
      }
    });

    after(async () => {
      for (const planet of addedPlanets) {
        try {
          await shared.infl.claim(planet.name, { from: planet.account });
        } catch (e) {
          // ignore cleanup errors
        }
        try {
          await shared.planets.removeplanet(planet.name);
        } catch (e) {}
      }
      await shared.infl.setreserve(originalReserve);
      await shared.infl.setlandclaim(originalLastFill);
    });

    it('should allow inflate when exactly seven planets exist', async () => {
      const planets = await shared.planets.planetsTable({ limit: 50 });
      chai.expect(planets.rows.length).to.equal(7);

      await shared.infl.inflate();

      const payouts = await shared.infl.payoutsTable();
      const planetNames = payouts.rows.map((row) => row.planet_name);
      addedPlanets.forEach(({ name }) => {
        chai.expect(planetNames).to.include(name);
      });
    });
  });

  context('nft multiplier with zero stake', () => {
    const tempPlanet = 'zstake.world';
    const multiplier = 1000;
    let tempAccount: Account;
    let originalReserve: number;
    let originalLastFill: Date;
    const stakeSnapshots: { planet: string; stakeUnits: number }[] = [];

    function unitsToAsset(units: number) {
      return `${(units / 10000).toFixed(4)} TLM`;
    }

    before(async () => {
      const reserveRes = await shared.infl.reserveTable();
      originalReserve = reserveRes.rows[0].total;

      const stateRes = await shared.infl.stateTable();
      originalLastFill = new Date(stateRes.rows[0].last_land_fill);

      const planetsRes = await shared.planets.planetsTable({ limit: 100 });
      for (const planet of planetsRes.rows) {
        const stakeUnits = Number(planet.total_stake || 0);
        if (stakeUnits > 0) {
          stakeSnapshots.push({ planet: planet.planet_name, stakeUnits });
          await shared.planets.updatestake(
            planet.planet_name,
            `-${unitsToAsset(stakeUnits)}`
          );
        }
      }

      tempAccount = await shared.createPlanet(tempPlanet, symbol);
      await shared.planets.updatemult(tempPlanet, multiplier);
      await shared.infl.setmultipl(tempPlanet, multiplier);

      const timestamp = shared
        .eosTime(new Date())
        .subtract(48, 'hours')
        .toDate();
      await shared.infl.setlandclaim(timestamp);
      await shared.infl.setreserve(3200000000000);
      const pauseState = await shared.infl.pausableTable();
      const isPaused =
        pauseState.rows.length > 0 ? pauseState.rows[0].paused : false;
      if (isPaused) {
        await shared.infl.unpause({ from: shared.infl.account });
      }
    });

    after(async () => {
      for (const snapshot of stakeSnapshots) {
        try {
          await shared.planets.updatestake(
            snapshot.planet,
            unitsToAsset(snapshot.stakeUnits)
          );
        } catch (e) {}
      }
      try {
        await shared.infl.setmultipl(tempPlanet, -multiplier);
        await shared.planets.removeplanet(tempPlanet);
      } catch (e) {}

      await shared.infl.setreserve(originalReserve);
      await shared.infl.setlandclaim(originalLastFill);
    });

    it('should reject inflate when nft weight exists but total stake is zero', async () => {
      await assertEOSErrorIncludesMessage(
        shared.infl.inflate(),
        'Total staked TLM must be greater than 0'
      );
    });
  });

  context('zero payout claims', () => {
    const zeroPlanet = 'zeropt.world';
    let zeroAccount: Account;
    let originalReserve: number;
    let originalLastFill: Date;

    before(async () => {
      const reserveRes = await shared.infl.reserveTable();
      originalReserve = reserveRes.rows[0].total;
      const stateRes = await shared.infl.stateTable();
      originalLastFill = new Date(stateRes.rows[0].last_land_fill);

      zeroAccount = await shared.createPlanet(zeroPlanet, symbol);

      const timestamp = shared
        .eosTime(new Date())
        .subtract(48, 'hours')
        .toDate();
      await shared.infl.setlandclaim(timestamp);
      await shared.infl.setreserve(3200000000000);
      {
        const pauseState = await shared.infl.pausableTable();
        const isPaused =
          pauseState.rows.length > 0 ? pauseState.rows[0].paused : false;
        if (isPaused) {
          await shared.infl.unpause({ from: shared.infl.account });
        }
      }

      await shared.infl.inflate();
    });

    after(async () => {
      try {
        await shared.planets.removeplanet(zeroPlanet);
      } catch (e) {}
      await shared.infl.setreserve(originalReserve);
      await shared.infl.setlandclaim(originalLastFill);
    });

    it('should fail to claim when planet payout amounts are zero', async () => {
      const payouts = await shared.infl.payoutsTable();
      const row = payouts.rows.find(
        (entry) => entry.planet_name === zeroPlanet
      );
      chai.expect(row).to.not.equal(undefined);
      chai.expect(parseFloat(row.mining)).to.equal(0);
      chai.expect(parseFloat(row.reserve)).to.equal(0);

      await assertEOSErrorIncludesMessage(
        shared.infl.claim(zeroPlanet, { from: zeroAccount }),
        'must transfer positive quantity'
      );
    });
  });
});

async function calc_landfill_amount() {
  let res = await shared.infl.reserveTable();
  const reserve = res.rows[0].total;

  let planets_res = await shared.planets.planetsTable({ limit: 100 });
  const num_planets = planets_res.rows.length;

  const inflation = (reserve * (13.0 + 1.9 * num_planets)) / 100000.0;
  const landowners_allocation = inflation * 0.2;
  console.log(
    'inflation',
    inflation,
    'landowners_allocation',
    landowners_allocation
  );
  let dtap = 0;
  for (const planet of planets_res.rows) {
    dtap += await calc_total_pay_amount(planet.planet_name, reserve);
  }
  const satellite_allocation = inflation * 0.1;

  return [landowners_allocation / 10000.0, satellite_allocation / 10000.0];
}
async function createToken() {
  await shared.dac_token_contract.create(
    shared.staking.account.name,
    '10000000.0000 MONEYF',
    false,
    { from: shared.dac_token_contract.account }
  );
}
async function initDac(dacId, tokenSymbol) {
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
    auth_account.name,
    dacId,
    {
      contract: shared.dac_token_contract.account.name,
      sym: tokenSymbol,
    },
    'dac_title',
    [],
    accounts,
    {
      auths: [{ actor: auth_account.name, permission: 'active' }],
    }
  );
}
async function calc_total_pay_amount(planet_name, reserve = null) {
  chai.expect(planet_name).to.not.equal(null);
  if (planet_name == 'bina.world') {
    return 0;
  }
  let res = await shared.planets.planetsTable({ limit: 100 });
  const number_planets = res.rows.length;

  if (reserve == null) {
    let resReserve = await shared.infl.reserveTable();
    reserve = resReserve.rows[0].total / 10000;
  }

  let resState = await shared.infl.stateTable();
  const state = resState.rows[0];
  const total_planet_nft_multiplier = state.nft_total;
  const planet = await get_planet(planet_name);
  const planet_nft_multiplier = planet.nft_multiplier;

  const nft_mod = 0.2;
  let nft_pay;
  const total_daily = reserve * (13.0 + number_planets * 1.9);
  if (total_planet_nft_multiplier > 0) {
    nft_pay =
      0.8 *
      ((total_daily * nft_mod) / 100000.0) *
      (planet_nft_multiplier / total_planet_nft_multiplier);
  } else {
    nft_pay = 0;
  }

  const planet_staked_tlm = planet.total_stake;
  const total_planet_staked_tlm = state.total_stake;

  let stake_pay;
  if (total_planet_staked_tlm > 0) {
    stake_pay =
      0.8 *
      ((total_daily * (1.0 - nft_mod)) / 100000.0) *
      (planet_staked_tlm / total_planet_staked_tlm);
  } else {
    stake_pay = 0;
  }
  const binance_daily_adjustment =
    (binance_daily + satellite_from_binance_daily) *
    (planet_staked_tlm / total_planet_staked_tlm);

  const x = Math.min(500000, nft_pay + stake_pay - binance_daily_adjustment);
  return x;
}

async function get_planet(planet_name: string) {
  let res = await shared.planets.planetsTable({ limit: 100 });
  for (const planet of res.rows) {
    if (planet.planet_name == planet_name) {
      return planet;
    }
  }
  throw Error(`planet ${planet_name} not found`);
}

function assert_close_enough(a, b, epsilon = 0.00011) {
  chai.expect(Math.abs(a - b)).to.be.lessThan(epsilon);
}

async function setupPermissions() {
  console.log('setupPermissions 1');
  await add_custom_permission_and_link(
    shared.dac_token_contract,
    'issue',
    shared.dac_token_contract,
    ['issue', 'transfer'],
    shared.infl
  );
  console.log('setupPermissions 2');

  await add_custom_permission_and_link(
    shared.infl,
    'issue',
    shared.eosioToken,
    'issue'
  );
  console.log('setupPermissions 3');
  await add_custom_permission_and_link(
    shared.infl,
    'xfer',
    shared.eosioToken,
    'transfer'
  );
  console.log('setupPermissions 4');
  await linkauth(shared.infl, 'xfer', shared.mining, 'fill');
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
    shared.infl,
    'log',
    shared.infl,
    'logclaim'
  );
  console.log('setupPermissions 7');

  /* NEW PERMISSIONS */
  // await add_custom_permission_and_link(
  //   shared.infl,
  //   'updatemult',
  //   shared.planets,
  //   'updatemult'
  // );
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
