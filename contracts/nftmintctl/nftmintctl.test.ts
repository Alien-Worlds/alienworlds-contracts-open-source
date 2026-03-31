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
} from 'lamington';
import * as chai from 'chai';
import { SharedTestObjects } from '../TestHelpers';
import { Nftmintctl } from './nftmintctl';
import dayjs = require('dayjs');

/*
export type NftmintctlATTRIBUTEMAP = Array<{ first: string; second: NftmintctlVariantInt8Int16Int32Int64Uint8Uint16Uint32Uint64Float32Float64StringINT8VECINT16VECINT32VECINT64VECUINT8VECUINT16VECUINT32VECUINT64VECFLOATVECDOUBLEVECSTRINGVEC }>;
export type NftmintctlDOUBLEVEC = Array<string>;
export type NftmintctlFLOATVEC = Array<string>;
export type NftmintctlINT16VEC = Array<number>;
export type NftmintctlINT32VEC = Array<number>;
export type NftmintctlINT64VEC = Array<number>;
export type NftmintctlINT8VEC = string;
export type NftmintctlSTRINGVEC = Array<string>;
export type NftmintctlUINT16VEC = Array<number>;
export type NftmintctlUINT32VEC = Array<number>;
export type NftmintctlUINT64VEC = Array<number|string>;
export type NftmintctlUINT8VEC = string;
*/

/*
      setattrs(template_id: number|string, immutable_data: NftmintctlATTRIBUTEMAP, mutable_data: NftmintctlATTRIBUTEMAP, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
      */
