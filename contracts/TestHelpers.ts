import {
  Account,
  AccountManager,
  EOSManager,
  ContractDeployer,
  sleep,
  assertRowCount,
  generateTypes,
  debugPromise,
  UpdateAuth,
  Asset,
  Contract,
} from 'lamington';
const fetch = require('node-fetch');
const { Serialize } = require('eosjs');
const Uint64LE = require('int64-buffer').Uint64LE;
const Int64LE = require('int64-buffer').Int64LE;
const chai = require('chai');
import * as moment from 'moment';
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

import { Alwgladiator } from './alwgladiator/alwgladiator';
import { Federation } from './federation/federation';
import { Infl } from './infl/infl';
import { Landholders } from './landholders/landholders';
import { Mining } from './mining/mining';
import { Atomicassets } from './atomicassets-contracts/src/atomicassets';
import { TlmToken } from './tlm.token/tlm.token';
import { Orngwax } from './orngwax/orngwax';
import { Landboost } from './landboost/landboost';
import { Userpoints } from './userpoints/userpoints';
import { Eosdactokens } from './eosdactokens/eosdactokens';
import { DacDirectoryContract } from './dacdirectory/dacdirectory';
import { Stakevote } from './stakevote/stakevote';
import { Pointsproxy } from './pointsproxy/pointsproxy';
import { Nftmintctl } from './nftmintctl/nftmintctl';
import { Testmarket } from './testmarket/testmarket';
import { Planets } from './planets/planets';
import { Staking } from './staking/staking';
import { Tokelore } from './tokelore/tokelore';
import { Autoteleport } from './autoteleport/autoteleport';
import { MockTeleport } from './mock.teleport/mock.teleport';
const TLM_SYM = 'TLM';

export class SharedTestObjects {
  // Shared Instances to use between tests.
  private static instance: SharedTestObjects;

  alwgladiator: Alwgladiator;
  federation: Federation;
  infl: Infl;
  userpoints: Userpoints;
  landholders: Landholders;
  mining: Mining;
  atomicassets: Atomicassets;
  eosioToken: TlmToken;
  nftmintctl: Nftmintctl;
  orngwax: Orngwax;
  tokenIssuer: Account;
  satellite_account: Account;
  atomicmarket: Testmarket;

  notify_account: Account;
  landholders_allocation_account: Account;
  landboost: Landboost;
  dac_token_contract: Eosdactokens;
  dacdirectory_contract: DacDirectoryContract;
  stakevote_contract: Stakevote;
  pointsproxy_contract: Pointsproxy;
  planets: Planets;
  staking: Staking;
  tokeLore: Tokelore;
  autoteleport: Autoteleport;
  mockTeleport: MockTeleport;
  mint_helper_account: Account;
  otherWorlds: Account;

  NFT_COLLECTION: string;
  BUDGET_SCHEMA: string;
  TOOL_SCHEMA: string;
  LAND_SCHEMA: string;
  MINION_SCHEMA: string;
  AVATAR_SCHEMA: string;
  WEAPON_SCHEMA: string;
  LAND_TEMPLATE_ID: Number;
  SHOVEL_TEMPLATE_ID: Number;
  DRILL_TEMPLATE_ID: Number;
  MEGABOOST_TEMPLATE_ID: Number;
  SUPERBOOST_TEMPLATE_ID: Number;
  MALE_AVATAR_TEMPLATE_ID: Number;
  FEMALE_AVATAR_TEMPLATE_ID: Number;
  ALIEN_AVATAR_TEMPLATE_ID: Number;

  landowners: any;
  planet_accounts: any;
  testplanet: string;

  constructor() {
    this.NFT_COLLECTION = 'alien.worlds';
    this.BUDGET_SCHEMA = 'budget';
    this.TOOL_SCHEMA = 'tool.worlds';
    this.LAND_SCHEMA = 'land.worlds';
    this.MINION_SCHEMA = 'alwminschme';
    this.AVATAR_SCHEMA = 'faces.worlds';
    this.WEAPON_SCHEMA = 'arms.worlds';
    this.BOOST_SCHEMA = 'boost.worlds';
    this.testplanet = 'eyeke.world';
    this.landowners = [];
    this.planet_accounts = {};
    this.numberOfLands = 0;
  }
  static async getInstance(): Promise<SharedTestObjects> {
    if (!SharedTestObjects.instance) {
      console.log(`SharedTestObjects new instance created`);
      SharedTestObjects.instance = new SharedTestObjects();
      await SharedTestObjects.instance.initAndGetSharedObjects();
    }
    return SharedTestObjects.instance;
  }

