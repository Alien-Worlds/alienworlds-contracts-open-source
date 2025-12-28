#!/usr/bin/env node

const fetch = require("node-fetch");
const fs = require("fs");
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const { ExplorerApi } = require('atomicassets');
const { transactCleos } = require('./transact_cleos');

const hyperion_endpoint = 'https://api.waxsweden.org';
// const endpoint = 'https://wax.pink.gg';
// const endpoint = 'http://127.0.0.1:28888';
// const endpoint = 'https://api.waxsweden.org';
const endpoint = 'https://waxnode.alienworlds.io';
// const endpoint = 'http://neri.alienworlds.io:58888';
const aa_endpoint = 'https://wax.api.atomicassets.io';
// const aa_endpoint = 'https://test.wax.api.atomicassets.io';
const atomicassets_account = 'atomicassets';
const collection_name = 'alien.worlds';
const terra_account = 'terra.worlds';
// const CLEOS = '/home/mike/Projects/EOS/wax.sh';
const CLEOS = './wax.sh';


const blacklist = ['open.worlds', 'atomictoolsx', 'atomicmarket', 's.rplanet'];
const memo = 'Alien Worlds: Landowner allocation';

const rpc = new JsonRpc(endpoint, { fetch });
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
// const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const sleep = async (ms) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

const generate = async () => {
    let page = 1;
    const landowners = {};
    while (true) {
        const url = `${aa_endpoint}/atomicassets/v1/assets?collection_name=${collection_name}&schema_name=land.worlds&limit=500&page=${page}`

        const res = await fetch(url);
        const res_json = await res.json();

        if (!res_json.data.length) {
            break;
        }
        // console.log(res_json.data.atomicassets_assets.length);
        // break;

        res_json.data.forEach(a => {
            if (typeof landowners[a.owner] === 'undefined') {
                landowners[a.owner] = {
                    account: a.owner,
                    qty: 0
                };
            }
            landowners[a.owner].qty++;
        });

        page++;

        await sleep(500);
    }

    // console.log(landowners);
    const amounts = Object.values(landowners);
    // console.log(amounts);
    const total = amounts.reduce((a, b) => a + b.qty, 0);

    // remove non player accounts
    const to_drop = amounts.filter(d => !blacklist.includes(d.account)).sort((a, b) => (a.qty > b.qty) ? 0 : -1);
    // console.log(to_drop);
    to_drop.forEach(d => {
        console.log(`${d.account},${d.qty}`);
    });
    const to_drop_total = to_drop.reduce((a, b) => a + b.qty, 0);
    console.error(`${total} lands found, ${to_drop_total} to drop`);
}

const filter = async (filename) => {
    console.log(`Filtering ${filename} with memo ${memo}`);
    const csv_data = fs.readFileSync(filename, 'utf-8');
    const lines = csv_data.split(`\n`).filter(l => l);
    const data = lines.map(l => {
        const [account, qty] = l.split(',')
        return { account, qty: parseInt(qty) }
    });

    const limit = 1000;
    const url = `${endpoint}/v2/history/get_actions?account=terra.worlds&filter=alien.worlds:transfer&limit=${limit}&after=2020-04-25T15:00:00&sort=-1`;
    const res = await fetch(url);
    const json = await res.json();
    console.log(json.actions[0]);

    for (let d = 0; d < data.length; d++) {
        try {
            // await sleep(50);

            let been_sent = false;
            if (json.actions.length) {
                // console.log(json.actions);
                for (let a = 0; a < json.actions.length; a++) {
                    if (json.actions[a].act.data.memo === memo && json.actions[a].act.data.to === data[d].account) {
                        // console.log(`Sent to ${data[d].account}`);
                        been_sent = true;
                        break;
                    }
                }
            }

            if (!been_sent) {
                console.log(`${data[d].account},${data[d].qty}`);
            }
        }
        catch (e) {
            console.error(e.message);
        }
    }
}

