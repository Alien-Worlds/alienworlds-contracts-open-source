#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { ExplorerApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');
const Uint64LE = require("int64-buffer").Uint64LE;

const schema_name = 'land.worlds';
const { atomicassets_account, federation_account, open_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');


const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });


const run = async () => {
    let total_found = 0;
    let page = 1;
    let land_assets = [];
    let land_assets_res = await atomic.getAssets({collection_name, schema_name}, page, 1000);
    while (true){
        page++;
        total_found += land_assets_res.length;
        land_assets = land_assets.concat(land_assets_res.filter(l => l.owner === federation_account).map(l => l.asset_id));
        land_assets_res = await atomic.getAssets({collection_name, schema_name}, page, 1000);

        if (land_assets_res.length === 0){
            break;
        }
    }
    console.log(`Found total of ${land_assets.length} land assets`);
    if (land_assets.length != 3343){
        console.error(`Invalid number of land assets found`);
        process.exit(1);
    }

    while (land_assets.length){
        const chunk = land_assets.splice(0, 50);

        const actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'transfer',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: {
                from: federation_account,
                to: open_account,
                asset_ids: chunk,
                memo: 'Land for packs'
            }
        });
        actions.push({
            account: open_account,
            name: 'fillcrate',
            authorization: [{
                actor: open_account,
                permission: 'active',
            }],
            data: {
                crate_name: 'land',
                filler: federation_account
            }
        });
        const res_col = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, [federation_account, open_account], CLEOS, api);
        console.log(res_col.transaction_id);
    }
}

const reverse = async () => {
    // send all the assets back to federation and clear crateassets
    let page = 1;
    let land_assets = [];
    let land_assets_res = await atomic.getAssets({collection_name, schema_name, owner: open_account}, page, 1000);
    while (true){
        page++;
        land_assets = land_assets.concat(land_assets_res.filter(l => l.owner === open_account).map(l => l.asset_id));
        land_assets_res = await atomic.getAssets({collection_name, schema_name, owner: open_account}, page, 1000);

        if (land_assets_res.length === 0){
            break;
        }
    }
    console.log(`Found total of ${land_assets.length} land assets to send back`);

    while (land_assets.length){
        const chunk = land_assets.splice(0, 50);

        const actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'transfer',
            authorization: [{
                actor: open_account,
                permission: 'active',
            }],
            data: {
                from: open_account,
                to: federation_account,
                asset_ids: chunk,
                memo: 'Return land for packs'
            }
        });
        const res_col = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, [open_account], CLEOS, api);
        console.log(res_col.transaction_id);
    }


    console.log(`Empty crate`);
    const actions = [];
    actions.push({
        account: open_account,
        name: 'emptycrate',
        authorization: [{
            actor: open_account,
            permission: 'active',
        }],
        data: {
            crate_name: 'land'
        }
    });
    const res_col = await transactCleos({
        actions
    }, {
        blocksBehind: 3,
        expireSeconds: 30,
        broadcast: false,
        sign: false
    }, [open_account], CLEOS, api);
    console.log(res_col.transaction_id);
}

run().then(process.exit);
// reverse();
