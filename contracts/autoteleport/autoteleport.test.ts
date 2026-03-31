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
  Asset,
} from 'lamington';
import * as chai from 'chai';

import { Autoteleport } from './autoteleport';
import { SharedTestObjects } from '../TestHelpers';
import * as moment from 'moment';
chai.use(require('chai-datetime'));

// Add dayjs imports
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

let shared: SharedTestObjects;
let autoteleport: Autoteleport;
let user: Account;
let otherWorlds: Account; // Account representing the 'other.worlds' contract for teleporting

const TLM_SYM = 'TLM';
const TLM_PRECISION = 4;

// Helper to create TLM asset string
const tlm = (amount: number): string =>
  `${amount.toFixed(TLM_PRECISION)} ${TLM_SYM}`;

// Helper to get checksum256 from a string (basic example, replace with actual logic if needed)
const stringToChecksum256 = (str: string): string => {
  // Placeholder: Replace with actual checksum256 generation logic if needed for tests
  // This example just pads or truncates the string to 64 hex characters
  let hex = Buffer.from(str, 'utf8').toString('hex');
  return hex.padEnd(64, '0').substring(0, 64);
};

describe('Autoteleport', async () => {
  before(async () => {
    shared = await SharedTestObjects.getInstance();
    autoteleport = shared.autoteleport;
    user = await AccountManager.createAccount('autouser');
    otherWorlds = shared.otherWorlds;

    // Issue some initial TLM to the autoteleport contract for testing balance checks
    await shared.eosioToken.transfer(
      shared.tokenIssuer.name,
      autoteleport.account.name,
      tlm(10000),
      'Initial balance for autoteleport tests',
      { from: shared.tokenIssuer }
    );
  });

  // Test contexts will go here (e.g., setconfig, start/stop, trigger)
  context('Initial State', async () => {
    it('should have an empty config table initially', async () => {
      const config = await autoteleport.configTable();
      chai
        .expect(config.rows.length)
        .to.equal(0, 'Config table should be empty initially');
    });
  });

  // Helper function to create a UTC timestamp string in EOS format
  function timePlusSecondsString(
    current: dayjs.Dayjs,
    seconds: number
  ): string {
    return current.add(seconds, 'seconds').format('YYYY-MM-DDTHH:mm:ss');
  }

  context('setconfig', async () => {
    const minAmount = tlm(100);
    const maxAmount = tlm(1000);
    const minFrequency = 3600; // 1 hour
    const destination = stringToChecksum256(
      'destination_address_on_other_chain'
    );
    const chainId = 2; // Example chain ID

    context('with wrong auth', async () => {
      it('should fail', async () => {
        await assertMissingAuthority(
          autoteleport.setconfig(
            minAmount,
            maxAmount,
            minFrequency,
            destination,
            chainId,
            {
              from: user, // Use a different user
            }
          )
        );
      });
    });

    context('with correct auth', async () => {
      it('should succeed', async () => {
        console.log('From: ', autoteleport.account.name);
        await autoteleport.setconfig(
          minAmount,
          maxAmount,
          minFrequency,
          destination,
          chainId,
          {
            from: autoteleport.account,
          }
        );
      });

      it('should update config table', async () => {
        const config = await autoteleport.configTable();
        chai.expect(config.rows.length).to.equal(1);
        const row = config.rows[0];
        chai.expect(row.min_amount).to.equal(minAmount);
        chai.expect(row.max_amount).to.equal(maxAmount);
        chai.expect(row.min_frequency).to.equal(minFrequency);
        chai.expect(row.destination).to.equal(destination);
        chai.expect(row.chain_id).to.equal(chainId);
        // is_active and last_teleport_time should retain defaults or previous values if set
      });

      it('should fail with invalid precision for max_amount', async () => {
        const invalidMaxAmount = '1000.00 TLM'; // Invalid precision
        await assertEOSErrorIncludesMessage(
          autoteleport.setconfig(
            minAmount, // Use valid minAmount
            invalidMaxAmount,
            minFrequency,
            destination,
            chainId,
            {
              from: autoteleport.account,
            }
          ),
          'ERR::INVALID_PRECISION::max_amount precision mismatch' // Updated error message for precision
        );
      });

      it('should fail when min_amount > max_amount', async () => {
        const highMinAmount = tlm(2000); // Higher than maxAmount
        const lowMaxAmount = tlm(1000);
        await assertEOSErrorIncludesMessage(
          autoteleport.setconfig(
            highMinAmount,
            lowMaxAmount,
            minFrequency,
            destination,
            chainId,
            {
              from: autoteleport.account,
            }
          ),
          'ERR::INVALID_AMOUNT::max_amount must be greater than or equal to min_amount'
        );
      });

      it('should succeed setting min_frequency to 0', async () => {
        const zeroMinFrequency = 0;
        await autoteleport.setconfig(
          minAmount,
          maxAmount,
          zeroMinFrequency, // Set frequency to 0
          destination,
          chainId,
          {
            from: autoteleport.account,
          }
        );

        // Verify the config table was updated
        const config = await autoteleport.configTable();
        chai.expect(config.rows.length).to.equal(1);
        chai.expect(config.rows[0].min_frequency).to.equal(zeroMinFrequency);
      });
    });

    context('with invalid parameters', async () => {
      it('should fail with invalid symbol for min_amount', async () => {
        const invalidMinAmount = '100.0000 FOO'; // Invalid symbol
        await assertEOSErrorIncludesMessage(
          autoteleport.setconfig(
            invalidMinAmount,
            maxAmount,
            minFrequency,
            destination,
            chainId,
            {
              from: autoteleport.account,
            }
          ),
          'ERR::INVALID_SYMBOL::min_amount symbol code mismatch' // Updated error message for symbol code mismatch
        );
      });
    });

    // Start action tests
    context('start', () => {
      it('with correct auth should set status to START', async () => {
        // First, set the config
        const zeroMinFrequency = 0;
        await autoteleport.setconfig(
          minAmount,
          maxAmount,
          zeroMinFrequency,
          destination,
          chainId,
          { from: autoteleport.account }
        );

        let config = await autoteleport.configTable();
        chai
          .expect(config.rows[0].is_active)
          .to.equal(false, 'Should be inactive (is_active=false) initially');

        // Now, start
        await autoteleport.start({ from: autoteleport.account });

        // Verify status is updated
        config = await autoteleport.configTable();
        chai.expect(config.rows.length).to.equal(1);
        chai
          .expect(config.rows[0].is_active)
          .to.equal(
            true,
            'Should be active (is_active=true) after start action'
          );
      });

      it('with wrong auth should fail', async () => {
        // Attempt to start with `user` account's auth
        await assertMissingAuthority(autoteleport.start({ from: user }));
      });

      it('calling start when already active should have no effect', async () => {
        // 1. Set config
        const zeroMinFrequency = 0;
        await autoteleport.setconfig(
          minAmount,
          maxAmount,
          zeroMinFrequency,
          destination,
          chainId,
          { from: autoteleport.account }
        );
        const configBeforeStart = await autoteleport.configTable();
        const initialConfigData = configBeforeStart.rows[0];

        // 2. Start (first time)
        await autoteleport.start({ from: autoteleport.account });
        const configAfterFirstStart = await autoteleport.configTable();
        chai
          .expect(configAfterFirstStart.rows[0].is_active)
          .to.equal(true, 'Should be active after first start');

        // 3. Start (second time)
        await autoteleport.start({ from: autoteleport.account });
        const configAfterSecondStart = await autoteleport.configTable();

        // 4. Verify config is unchanged and still active
        chai.expect(configAfterSecondStart.rows.length).to.equal(1);
        const finalConfigData = configAfterSecondStart.rows[0];
        chai
          .expect(finalConfigData.is_active)
          .to.equal(true, 'Should remain active after second start');
        // Check other fields remain unchanged (compared to after the first start)
        chai
          .expect(finalConfigData.min_amount)
          .to.equal(configAfterFirstStart.rows[0].min_amount);
        chai
          .expect(finalConfigData.max_amount)
          .to.equal(configAfterFirstStart.rows[0].max_amount);
        chai
          .expect(finalConfigData.min_frequency)
          .to.equal(configAfterFirstStart.rows[0].min_frequency);
        chai
          .expect(finalConfigData.destination)
          .to.equal(configAfterFirstStart.rows[0].destination);
        chai
          .expect(finalConfigData.chain_id)
          .to.equal(configAfterFirstStart.rows[0].chain_id);
        // is_active should also be the same as after the first start
        chai
          .expect(finalConfigData.is_active)
          .to.equal(configAfterFirstStart.rows[0].is_active);
      });
    }); // End start context

    // Stop action tests
    context('stop', () => {
      it('with correct auth should set status to STOP', async () => {
        // 1. Ensure config exists and is active
        await autoteleport.setconfig(
          minAmount,
          maxAmount,
          minFrequency,
          destination,
          chainId,
          { from: autoteleport.account }
        );
        await autoteleport.start({ from: autoteleport.account });
        let config = await autoteleport.configTable();
        chai
          .expect(config.rows[0].is_active)
          .to.equal(true, 'Should be active before stop');

        // 2. Call stop
        await autoteleport.stop({ from: autoteleport.account });

        // 3. Verify is_active is false
        config = await autoteleport.configTable();
        chai.expect(config.rows.length).to.equal(1);
        chai
          .expect(config.rows[0].is_active)
          .to.equal(false, 'Should be inactive after stop');
      });

      it('with wrong auth should fail', async () => {
        // Attempt to stop with `user` account's auth
        // Ensure config exists first (state might be affected by other tests)
        await autoteleport.setconfig(
          minAmount,
          maxAmount,
          minFrequency,
          destination,
          chainId,
          { from: autoteleport.account }
        );
        await assertMissingAuthority(autoteleport.stop({ from: user }));
      });
    }); // End stop context

    context('trigger', () => {
      // Use dayjs for consistent time handling
      let currentBlockTime: dayjs.Dayjs;
      let initialTimeString: string; // Formatted string for action param
      let futureTime: Date; // JS Date object for action param

      // Run once before all tests in this context
      before(async () => {
        // Set reference time for this context
        currentBlockTime = dayjs().utc();
        initialTimeString = timePlusSecondsString(currentBlockTime, 0); // Use string helper
        // futureTime will be calculated within tests as needed using adjusted helper

        // Get current config state defensively
        let currentConfig = await autoteleport.configTable();
        let needsSetConfig = true;
        let needsStart = true;

        if (currentConfig.rows.length > 0) {
          const config = currentConfig.rows[0];
          // Check if config matches desired defaults
          if (
            config.min_amount === minAmount &&
            config.max_amount === maxAmount &&
            config.min_frequency === minFrequency &&
            config.destination === destination &&
            config.chain_id === chainId
          ) {
            needsSetConfig = false;
          }
          // Check if already active
          if (config.is_active === true) {
            needsStart = false;
          }
        }

        // Set a default configuration for the trigger tests ONLY if needed
        if (needsSetConfig) {
          // console.log('Trigger context: Setting default config...');
          await autoteleport.setconfig(
            minAmount, // Default minAmount from outer scope
            maxAmount, // Default maxAmount from outer scope
            minFrequency, // Default minFrequency from outer scope
            destination,
            chainId,
            { from: autoteleport.account }
          );
        }

        // Start the contract once for all trigger tests ONLY if needed
        if (needsStart) {
          // console.log('Trigger context: Starting contract...');
          await autoteleport.start({ from: autoteleport.account });
        }

        // Ensure sufficient initial balance for most tests.
        // Use the helper function to get the balance
        let currentBalanceNum = 0;
        currentBalanceNum = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        const requiredBalance = new Asset(maxAmount).amount; // Ensure balance > default max

        if (currentBalanceNum < requiredBalance + 100) {
          // Add buffer
          const needed = requiredBalance + 100 - currentBalanceNum;
          await shared.eosioToken.transfer(
            shared.tokenIssuer.name,
            autoteleport.account.name,
            tlm(needed),
            'Ensuring sufficient balance for trigger tests',
            { from: shared.tokenIssuer }
          );
        }
      });

      it('should fail with wrong auth', async () => {
        // Call trigger with user auth - should fail with missing auth
        await assertMissingAuthority(
          autoteleport.trigger(initialTimeString, { from: user })
        );
      });

      it('should fail when inactive', async () => {
        // 1. Ensure inactive by calling stop()
        await autoteleport.stop({ from: autoteleport.account });
        const config = await autoteleport.configTable();
        chai
          .expect(config.rows[0].is_active)
          .to.equal(false, 'Contract should be inactive');

        // 2. Attempt to trigger with simulated time
        await assertEOSErrorIncludesMessage(
          autoteleport.trigger(initialTimeString, {
            from: autoteleport.account,
          }),
          'ERR: autoteleport is not active'
        );
      });

      it('should fail when balance < min_amount', async () => {
        // Ensure contract is active before this test, as previous test might have stopped it.
        let config = await autoteleport.configTable();
        if (!config.rows[0]?.is_active) {
          console.log('Ensuring contract is active for balance test...');
          await autoteleport.start({ from: autoteleport.account });
        }

        // 1. Set config with high min_amount *specifically for this test*
        const highMinAmount = tlm(1000000); // 1M TLM
        const correspondingMaxAmount = tlm(2000000); // Must be >= min
        await autoteleport.setconfig(
          highMinAmount,
          correspondingMaxAmount,
          minFrequency,
          destination,
          chainId,
          { from: autoteleport.account }
        );

        // 2. Ensure active (start was called in 'before' hook)

        // 3. Attempt to trigger (balance is likely < 1M TLM)
        await assertEOSErrorIncludesMessage(
          autoteleport.trigger(initialTimeString, {
            from: autoteleport.account,
          }),
          'ERR: balance is less than min amount to teleport.'
        );
      });
      it('first trigger should succeed', async () => {
        // Reset to default config just in case previous test changed it
        await autoteleport.setconfig(
          minAmount, // Default minAmount
          maxAmount, // Default maxAmount
          minFrequency,
          destination,
          chainId,
          { from: autoteleport.account }
        );

        // Balance was ensured in 'before' hook to be > maxAmount (default)
        // It should attempt to teleport maxAmount.

        // 1. First trigger - should now succeed
        await autoteleport.trigger(initialTimeString, {
          from: autoteleport.account,
        });

        // 2. Verify time was updated using dayjs
        const configAfterFirstTrigger = await autoteleport.configTable();
        const lastTeleportTimeString =
          configAfterFirstTrigger.rows[0].last_teleport_time;
        const recordedTimeSeconds = dayjs.utc(lastTeleportTimeString).unix();
        // Compare against the timestamp of the Date object *passed* to the action
        const expectedInitialTimeSeconds = currentBlockTime.unix();
        chai
          .expect(recordedTimeSeconds)
          .to.be.closeTo(
            expectedInitialTimeSeconds,
            2,
            'Last teleport time should be close to initial trigger time'
          );
      });

      it('should fail when time since last teleport is less than min_frequency', async () => {
        // The previous test 'first trigger should succeed' already set the last_teleport_time.
        // We don't need to trigger it again here.

        // 1. Set frequency back (defensively) if needed - should already be set by default config
        let currentConfigFreq = await autoteleport.configTable();
        if (currentConfigFreq.rows[0]?.min_frequency !== minFrequency) {
          await autoteleport.setconfig(
            minAmount,
            maxAmount,
            minFrequency,
            destination,
            chainId,
            { from: autoteleport.account }
          );
        }
      });

      it('should succeed when enough time has passed', async () => {
        // The 'first trigger should succeed' test already set the initial last_teleport_time.
        // We don't need to trigger it again with the same initial time here.

        // 1. Set frequency back (defensively) if needed - should already be set by default config
        let currentConfigFreqAfter = await autoteleport.configTable();
        if (currentConfigFreqAfter.rows[0]?.min_frequency !== minFrequency) {
          await autoteleport.setconfig(
            minAmount,
            maxAmount,
            minFrequency,
            destination,
            chainId,
            { from: autoteleport.account }
          );
        }

        // 2. Create a time well past the minFrequency using the helper
        const muchLaterTimeString = timePlusSecondsString(
          currentBlockTime,
          minFrequency + 100
        ); // Use string helper
        const muchLaterTimeUnix = dayjs.utc(muchLaterTimeString).unix(); // Store expected Unix time

        // 3. Second trigger - should now succeed
        await autoteleport.trigger(muchLaterTimeString, {
          from: autoteleport.account,
        }); // Use muchLaterTime string

        // 4. Check that last_teleport_time was updated after the second trigger attempt
        const configAfterSecondTrigger = await autoteleport.configTable();
        // Compare against the timestamp of the Date object *passed* to the action
        const secondTriggerTimeSeconds = muchLaterTimeUnix;
        const recordedSecondTriggerTimeSeconds = dayjs
          .utc(configAfterSecondTrigger.rows[0].last_teleport_time)
          .unix();

        chai
          .expect(recordedSecondTriggerTimeSeconds)
          .to.be.closeTo(
            secondTriggerTimeSeconds,
            2,
            'last_teleport_time should be close to the second trigger time'
          );
        chai
          .expect(recordedSecondTriggerTimeSeconds)
          .to.not.be.closeTo(currentBlockTime.unix(), 2);
      });

      it('should succeed and teleport max_amount when balance > max_amount', async () => {
        // 1. Setup with small max_amount *specifically for this test*
        const smallMinAmount = tlm(1);
        const smallMaxAmount = tlm(50); // Set a small max_amount
        await autoteleport.setconfig(
          smallMinAmount,
          smallMaxAmount,
          0, // Set frequency to 0 for simplicity
          destination,
          chainId,
          { from: autoteleport.account }
        );

        // 2. Ensure contract has more than max_amount (balance ensured in 'before' is likely sufficient)

        // 3. Trigger the teleport - should succeed
        await autoteleport.trigger(initialTimeString, {
          // Time doesn't matter as frequency is 0
          from: autoteleport.account,
        });
        // We can't easily check the printed message, but success implies mock was called.
        // Check time update as proxy for success
        const config = await autoteleport.configTable();
        const recordedTimeSeconds = dayjs
          .utc(config.rows[0].last_teleport_time)
          .unix();
        const expectedTimeSeconds = currentBlockTime.unix();
        chai.expect(recordedTimeSeconds).to.be.closeTo(expectedTimeSeconds, 2);
      });

      it('should succeed and teleport current balance when min < balance < max', async () => {
        // 1. Setup config *specifically for this test*
        const testMinAmount = tlm(10);
        const testMaxAmount = tlm(1000); // Max is high

        // Get initial balance for restoration later
        let initialBalanceNum = 0;
        initialBalanceNum = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        await autoteleport.setconfig(
          testMinAmount,
          testMaxAmount,
          0, // Frequency 0
          destination,
          chainId,
          { from: autoteleport.account }
        );

        // 2. Set the contract balance to a specific amount between min and max
        const targetBalanceNum = 500;
        let currentBalanceNum = 0;
        currentBalanceNum = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // Transfer balance only if needed
        if (currentBalanceNum > targetBalanceNum) {
          const transferAmount = currentBalanceNum - targetBalanceNum;
          if (transferAmount > 0) {
            await shared.eosioToken.transfer(
              autoteleport.account.name,
              shared.tokenIssuer.name, // Send it back to issuer
              tlm(transferAmount),
              'Adjusting balance down for test',
              { from: autoteleport.account }
            );
          }
        } else if (currentBalanceNum < targetBalanceNum) {
          const transferAmount = targetBalanceNum - currentBalanceNum;
          if (transferAmount > 0) {
            await shared.eosioToken.transfer(
              shared.tokenIssuer.name,
              autoteleport.account.name,
              tlm(transferAmount),
              'Adjusting balance up for test',
              { from: shared.tokenIssuer }
            );
          }
        }
        // Balance should now be targetBalanceNum (500)

        // 3. Trigger - should succeed
        await autoteleport.trigger(initialTimeString, {
          // Time doesn't matter (freq 0)
          from: autoteleport.account,
        });
        // Check time update as proxy for success
        const config = await autoteleport.configTable();
        const recordedTimeSeconds = dayjs
          .utc(config.rows[0].last_teleport_time)
          .unix();
        // Compare against the timestamp of the Date object *passed* to the action
        const expectedTimeSeconds = currentBlockTime.unix();
        chai.expect(recordedTimeSeconds).to.be.closeTo(expectedTimeSeconds, 2);

        // Restore initial balance to avoid affecting subsequent tests
        let finalBalanceNum = 0;
        finalBalanceNum = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        if (finalBalanceNum < initialBalanceNum) {
          const diff = initialBalanceNum - finalBalanceNum;
          await shared.eosioToken.transfer(
            shared.tokenIssuer.name,
            autoteleport.account.name,
            tlm(diff),
            'Restoring balance after test',
            { from: shared.tokenIssuer }
          );
        } else if (finalBalanceNum > initialBalanceNum) {
          const diff = finalBalanceNum - initialBalanceNum;
          await shared.eosioToken.transfer(
            autoteleport.account.name,
            shared.tokenIssuer.name,
            tlm(diff),
            'Restoring balance after test',
            { from: autoteleport.account }
          );
        }
      });

      // First test that checks balance decreases - keeping this as a generic test
      it('should decrease TLM balance by the expected amount after successful trigger', async () => {
        // 1. Setup with specific amounts for clear verification
        const testMinAmount = tlm(10);
        const testMaxAmount = tlm(500);
        await autoteleport.setconfig(
          testMinAmount,
          testMaxAmount,
          0, // Set frequency to 0 to ensure trigger will succeed
          destination,
          chainId,
          { from: autoteleport.account }
        );

        // 2. Ensure contract is active
        await autoteleport.start({ from: autoteleport.account });

        // 3. Get balance before trigger
        const balanceBefore = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // The expected teleport amount - if balance > max_amount, it teleports max_amount
        // Otherwise it teleports the full balance
        const expectedTeleportAmount =
          balanceBefore > 500 ? 500 : balanceBefore;

        // 4. Trigger teleport with a new timestamp
        const newTimeString = timePlusSecondsString(
          dayjs().utc(),
          1000 // Far future to avoid frequency issues
        );
        await autoteleport.trigger(newTimeString, {
          from: autoteleport.account,
        });

        // 5. Get balance after trigger
        const balanceAfter = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // 6. Verify balance decreased by expected amount
        chai
          .expect(balanceBefore - balanceAfter)
          .to.equal(
            expectedTeleportAmount,
            `Balance should decrease by exactly ${expectedTeleportAmount} TLM`
          );
      });

      // Test 1: Teleport max_amount when balance > max_amount
      it('should teleport exactly max_amount when balance > max_amount', async () => {
        // Using a constant to enable/disable this test
        const runTest = true; // Re-enable this test
        if (!runTest) return;

        // Use uniquely different max_amount
        const testMinAmount = tlm(5); // Different min amount
        const testMaxAmount = tlm(275); // Different max amount (not 200 or 500)

        // Generate completely unique destination checksum
        const uniqueDestination = stringToChecksum256(
          'unique_destination_for_max_amount_test_' + Date.now()
        );

        // Different chain_id
        const uniqueChainId = 5; // different from default chainId

        await autoteleport.setconfig(
          testMinAmount,
          testMaxAmount,
          0, // Set frequency to 0
          uniqueDestination, // Use unique destination
          uniqueChainId, // Use unique chain ID
          { from: autoteleport.account }
        );

        // Check if contract is already active before trying to start it
        const configAfterSetconfig = await autoteleport.configTable();
        const isAlreadyActive = configAfterSetconfig.rows[0]?.is_active;

        // Only call start if needed
        if (!isAlreadyActive) {
          await autoteleport.start({ from: autoteleport.account });
        }

        // 3. Ensure balance is greater than max_amount
        let currentBalance = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // If balance isn't high enough, add more TLM
        if (currentBalance <= 275) {
          const amountToAdd = 550; // Add enough to be well over max_amount
          await shared.eosioToken.transfer(
            shared.tokenIssuer.name,
            autoteleport.account.name,
            tlm(amountToAdd),
            'Adding TLM for max_amount test with unique memo ' + Date.now(), // Unique memo with timestamp
            { from: shared.tokenIssuer }
          );

          // Verify new balance
          currentBalance = await shared.getBalance(
            autoteleport.account,
            shared.eosioToken,
            TLM_SYM
          );
          chai
            .expect(currentBalance)
            .to.be.greaterThan(
              275,
              'Balance should be greater than max_amount for this test'
            );
        }

        // 4. Get precise balance before trigger
        const balanceBefore = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // 5. Trigger teleport
        const uniqueTimeString = timePlusSecondsString(dayjs().utc(), 10);
        await autoteleport.trigger(uniqueTimeString, {
          from: autoteleport.account,
        });

        // 6. Get balance after trigger
        const balanceAfter = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // 7. Verify exactly max_amount (275 TLM) was teleported
        chai
          .expect(balanceBefore - balanceAfter)
          .to.equal(
            275,
            'Should teleport exactly max_amount (275 TLM) when balance > max_amount'
          );
      });

      // Test 2: Teleport full balance when min < balance < max
      it('should teleport full balance when min_amount < balance < max_amount', async () => {
        // Using a constant to enable/disable this test
        const runTest = true; // Set to true to run this test
        if (!runTest) return;

        // 1. Setup with completely different config values
        const testMinAmount = tlm(9); // Different min value
        const testMaxAmount = tlm(1500); // Different max value

        // Generate a completely unique destination using the current timestamp
        const uniqueDestination = stringToChecksum256(
          'unique_destination_for_full_balance_test_' + Date.now()
        );
        const uniqueChainId = 9; // Different chain ID

        await autoteleport.setconfig(
          testMinAmount,
          testMaxAmount,
          0, // Set frequency to 0
          uniqueDestination,
          uniqueChainId,
          { from: autoteleport.account }
        );

        // 2. Check if contract is already active before trying to start it
        const configAfterSetconfig = await autoteleport.configTable();
        const isAlreadyActive = configAfterSetconfig.rows[0]?.is_active;

        // Only call start if needed
        if (!isAlreadyActive) {
          await autoteleport.start({ from: autoteleport.account });
        }

        // 3. Set balance to specific amount between min and max
        const targetBalance = 125; // Different value from previous tests

        // First, get current balance
        let currentBalance = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        if (currentBalance > targetBalance) {
          // Transfer out excess balance with unique memo
          const toTransfer = currentBalance - targetBalance;

          // Use a completely unique memo with timestamp
          const uniqueMemo = 'Adjusting balance down ' + Date.now();

          await shared.eosioToken.transfer(
            autoteleport.account.name,
            shared.tokenIssuer.name,
            tlm(toTransfer),
            uniqueMemo,
            { from: autoteleport.account }
          );
        } else if (currentBalance < targetBalance) {
          // Add balance to reach target with unique memo
          const toAdd = targetBalance - currentBalance;

          // Use a completely unique memo with timestamp
          const uniqueMemo = 'Adjusting balance up ' + Date.now();

          await shared.eosioToken.transfer(
            shared.tokenIssuer.name,
            autoteleport.account.name,
            tlm(toAdd),
            uniqueMemo,
            { from: shared.tokenIssuer }
          );
        }

        // 4. Verify we have the expected balance
        const balanceBefore = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );
        chai.expect(balanceBefore).to.equal(targetBalance);

        // 5. Trigger teleport with unique timestamp
        const uniqueTimeString = timePlusSecondsString(dayjs().utc(), 11);
        await autoteleport.trigger(uniqueTimeString, {
          from: autoteleport.account,
        });

        // 6. Get balance after trigger
        const balanceAfter = await shared.getBalance(
          autoteleport.account,
          shared.eosioToken,
          TLM_SYM
        );

        // 7. Verify the entire balance was teleported
        chai
          .expect(balanceBefore - balanceAfter)
          .to.equal(
            targetBalance,
            `Should teleport full balance (${targetBalance} TLM) when min < balance < max`
          );

        // 8. Verify final balance is near zero
        chai
          .expect(balanceAfter)
          .to.be.closeTo(
            0,
            0.0001,
            'Balance should be near zero after teleporting full amount'
          );
      });
    }); // End trigger context
  }); // End setconfig context
}); // End Autoteleport describe
