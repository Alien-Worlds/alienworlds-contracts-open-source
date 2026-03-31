#!/usr/bin/env node

/*
Adds mining nfts based on their rarities
 */

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { ExplorerApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');

const mining_contract = 'm.federation';
const sale_contract = 'sale.worlds';
const { atomicassets_account, federation_account, open_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');

const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });


const run = async () => {
    const rarities = ['Abundant', 'Common', 'Rare', 'Epic', 'Legendary', 'Mythical'];
    // const rarities = ['Abundant'];
    const schemas = ['tool.worlds', 'crew.worlds', 'faces.worlds', 'arms.worlds'];

    for (let r = 0; r < rarities.length; r++){
        const rarity = rarities[r];

        const search = {
            rarity
        };
        let templates = await atomic.getTemplates({collection_name}, 1, 100, search);
        // console.log(templates);

        // only ones with some left to mint
        templates = templates.filter(t => parseInt(t.max_supply) !== parseInt(t.issued_supply) || parseInt(t.issued_supply) === 0);
        // only stone
        templates = templates.filter(t => t.immutable_data.shine === 'Stone');
        // only specified schemas
        templates = templates.filter(t => schemas.includes(t.schema.schema_name));
        // no Dacalizer
        templates = templates.filter(t => t.name !== 'Dacalizer');

        templates = templates.filter(t => t.name.indexOf('T8') === -1);
        templates = templates.filter(t => t.name.indexOf('T15') === -1);

        const template_ids = templates.map(t => t.template_id);
        console.log(rarity, template_ids);

        const actions = [{
            account: mining_contract,
            name: 'setnfts',
            authorization: [{
                actor: mining_contract,
                permission: 'active',
            }],
            data: {
                rarity: rarity.toLowerCase(),
                template_ids
            }
        }];


        try {
            const res_create = await transactCleos({
                actions
            }, {
                blocksBehind: 3,
                expireSeconds: 30
            }, [mining_contract], CLEOS, api);

            console.log(`Updated ${rarity} NFTs ${res_create.processed.id}`);
        }
        catch (e){
            console.log(e.message);
            throw e;
        }
    }
}

run();
