import {
  Account,
  sleep,
  assertMissingAuthority,
  assertEOSErrorIncludesMessage,
  AccountManager,
  UpdateAuth,
  Asset,
  EOSManager,
} from 'lamington';
import { SharedTestObjects } from '../TestHelpers';
import {
  Tokelore,
  TokeloreVoterInfo,
  TokeloreGlobalsItem,
  TokeloreVoterInfo2,
  TokeloreGlobalsItem2,
} from './tokelore';
import * as chai from 'chai';

let shared: SharedTestObjects;
let tokeLore: Tokelore;

let user1: Account;
let user2: Account;
let voter1: Account;
let voter2: Account;

const seconds = 1;
const minutes = 60 * seconds;
let TOKELORE_TEMPLATE_ID;
const TOKELORE_SCHEMA = 'lore.worlds';
let planet: Account;
let proposal_id: number = 1;
let executedProposalId: number | undefined;

const POWER_PER_DAY = '0.0864 VP'; // 0.01 per second

describe('TokeLore', async () => {
  let voterCheck: VoterCheck;
  let globalsCheck: GlobalsCheck;
  let collection = '';

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    collection = shared.NFT_COLLECTION;

    tokeLore = shared.tokeLore;
    user1 = await AccountManager.createAccount('user1');
    user2 = await AccountManager.createAccount('user2');
    voter1 = await AccountManager.createAccount('voter1');
    voter2 = await AccountManager.createAccount('voter2');

    await configureAuths();
    // await linkPermissions();

    await shared.eosioToken.transfer(
      shared.tokenIssuer.name,
      user1.name,
      '10000.0000 TLM',
      'for staking',
      { from: shared.tokenIssuer }
    );
    await shared.eosioToken.transfer(
      shared.tokenIssuer.name,
      user2.name,
      '10000.0000 TLM',
      'for staking',
      { from: shared.tokenIssuer }
    );
    await shared.eosioToken.transfer(
      shared.tokenIssuer.name,
      voter1.name,
      '10000.0000 TLM',
      'for staking',
      { from: shared.tokenIssuer }
    );
    await shared.eosioToken.transfer(
      shared.tokenIssuer.name,
      voter2.name,
      '10000.0000 TLM',
      'for staking',
      { from: shared.tokenIssuer }
    );

    await shared.atomicassets.createschema(
      tokeLore.account.name,
      collection,
      TOKELORE_SCHEMA,
      [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'attr1', type: 'string' },
        { name: 'img', type: 'image' },
        { name: 'backimg', type: 'image' },
      ],
      { from: tokeLore.account }
    );

    await shared.atomicassets.createtempl(
      tokeLore.account.name,
      collection,
      TOKELORE_SCHEMA,
      true,
      true,
      100,
      [{ key: 'name', value: ['string', 'Lore'] }],
      { from: tokeLore.account }
    );
    TOKELORE_TEMPLATE_ID = await shared.getTemplateId(
      TOKELORE_SCHEMA,
      'Lore',
      collection
    );

    // There is no way to set a specific template id, so the only way is to create it and then
    // search the table for the value. The smart contract needs to know the id though, so we have
    // to check what the value is and hard-code it in the smart code.
    // chai.expect(TOKELORE_TEMPLATE_ID).to.equal(8);
    console.log('TOKELORE_TEMPLATE_ID: ', TOKELORE_TEMPLATE_ID);
    await tokeLore.settemplid(TOKELORE_TEMPLATE_ID);

    const ART_COLLECTION = 'art.worlds';
    const artWorldsAccount = await AccountManager.createAccount(ART_COLLECTION);

    await shared.atomicassets.createcol(
      artWorldsAccount.name, // author
      ART_COLLECTION, // collection_name
      true, // allow_notify
      [tokeLore.account.name, artWorldsAccount.name], // authorised accounts
      [], // notify accounts
      '0.01', // market fee – arbitrary
      '', // data
      { from: artWorldsAccount }
    );
    console.log('Created collection art.worlds');

    await shared.atomicassets.createschema(
      artWorldsAccount.name, // authorized_creator
      ART_COLLECTION,
      TOKELORE_SCHEMA,
      [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'attr1', type: 'string' },
        { name: 'img', type: 'image' },
        { name: 'backimg', type: 'image' },
      ],
      { from: artWorldsAccount }
    );
    console.log('Created schema lore.worlds in art.worlds collection');
  });

  context('updateconfig', async () => {
    it('should update config', async () => {
      await tokeLore.updateconfig(
        {
          duration: 60,
          fee: '10.0000 TLM',
          pass_percent_x100: 5500,
          quorum_percent_x100: 5499,
        },
        { from: tokeLore.account }
      );
    });
    it('should have updated the globals table', async () => {
      const globals = (await tokeLore.globals2Table()).rows[0];
      chai.expect(globals.duration).to.equal(60);
      chai.expect(globals.fee).to.equal('10.0000 TLM');
      chai.expect(globals.pass_percent_x100).to.equal(5500);
      chai.expect(globals.quorum_percent_x100).to.equal(5499);
      chai.expect(globals.power_per_day).to.equal('0.0000 VP');
    });
  });

  context('set power per day', async () => {
    it('should set power per day', async () => {
      await tokeLore.setpperday(
        POWER_PER_DAY, // 0.01 per second
        { from: tokeLore.account }
      );
    });
    it('should have updated the globals table', async () => {
      const globals = (await tokeLore.globals2Table()).rows[0];
      chai.expect(globals.duration).to.equal(60);
      chai.expect(globals.fee).to.equal('10.0000 TLM');
      chai.expect(globals.pass_percent_x100).to.equal(5500);
      chai.expect(globals.quorum_percent_x100).to.equal(5499);
      chai.expect(globals.power_per_day).to.equal(POWER_PER_DAY); // This should be the only change
    });
  });

  context('stake', async () => {
    it('should stake', async () => {
      await shared.eosioToken.transfer(
        user1.name,
        tokeLore.account.name,
        '100.0000 TLM',
        'for staking',
        { from: user1 }
      );
      await tokeLore.stake(user1.name, { from: user1 });
    });
    it('should have 100 staked in voters table', async () => {
      const staked = (await tokeLore.voters2Table()).rows[0];
      chai.expect(staked.vote_power).to.equal('0.0000 VP');
      chai.expect(staked.staked_amount).to.equal('100.0000 TLM');
      chai.expect(staked.voter).to.equal('user1');
    });
    it('should have updated the globals table with staking', async () => {
      const globals = (await tokeLore.globals2Table()).rows[0];
      chai.expect(globals.total_staked).to.equal('100.0000 TLM');
      chai.expect(globals.total_vote_power).to.equal('0.0000 VP');
    });
    it('check total vote integrity', async () => {
      await checkTotalVotePowerMatchesGlobalVotePower();
    });
  });

  context('propose', () => {
    context('with insufficient deposit', async () => {
      before(async () => {
        await shared.eosioToken.transfer(
          user1.name,
          tokeLore.account.name,
          '1.0000 TLM',
          'for staking',
          { from: user1 }
        );
      });
      it('should fail with fee error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.propose(
            proposal_id,
            user1.name,
            'title',
            'proptype1',
            [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
            { from: user1 }
          ),
          'INSUFFICIENT_FEE'
        );
      });
    });
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.propose(
            proposal_id,
            user1.name,
            'title',
            'proptype1',
            [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
            { from: user2 }
          )
        );
      });
    });
    context('With correct auth and enough deposit', async () => {
      it('should propose', async () => {
        await shared.eosioToken.transfer(
          user1.name,
          tokeLore.account.name,
          '10.0000 TLM',
          'for staking',
          { from: user1 }
        );
        await tokeLore.propose(
          ++proposal_id,
          user1.name,
          'title',
          'proptype1',
          [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
          { from: user1 }
        );
      });
      it('should have 1 proposal', async () => {
        const tokeLoreProp = (await tokeLore.tokeloresTable()).rows[0];
        chai.expect(tokeLoreProp.proposal_id).to.equal(proposal_id);
        chai.expect(tokeLoreProp.proposer).to.equal(user1.name);
        chai.expect(tokeLoreProp.title).to.equal('title');
        chai.expect(tokeLoreProp.type).to.equal('proptype1');
        chai.expect(tokeLoreProp.attributes[0].key).to.equal('attr1');
        chai.expect(tokeLoreProp.attributes[0].value[1]).to.equal('sdfsdfsdf');
        chai.expect(tokeLoreProp.status).to.equal('open');
        chai.expect(tokeLoreProp.total_yes_votes).to.equal('0.0000 VP');
        chai.expect(tokeLoreProp.total_no_votes).to.equal('0.0000 VP');
        chai
          .expect(tokeLoreProp.expires)
          .to.be.greaterThan(new Date(Date.now()));
      });
    });
  });

  context('voting', async () => {
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.vote(user1.name, proposal_id, 'yes', '0.1000 VP', {
            from: user2,
          })
        );
      });
    });
    context('with correct auth voting yes', async () => {
      before(async () => {
        voterCheck = new VoterCheck(user1.name);
        globalsCheck = new GlobalsCheck();
        await voterCheck.capture();
        await globalsCheck.capture();
      });

      it('should vote', async () => {
        await tokeLore.vote(user1.name, proposal_id, 'yes', '0.0002 VP', {
          from: user1,
        });
      });
      it('should have 1 yes vote', async () => {
        const tokeLoreProp = (await tokeLore.tokeloresTable()).rows[0];
        chai.expect(tokeLoreProp.total_yes_votes).to.equal('0.0002 VP');
      });
      it('should have updated voters table', async () => {
        await voterCheck.check_after_voting('0.0002 VP');
      });
      it('should have updated globals table', async () => {
        await globalsCheck.checkAfterStaking();
      });
      it('check total vote integrity', async () => {
        await checkTotalVotePowerMatchesGlobalVotePower();
      });
    });
    context('with correct auth voting no', async () => {
      before(async () => {
        voterCheck = new VoterCheck(user1.name);
        await voterCheck.capture();
        await globalsCheck.capture();
      });

      it('should vote', async () => {
        await tokeLore.vote(user1.name, proposal_id, 'no', '0.0001 VP', {
          from: user1,
        });
      });
      it('should have 1 yes vote', async () => {
        const tokeLoreProp = (await tokeLore.tokeloresTable()).rows[0];
        chai.expect(tokeLoreProp.total_no_votes).to.equal('0.0001 VP');
        chai.expect(tokeLoreProp.total_yes_votes).to.equal('0.0002 VP');
        await voterCheck.check_after_voting('0.0001 VP');
      });
      it('should have updated globals table', async () => {
        await globalsCheck.checkAfterStaking();
      });
    });
    context('with correct auth voting with execeeded vote power', async () => {
      before(async () => {
        voterCheck = new VoterCheck(user1.name);
        await voterCheck.capture();
        await globalsCheck.capture();
      });
      it('should fail to vote', async () => {
        const voter = (await tokeLore.voters2Table()).rows.find(
          (v) => v.voter === user1.name
        );
        await assertEOSErrorIncludesMessage(
          tokeLore.vote(
            user1.name,
            proposal_id,
            'yes',
            new Asset(voter.vote_power.toString()).add(
              new Asset(voter.vote_power.toString())
            ), // needs to be significantly more than the current vote power because the vote power is updated before the vote for the current time. Therefore, the vote power + 1 will still succeed.
            { from: user1 }
          ),
          'ERR::VOTE_POWER_EXCEEDED'
        );
        await voterCheck.check_after_voting('0.0000 VP'); // no vote power should be deducted and hsould not have updated the voters table
        await globalsCheck.checkAfterStaking(); // no vote power should be deducted and hsould not have updated the globals table
      });
    });
  });

  context('stake more', async () => {
    before(async () => {
      voterCheck = new VoterCheck(user1.name);
      await voterCheck.capture();
      await globalsCheck.capture();
    });
    it('should stake', async () => {
      // 1 TLM is still left to be staked for this user after the proposal action from earlier.
      await tokeLore.stake(user1.name, { from: user1 });
    });
    it('should have 150 staked in voters table', async () => {
      await voterCheck.check_after_staking(new Asset('1.0000 TLM'));
    });
    it('should have updated the globals table with staking', async () => {
      await globalsCheck.checkAfterStaking(new Asset('1.0000 TLM'));
    });
    it('check total vote integrity', async () => {
      await checkTotalVotePowerMatchesGlobalVotePower();
    });
  });

  context('exec proposal', async () => {
    context('without enough quorum votes', async () => {
      it('should fail to exec proposal', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.exec(proposal_id, { from: user1 }),
          'Status: quorum.unmet'
        );
      });
    });
    context('with enough quorum votes but not enough yes votes', async () => {
      before(async () => {
        await tokeLore.updateconfig(
          {
            duration: 80,
            fee: '10.0000 TLM',
            pass_percent_x100: 8000,
            quorum_percent_x100: 2000,
          },
          { from: tokeLore.account }
        );
      });
      it('should fail to exec proposal', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.exec(proposal_id, { from: user1 }),
          'Status: failing'
        );
      });
    });
    context('with enough yes votes', async () => {
      let tokePropVotePower: Asset;
      let earliestExec: Date;
      let msUntilReady: number;
      before(async () => {
        // Create a fresh proposal so earliest_exec is relative to now
        proposal_id += 1;

        await shared.eosioToken.transfer(
          user1.name,
          tokeLore.account.name,
          '10.0000 TLM',
          'for staking',
          { from: user1 }
        );

        await tokeLore.propose(
          proposal_id,
          user1.name,
          'title',
          'proptype1',
          [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
          { from: user1 }
        );

        await tokeLore.vote(user1.name, proposal_id, 'yes', '0.0005 VP', {
          from: user1,
        });

        const propRes = await tokeLore.tokeloresTable({
          lowerBound: proposal_id,
          upperBound: proposal_id,
          limit: 1,
        });
        const prop = propRes.rows[0];
        earliestExec = prop.earliest_exec;
        msUntilReady = Math.max(earliestExec.getTime() - Date.now(), 0);

        globalsCheck = new GlobalsCheck();
        await globalsCheck.capture();
      });
      it('should fail to exec proposal to early', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.exec(proposal_id, { from: user1 }),
          'ERR::PROPOSAL_NOT_READY::Too early'
        );
      });
      it('should succeed to exec proposal', async () => {
        await sleep(msUntilReady + 500);
        await tokeLore.exec(proposal_id, { from: user1 });
        executedProposalId = proposal_id;
      });
      it('should have execd proposal', async () => {
        const tokeLoreProp = (
          await tokeLore.tokeloresTable({
            lowerBound: proposal_id,
            upperBound: proposal_id,
            limit: 1,
          })
        ).rows[0];
        tokePropVotePower = new Asset(
          tokeLoreProp.total_yes_votes.toString()
        ).add(new Asset(tokeLoreProp.total_no_votes.toString()));
        chai.expect(tokeLoreProp.status).to.equal('executed');
      });
      it('should have updated the globals table', async () => {
        await globalsCheck.checkAfterCompletingProposal(tokePropVotePower);
      });
      it('should no longer be allowed to vote', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.vote(user1.name, proposal_id, 'yes', '0.0002 VP', {
            from: user1,
          }),
          'ERR::PROPOSAL_EXECUTED::'
        );
      });
    });
  });
  context('unstake', async () => {
    let voterCheck: VoterCheck;
    let globalsCheck: GlobalsCheck;

    before(async () => {
      await shared.eosioToken.transfer(
        shared.tokenIssuer.name,
        user1.name,
        '100.0000 TLM',
        'for staking',
        { from: shared.tokenIssuer }
      );
      await shared.eosioToken.transfer(
        user1.name,
        tokeLore.account.name,
        '100.0000 TLM',
        'for staking',
        { from: user1 }
      );
      await tokeLore.stake(user1.name, { from: user1 });
    });

    context('with correct auth', async () => {
      before(async () => {
        voterCheck = new VoterCheck(user1.name);
        globalsCheck = new GlobalsCheck();
        await voterCheck.capture();
        await globalsCheck.capture();
      });

      it('before unstake, user should not have any deposits', async () => {
        const deposit = (await tokeLore.depositsTable()).rows.find(
          (d) => d.account === user1.name
        );
        chai.expect(deposit).to.be.undefined;
      });
      it('before unstake, checkTotalVotePowerMatchesGlobalVotePower', async () => {
        await checkTotalVotePowerMatchesGlobalVotePower();
      });
      it('establish total stake before unstake', async () => {
        const globals = (await tokeLore.globals2Table()).rows[0];
        chai.expect(globals.total_staked).to.equal('201.0000 TLM');
      });

      it('should unstake', async () => {
        await tokeLore.unstake(user1.name, { from: user1 });
      });

      it('should have moved staked amount to deposits table', async () => {
        const deposit = (await tokeLore.depositsTable()).rows.find(
          (d) => d.account === user1.name
        );
        chai.expect(deposit.deposit).to.equal('201.0000 TLM');
      });

      it('should have removed voter from voters table', async () => {
        const voter = (await tokeLore.voters2Table()).rows.find(
          (v) => v.voter === user1.name
        );
        chai.expect(voter).to.be.undefined;
      });

      it('check total vote integrity', async () => {
        await checkTotalVotePowerMatchesGlobalVotePower();
      });
    });

    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.unstake(user1.name, { from: user2 })
        );
      });
    });
  });
  context('refund', async () => {
    let userBalanceBefore: number;
    let userBalanceAfter: number;
    context('with correct auth', async () => {
      it('establish balance before refund', async () => {
        userBalanceBefore = await shared.getBalance(user1.name);
      });
      it('should refund the deposit', async () => {
        const initialDeposit = (await tokeLore.depositsTable()).rows.find(
          (d) => d.account === user1.name
        );
        chai.expect(initialDeposit.deposit).to.equal('201.0000 TLM');

        await tokeLore.refund(user1.name, { from: user1 });

        const finalDeposit = (await tokeLore.depositsTable()).rows.find(
          (d) => d.account === user1.name
        );
        chai.expect(finalDeposit).to.be.undefined;

        userBalanceAfter = await shared.getBalance(user1.name);
        chai.expect(userBalanceAfter).to.equal(userBalanceBefore + 201);
      });
    });

    context('with no deposit', async () => {
      it('should fail with no deposit error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.refund(user2.name, { from: user2 }),
          'ERR::NO_DEPOSIT'
        );
      });
    });
  });
  context('auto exec after duration and enough votes', async () => {
    before(async () => {
      await shared.eosioToken.transfer(
        user1.name,
        tokeLore.account.name,
        '110.0000 TLM',
        'for staking',
        { from: user1 }
      );

      await tokeLore.propose(
        ++proposal_id,
        user1.name,
        'auto exec after duration and enough votes',
        'proptype1',
        [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
        { from: user1 }
      );
      await tokeLore.stake(user1.name, { from: user1 });
      await sleep(10000); // wait for min duration to pass before voting and then it should execute.
      await tokeLore.vote(user1.name, proposal_id, 'yes', '0.0006 VP', {
        from: user1,
      });
    });
    it('should not have execd proposal', async () => {
      const tokeLoreProp = (await tokeLore.tokeloresTable()).rows.filter(
        (p) => {
          return p.proposal_id === proposal_id;
        }
      );
      chai.expect(tokeLoreProp[0].status).to.equal('passing');
    });
    context('after min duration has passed', async () => {
      before(async () => {
        await sleep(10000);
        await tokeLore.vote(user1.name, proposal_id, 'yes', '0.0006 VP', {
          from: user1,
        });
      });
      it('should have execd proposal', async () => {
        const tokeLoreProp = (await tokeLore.tokeloresTable()).rows.filter(
          (p) => {
            return p.proposal_id === proposal_id;
          }
        );
        chai.expect(tokeLoreProp[0].status).to.equal('executed');
      });
    });
  });
  context('cancel', async () => {
    let proposalId: number;
    let executed_proposal;

    before(async () => {
      await shared.eosioToken.transfer(
        user1.name,
        tokeLore.account.name,
        '10.0000 TLM',
        'for staking',
        { from: user1 }
      );
      await tokeLore.propose(
        ++proposal_id,
        user1.name,
        'title',
        'proptype1',
        [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
        { from: user1 }
      );

      // find an already executed proposal
      executed_proposal = (await tokeLore.tokeloresTable()).rows.find(
        (p) => p.status === 'executed'
      );
      const normal_proposal = (await tokeLore.tokeloresTable()).rows.find(
        (p) => p.status !== 'executed'
      );
      console.log('proposal: ', normal_proposal);
      proposalId = normal_proposal.proposal_id as number;
    });

    context('with correct auth', async () => {
      it('canceling already executed proposal should fail', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.cancel(executed_proposal.proposal_id, { from: user1 }),
          'ERR::PROPOSAL_EXECUTED::'
        );
      });
      it('should cancel the proposal', async () => {
        await tokeLore.cancel(proposalId, { from: user1 });

        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === proposalId
        );
        chai.expect(finalProposal).to.be.undefined;
      });

      it('should update reduce global vote power', async () => {
        await shared.eosioToken.transfer(
          user1.name,
          tokeLore.account.name,
          '10.0000 TLM',
          'for proposing',
          { from: user1 }
        );

        await tokeLore.propose(
          ++proposal_id,
          user1.name,
          'hjsdghkjl',
          'proptype1',
          [{ key: 'attr1', value: ['string', 'sdfsdfsdf'] }],
          { from: user1 }
        );
        const newProposalId = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.title === 'hjsdghkjl'
        ).proposal_id;

        await shared.eosioToken.transfer(
          user1.name,
          tokeLore.account.name,
          '110.0000 TLM',
          'for staking',
          { from: user1 }
        );

        await tokeLore.stake(user1.name, { from: user1 });

        await sleep(10000);

        const ppp = (await tokeLore.tokeloresTable()).rows[0];
        await tokeLore.vote(user1.name, newProposalId, 'yes', '0.0002 VP', {
          from: user1,
        });

        const afterVoteGlobals = (await tokeLore.globals2Table()).rows[0];
        const afterVoteTotalVotePower = new Asset(
          afterVoteGlobals.total_vote_power.toString()
        );

        await tokeLore.cancel(newProposalId, { from: user1 });

        const finalGlobals = (await tokeLore.globals2Table()).rows[0];
        chai
          .expect(
            new Asset(finalGlobals.total_vote_power.toString())
              .amount_raw()
              .toFixed(4)
          )
          .to.equal((afterVoteTotalVotePower.amount_raw() - 2).toFixed(4));
      });
    });

    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        const existing_proposal_id = (await tokeLore.tokeloresTable()).rows[0]
          .proposal_id;

        await assertMissingAuthority(
          tokeLore.cancel(existing_proposal_id, { from: user2 })
        );
      });
    });

    context('with non-existent proposal', async () => {
      it('should fail with proposal not found error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.cancel(999, { from: user1 }),
          'ERR::PROPOSAL_NOT_FOUND'
        );
      });
    });
  });
  context('rmvexpired', async () => {
    let proposalId: number;

    before(async () => {
      await tokeLore.updateconfig(
        {
          duration: 5,
          fee: '10.0000 TLM',
          pass_percent_x100: 9500,
          quorum_percent_x100: 8000,
        },
        { from: tokeLore.account }
      );
      await shared.eosioToken.transfer(
        user1.name,
        tokeLore.account.name,
        '10.0000 TLM',
        'for staking',
        { from: user1 }
      );
      await tokeLore.propose(
        ++proposal_id,
        user1.name,
        'fsdgshtwlp',
        'proptype1',
        [{ key: 'attr1', value: ['string', 'fjklsg3'] }],
        { from: user1 }
      );
      const proposal = (await tokeLore.tokeloresTable()).rows.find(
        (x) => x.title === 'fsdgshtwlp'
      );
      console.log('proposal: ', proposal);
      proposalId = proposal.proposal_id;

      // Wait for the proposal to expire
      await sleep(6000);
    });
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.rmvexpired(proposalId, { from: user2 })
        );
      });
    });

    context('with correct auth', async () => {
      it('should remove the expired proposal', async () => {
        await tokeLore.rmvexpired(proposalId, { from: user1 });

        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === proposalId
        );
        chai.expect(finalProposal).to.be.undefined;
      });
    });
  });
  context('setmerged', async () => {
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.setmerged(proposal_id, { from: user2 })
        );
      });
    });
    context('with wrong state', async () => {
      let wrongStatePropId = 10;
      before(async () => {
        await shared.eosioToken.transfer(
          user1.name,
          tokeLore.account.name,
          '10.0000 TLM',
          'for staking',
          { from: user1 }
        );
        await tokeLore.propose(
          wrongStatePropId,
          user1.name,
          'wrong state prop',
          'proptype1',
          [{ key: 'attr1', value: ['string', 'value1'] }],
          { from: user1 }
        );
      });
      it('should fail with wrong state error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.setmerged(wrongStatePropId, { from: tokeLore.account }),
          'PROPOSAL_NOT_EXECUTED'
        );
      });
    });
    context('with correct auth and state', async () => {
      it('should set the proposal to merged', async () => {
        chai.expect(executedProposalId).to.be.a('number');
        await tokeLore.setmerged(executedProposalId, {
          from: tokeLore.account,
        });

        // Check proposal status
        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === executedProposalId
        );
        chai.expect(finalProposal.status).to.equal('merged');
      });
    });
  });
  context('setmintprep', async () => {
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.setmintprep(proposal_id, { from: user2 })
        );
      });
    });
    context('with wrong state', async () => {
      let wrongStatePropId = 10;
      it('should fail with wrong state error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.setmerged(wrongStatePropId, { from: tokeLore.account }),
          'PROPOSAL_NOT_EXECUTED'
        );
      });
    });
    context('with correct auth and state', async () => {
      it('should set the proposal to mintprep', async () => {
        chai.expect(executedProposalId).to.be.a('number');
        await tokeLore.setmintprep(executedProposalId, {
          from: tokeLore.account,
        });

        // Check proposal status
        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === executedProposalId
        );
        chai.expect(finalProposal.status).to.equal('mintprep');
      });

      it('should allow calling setmintprep when already in mintprep state', async () => {
        // First call to set mintprep
        await tokeLore.setmintprep(executedProposalId, {
          from: tokeLore.account,
        });
        await sleep(5000);
        // Second call should also succeed
        await tokeLore.setmintprep(executedProposalId, {
          from: tokeLore.account,
        });

        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === executedProposalId
        );
        chai.expect(finalProposal.status).to.equal('mintprep');
      });
    });
  });
  context('mint', async () => {
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.mint(proposal_id, 'sdfsdf', { from: user2 })
        );
      });
    });
    context('with wrong state', async () => {
      let wrongStatePropId = 10;
      it('should fail with wrong state error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.mint(wrongStatePropId, 'sdfsdf', {
            from: tokeLore.account,
          }),
          'PROPOSAL_NOT_MINTPREP'
        );
      });
    });
    context('with correct auth and state', async () => {
      it('should complete the minting process', async () => {
        chai.expect(executedProposalId).to.be.a('number');
        await tokeLore.mint(executedProposalId, 'sdfsdf', {
          from: tokeLore.account,
        });

        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === executedProposalId
        );
        chai.expect(finalProposal.status).to.equal('complete');
      });
    });
  });
  context('rmvcompleted', async () => {
    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.rmvcompleted(10, { from: user2 })
        );
      });
    });

    context('with correct auth', async () => {
      it('should remove the completed proposal', async () => {
        chai.expect(executedProposalId).to.be.a('number');
        await tokeLore.rmvcompleted(executedProposalId, { from: user1 });

        const finalProposal = (await tokeLore.tokeloresTable()).rows.find(
          (p) => p.proposal_id === executedProposalId
        );
        chai.expect(finalProposal).to.be.undefined;
      });
    });

    context('with non-existent proposal', async () => {
      it('should fail with proposal not found error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.rmvcompleted(999, { from: user1 }),
          'ERR::PROPOSAL_NOT_FOUND'
        );
      });
    });
  });

  context('fillpot', async () => {
    const fillAmount = '50.0000 TLM';

    before(async () => {
      await shared.eosioToken.transfer(
        user2.name,
        tokeLore.account.name,
        fillAmount,
        'for filling pot',
        { from: user2 }
      );
    });

    context('with no deposit', async () => {
      it('should fail with no deposit error', async () => {
        await assertEOSErrorIncludesMessage(
          tokeLore.fillpot(voter2.name, { from: voter2 }),
          'ERR::NO_DEPOSIT'
        );
      });
    });

    context('with wrong auth', async () => {
      it('should fail with missing authority', async () => {
        await assertMissingAuthority(
          tokeLore.fillpot(user2.name, { from: user1 })
        );
      });
    });

    context('with correct auth and deposit', async () => {
      let rewardPotBefore: number;

      before(async () => {
        const rewardGlob = await getRewardGlobals();
        rewardPotBefore = new Asset(rewardGlob.reward_pot).amount_raw();
      });

      it('should fill the pot successfully', async () => {
        await tokeLore.fillpot(user2.name, { from: user2 });
      });

      it('should have removed the deposit', async () => {
        const deposit = (await tokeLore.depositsTable()).rows.find(
          (d) => d.account === user2.name
        );
        chai.expect(deposit).to.be.undefined;
      });

      it('should have increased reward_pot by fill amount', async () => {
        const rewardGlob = await getRewardGlobals();
        const rewardPotAfter = new Asset(rewardGlob.reward_pot).amount_raw();
        chai
          .expect(rewardPotAfter)
          .to.equal(rewardPotBefore + new Asset(fillAmount).amount_raw());
      });
    });
  });

  context('voting reward (Synthetix-style)', async () => {
    // Flow: voter stakes → votes (VP registered) → filler fills pot →
    //       reward_per_vp_stored increases → voter calls claimreward → receives TLM

    let voterBalanceBefore: number;
    let rewardPotAfterFill: number;
    const potFillAmount = '200.0000 TLM';
    const voteAmount = '0.0001 VP';

    before(async () => {
      // Stake voter1 so they have vote power
      await shared.eosioToken.transfer(
        voter1.name,
        tokeLore.account.name,
        '100.0000 TLM',
        'for staking',
        { from: voter1 }
      );
      await tokeLore.stake(voter1.name, { from: voter1 });

      // Create a proposal for voter1 to vote on
      await shared.eosioToken.transfer(
        user1.name,
        tokeLore.account.name,
        '10.0000 TLM',
        'for proposing',
        { from: user1 }
      );
      await tokeLore.propose(
        ++proposal_id,
        user1.name,
        'voting reward test proposal',
        'proptype1',
        [{ key: 'attr1', value: ['string', 'rewardtest'] }],
        { from: user1 }
      );

      // Let vote power accrue before voting
      await sleep(5000);

      // voter1 votes — this registers their VP in the voterreward table
      await tokeLore.vote(voter1.name, proposal_id, 'yes', voteAmount, {
        from: voter1,
      });

      // Capture voter balance before the pot is filled (no rewards yet)
      voterBalanceBefore = await shared.getBalance(voter1.name);

      // Now fill the pot — this distributes rewards to all participating VP
      await shared.eosioToken.transfer(
        user2.name,
        tokeLore.account.name,
        potFillAmount,
        'filling reward pot',
        { from: user2 }
      );
      await tokeLore.fillpot(user2.name, { from: user2 });

      const globsAfterFill = await getRewardGlobals();
      rewardPotAfterFill = new Asset(globsAfterFill.reward_pot).amount_raw();
    });

    it('should have reward_pot > 0 after fillpot', async () => {
      chai.expect(rewardPotAfterFill).to.be.greaterThan(0);
    });

    it('voter should have accrued rewards after the pot is filled', async () => {
      const reward = await getVoterReward(voter1.name);
      // reward_per_vp_stored > reward_per_vp_paid, so pending rewards exist
      // We don't check exact accrued yet (it's settled on claimreward), but the
      // global accumulator should have moved
      const globs = await getRewardGlobals();
      chai.expect(Number(globs.reward_per_vp_stored)).to.be.greaterThan(0);
    });

    it('claimreward should fail with no rewards if voter has not participated', async () => {
      await assertEOSErrorIncludesMessage(
        tokeLore.claimreward(voter2.name, { from: voter2 }),
        'ERR::NO_REWARDS'
      );
    });

    it('voter should receive TLM on claimreward', async () => {
      await tokeLore.claimreward(voter1.name, { from: voter1 });

      const voterBalanceAfter = await shared.getBalance(voter1.name);
      chai.expect(voterBalanceAfter).to.be.greaterThan(voterBalanceBefore);
    });

    it('claimed reward should equal the full pot fill (sole participant)', async () => {
      const voterBalanceAfter = await shared.getBalance(voter1.name);
      // voter1 is the only participant so reward = full pot fill amount
      chai
        .expect(voterBalanceAfter - voterBalanceBefore)
        .to.approximately(new Asset(potFillAmount).amount_raw(), 0.0001);
    });

    it('reward_pot should be empty after sole voter claims', async () => {
      const globs = await getRewardGlobals();
      const remainingPot = new Asset(globs.reward_pot).amount_raw();
      chai.expect(remainingPot).to.approximately(0, 0.0001);
    });

    it('rewards_accrued should be zero after claiming', async () => {
      const reward = await getVoterReward(voter1.name);
      chai.expect(reward.rewards_accrued).to.equal(0);
    });

    it('claimreward should fail with nothing to claim after already claimed', async () => {
      await assertEOSErrorIncludesMessage(
        tokeLore.claimreward(voter1.name, { from: voter1 }),
        'ERR::NOTHING_TO_CLAIM'
      );
    });
  });
});