const send = async (filename, batch_size, dry_run = false, land_allocation = null) => {
    console.log(`Sending from ${filename} with batch size of ${batch_size}`);
    // load csv
    const csv_data = fs.readFileSync(filename, 'utf-8');
    const lines = csv_data.split(`\n`).filter(l => l);
    const data = lines.map(l => {
        const [account, qty] = l.split(',')
        return { account, qty: parseInt(qty) }
    });

    var each_land_allocation = 0.0;

    if (land_allocation) {
        each_land_allocation = land_allocation;
    } else {
        const total_lands = data.reduce((a, b) => a + b.qty, 0);
        console.log(total_lands);

        // get balance of the landholders account to distribute equally
        const bal = await rpc.get_currency_balance('alien.worlds', terra_account, 'TLM');
        const [total_str] = bal[0].split(' ');

        const total = parseFloat(total_str); // for 10 tests

        each_land_allocation = Math.floor((total / total_lands) * 10000) / 10000
        // console.log(bal, each_land_allocation, total_lands);
        // return;
    }

    // filter the list for people that have already received
    const to_send = [];
    for (let d = 0; d < data.length; d++) {
        try {

            const amount_to_send = `${(each_land_allocation * data[d].qty).toFixed(4)} TLM`;

            if (dry_run) {
                console.log(`Fetching TLM transfers for ${data[d].account}`);
            }

            const limit = 100;
            let been_sent = false;
            /*
            const url = `${hyperion_endpoint}/v2/history/get_actions?account=${data[d].account}&filter=alien.worlds:transfer&limit=${limit}&after=2020-03-25T15:00:00`;
            const res = await fetch(url);
            const json = await res.json();
            if (json.actions.length) {
                // console.log(json.actions);
                for (let a = 0; a < json.actions.length; a++) {
                    if (json.actions[a].act.data.memo === memo) {
                        // console.log(json.actions[a].act);
                        been_sent = true;
                        if (amount_to_send !== json.actions[a].act.data.quantity) {
                            console.error(`Invalid amount sent for ${data[d].account}, was ${json.actions[a].act.data.quantity}, should be ${amount_to_send} (${each_land_allocation} * ${data[d].qty})`);
                        }
                        else {
                            console.log(`Already sent to ${data[d].account}`);
                        }
                    }
                }
            }
            await sleep(20);
            */

            if (!been_sent) {
                to_send.push({
                    account: data[d].account,
                    qty: amount_to_send
                });
            }

            if (d % 50 === 0) {
                console.log(`Pre-processed ${d}/${data.length} records`);
            }

        }
        catch (e) {
            console.log(`Failed to get currency transfers for ${data[d].account} ${e.message}`);
            d--;
        }

    }


    // console.log(to_send);

    if (to_send.length === 0) {
        console.error(`Nothing to send!`);
        return;
    }

    console.log(`Sending to ${to_send.length} accounts`);
    await sleep(5000);
    // return;

    let chunk_pos = 0;
    let chunk = to_send.slice(chunk_pos, chunk_pos + batch_size);
    while (chunk.length) {
        try {
            const actions = [];
            chunk.forEach(c => {
                actions.push({
                    account: 'alien.worlds',
                    name: 'transfer',
                    authorization: [{
                        actor: terra_account,
                        permission: 'xfer',
                    }],
                    data: {
                        from: terra_account,
                        to: c.account,
                        quantity: c.qty,
                        memo
                    }
                });
            });

            if (dry_run) {
                chunk.forEach(c => {
                    console.log(`Sending ${c.qty} to ${c.account}`);
                });
            }
            // console.log(actions);

            if (!dry_run) {
                const res = await transactCleos({
                    actions
                }, {
                    blocksBehind: 3,
                    expireSeconds: 30,
                    broadcast: false,
                    sign: false
                }, terra_account, CLEOS, api);

                console.log(`Processed chunk ${chunk_pos} ${res.transaction_id}`);
            }
        }
        catch (e) {
            console.error(`Error processing chunk ${chunk_pos} - ${e.message}`);
        }

        chunk_pos += batch_size;
        chunk = to_send.slice(chunk_pos, chunk_pos + batch_size);
    }
}