let shared: SharedTestObjects;
let mint_manager: Account;
describe('NFTMintctl', () => {
  let nftmintctl: Nftmintctl;
  let somebody: Account;
  let TEMPLATE_ID: number;
  before(async () => {
    shared = await SharedTestObjects.getInstance();
    nftmintctl = shared.nftmintctl;
    mint_manager = await AccountManager.createAccount('mintmanager');
    somebody = await AccountManager.createAccount();
    await add_permissions();
  });

  context('newconfig', async () => {
    context('auth', async () => {
      /* newconfig(template_id: number, mint_manager: string|number, collection: string|number, mint_frequency: number, market_place: string|number, starting_bid: string, duration: number, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
       */
      it('without mint_manager auth, should raise auth error', async () => {
        await assertMissingAuthority(
          nftmintctl.newconfig(
            1,
            mint_manager.name,
            shared.NFT_COLLECTION,
            5,
            'mymarket',
            '1.0000 TLM',
            5
          )
        );
      });

      // more tests for the function above:

      // with manager that is this contract:
      it('with manager that is this contract', async () => {
        await assertEOSErrorIncludesMessage(
          nftmintctl.newconfig(
            2,
            nftmintctl.account.name,
            shared.NFT_COLLECTION,
            5,
            'mymarket',
            '1.0000 TLM',
            5,
            { from: nftmintctl.account }
          ),
          'Mint manager cannot be this contract.'
        );
      });
    });
    context('with proper auth', async () => {
      before(async () => {
        await shared.atomicassets.addcolauth(
          shared.NFT_COLLECTION,
          mint_manager.name,
          { from: shared.eosioToken.account }
        );
      });
      it('should create a new config', async () => {
        await nftmintctl.newconfig(
          1,
          mint_manager.name,
          shared.NFT_COLLECTION,
          5,
          'mymarket',
          '1.0000 TLM',
          5,
          { from: mint_manager }
        );
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
      it('should not create a new config with the same template id', async () => {
        await assertEOSErrorIncludesMessage(
          nftmintctl.newconfig(
            1,
            mint_manager.name,
            shared.NFT_COLLECTION,
            5,
            'mymarket',
            '1.0000 TLM',
            5,
            { from: mint_manager }
          ),
          'config with template already exists.'
        );
      });
      it('should create another config', async () => {
        await nftmintctl.newconfig(
          2,
          mint_manager.name,
          shared.NFT_COLLECTION,
          5,
          'mymarket',
          '1.0000 TLM',
          5,
          { from: mint_manager }
        );
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
          {
            template_id: 2,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
    });
  });
  context('updateconfig', async () => {
    /* 
    ACTION updateconfig(uint64_t template_id, uint32_t mint_frequency, eosio::name market_place,
        eosio::asset starting_bid, uint32_t duration) {

        auto matching_config =
            _mint_configs.require_find(S<uint64_t>(template_id), "No config for the specified template_id.");

        require_auth(matching_config->mint_manager);

        _mint_configs.modify(matching_config, same_payer, [&](auto &c) {
            c.mint_frequency = mint_frequency;
            c.market_place   = market_place;
            c.starting_bid   = starting_bid;
            c.duration       = duration;
        });
    }
    */
    context('without mint_manager auth', async () => {
      it('should raise auth error', async () => {
        await assertMissingAuthority(
          nftmintctl.updateconfig(1, 5, 'mymarket', '1.0000 TLM', 5)
        );
      });
    });
    context('with proper auth', async () => {
      it('should update the config', async () => {
        await nftmintctl.updateconfig(1, 6, 'mymarket2', '2.0000 TLM', 7, {
          from: mint_manager,
        });
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 6,
            market_place: 'mymarket2',
            starting_bid: '2.0000 TLM',
            duration: 7,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
          {
            template_id: 2,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
    });
  });
  context('setattrs', async () => {
    /*
    ACTION setattrs(uint64_t template_id, ATTRIBUTE_MAP immutable_data, ATTRIBUTE_MAP mutable_data) {
        auto matching_config =
            _mint_configs.require_find(S<uint64_t>(template_id), "No config for the specified template_id.");
        require_auth(matching_config->mint_manager);

        _mint_configs.modify(matching_config, same_payer, [&](auto &c) {
            c.immutable_data = immutable_data;
            c.mutable_data   = mutable_data;
        });
    }
    */
    context('without mint_manager auth', async () => {
      it('should raise auth error', async () => {
        await assertMissingAuthority(nftmintctl.setattrs(1, [], []));
      });
    });
    context('with proper auth', async () => {
      it('should set the attributes', async () => {
        await nftmintctl.setattrs(
          1,
          [{ key: 'a', value: ['string', 'b'] }],
          [{ key: 'c', value: ['string', 'd'] }],
          {
            from: mint_manager,
          }
        );
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 6,
            market_place: 'mymarket2',
            starting_bid: '2.0000 TLM',
            duration: 7,
            active: false,
            immutable_data: [{ key: 'a', value: ['string', 'b'] }],
            mutable_data: [{ key: 'c', value: ['string', 'd'] }],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
          {
            template_id: 2,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
    });
  });
  /*
   ACTION activate(uint64_t template_id, bool active, string message) {
        require_auth(get_self());

        auto matching_config = _mint_configs.require_find(template_id, "No config for the specified template_id.");

        _mint_configs.modify(matching_config, same_payer, [&](auto &c) {
            c.active = active;
        });
    }
    */
  /*
   activate(template_id: number|string, active: boolean, message: string, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
   */
  context('activate', async () => {
    context('without contract auth', async () => {
      it('should raise auth error', async () => {
        await assertMissingAuthority(
          nftmintctl.activate(1, true, '', { from: somebody })
        );
      });
    });
    context('with proper auth', async () => {
      it('should activate the config', async () => {
        await nftmintctl.activate(1, true, '');
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 6,
            market_place: 'mymarket2',
            starting_bid: '2.0000 TLM',
            duration: 7,
            active: true,
            immutable_data: [{ key: 'a', value: ['string', 'b'] }],
            mutable_data: [{ key: 'c', value: ['string', 'd'] }],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
          {
            template_id: 2,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: false,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
      // activate the other config
      it('should activate the other config', async () => {
        await nftmintctl.activate(2, true, '');
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 6,
            market_place: 'mymarket2',
            starting_bid: '2.0000 TLM',
            duration: 7,
            active: true,
            immutable_data: [{ key: 'a', value: ['string', 'b'] }],
            mutable_data: [{ key: 'c', value: ['string', 'd'] }],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
          {
            template_id: 2,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: true,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
      // deactivate the first config
      it('should deactivate the first config', async () => {
        await nftmintctl.activate(1, false, '');
        await assertRowsEqual(nftmintctl.mintconfigsTable(), [
          {
            template_id: 1,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 6,
            market_place: 'mymarket2',
            starting_bid: '2.0000 TLM',
            duration: 7,
            active: false,
            immutable_data: [{ key: 'a', value: ['string', 'b'] }],
            mutable_data: [{ key: 'c', value: ['string', 'd'] }],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
          {
            template_id: 2,
            mint_manager: mint_manager.name,
            collection: shared.NFT_COLLECTION,
            mint_frequency: 5,
            market_place: 'mymarket',
            starting_bid: '1.0000 TLM',
            duration: 5,
            active: true,
            immutable_data: [],
            mutable_data: [],
            next_mint_time: new Date(0),
            number_minted: 0,
          },
        ]);
      });
    });
  });
  /*
  ACTION trigger(uint64_t template_id) {
        auto matching_config = _mint_configs.require_find(template_id, "No config for the specified template_id.");
        auto collection_itr  = atomicassets::collections.require_find(
             matching_config->collection.value, "No collection with this name exists");

        check(std::find(collection_itr->authorized_accounts.begin(), collection_itr->authorized_accounts.end(),
                  matching_config->mint_manager) != collection_itr->authorized_accounts.end(),
            "mint_manager: %s not authorized to mint new assets", matching_config->mint_manager);

        auto current_time = time_point_sec(current_time_point());
        check(matching_config->active, "Minting config is inactive.");
        check(matching_config->next_mint_time >= current_time,
            "Too soon to trigger next mint. current_time: %s, waiting for time: %s", current_time,
            matching_config->next_mint_time);

        auto          templates          = atomicassets::templates_t{NFT_CONTRACT, matching_config->collection.value};
        auto          matching_template  = templates.require_find(template_id, "Unknown template.");
        vector<asset> quantities_to_back = {};

        action(permission_level{get_self(), "issue"_n}, NFT_CONTRACT, "mintasset"_n,
            make_tuple(get_self(), matching_config->collection, matching_template->schema_name,
                matching_config->template_id, get_self(), matching_config->immutable_data,
                matching_config->mutable_data, quantities_to_back))
            .send();
    }
    */
  /*
   	trigger(template_id: number|string, options?: { from?: Account, auths?: ActorPermission[] }): Promise<any>;
  */
  context('trigger', async () => {
    before(async () => {
      await shared.createToolTemplate([
        { key: 'cardid', value: ['uint16', 2] },
        { key: 'name', value: ['string', 'Awesome Tool'] },
        {
          key: 'img',
          value: ['string', 'QmRG8qeqB4PdQiV4pkVCGLP78HKS9uus5iV6fckysnkcrn'],
        },
        {
          key: 'backimg',
          value: ['string', 'QmaUNXHeeFvMGD4vPCC3vpGTr77tJvBHjh1ndUm4J7o4tP'],
        },
        { key: 'rarity', value: ['string', 'Rare'] },
        { key: 'shine', value: ['string', 'Gold'] },
        { key: 'type', value: ['string', 'Extractor'] },
        { key: 'delay', value: ['uint16', '115'] },
        { key: 'difficulty', value: ['uint8', '1'] },
        { key: 'ease', value: ['uint16', '20'] },
        { key: 'luck', value: ['uint16', '39'] },
      ]);

      TEMPLATE_ID = await shared.getTemplateId(
        shared.TOOL_SCHEMA,
        'Awesome Tool'
      );

      await nftmintctl.newconfig(
        TEMPLATE_ID,
        mint_manager.name,
        shared.NFT_COLLECTION,
        6,
        'mymarket2',
        '2.0000 TLM',
        7,
        { from: mint_manager }
      );
      // activate
      await nftmintctl.activate(TEMPLATE_ID, true, '');
      // setattrs
      await nftmintctl.setattrs(
        TEMPLATE_ID,
        [
          { key: 'luck', value: ['uint16', '23'] },
          { key: 'delay', value: ['uint16', '42'] },
          { key: 'shine', value: ['string', 'abcd'] },
        ],
        [{ key: 'ease', value: ['uint16', '42'] }],
        { from: mint_manager }
      );

      console.log('TEMPLATE_ID: ', TEMPLATE_ID);
    });
    context('if mintmanager is not authorized to mint', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          nftmintctl.trigger(TEMPLATE_ID, { from: somebody }),
          'The minter is not authorized within the collection'
        );
      });
    });
    context('if mintmanager is authorized to mint', async () => {
      let asset: any;
      before(async () => {
        await shared.atomicassets.addcolauth(
          shared.NFT_COLLECTION,
          nftmintctl.account.name,
          { from: shared.eosioToken.account }
        );
      });
      it('should fail if the config does not exist', async () => {
        await assertEOSErrorIncludesMessage(
          nftmintctl.trigger(23, { from: somebody }),
          'No config for the specified template_id.'
        );
      });
      it('should fail if the config is inactive', async () => {
        await assertEOSErrorIncludesMessage(
          nftmintctl.trigger(1, { from: somebody }),
          'Minting config is inactive.'
        );
      });
      it('should succeed', async () => {
        await nftmintctl.trigger(TEMPLATE_ID);
      });
      it('should have updated config', async () => {
        // chai.expect(datetime).closeToTime(now(), 5);
        const res = await nftmintctl.mintconfigsTable();
        const row = res.rows.find((row) => row.template_id === TEMPLATE_ID);
        chai
          .expect(row.next_mint_time)
          .to.be.closeToTime(dayjs().add(7, 'seconds').toDate(), 3);
        chai.expect(row.number_minted).to.equal(1);
      });
      it('should have transferred the asset', async () => {
        const res = await shared.atomicassets.assetsTable({
          scope: shared.atomicmarket.name,
        });
        asset = res.rows.find((row) => row.template_id === TEMPLATE_ID);
        chai.expect(asset).not.to.be.undefined;
      });
      it('nft should have expected attributes', async () => {
        const atomic = shared.get_atomic();
        const res = await atomic.getAsset(
          shared.atomicmarket.name,
          asset.asset_id
        );
        const mutableData = await res.mutableData();
        const immutableData = await res.immutableData();
        chai
          .expect(immutableData)
          .to.deep.equal({ shine: 'abcd', delay: 42, luck: 23 });
        chai.expect(mutableData).to.deep.equal({ ease: 42 });
      });
      it('should have announced the auction', async () => {
        const res = await shared.atomicmarket.auctionsTable();
        const auction = res.rows.find(
          (row) => row.asset_ids[0] === asset.asset_id
        );
        chai.expect(auction).not.to.be.undefined;
        chai.expect(auction.starting_bid).to.equal('2.0000 TLM');
        chai.expect(auction.duration).to.equal(7);
        chai.expect(auction.maker_marketplace).to.equal('mymarket2');
      });
    });
  });
});

async function add_permissions() {
  await SharedTestObjects.add_custom_permission_and_link(
    shared.nftmintctl,
    'issue',
    shared.atomicassets,
    'mintasset'
  );
  await SharedTestObjects.add_custom_permission_and_link(
    shared.nftmintctl,
    'xfer',
    shared.atomicassets,
    'transfer'
  );
  await SharedTestObjects.add_custom_permission_and_link(
    shared.nftmintctl,
    'announce',
    shared.atomicmarket,
    'announceauct'
  );
}
