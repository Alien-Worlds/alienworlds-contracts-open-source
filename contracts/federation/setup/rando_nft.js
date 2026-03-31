#!/usr/bin/env node

/*
Fills the mining fnt bucket with random nfts until it is full, doesnt touch the mythical bucket
 */

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { ExplorerApi } = require('atomicassets');

const { atomicassets_account, federation_account, open_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');

const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = new JsSignatureProvider(['5JvNW5Yroq6mcgr7oCCgE5bQpMw44ZfUfAaprd1S1zWqtzBEx5L']);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const get_templates = async (rarity) => {
    // console.log(`Getting templates for ${collection_name}`);
    const templates = await atomic.getTemplates({collection_name, schema_name: 'tool.worlds'}, 1, 100, {rarity});
    return templates;
}

const check_bucket = async (rarity) => {
    const common_res = await api.rpc.get_table_rows({
        code: federation_account,
        scope: federation_account,
        table: 'miningnfts',
        lower_bound: rarity.toLowerCase(),
        upper_bound: rarity.toLowerCase()
    });

    // console.log(common_res);
    let count = 0;
    if (common_res.rows.length){
        count = common_res.rows[0].items.length
    }
    console.log(`Have ${count} items in the mining pot for ${rarity}`);

    const max_counts = {
        Common: 100,
        Rare: 40,
        Epic: 20,
        Legendary: 10
    };
    const max_count = max_counts[rarity];
    const templates = await get_templates(rarity)
    // console.log(templates);
    // templates.filter(t => t.schema.schema_name === 'tool.worlds');
    while (count < max_count){
        const rnd_template = templates[parseInt(Math.random() * templates.length)];
        // console.log(rnd_template);
        console.log(`Minting ${rnd_template.name} (${rnd_template.immutable_data.rarity})`);
        // mint nfts to the federation (should be put in basket automatically)
        const mint_data = {
            authorized_minter: federation_account,
            collection_name,
            schema_name: 'tool.worlds',
            template_id: parseInt(rnd_template.template_id),
            new_asset_owner: federation_account,
            immutable_data: [],
            mutable_data: [],
            tokens_to_back: []
        };
        // console.log(mint_data);
        const actions = [{
            account: atomicassets_account,
            name: 'mintasset',
            authorization: [{
                actor: federation_account,
                permission: 'issue',
            }],
            data: mint_data
        }];
        const push_res = await api.transact({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30 + count,
        });

        count++;
    }
};


check_bucket('Common');
check_bucket('Epic');
check_bucket('Legendary');
check_bucket('Rare');