// ── Helpers for reward tables (not yet in generated bindings) ─────────────────

async function getRewardGlobals(): Promise<{
  reward_pot: string;
  reward_per_vp_stored: number | string;
  total_vp_participating: number;
}> {
  const res = await EOSManager.api.rpc.get_table_rows({
    code: tokeLore.account.name,
    scope: tokeLore.account.name,
    table: 'rewardglob',
    json: true,
    limit: 1,
  });
  return (
    res.rows[0] ?? {
      reward_pot: '0.0000 TLM',
      reward_per_vp_stored: 0,
      total_vp_participating: 0,
    }
  );
}

async function getVoterReward(voter: string): Promise<{
  voter: string;
  vp_participating: number;
  reward_per_vp_paid: number | string;
  rewards_accrued: number;
}> {
  const res = await EOSManager.api.rpc.get_table_rows({
    code: tokeLore.account.name,
    scope: tokeLore.account.name,
    table: 'voterreward',
    json: true,
    lower_bound: voter,
    upper_bound: voter,
    limit: 1,
  });
  return (
    res.rows[0] ?? {
      voter,
      vp_participating: 0,
      reward_per_vp_paid: 0,
      rewards_accrued: 0,
    }
  );
}

class VoterCheck {
  initial_voter_info: TokeloreVoterInfo2;
  constructor(public voterName: string) {}

