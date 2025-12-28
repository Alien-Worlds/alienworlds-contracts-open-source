#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { RpcApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');

const pack_contract = 'pack.worlds';
const sale_contract = 'sale.worlds';
// const pack_contract = '1jcjxbr5d3aj';
// const sale_contract = '2y25yjltikdf';
const { atomicassets_account, federation_account, open_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');


const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new RpcApi(endpoint, atomicassets_account, { fetch, rateLimit: 4 });


const testAuction = async (pack) => {

    // Create an auction starting in 5 minutes
    // 10 periods of 9 minutes
    // 1 minute between periods
    // Starting price = 100 WAX
    // Drop by 5 WAX per period
    // extended_asset pack, time_point start_time, foreign_symbol price_symbol,
    // uint64_t start_price, uint32_t period_length, uint32_t break_length, uint64_t price_step, uint8_t period_count

    const now = (new Date()).getTime();
    const add_five_mins = now + (2 * 60 * 60 * 1000);
    const start_time = new Date(add_five_mins);

    // const live_start_time = new Date(1603458000 * 1000);

    let actions = [];
    actions.push({
        account: sale_contract,
        name: 'addauction',
        authorization: [{
            actor: sale_contract,
            permission: 'active',
        }],
        data: {
            pack: {contract: pack_contract, quantity: `1000 ${pack.symbol}`},
            // start_time: start_time.toISOString().replace(/Z$/, ''),
            start_time: start_time.toISOString().replace(/Z$/, ''),
            // price_symbol: {chain: 'wax', symbol: '8,WAX', contract: 'eosio.token'},
            // price_symbol: {chain: 'ethereum', symbol: '18,ETH', contract: ''},
            price_symbol: {chain: 'eos', symbol: '4,EOSDAC', contract: 'eosdactokens'},
            // start_price: 1600 * Math.pow(10, 14),
            // first_step: 720 * Math.pow(10, 14),
            // price_step: 30 * Math.pow(10, 14),
            // start_price: 1600 * Math.pow(10, 8),
            // first_step: 720 * Math.pow(10, 8),
            // price_step: 30 * Math.pow(10, 8),
            start_price: 13000 * Math.pow(10, 4),
            first_step: 4000 * Math.pow(10, 4),
            price_step: 70 * Math.pow(10, 4),
            period_length: (60 * 60 * 2) - 10,
            break_length: 10,
            // period_length: 55,
            // break_length: 5,
            period_count: 36
        }
    });

    try {
        const res_create = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, [federation_account], CLEOS, api);

        console.log(`Auction created on ${sale_contract} in transaction ${res_create.processed.id}`);
    }
    catch (e){
        throw e;
    }
};

const doWork = async () => {
    await testAuction({symbol: 'DACEXC'});
    process.exit(0);
};



doWork();
