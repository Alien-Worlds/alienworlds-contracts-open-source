#!/usr/bin/env -S node --max-old-space-size=32768

const crypto = require("crypto");
const fs = require("fs");
const cluster = require('cluster');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const { ExplorerApi } = require("atomicassets");
const fetch = require("node-fetch");

const state_table = 'state3';
const atomicassets_account = 'atomicassets';
const federation_account = 'federation';
const mining_account = 'm.federation';
const collection = 'alien.worlds';
const env = (process.env.CONFIG)?process.env.CONFIG:'dev';
console.log(`Config environment set to ${env}`);
const config = require('./config.' + env);

const aa_api = new ExplorerApi(config.atomic_endpoint, atomicassets_account, {fetch, rateLimit: 4});
const eos_rpc = new JsonRpc(config.endpoint, {fetch});
const signatureProvider = new JsSignatureProvider([config.mine_pk]);
const eos_api = new Api({ rpc: eos_rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const { getBag, setBag, getLand, setLand, getLandByPlanet, getPlayerData, getTools, getPlanets, getLandMiningParams, getBagMiningParams, getNextMineDelay, lastMineTx, doWork, doWorkWorker } = require('./mine');


const sleep = async (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

const get_pot = async (planet_name) => {
    const res = await eos_rpc.get_table_rows({
        code: mining_account,
        scope: planet_name,
        table: 'state3'
    });
    // console.log(planet_name, res.rows);
    const planet_data = res.rows[0];
    const now = parseInt((new Date()).getTime() / 1000);
    const last_fill = parseInt((new Date(Date.parse(planet_data.last_fill_time.replace(/\.[05]00/, '')))).getTime() / 1000);
    const diff = now - last_fill;
    const sats_fill = parseFloat(planet_data.fill_rate) * diff;
    const [mine_bucket_str] = planet_data.mine_bucket.split(' ');
    const current_bucket = (parseFloat(mine_bucket_str) + (sats_fill / 10000)).toFixed(4);
    // console.log(`${planet_name} - ${current_bucket} TLM`);

    return { planet_name, current_bucket };
}

const get_best_planet = async () => {
    const planets = ['eyeke.world', 'magor.world', 'kavian.world', 'neri.world', 'naron.world', 'veles.world'];
    const pots = [];
    for (let p = 0; p < planets.length; p++){
        pots.push(await get_pot(planets[p]));
    }
    return pots.sort((a, b) => (parseFloat(a.current_bucket) < parseFloat(b.current_bucket))?1:-1)[0];
}


const mine = async (account) => {

    let [account_name, account_permission] = account.split('@');
    if (!account_permission){
        account_permission = 'active';
    }
    account = account_name;

    let land;
    try {
        land = await getLand(mining_account, account, eos_rpc, aa_api);
    }
    catch (e){
        console.error(`Failed to get land for ${mining_account}`);
    }
    if (!land){
        console.log(`${account} Land not found, setting land to ${config.land_id}`);
        await setLand(mining_account, account, config.land_id, eos_api, account_permission);

        land = await getLand(federation_account, mining_account, account, eos_rpc, aa_api);
    }

    console.log(`${account} Fetching bag... `);
    const bag = await getBag(mining_account, account, eos_rpc, aa_api);
    if (bag.length === 0){
        console.error(`${account} Bag empty - getting owned tools`);
        // Check that i have the free asset and set it to my bag
        const tools = await getTools(account, aa_api, collection);
        if (tools.length){
            console.log(`${account} Setting bag`);
            await setBag(mining_account, account, tools.slice(0, 3).map(t => t.asset_id), eos_api, account_permission);
        }
        else {
            console.log(`${account} No tools owned`);
            return;
        }
    }
    console.log(bag.map((i) => {
        return `${i.data.name}, delay = ${i.data.delay}, difficulty = ${i.data.difficulty}, ease = ${i.data.ease}, luck = ${i.data.luck}`;
    }).join("\n"));
    process.stdout.write(`${account} Fetching mining params... `);
    const params = getBagMiningParams(bag, eos_rpc);
    console.log(params);
    // params.delay = 6;
    const land_params = getLandMiningParams(land);
    process.stdout.write(`${account} Fetching land mining params... `, land_params);
    params.delay *= (land_params.delay / 10);
    params.ease *= (land_params.ease / 10);
    params.difficulty += land_params.difficulty;
    console.log(params);
    // params.delay = 0;

    let mine_delay = await getNextMineDelay(mining_account, account, params, eos_rpc);
    if (mine_delay === -1){
        // first mine, set a random delay
        const ten_minutes = 60 * 10 * 1000;
        mine_delay = parseInt(Math.random() * ten_minutes);
        console.log(`${account} Setting mine delay to random for first mine ${mine_delay}`);
        // mine_delay = 1;
    }
    // mine_delay = 6000; // only for testing
    const five_minutes = 60 * 5 * 1000;
    if (mine_delay > five_minutes){
        // next mine is more than 5 minutes away, wait until 5 mins before to start work
        console.log(`${account} Waiting to start work... ${(mine_delay - five_minutes) / 1000} seconds`);
        await sleep(mine_delay - five_minutes);
        mine_delay = five_minutes;
    }

    const last_mine_tx = await lastMineTx(mining_account, account, eos_rpc);
    const mine_work = await doWork({mining_account, account, difficulty:params.difficulty, last_mine_tx});

    // wait until our time to mine
    console.log(`${account} Waiting to push mine results... ${(mine_delay) / 1000} seconds`);
    await sleep(mine_delay);

    const best_planet = await get_best_planet();
    if (typeof config.lands[best_planet.planet_name] !== 'undefined' && config.lands[best_planet.planet_name] !== ''){
        console.log(`Switching land to ${best_planet.planet_name}`);
        await setLand(mining_account, account, config.lands[best_planet.planet_name], eos_api, account_permission);
    }

    mine_delay = await getNextMineDelay(mining_account, account, params, eos_rpc);
    while (mine_delay > 0){
        await sleep(mine_delay);
        mine_delay = await getNextMineDelay(mining_account, account, params, eos_rpc);
    }

    console.log(`${account} Pushing mine results...`);
    const mine_data = {
        miner: account,
        nonce: mine_work.rand_str
    };
    console.log(mine_data);
    // return;
    try {
        const actions = [{
            account: mining_account,
            name: 'mine',
            authorization: [{
                actor: account,
                permission: account_permission,
            }],
            data: mine_data
        }];
        const res = await eos_api.transact({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 90,
        });

        return res;
    }
    catch (e){
        console.log(`Failed to push mine results ${e.message}`);
    }

}

const mine_bot = async () => {
    const miner_accounts = fs.readFileSync(`./mining_accounts.${env}.txt`).toString().split('\n').filter(a => a);
    // const miner_accounts = [fs.readFileSync(`./mining_accounts.txt`).toString().split('\n').filter(a => a)[0]];
    // console.log(miner_accounts);

    if (cluster.isMaster){
        miner_accounts.forEach((miner) => {
            const worker = cluster.fork();
            worker.send(miner);
        });
    }
    else {
        process.on('message', async (account) => {
            console.log(`Mining for account ${account}`);
            while (true){
                try {
                    res = await mine(account);

                    if (res && res.processed){
                        res.processed.action_traces[0].inline_traces.forEach((t) => {
                            if (t.act.data.quantity){
                                const mine_amount = t.act.data.quantity;
                                console.log(`${account} Mined ${mine_amount}`);
                            }
                        });
                    }
                    else {
                        //process.exit(0);
                        console.error(`Mine failed on chain`, res);
                    }

                }
                catch (e){
                    console.error(`${account} Mine failed ${e.message}`);
                }
            }
        });
    }

};

mine_bot();
// mine('evilmikehere');

//