  /**
   * Capture the initial voters table. This should be called before any voting or staking so it can be used for comparison later.
   */
  async capture() {
    this.initial_voter_info = (await tokeLore.voters2Table()).rows.find(
      (v) => v.voter === this.voterName
    );
  }

  /**
   *  Check the updated voters table after voting
   * @param votepower additional vote power to be added to the total vote power
   */
  async check_after_voting(votepower: Asset) {
    votepower = new Asset(votepower.toString());
    await this.check_after_delta(
      -votepower.amount_raw(),
      new Asset('0.0000 TLM')
    );
  }

  /**
   *  Check the updated voters table after staking
   * @param addedStake additional stake to be added to the total staked amount
   */
  async check_after_staking(addedStake: Asset) {
    addedStake = new Asset(addedStake.toString());
    await this.check_after_delta(0, addedStake);
  }

  private async check_after_delta(vote_delta: number, addedStake: Asset) {
    const updatedVoter = (await tokeLore.voters2Table()).rows.find(
      (v) => v.voter === this.voterName
    );

    const time_diff =
      (updatedVoter.last_claim_time.valueOf() -
        this.initial_voter_info.last_claim_time.valueOf()) *
      0.001;
    const initialStakedAmount = new Asset(
      this.initial_voter_info.staked_amount.toString()
    );
    const initialVotePower = new Asset(
      this.initial_voter_info.vote_power.toString()
    );
    const power_multiplier =
      new Asset(POWER_PER_DAY).amount_raw() / 86400 / 10000;
    const updatedVotePower =
      initialVotePower.amount_raw() +
      initialStakedAmount.amount_raw() * time_diff * power_multiplier +
      vote_delta;
    chai
      .expect(new Asset(updatedVoter.vote_power.toString()).amount_raw())
      .to.approximately(updatedVotePower, 0.0001);
    chai
      .expect(new Asset(updatedVoter.staked_amount.toString()).amount_raw())
      .be.equal(initialStakedAmount.add(addedStake).amount_raw());
    chai.expect(updatedVoter.voter).to.equal(this.initial_voter_info.voter);
  }
}

