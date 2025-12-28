import { expect } from 'chai';
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
} from 'lamington';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
// chai.use(chaiAsPromised);

import { parseMineLucksIntoTickets } from './daemon_new';

describe('buildTickets', () => {
  context('with no results from mineluck', async () => {
    it('should return empty array', async () => {
      const [ticket1, ticket2] = await parseMineLucksIntoTickets([]);
      expect(ticket1.number_winners).to.equal(321);
      expect(ticket2.number_winners).to.equal(20);
      expect(ticket1.total_luck).equal(0);
      expect(ticket2.total_luck).equal(0);
    });
  });
});
