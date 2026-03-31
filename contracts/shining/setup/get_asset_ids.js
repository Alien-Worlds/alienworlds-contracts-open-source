#!/usr/bin/env node

const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { ExplorerApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');

const atomicassets_account = 'atomicassets';
const collection_name = 'alien.worlds';
const shining_contract = 's.federation';
const endpoint = 'https://wax-test.eosdac.io';
const CLEOS = '/home/mike/Projects/EOS/wax-testnet.sh';
const aa_endpoint = 'https://test.wax.api.atomicassets.io';


const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });




const run = async (template_id) => {
    const assets = await atomic.getAssets({collection_name, template_id, owner: 'evilmikehere'}, 1, 4);
    console.log(JSON.stringify(assets.map(a => a.asset_id)));

}


run(12812);

