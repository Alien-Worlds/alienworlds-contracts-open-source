#!/usr/bin/env node

const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { ExplorerApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');

const atomicassets_account = 'atomicassets';
const collection_name = 'alien.worlds';
const shining_contract = 's.federation';
// const endpoint = 'https://wax-test.eosdac.io';
// const CLEOS = '/home/mike/Projects/EOS/wax-testnet.sh';
// const aa_endpoint = 'https://test.wax.api.atomicassets.io';

const endpoint = 'https://api.waxsweden.org';
const CLEOS = '/home/mike/Projects/EOS/wax.sh';
const aa_endpoint = 'https://wax.api.atomicassets.io';


const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });



const get_genesis_id = async () => {
    const assets = await atomic.getAssets({collection_name, order:'asc'}, 1, 1);
    return assets[0].asset_id;
}

const set_genesis_id = async (genesis_id) => {
    actions = [];
    actions.push({
        account: shining_contract,
        name: 'setgenesisid',
        authorization: [{
            actor: shining_contract,
            permission: 'active',
        }],
        data: {
            genesis_id
        }
    });
    // console.log(JSON.stringify(actions, '', 4));
    const res_tp = await transactCleos({
        actions
    }, {
        blocksBehind: 3,
        expireSeconds: 30
    }, shining_contract, CLEOS, api);
}

const run = async () => {
    const genesis_id = await get_genesis_id();

    console.log(`Genesis ID is : ${genesis_id}`);

    await set_genesis_id(genesis_id);
}


run();

