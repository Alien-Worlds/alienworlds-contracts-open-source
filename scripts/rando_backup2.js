#!/usr/bin/env node

/*
Processes randos in an emergency
 */

const fetch = require("node-fetch");
const fs = require('fs');
const readline = require('readline');
const {TextDecoder, TextEncoder} = require('text-encoding');
const {Api, JsonRpc, Serialize} = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');

const mining_account = 'm.federation';
// const endpoint = 'https://api.waxsweden.org';
// const endpoint = 'https://wax.eosdac.io';
// const endpoint = 'https://wax-test.eosdac.io';
const endpoint = 'http://127.0.0.1:28888';
const rand_perm = 'rando';

const private_data = require('./rando_backup.private');

const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = new JsSignatureProvider([private_data.pk]);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const sleep = async (ms) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

(async () => {
    while (true){
        try {
            const try_length = 30;
            // check if we have more than try_length in the queue
            const res = await rpc.get_table_rows({
                code: mining_account,
                scope: mining_account,
                table: 'randos2',
                limit: try_length
            });

            if (res.rows.length >= try_length){
                console.log(`Got ${res.rows.length} rows`);
                // console.log(res.rows);
                // get randomish block
                const info = await rpc.get_info();
                const lib = info.last_irreversible_block_num;
                // console.log(lib);
                const add_to_lib = parseInt(Math.random() * 30);
                // console.log(add_to_lib);
                const my_block = lib + add_to_lib;
                const block_data = await rpc.get_block(my_block);
                // console.log(block_data);
                if (!block_data.transactions.length){
                    console.log(`No transactions in block!`);
                    await sleep(1000);
                    continue;
                }

                // get random tx from that block
                const tx_rnd = parseInt(Math.random() * (block_data.transactions.length - 1));
                const tx_id = block_data.transactions[tx_rnd].trx.id;

                if (typeof tx_id === 'undefined'){
                    await sleep(1000);
                    continue;
                }

                console.log(my_block, tx_id);

                const actions = [{
                    account: mining_account,
                    name: 'receiverand2',
                    authorization: [{
                        actor: mining_account,
                        permission: rand_perm,
                    }],
                    data: {
                        assoc_id: my_block,
                        random_value: tx_id
                    }
                }];
                try {
                    const res = await api.transact({
                        actions
                    }, {
                        blocksBehind: 3,
                        expireSeconds: 30
                    });
                    console.log(`Processed tx ${res.transaction_id}`);
                }
                catch (e){
                    console.error(e);
                }
            }
            else {
                console.log(`waiting...`);
            }
        }
        catch (e){
            console.error(e.message);
        }

        // await sleep(parseInt(Math.random() * 1) * 1000);
        await sleep(1000);
    }

})();