class GlobalsCheck {
  initial_globals: TokeloreGlobalsItem2;
  constructor() {}

  /**
   * Capture the initial globals table. This should be called before any voting or staking so it can be used for comparison later.
   */
  async capture() {
    this.initial_globals = (await tokeLore.globals2Table()).rows[0];
  }

  /**
   *  Check the updated globals table after staking
   * @param stakedExtra additional stake to be added to the total staked amount
   */
  async checkAfterStaking(stakedExtra: Asset = new Asset('0.0000 TLM')) {
    stakedExtra = new Asset(stakedExtra.toString());
    const updatedGlobals = (await tokeLore.globals2Table()).rows[0];

    const initialStakedAmount = new Asset(
      this.initial_globals.total_staked.toString()
    );
    const time_diff =
      (updatedGlobals.last_update.valueOf() -
        this.initial_globals.last_update.valueOf()) *
      0.001;
    const power_multiplier =
      new Asset(POWER_PER_DAY).amount_raw() / 86400 / 10000;
    const updatedVotePower =
      new Asset(this.initial_globals.total_vote_power.toString()).amount_raw() +
      initialStakedAmount.amount_raw() * time_diff * power_multiplier;

    chai
      .expect(
        new Asset(updatedGlobals.total_vote_power.toString()).amount_raw()
      )
      .to.equal(updatedVotePower);
    chai
      .expect(new Asset(updatedGlobals.total_staked.toString()).amount_raw())
      .to.equal(initialStakedAmount.add(stakedExtra).amount_raw());
  }