  private async initAndGetSharedObjects() {
    console.log('Waiting for system contract to be deployed...');
    await this.waitForSystemContract();
    this.alwgladiator = await ContractDeployer.deployWithName<Alwgladiator>(
      'alwgladiator',
      'alwgladiator'
    );
    this.landholders = await ContractDeployer.deployWithName<Landholders>(
      'landholders',
      'awlndratings'
    );
    this.landholders_allocation_account = await AccountManager.createAccount(
      'awlndratings'
    );
    this.landholders.account.addCodePermission();
    this.federation = await ContractDeployer.deployWithName<Federation>(
      'federation',
      'federation'
    );
    this.infl = await ContractDeployer.deployWithName<Infl>(
      'infl',
      'infl.worlds'
    );
    this.userpoints = await ContractDeployer.deployWithName<Userpoints>(
      'userpoints',
      'uspts.worlds'
    );
    this.userpoints.account.addCodePermission();
    this.eosioToken = await ContractDeployer.deployWithName<TlmToken>(
      'tlm.token',
      'alien.worlds'
    );
    this.atomicassets = await ContractDeployer.deployWithName<Atomicassets>(
      'atomicassets',
      'atomicassets'
    );
    await this.atomicassets.account.addCodePermission();
    await this.atomicassets.init({ from: this.atomicassets.account });
    this.mining = await ContractDeployer.deployWithName<Mining>(
      'mining',
      'm.federation'
    );
    this.orngwax = await ContractDeployer.deployWithName<Orngwax>(
      'orngwax',
      'orng.wax'
    );
    this.landboost = await ContractDeployer.deployWithName<Landboost>(
      'landboost',
      'boost.worlds'
    );
    this.landboost.account.addCodePermission();
    this.dac_token_contract = await ContractDeployer.deployWithName(
      'eosdactokens',
      'token.worlds'
    );
    this.dacdirectory_contract = await ContractDeployer.deployWithName(
      'dacdirectory',
      'index.worlds'
    );
    this.stakevote_contract = await ContractDeployer.deployWithName(
      'stakevote',
      'stakevote'
    );
    this.notify_contract = await ContractDeployer.deployWithName(
      'notify',
      'notify.world'
    );
    this.pointsproxy_contract = await ContractDeployer.deployWithName(
      'pointsproxy',
      'pointsproxy'
    );
    this.nftmintctl = await ContractDeployer.deployWithName(
      'nftmintctl',
      'nftmt.worlds'
    );
    this.satellite_account = await AccountManager.createAccount('sat.worlds');
    this.atomicmarket = await ContractDeployer.deployWithName(
      'testmarket',
      'atomicmarket'
    );
    this.planets = await ContractDeployer.deployWithName(
      'planets',
      'plnts.worlds'
    );
    this.staking = await ContractDeployer.deployWithName(
      'staking',
      'stake.worlds'
    );
    this.tokeLore = await ContractDeployer.deployWithName<Tokelore>(
      'tokelore',
      'tokelore'
    );

    this.autoteleport = await ContractDeployer.deployWithName<Autoteleport>(
      'autoteleport',
      'autoteleport'
    );

    this.mockTeleport = await ContractDeployer.deployWithName<MockTeleport>(
      'mock.teleport',
      'other.worlds'
    );
    this.otherWorlds = this.mockTeleport.account;

    this.mint_helper_account = await AccountManager.createAccount(
      'mint.worlds'
    );

    await this.setupNFTs();
    await this.issueTokens();
    await this.setupPermissions();
    await this.setupLand();
  }

  private async waitForSystemContract(maxAttempts = 30) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check if system contract is deployed
        const abi = await EOSManager.rpc.get_abi('eosio');
        if (
          !abi.abi ||
          !abi.abi.actions.some(
            (action: { name: string }) => action.name === 'buyrambytes'
          )
        ) {
          console.debug(
            `System contract not deployed yet, attempt ${attempt}/${maxAttempts}...`
          );
          await sleep(1000);
          continue;
        }

        // Check if system contract is initialized
        const rammarket = await EOSManager.rpc.get_table_rows({
          json: true,
          code: 'eosio',
          scope: 'eosio',
          table: 'rammarket',
          limit: 1,
        });