const sendPrecalculatedList = async (filename, batch_size, dry_run = false) => {
    console.log(`Sending from ${filename} with batch size of ${batch_size}`);
    // load csv
    const data = JSON.parse(fs.readFileSync(filename, 'utf-8'));

    console.log((data.length))

    const to_send = [];
    // process.exit(1);
    for (let d = 0; d < data.length; d++) {
        try {

            const amount_to_send = `${(data[d].quantity).toFixed(4)} TLM`

            if (dry_run) {
                console.log(`Fetching TLM transfers for ${data[d].account}`);
            }

            to_send.push({
                account: data[d].account,
                qty: amount_to_send
            });

            if (d % 50 === 0) {
                console.log(`Pre-processed ${d}/${data.length} records`);
            }
        }
        catch (e) {
            console.log(`Failed to get currency transfers for ${data[d].account} ${e.message}`);
            d--;
        }
    }

    if (to_send.length === 0) {
        console.error(`Nothing to send!`);
        return;
    }

    console.log(`Sending to ${to_send.length} accounts`);
    await sleep(5000);
    // return;

    let chunk_pos = 0;
    let chunk = to_send.slice(chunk_pos, chunk_pos + batch_size);
    while (chunk.length) {
        try {
            const actions = [];
            chunk.forEach(c => {
                actions.push({
                    account: 'alien.worlds',
                    name: 'transfer',
                    authorization: [{
                        actor: terra_account,
                        permission: 'xfer',
                    }],
                    data: {
                        from: terra_account,
                        to: c.account,
                        quantity: c.qty,
                        memo
                    }
                });
            });

            if (dry_run) {
                chunk.forEach(c => {
                    console.log(`Sending ${c.qty} to ${c.account}`);
                });
            }
            // console.log(actions);

            if (!dry_run) {
                const res = await transactCleos({
                    actions
                }, {
                    blocksBehind: 3,
                    expireSeconds: 30,
                    broadcast: false,
                    sign: false
                }, terra_account, CLEOS, api);

                console.log(`Processed chunk ${chunk_pos} ${res.transaction_id}`);
            }
        }
        catch (e) {
            console.error(`Error processing chunk ${chunk_pos} - ${e.message}`);
        }

        chunk_pos += batch_size;
        chunk = to_send.slice(chunk_pos, chunk_pos + batch_size);
    }
}

var filename = undefined;
var batch_size = undefined;

switch (process.argv[2]) {
    case '--generate':
        generate();
        break;
    case '--send':
        filename = process.argv[3];
        if (!filename) {
            console.error('Must supply filename');
            process.exit(1);
        }
        batch_size = parseInt(process.argv[4]);
        if (isNaN(batch_size)) {
            console.error('Must supply batch size');
            process.exit(1);
        }
        send(filename, batch_size, false, get_excplicit_land_allocation());
        break;
    case '--send-dry-run':
        filename = process.argv[3];
        if (!filename) {
            console.error('Must supply filename');
            process.exit(1);
        }
        batch_size = parseInt(process.argv[4]);
        if (isNaN(batch_size)) {
            console.error('Must supply batch size');
            process.exit(1);
        }

        send(filename, batch_size, true, get_excplicit_land_allocation());
        break;
    case '--send-precalculated-dry-run':
        filename = process.argv[3];
        if (!filename) {
            console.error('Must supply filename');
            process.exit(1);
        }
        batch_size = parseInt(process.argv[4]);
        if (isNaN(batch_size)) {
            console.error('Must supply batch size');
            process.exit(1);
        }

        sendPrecalculatedList(filename, batch_size, true, get_excplicit_land_allocation());
        break;
    case '--send-precalculated':
        filename = process.argv[3];
        if (!filename) {
            console.error('Must supply filename');
            process.exit(1);
        }
        batch_size = parseInt(process.argv[4]);
        if (isNaN(batch_size)) {
            console.error('Must supply batch size');
            process.exit(1);
        }

        sendPrecalculatedList(filename, batch_size, false, get_excplicit_land_allocation());
        break;
    case '--filter':
        // removes all accounts which have already received this payment
        const filenamee = process.argv[3];
        if (!filenamee) {
            console.error('Must supply filename');
            process.exit(1);
        }
        filter(filenamee);
        break;
    default:
        console.error(`Incorrect usage!`);
}


function get_excplicit_land_allocation() {
    const explicit_land_allocation = process.argv[5];
    if (explicit_land_allocation && isNaN(explicit_land_allocation)) {
        console.error('If supplying an explicit_land_allocation it must be a decimal number');
        process.exit(1);
    }
    return explicit_land_allocation
}
// run();