  async checkAfterCompletingProposal(propTotalVotePower: Asset) {
    const updatedGlobals = (await tokeLore.globals2Table()).rows[0];

    chai
      .expect(
        new Asset(updatedGlobals.total_vote_power.toString())
          .amount_raw()
          .toFixed(4)
      )
      .to.equal(
        new Asset(this.initial_globals.total_vote_power.toString())
          .sub(propTotalVotePower)
          .amount_raw()
          .toFixed(4)
      );
  }
}

async function checkTotalVotePowerMatchesGlobalVotePower() {
  const voters = (await tokeLore.voters2Table()).rows;
  const totalVoterPower = voters.reduce(
    (acc, voter) => acc + new Asset(voter.vote_power.toString()).amount_raw(),
    0
  );

  const tokeLoreProps = (await tokeLore.tokeloresTable()).rows;
  const totalYesNoVotes = tokeLoreProps.reduce(
    (acc, prop) =>
      prop.status !== 'executed'
        ? acc +
          new Asset(prop.total_yes_votes.toString()).amount_raw() +
          new Asset(prop.total_no_votes.toString()).amount_raw()
        : acc,
    0
  );

  const globals = (await tokeLore.globals2Table()).rows[0];
  const globalVotePower = new Asset(
    globals.total_vote_power.toString()
  ).amount_raw();

  chai
    .expect(globalVotePower)
    .to.approximately(totalVoterPower + totalYesNoVotes, 0.0001);
}

async function configureAuths() {
  UpdateAuth.execUpdateAuth(
    tokeLore.account.active,
    tokeLore.name,
    'active',
    'owner',
    UpdateAuth.AuthorityToSet.explicitAuthorities(
      1,
      [
        {
          permission: {
            actor: tokeLore.account.name,
            permission: 'eosio.code',
          },
          weight: 1,
        },
      ],
      [{ weight: 1, key: tokeLore.account.publicKey }],
      []
    )
  );

  await SharedTestObjects.add_custom_permission_and_link(
    tokeLore.account,
    'issue',
    shared.atomicassets,
    'mintasset'
  );
}
