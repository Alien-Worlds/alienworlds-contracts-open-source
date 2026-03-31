#!/usr/bin/env node

const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { RpcApi } = require('atomicassets');

const atomicassets_account = 'atomicassets';
// const atomicassets_account = 'assetstest55';
const federation_account = 'federation';
// const collection_name = 'alien.worlds';
const collection_name = 'test.worlds';
const endpoint = 'https://wax-test.eosdac.io';
const CLEOS = '/home/mike/Projects/EOS/wax-testnet.sh';


const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new RpcApi(endpoint, atomicassets_account, { fetch, rateLimit: 4 });


const required_schemas = ['tool.worlds', 'arms.worlds'];
const template_ids = {};

const run = async () => {
    const collection = await atomic.getCollection(collection_name);
    const templates = await atomic.getCollectionTemplates(collection_name);

    // console.log(templates);
    for (let t=0; t<templates.length; t++){
        const template_obj = await templates[t].toObject();
        if (required_schemas.includes(template_obj.schema.schema_name)){
            const rarity = template_obj.immutableData.rarity.toLowerCase();
            // console.log(template_obj.immutableData)
            if (rarity !== 'abundant' && template_obj.immutableData.shine === 'Stone'){
                if (typeof template_ids[rarity] === 'undefined'){
                    template_ids[rarity] = [];
                }
                template_ids[rarity].push(parseInt(template_obj.template_id));
            }

        }

    }

    console.log(template_ids);

    return template_ids;
};

run().then((template_ids) => {
    console.log('DONE');

    for (let r in template_ids){
        const data = [r, template_ids[r]]
        console.log(JSON.stringify(data));
    }

    process.exit(0);
});
