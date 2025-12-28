import {
  ContractDeployer,
  assertRowsEqual,
  AccountManager,
  Account,
  Contract,
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

import { Planets } from './planets';
import { SharedTestObjects } from '../TestHelpers';

let shared: SharedTestObjects;
let planets: Planets;
let anybody: Account;

describe('Planets', async () => {
  before(async () => {
    shared = await SharedTestObjects.getInstance();
    planets = shared.planets;
    anybody = await AccountManager.createAccount('anybody');

    await planets.clearplanets();
  });
  context('addplanet', async () => {
    it('should add a planet', async () => {
      const planet_name = 'earth';
      const title = 'Earth';
      const dac_symbol = '4,EOS';
      const metadata = 'Planet Earth';

      await planets.addplanet(planet_name, title, dac_symbol, metadata);

      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name,
          title,
          dac_symbol,
          metadata,
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });
    it('should add second planet', async () => {
      const planet_name = 'venus';
      const title = 'Venus';
      const dac_symbol = '4,EOS';
      const metadata = 'Planet Venus';

      await planets.addplanet(planet_name, title, dac_symbol, metadata);

      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name,
          title,
          dac_symbol,
          metadata,
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
        {
          planet_name: 'earth',
          title: 'Earth',
          dac_symbol: '4,EOS',
          metadata: 'Planet Earth',
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });
    it('should not add a planet with the same name', async () => {
      const planet_name = 'earth';
      const title = 'Earth';
      const dac_symbol = '4,EOS';
      const metadata = 'Other Earth';

      await assertEOSErrorIncludesMessage(
        planets.addplanet(planet_name, title, dac_symbol, metadata),
        'Planet already exists with this name'
      );
    });
    it('should not add a planet without proper authorization', async () => {
      const planet_name = 'mars';
      const title = 'Mars';
      const dac_symbol = '4,EOS';
      const metadata = 'Planet Mars';

      await assertMissingAuthority(
        planets.addplanet(planet_name, title, dac_symbol, metadata, {
          from: anybody,
        })
      );
    });
  });
  context('updateplanet', async () => {
    it('should update a planet', async () => {
      const planet_name = 'earth';
      const new_title = 'New Earth';
      const new_metadata = 'Updated Planet Earth';
      const new_active = false;

      await planets.updateplanet(
        planet_name,
        new_title,
        new_metadata,
        new_active
      );

      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name,
          title: new_title,
          dac_symbol: '4,EOS',
          metadata: new_metadata,
          active: new_active,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
        {
          planet_name: 'venus',
          title: 'Venus',
          dac_symbol: '4,EOS',
          metadata: 'Planet Venus',
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });

    it('should not update a non-existent planet', async () => {
      const planet_name = 'nonexistent';
      const title = 'Non-existent';
      const metadata = 'Non-existent Planet';
      const active = false;

      await assertEOSErrorIncludesMessage(
        planets.updateplanet(planet_name, title, metadata, active),
        ERR_PLANET_DOES_NOT_EXIST
      );
    });

    it('should not update a planet without proper authorization', async () => {
      const planet_name = 'earth';
      const title = 'Unauthorized';
      const metadata = 'Unauthorized Update';
      const active = false;

      await assertMissingAuthority(
        planets.updateplanet(planet_name, title, metadata, active, {
          from: anybody,
        })
      );
    });
  });
  context('removeplanet', async () => {
    it('should remove a planet', async () => {
      const planet_name = 'earth';

      await planets.removeplanet(planet_name);

      await assertRowCount(planets.planetsTable(), 1);
      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name: 'venus',
          title: 'Venus',
          dac_symbol: '4,EOS',
          metadata: 'Planet Venus',
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });

    it('should not remove a non-existent planet', async () => {
      const planet_name = 'nonexistent';

      await assertEOSErrorIncludesMessage(
        planets.removeplanet(planet_name),
        ERR_PLANET_DOES_NOT_EXIST
      );
    });

    it('should not remove a planet without proper authorization', async () => {
      const planet_name = 'venus';

      await assertMissingAuthority(
        planets.removeplanet(planet_name, { from: anybody })
      );
    });
  });
  context('clearplanets', async () => {
    it('should clear all planets', async () => {
      // Add two planets
      await planets.addplanet('mars', 'Mars', '4,EOS', 'Planet Mars');
      await planets.addplanet('jupiter', 'Jupiter', '4,EOS', 'Planet Jupiter');

      // Clear all planets
      await planets.clearplanets();

      // Check if the planets table is empty
      await assertRowCount(planets.planetsTable(), 0);
    });

    it('should not clear planets without proper authorization', async () => {
      // Add a planet
      await planets.addplanet('saturn', 'Saturn', '4,EOS', 'Planet Saturn');

      // Attempt to clear planets without proper authorization
      await assertMissingAuthority(planets.clearplanets({ from: anybody }));

      // Check if the planet still exists
      await assertRowCount(planets.planetsTable(), 1);
    });
  });
  context('setmap', async () => {
    it('should set a map for a planet', async () => {
      const planet_name = 'venus';
      const x = 10;
      const y = 20;
      const asset_id = 12345;

      await planets.addplanet(planet_name, 'Venus', '4,EOS', 'Planet Venus');
      await planets.setmap(planet_name, x, y, asset_id);

      await assertRowsEqual(planets.mapsTable({ scope: planet_name }), [
        {
          x,
          y,
          asset_id,
        },
      ]);
    });

    it('should not set a map for a non-existent planet', async () => {
      const planet_name = 'nonexistent';
      const x = 10;
      const y = 20;
      const asset_id = 12345;

      await assertEOSErrorIncludesMessage(
        planets.setmap(planet_name, x, y, asset_id),
        ERR_PLANET_DOES_NOT_EXIST
      );
    });

    it('should not set a map without proper authorization', async () => {
      const planet_name = 'earth';
      const x = 10;
      const y = 20;
      const asset_id = 12345;

      await assertMissingAuthority(
        planets.setmap(planet_name, x, y, asset_id, { from: anybody })
      );
    });
  });
  context('clearmap', async () => {
    it('should clear the map for a planet', async () => {
      const planet_name = 'venus';

      // Add a map entry to the planet
      const x = 11;
      const y = 21;
      const asset_id = 12346;
      await planets.setmap(planet_name, x, y, asset_id);

      // Clear the map
      await planets.clearmap(planet_name);

      // Check if the map is empty
      await assertRowCount(planets.mapsTable({ scope: planet_name }), 0);
    });

    it('should not clear the map for a non-existent planet', async () => {
      const planet_name = 'nonexistent';

      await assertEOSErrorIncludesMessage(
        planets.clearmap(planet_name),
        ERR_PLANET_DOES_NOT_EXIST
      );
    });

    it('should not clear the map without proper authorization', async () => {
      const planet_name = 'venus';

      await assertMissingAuthority(
        planets.clearmap(planet_name, { from: anybody })
      );
    });
  });

  context('updatestake', async () => {
    it('should update the total_stake for a planet', async () => {
      // Clear all planets
      await planets.clearplanets();

      // Add two planets
      await planets.addplanet('mars', 'Mars', '4,EOS', 'Planet Mars');
      await planets.addplanet('jupiter', 'Jupiter', '4,EOS', 'Planet Jupiter');

      const planet_name = 'mars';
      //   const stake = new Asset(1000, '4,EOS');
      const stake = '1000.0000 EOS';

      await planets.updatestake(planet_name, stake);

      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name,
          title: 'Mars',
          dac_symbol: '4,EOS',
          metadata: 'Planet Mars',
          active: true,
          total_stake: 10000000,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
        {
          planet_name: 'jupiter',
          title: 'Jupiter',
          dac_symbol: '4,EOS',
          metadata: 'Planet Jupiter',
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });

    it('should update the total_stake with a negative stake', async () => {
      const planet_name = 'mars';
      const stake = '-500.0000 EOS';

      await planets.updatestake(planet_name, stake);

      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name,
          title: 'Mars',
          dac_symbol: '4,EOS',
          metadata: 'Planet Mars',
          active: true,
          total_stake: 5000000,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
        {
          planet_name: 'jupiter',
          title: 'Jupiter',
          dac_symbol: '4,EOS',
          metadata: 'Planet Jupiter',
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });
    it('should not update the total_stake with a stake greater than the current total_stake', async () => {
      const planet_name = 'mars';
      const stake = '-6000.0000 EOS';

      await assertEOSErrorIncludesMessage(
        planets.updatestake(planet_name, stake),
        'Trying to refund more than was staked on planet'
      );

      await assertRowsEqual(planets.planetsTable(), [
        {
          planet_name,
          title: 'Mars',
          dac_symbol: '4,EOS',
          metadata: 'Planet Mars',
          active: true,
          total_stake: 5000000,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
        {
          planet_name: 'jupiter',
          title: 'Jupiter',
          dac_symbol: '4,EOS',
          metadata: 'Planet Jupiter',
          active: true,
          total_stake: 0,
          nft_multiplier: 0,
          last_claim: new Date(0),
        },
      ]);
    });

    it('should not update the total_stake for a non-existent planet', async () => {
      const planet_name = 'nonexistent';
      const stake = '1000.0000 EOS';

      await assertEOSErrorIncludesMessage(
        planets.updatestake(planet_name, stake),
        ERR_PLANET_DOES_NOT_EXIST
      );
    });

    it('should not update the total_stake without proper authorization', async () => {
      const planet_name = 'mars';
      const stake = '1000.0000 EOS';

      await assertMissingAuthority(
        planets.updatestake(planet_name, stake, { from: anybody })
      );
    });
  });
  describe('updatemult', function () {
    it('should update the multiplier for a valid planet', async function () {
      await planets.updatemult('mars', 235);
      const planet = await planets.planetsTable();
      const mars = planet.rows.find((x) => x.planet_name == 'mars');
      chai.expect(mars.nft_multiplier).to.equal(235);
    });

    it('should fail when trying to update the multiplier with a negative value', async function () {
      await assertEOSErrorIncludesMessage(
        planets.updatemult('mars', -2),
        'Multiplier must be positive'
      );
    });

    it('should fail when trying to update the multiplier for a non-existent planet', async function () {
      await assertEOSErrorIncludesMessage(
        planets.updatemult('unknown', 2),
        ERR_PLANET_DOES_NOT_EXIST
      );
    });

    it('should fail when trying to update the multiplier without proper authorization', async function () {
      await assertMissingAuthority(
        planets.updatemult('earth', 2, { from: anybody })
      );
    });
  });
});