        if (rammarket.rows.length > 0) {
          console.log('System contract detected and initialized!');
          return;
        }

        console.debug(
          `System contract deployed but not initialized yet, attempt ${attempt}/${maxAttempts}...`
        );
      } catch (error) {
        console.debug(
          `Error checking system contract status: ${error.message}`
        );
      }

      if (attempt === maxAttempts) {
        throw new Error(
          'Timeout waiting for system contract to be deployed and initialized'
        );
      }

      await sleep(1000); // Wait 1 second between attempts
    }
  }

  private async setupPermissions() {
    await UpdateAuth.execUpdateAuth(
      this.mining.account.active,
      this.mining.account.name,
      'random',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.mining.account)
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.federation.name,
      'miningstart',
      'random'
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.federation.name,
      'miningnft',
      'random'
    );
    await UpdateAuth.execUpdateAuth(
      this.mining.account.active,
      this.mining.account.name,
      'xfer',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.mining.account)
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.eosioToken.name,
      'transfer',
      'xfer'
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.federation.name,
      'setlandnick',
      'xfer'
    );
    await UpdateAuth.execUpdateAuth(
      this.mining.account.active,
      this.mining.account.name,
      'log',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.mining.account)
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.notify_contract.name,
      'logmine',
      'log'
    );
    await UpdateAuth.execUpdateAuth(
      this.userpoints.account.active,
      this.userpoints.account.name,
      'usrpoints',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.mining.account)
    );
    await UpdateAuth.execUpdateAuth(
      this.userpoints.account.active,
      this.userpoints.account.name,
      'issue',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.userpoints.account)
    );
    await UpdateAuth.execLinkAuth(
      this.userpoints.account.active,
      this.userpoints.account.name,
      this.userpoints.name,
      'addpoints',
      'usrpoints'
    );
    await UpdateAuth.execLinkAuth(
      this.userpoints.account.active,
      this.userpoints.account.name,
      this.userpoints.name,
      'testaddpnts',
      'usrpoints'
    );
    await UpdateAuth.execUpdateAuth(
      this.mining.account.active,
      this.mining.account.name,
      'issue',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.mining.account)
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.atomicassets.name,
      'mintasset',
      'issue'
    );
    await UpdateAuth.execUpdateAuth(
      this.federation.account.active,
      this.federation.account.name,
      'issue',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.federation.account)
    );
    await UpdateAuth.execLinkAuth(
      this.federation.account.active,
      this.federation.account.name,
      this.dac_token_contract.name,
      'issue',
      'issue'
    );
    await UpdateAuth.execUpdateAuth(
      this.staking.account.active,
      this.staking.account.name,
      'issue',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.staking.account)
    );
    await UpdateAuth.execLinkAuth(
      this.staking.account.active,
      this.staking.account.name,
      this.dac_token_contract.name,
      'issue',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.staking.account.active,
      this.staking.account.name,
      this.dac_token_contract.name,
      'burn',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.federation.account.active,
      this.federation.account.name,
      this.dac_token_contract.name,
      'transfer',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.staking.account.active,
      this.staking.account.name,
      this.dac_token_contract.name,
      'transfer',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.federation.account.active,
      this.federation.account.name,
      this.atomicassets.name,
      'mintasset',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.federation.account.active,
      this.federation.account.name,
      this.atomicassets.name,
      'setassetdata',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.mining.account.active,
      this.mining.account.name,
      this.atomicassets.name,
      'setassetdata',
      'issue'
    );
    await UpdateAuth.execLinkAuth(
      this.userpoints.account.active,
      this.userpoints.account.name,
      this.atomicassets.name,
      'transfer',
      'issue'
    );
    await UpdateAuth.execUpdateAuth(
      [{ actor: this.landholders.account.name, permission: 'active' }],
      this.landholders.account.name,
      'nftupdate',
      'active',
      UpdateAuth.AuthorityToSet.forContractCode(this.landholders.account)
    );
    await UpdateAuth.execLinkAuth(
      this.landholders.account.active,
      this.landholders.account.name,
      this.atomicassets.account.name,
      'setassetdata',
      'nftupdate'
    );

    await SharedTestObjects.add_custom_permission_and_link(
      this.planets,
      'upsertplanet',
      this.planets,
      'upsertplanet',
      this.staking
    );
    await SharedTestObjects.add_custom_permission_and_link(
      this.staking,
      'xfer',
      this.eosioToken,
      'transfer'
    );
    await SharedTestObjects.add_custom_permission_and_link(
      this.planets,
      'updatestake',
      this.planets,
      'updatestake',
      this.staking
    );
    /* NEW PERMISSION, needs to be added to live system before deployment */
    await SharedTestObjects.add_custom_permission_and_link(
      this.infl,
      'updatestake',
      this.infl,
      'updatestake',
      this.staking
    );

    await SharedTestObjects.add_custom_permission(
      this.mint_helper_account,
      'issue',
      'active',
      this.atomicassets.account
    );
    await SharedTestObjects.add_custom_permission_and_link(
      this.mining.account,
      'claim',
      this.mining.account,
      'pltdtapntfy',
      this.mining.account
    );

    await UpdateAuth.execUpdateAuth(
      this.mint_helper_account.active,
      this.mint_helper_account.name,
      'issue',
      'active',
      UpdateAuth.AuthorityToSet.explicitAuthorities(1, [
        {
          permission: {
            actor: this.mining.account.name,
            permission: 'eosio.code',
          },
          weight: 1,
        },
        {
          permission: {
            actor: this.federation.account.name,
            permission: 'eosio.code',
          },
          weight: 1,
        },
      ])
    );
    await UpdateAuth.execLinkAuth(
      this.mint_helper_account.active,
      this.mint_helper_account.name,
      this.atomicassets.account.name,
      'mintasset',
      'issue'
    );

    await SharedTestObjects.add_custom_permission_and_link(
      this.autoteleport,
      'xfer',
      this.eosioToken,
      'transfer'
    );
    await SharedTestObjects.add_custom_permission_and_link(
      this.autoteleport,
      'teleport',
      this.otherWorlds,
      'teleport'
    );
  }
  private async setupNFTs() {
    await this.atomicassets.createcol(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      true,
      [
        this.eosioToken.account.name,
        this.alwgladiator.account.name,
        this.federation.account.name,
        this.landholders.account.name,
        this.mining.account.name,
        this.tokeLore.account.name,
        this.mint_helper_account.name,
      ],
      [
        this.alwgladiator.account.name,
        this.federation.account.name,
        this.landholders.account.name,
      ],
      '0.01',
      '',
      { from: this.eosioToken.account }
    );
    // await this.createBudgetsSchema();

    // await this.mintBudgetNFT(400);
    // await this.mintBudgetNFT(500);
    // await this.mintBudgetNFT(300);
    await this.createToolSchema();
    await this.setupAwlgladiatorNFTs();
    await this.createShovelTemplate();
    await this.createDrillTemplate();

    await this.createAvatarTemplates();
  }

  async setupAwlgladiatorNFTs() {
    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.MINION_SCHEMA,
      [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'uint8' },
        { name: 'race', type: 'uint8' },
        { name: 'attack', type: 'uint8' },
        { name: 'defence', type: 'uint8' },
        { name: 'movecost', type: 'uint8' },
        { name: 'nummatches', type: 'uint32' },
        { name: 'numwins', type: 'uint32' },
      ],
      { from: this.eosioToken.account }
    );

    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.WEAPON_SCHEMA,
      [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'uint8' },
        { name: 'attack', type: 'uint8' },
        { name: 'defence', type: 'uint8' },
      ],
      { from: this.eosioToken.account }
    );

    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.AVATAR_SCHEMA,
      [
        { name: 'cardid', type: 'uint16' },
        { name: 'name', type: 'string' },
      ],
      { from: this.eosioToken.account }
    );

    await this.atomicassets.createtempl(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.MINION_SCHEMA,
      true,
      true,
      100,
      '',
      { from: this.eosioToken.account }
    );
  }
  async createTemplate(
    schema: string,
    attributes: { key: string; value: any }[],
    transferable: boolean = true,
    burnable: boolean = true,
    maxSupply: number = 0
  ) {
    await this.atomicassets.createtempl(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      schema,
      transferable,
      burnable,
      maxSupply,
      attributes as any,
      { from: this.eosioToken.account }
    );
  }

  async createBudgetsSchema() {
    console.log('creating budget schema:', this.BUDGET_SCHEMA);
    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.BUDGET_SCHEMA,
      [
        { name: 'cardid', type: 'uint16' },
        { name: 'name', type: 'string' },
        { name: 'percentage', type: 'uint16' },
      ],
      { from: this.eosioToken.account }
    );
  }

  async createBudgetTemplate() {
    await this.atomicassets.createtempl(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.BUDGET_SCHEMA,
      true,
      true,
      100,
      '',
      { from: this.eosioToken.account }
    );
  }

  async mintBudgetNFT(percentageMultipliedBy100: number) {
    await this.atomicassets.mintasset(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.BUDGET_SCHEMA,
      -1,
      this.eosioToken.account.name,
      [
        { key: 'cardid', value: ['uint16', 1] },
        { key: 'name', value: ['string', 'xxx'] },
        { key: 'percentage', value: ['uint16', percentageMultipliedBy100] }, // 4%
      ] as any,
      '',
      [],
      { from: this.eosioToken.account }
    );
  }

  async createToolSchema() {
    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.TOOL_SCHEMA,
      [
        { name: 'cardid', type: 'uint16' },
        { name: 'name', type: 'string' },
        { name: 'img', type: 'string' },
        { name: 'backimg', type: 'string' },
        { name: 'rarity', type: 'string' },
        { name: 'shine', type: 'string' },
        { name: 'material_grade', type: 'uint64' },
        { name: 'type', type: 'string' },
        { name: 'delay', type: 'uint16' },
        { name: 'difficulty', type: 'uint8' },
        { name: 'ease', type: 'uint16' },
        { name: 'luck', type: 'uint16' },
        { name: 'last_mine', type: 'uint32' },
      ],
      { from: this.eosioToken.account }
    );
  }

  async createBoostSchema() {
    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.BOOST_SCHEMA,
      [{ name: 'name', type: 'string' }],
      { from: this.eosioToken.account }
    );
  }

  async createToolTemplate(attributes: { key: string; value: any }[]) {
    await this.createTemplate(this.TOOL_SCHEMA, attributes);
  }

  async createAvatarTemplates() {
    await this.createTemplate(this.AVATAR_SCHEMA, [
      { key: 'cardid', value: ['uint16', 1] },
      { key: 'name', value: ['string', 'Male Avatar'] },
    ]);
    this.MALE_AVATAR_TEMPLATE_ID = await this.getTemplateId(
      this.AVATAR_SCHEMA,
      'Male Avatar'
    );
    await this.createTemplate(this.AVATAR_SCHEMA, [
      { key: 'cardid', value: ['uint16', 2] },
      { key: 'name', value: ['string', 'Female Avatar'] },
    ]);
    this.FEMALE_AVATAR_TEMPLATE_ID = await this.getTemplateId(
      this.AVATAR_SCHEMA,
      'Female Avatar'
    );

    await this.createTemplate(this.AVATAR_SCHEMA, [
      { key: 'cardid', value: ['uint16', 3] },
      { key: 'name', value: ['string', 'Alien Avatar'] },
    ]);
    this.ALIEN_AVATAR_TEMPLATE_ID = await this.getTemplateId(
      this.AVATAR_SCHEMA,
      'Alien Avatar'
    );
  }

  async createMegaboostTemplate() {
    await this.createTemplate(this.BOOST_SCHEMA, [
      { key: 'name', value: ['string', 'Megaboost'] },
    ]);

    this.MEGABOOST_TEMPLATE_ID = await this.getTemplateId(
      this.BOOST_SCHEMA,
      'Megaboost'
    );
    console.log('MEGABOOST_TEMPLATE_ID: ', this.MEGABOOST_TEMPLATE_ID);
  }
  async createSuperboostTemplate() {
    await this.createTemplate(this.BOOST_SCHEMA, [
      { key: 'name', value: ['string', 'Superboost'] },
    ]);

    this.SUPERBOOST_TEMPLATE_ID = await this.getTemplateId(
      this.BOOST_SCHEMA,
      'Superboost'
    );
    console.log('SUPERBOOST_TEMPLATE_ID: ', this.SUPERBOOST_TEMPLATE_ID);
  }

  async createShovelTemplate() {
    await this.createToolTemplate([
      { key: 'cardid', value: ['uint16', 1] },
      { key: 'name', value: ['string', 'Standard Shovel'] },
      {
        key: 'img',
        value: ['string', 'QmYm1FG7LxhF3mFUaVmVEVqRztEmByVbHwL6ZWXwVY2dvb'],
      },
      {
        key: 'backimg',
        value: ['string', 'QmaUNXHeeFvMGD4vPCC3vpGTr77tJvBHjh1ndUm4J7o4tP'],
      },
      { key: 'rarity', value: ['string', 'Abundant'] },
      { key: 'shine', value: ['string', 'Stone'] },
      { key: 'type', value: ['string', 'Extractor'] },
      { key: 'delay', value: ['uint16', '80'] },
      { key: 'difficulty', value: ['uint8', '0'] },
      { key: 'ease', value: ['uint16', '10'] },
      { key: 'luck', value: ['uint16', '39'] },
    ]);

    this.SHOVEL_TEMPLATE_ID = await this.getTemplateId(
      this.TOOL_SCHEMA,
      'Standard Shovel'
    );
    console.log('SHOVEL_TEMPLATE_ID: ', this.SHOVEL_TEMPLATE_ID);
  }

  async createDrillTemplate() {
    await this.createToolTemplate([
      { key: 'cardid', value: ['uint16', 2] },
      { key: 'name', value: ['string', 'Standard Drill'] },
      {
        key: 'img',
        value: ['string', 'QmRG8qeqB4PdQiV4pkVCGLP78HKS9uus5iV6fckysnkcrn'],
      },
      {
        key: 'backimg',
        value: ['string', 'QmaUNXHeeFvMGD4vPCC3vpGTr77tJvBHjh1ndUm4J7o4tP'],
      },
      { key: 'rarity', value: ['string', 'Common'] },
      { key: 'shine', value: ['string', 'Gold'] },
      { key: 'type', value: ['string', 'Extractor'] },
      { key: 'delay', value: ['uint16', '115'] },
      { key: 'difficulty', value: ['uint8', '1'] },
      { key: 'ease', value: ['uint16', '20'] },
      { key: 'luck', value: ['uint16', '39'] },
    ]);

    this.DRILL_TEMPLATE_ID = await this.getTemplateId(
      this.TOOL_SCHEMA,
      'Standard Drill'
    );
  }

  public async getTemplateId(
    schema_name: string,
    name: string,
    collection?: string
  ) {
    if (!collection) {
      collection = this.NFT_COLLECTION;
    }
    const atomic = this.get_atomic();
    const templates = await atomic.getCollectionTemplates(collection);
    const objects = await Promise.all(templates.map((x) => x.toObject()));
    return parseInt(
      objects.find((x) => {
        return (
          x.schema.schema_name == schema_name && x.immutableData.name == name
        );
      }).template_id,
      10
    );
  }

  public async mintShovel(newOwner: string) {
    await this.atomicassets.mintasset(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.TOOL_SCHEMA,
      this.SHOVEL_TEMPLATE_ID,
      newOwner,
      '',
      '',
      [],
      { from: this.eosioToken.account }
    );
  }

  public async mintMegaboost(newOwner: string) {
    await this.atomicassets.mintasset(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.BOOST_SCHEMA,
      this.MEGABOOST_TEMPLATE_ID,
      newOwner,
      '',
      '',
      [],
      { from: this.eosioToken.account }
    );
  }

  public async mintSuperboost(newOwner: string) {
    await this.atomicassets.mintasset(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.BOOST_SCHEMA,
      this.SUPERBOOST_TEMPLATE_ID,
      newOwner,
      '',
      '',
      [],
      { from: this.eosioToken.account }
    );
  }

  public async mintDrill(newOwner: string) {
    await this.atomicassets.mintasset(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.TOOL_SCHEMA,
      this.DRILL_TEMPLATE_ID,
      newOwner,
      '',
      '',
      [],
      { from: this.eosioToken.account }
    );
  }
  private async setupLand() {
    const owners = [
      { id: 1, owner: 'owner1' },
      { id: 2, owner: 'owner2' },
      { id: 3, owner: 'owner3' },
      { id: 4, owner: 'owner1' },
      { id: 5, owner: 'owner2' },
      { id: 6, owner: 'owner4' },
      { id: 7, owner: 'owner5' },
      { id: 8, owner: 'owner11' },
      { id: 9, owner: 'owner12' },
      { id: 10, owner: 'owner13' },
      { id: 11, owner: 'owner14' },
      { id: 12, owner: 'owner15' },
      { id: 13, owner: 'owner21' },
      { id: 14, owner: 'owner22' },
      { id: 15, owner: 'owner23' },
      { id: 16, owner: 'owner24' },
      { id: 17, owner: 'owner25' },
      { id: 18, owner: 'owner31' },
      { id: 19, owner: 'owner32' },
      { id: 20, owner: 'owner33' },
      { id: 21, owner: 'owner34' },
    ];
    await this.atomicassets.createschema(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.LAND_SCHEMA,
      [
        { name: 'cardid', type: 'uint16' },
        { name: 'name', type: 'string' },
        { name: 'nickname', type: 'string' },
        { name: 'img', type: 'image' },
        { name: 'backimg', type: 'image' },
        { name: 'commission', type: 'uint16' },
        { name: 'planet', type: 'uint64' },
        { name: 'rarity', type: 'string' },
        { name: 'delay', type: 'uint8' }, // Delay on land is a multiplier (x10)
        { name: 'difficulty', type: 'uint8' },
        { name: 'ease', type: 'uint8' },
        { name: 'luck', type: 'uint8' },
        { name: 'x', type: 'uint16' },
        { name: 'y', type: 'uint16' },
      ],
      { from: this.eosioToken.account }
    );

    await this.atomicassets.createtempl(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.LAND_SCHEMA,
      true,
      true,
      100,
      [
        { key: 'planet', value: ['uint64', this.nameToInt(this.testplanet)] },
        { key: 'cardid', value: ['uint16', 1] },
        { key: 'img', value: ['string', 'xxx'] },
        { key: 'backimg', value: ['string', 'xxx'] },
        { key: 'name', value: ['string', owner] },
        { key: 'planet', value: ['uint64', this.nameToInt(this.testplanet)] },
        { key: 'delay', value: ['uint8', 1] },
        { key: 'difficulty', value: ['uint8', 15] },
        { key: 'ease', value: ['uint8', 1] },
        { key: 'luck', value: ['uint8', 9] },
      ],
      { from: this.eosioToken.account }
    );

    const res = await this.atomicassets.templatesTable({
      scope: this.eosioToken.account.name,
    });

    this.LAND_TEMPLATE_ID = parseInt(
      res.rows.find((x) => x.schema_name == this.LAND_SCHEMA).template_id,
      10
    );

    for (const { id, owner } of owners) {
      this.landowners.push(await AccountManager.createAccount(owner));

      await this.mintLand(owner);
    }

    await assertRowCount(this.landholders.landregsTable({ limit: 100 }), 21);
  }

  public async mintLand(owner: string, rarity = 'Common') {
    await this.atomicassets.mintasset(
      this.eosioToken.account.name,
      this.NFT_COLLECTION,
      this.LAND_SCHEMA,
      this.LAND_TEMPLATE_ID,
      owner,
      [
        { key: 'cardid', value: ['uint16', 1] },
        { key: 'img', value: ['string', 'xxx'] },
        { key: 'backimg', value: ['string', 'xxx'] },
        { key: 'name', value: ['string', owner] },
        { key: 'planet', value: ['uint64', this.nameToInt(this.testplanet)] },
        { key: 'rarity', value: ['string', rarity] },
      ] as any,
      [{ key: 'commission', value: ['uint16', 1000] }], // 10%
      [],
      { from: this.eosioToken.account }
    );
    const res = await this.atomicassets.assetsTable({
      scope: owner,
    });
    const land = res.rows.find((x) => x.schema_name == this.LAND_SCHEMA);
    chai.expect(land).not.to.be.undefined;
    this.numberOfLands++;
    await this.landholders.setconfig(
      this.numberOfLands,
      ['owner4'],
      '150000.0000 TLM'
    );
    return land;
  }

  public async createPlanet(name: string, symbol: string) {
    const planet_account = await AccountManager.createAccount(name);
    this.planet_accounts[name] = planet_account;
    await this.planets.addplanet(name, 'planet_title', symbol, 'metadata');
    return planet_account;
  }
  /* Use a fresh instance to prevent caching of results */
  public get_atomic() {
    const { RpcApi } = require('atomicassets');

    return new RpcApi('http://localhost:8888', 'atomicassets', {
      fetch,
    });
  }
  public eosTime(date: Date) {
    const dateUTC = moment(date.toUTCString());
    const offset = dateUTC.utcOffset();
    return dateUTC.subtract(offset, 'minutes');
  }

  async issueTokens() {
    this.tokenIssuer = this.infl.account;
    await this.eosioToken.create(
      this.tokenIssuer.name,
      '10000000000.0000 TLM',
      {
        from: new Account(this.NFT_COLLECTION),
      }
    );

    await this.eosioToken.issue(
      this.tokenIssuer.name,
      '1000000000.0000 TLM',
      'initial issue',
      {
        from: this.tokenIssuer,
      }
    );
  }

  public async getBalance(
    user: Account | string,
    contract: TlmToken | Eosdactokens | null = null,
    symbol: string = TLM_SYM // Default to TLM symbol
  ) {
    if (typeof user !== 'string') {
      user = user.name;
    }
    const c = contract ? contract : this.eosioToken;
    try {
      // Use EOSManager.api.rpc.get_table_rows for more direct control
      const res = await EOSManager.api.rpc.get_table_rows({
        code: c.name, // Contract account name
        scope: user, // Account scope
        table: 'accounts', // Table name
        json: true,
        limit: 10, // Limit, might have other tokens
      });

      // Find the row with the correct symbol
      const row = res.rows.find((r) => r.balance && r.balance.includes(symbol));

      if (row) {
        const balance = new Asset(row.balance); // Use constructor
        return balance.amount;
      } else {
        return 0; // Row not found for the symbol
      }
    } catch (e) {
      // Handle potential errors (though get_table_rows usually returns empty rows)
      console.error(`Error in getBalance for ${user}, symbol ${symbol}:`, e);
      return 0; // Assume 0 balance on error
    }
  }
  public nameToInt(name: string) {
    const sb = new Serialize.SerialBuffer({
      textEncoder: new TextEncoder(),
      textDecoder: new TextDecoder(),
    });

    sb.pushName(name);

    const name_64 = new Uint64LE(sb.array);

    return BigInt(name_64 + '');
  }
  public intToName(int: BigInt) {
    int = new Int64LE(int);

    const sb = new Serialize.SerialBuffer({
      textEncoder: new TextEncoder(),
      textDecoder: new TextDecoder(),
    });

    sb.pushArray(int.toArray());

    const name = sb.getName();

    return name;
  }
  public get_utc_time() {
    return moment.utc().toDate();
  }

  static assert_close_enough(a, b, epsilon = 0.00011) {
    chai.expect(Math.abs(a - b)).to.be.lessThan(epsilon);
  }

  public seconds_since_epoch() {
    return Math.round(this.get_utc_time().getTime() / 1000);
  }

  public withLocalOffset(date: any) {
    const dateUTC = moment(date.toDate().toUTCString());
    const offset = dateUTC.utcOffset();
    return dateUTC.add(offset, 'minutes');
  }

  public withRemovedLocalOffset(date: any) {
    const dateUTC = dayjs(date.toDate().toUTCString());
    const offset = dateUTC.utcOffset();
    return dateUTC.subtract(offset, 'minutes');
  }

  public async acceptTerms(user: Account) {
    await this.federation.agreeterms(
      user.name,
      1,
      '1212121212121212121212121212121212121212121212121212121212121212',
      {
        from: user,
      }
    );
  }

  static async add_custom_permission(
    account,
    name,
    parent = 'active',
    contract = null
  ) {
    if (account.account) {
      account = account.account;
    }
    if (contract == null) {
      contract = account;
    }
    const auth_to_set = UpdateAuth.AuthorityToSet.forContractCode(contract);
    await UpdateAuth.execUpdateAuth(
      account.active,
      account.name,
      name,
      parent,
      auth_to_set
    );
  }
  static async linkauth(
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
  static async add_custom_permission_and_link(
    permission_owner,
    permission_name,
    action_owner,
    action_names,
    contract = null
  ) {
    await SharedTestObjects.add_custom_permission(
      permission_owner,
      permission_name,
      'active',
      contract
    );

    try {
      await SharedTestObjects.linkauth(
        permission_owner,
        permission_name,
        action_owner,
        action_names
      );
    } catch (e) {
      if (
        e.message.includes(
          'Attempting to update required authority, but new requirement is same as old'
        )
      ) {
        console.log('Ignoring error: ', e.message);
      } else {
        throw e;
      }
    }
  }

  async singleton_get(res, key) {
    if (!res.rows[0]) {
      return null;
    }
    const data = res.rows[0].data;
    for (const x of data) {
      if (x.key == key) {
        return x.value[1];
      }
    }
  }
} // end of Shared
