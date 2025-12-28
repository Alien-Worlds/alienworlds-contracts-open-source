#!/usr/bin/env node

const fetch = require("node-fetch");
const { Api, JsonRpc } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const RNGData = require('./rngdata');

const config = require('./config');

const rpc = new JsonRpc(config.endpoint, { fetch });
const push_rpc = new JsonRpc(config.push_endpoint, { fetch });
const signatureProvider = new JsSignatureProvider(config.private_keys);
const api = new Api({ rpc: push_rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const read_api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const MAX_UINT32 = 4294967295;
let broadcast = true;

const sleep = async (ms) => {
    return new Promise(resolve => { setTimeout(resolve, ms) });
}

const bots = new Map();
const check_bot = async (account) => {
    try {
        if (bots.has(account)) {
            return bots.get(account);
        }

        const actions = [{
            account: config.mining_contract,
            name: 'testparam',
            authorization: [{
                actor: config.mining_contract,
                permission: config.test_permission,
            }],
            data: {
                key: account
            }
        }];
        const res = await read_api.transact({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30
        });

        console.log(`Sent tx ${res.transaction_id}`);
    }
    catch (e) {
        let found = true;
        // console.error(e.message);
        if (e.message.indexOf('not found') > -1) {
            found = false;
        }

        bots.set(account, found);

        return found;
    }
}

const send_results = async (time, index, results, max_index) => {
    const data = {
        oracle_id: config.oracle_id,
        time,
        index,
        max_index,
        results
    }
    console.log("data: ", JSON.stringify(data, null, 4));

    const actions = [];
    actions.push({
        account: config.mining_contract,
        name: 'rand',
        authorization: [{
            actor: config.mining_contract,
            permission: config.oracle_permission
        }],
        data
    });

    try {
        const res = await api.transact({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast
        });

        console.log(`Processed ${res.transaction_id}`);

        return { success: true, tx_id: res.transaction_id };
    }
    catch (e) {
        console.error(`Error : ${e.message}`);
        const err = e.message.split('::');
        if (err.length >= 3) {
            console.log(" Split could not be split: ", err);
            return { success: false, err_code: err[1], err_msg: err[2] };
        }

        return { success: false, err_code: e.code, err_msg: e.message };
    }
}

const get_winners = (tickets, total_luck, rng, number_winners = 1000) => {
    console.log(`Choosing ${number_winners} winners with ${tickets.size} tickets`, rng);
    const winners = [];
    while (true) {
        let current = 0;
        // console.log(rng.get_uint16());
        const r = rng.get_uint32();
        const w = (r / MAX_UINT32) * total_luck;

        for (let [miner, val] of tickets) {
            // console.log(miner, val)
            // console.log(r);
            current += val.avg_luck;
            if (current >= w) {
                console.log(`Winner is ${miner} on ${val.planet_name} with luck ${val.avg_luck} from ${val.total_mines} mines (${r / MAX_UINT32} ${w} ${current})`);
                if (winners.find(a => a.miner === miner)) {
                    console.log(`${miner} has already won!`);
                }
                else {
                    winners.push({
                        miner,
                        planet_name: val.planet_name,
                        rarities: new Set([...val.rarities.map(r => r.toLowerCase())])
                    });
                }
                break;
            }
        }

        if (winners.length >= number_winners) {
            break;
        }
    }

    return winners;
}

const build_tickets = async (start_time, dev = false) => {
    const end_time = new Date(start_time.getTime() + (60 * 60 * 1000));
    // const end_time = new Date(start_time.getTime() + (10 * 60 * 1000));
    let global_sequence = 0;
    let total_luck = 0;

    const unsorted = new Map();

    // Looping with a 1 second delay incase of minluck fetching errors.
    while (true) {
        try {
            console.log(`Fetching data`);
            const url = `${config.api_url}/v1/alienworlds/mineluck?from=${start_time.toISOString()}&to=${end_time.toISOString()}`;
            const res = await fetch(url);
            // Sample output : 

            /*
            const sample = [{
                "total_luck": 6,
                "total_mines": 1,
                "planets": ["eyeke.world"],
                "tools": [1099542842875, 1099542842876, 1099542842928],
                "avg_luck": 6,
                "rarities": ["Abundant", "Abundant", "Abundant"],
                "miner": "z3.ey.wam"
            },
            {
                "total_luck": 90,
                "total_mines": 1,
                "planets": ["eyeke.world"],
                "tools": [1099540102516, 1099538586807, 1099528530567],
                "avg_luck": 90,
                "rarities": ["Rare", "Rare", "Rare"],
                "miner": "yhjri.wam"
            }]
*/

            const json = await res.json();
            console.log(url);

            if (json.results && json.results.length === 0) {
                break;
            }
            if (!json.results) {
                throw new Error(`Error fetching results`);
            }

            console.log(`Checking ${json.results.length} accounts for bot`)
            for (let r = 0; r < json.results.length; r++) {
                const data = json.results[r];

                if (r % 5000 === 0) {
                    console.log(`Processed ${r} / ${json.results.length} bots`);
                }

                if (!dev && await check_bot(data.miner)) {
                    // console.log(`${result.miner} is a bot`);
                    continue;
                }

                data.planet_name = data.planets[0];
                delete data.planets;

                // console.log(`${data.miner} is not a bot`, data);
                if (data.avg_luck > 0) {
                    unsorted.set(data.miner, data);
                }

                total_luck += data.avg_luck;
            }

            break;
        }
        catch (e) {
            console.error("Error while getting and processing mineluck: ", e.message);
            await sleep(1000);
        }

    }


    // const sorted = new Map([...unsorted].sort());
    // console.log(sorted, total_luck, 'sorted tickets');
    const vips = new Map([...unsorted].filter(([miner, data]) => {
        return (data.rarities.includes('Rare') || data.rarities.includes('Epic') || data.rarities.includes('Legendary') || data.rarities.includes('Mythic'));
    }).sort());
    const commoners = new Map([...unsorted].filter(([miner, data]) => {
        return (!data.rarities.includes('Rare') && !data.rarities.includes('Epic') && !data.rarities.includes('Legendary') && !data.rarities.includes('Mythic'));
    }).sort());

    let vip_total_luck = 0;
    // console.log(commoners.forEach)
    vips.forEach((data) => {
        vip_total_luck += data.avg_luck;
    });

    // vips.forEach(console.log);
    let common_total_luck = 0;
    commoners.forEach((data) => {
        common_total_luck += data.avg_luck;
    });

    // console.log(vips, [...vips].length);
    delete unsorted;
    // process.exit(0)

    const vip_winners = 20;

    return [
        { tickets: commoners, total_luck: common_total_luck, number_winners: total_counts() - vip_winners },
        { tickets: vips, total_luck: common_total_luck, number_winners: vip_winners }
    ]
}

const get_tx_id = async () => {
    let tx_id;

    while (true) {
        const info = await rpc.get_info();
        const lib = info.last_irreversible_block_num;
        // console.log(lib);
        const add_to_lib = parseInt(Math.random() * 30);
        // console.log(add_to_lib);
        const my_block = lib + add_to_lib;
        const block_data = await rpc.get_block(my_block);
        // console.log(block_data);
        const transactions = block_data.transactions.filter(t => t.trx.id)
        if (!transactions.length) {
            console.log(`No valid transactions in block!`);
            await sleep(1000);
            continue;
        }

        // get random tx from that block
        const tx_rnd = Math.floor(Math.random() * (transactions.length - 1));
        tx_id = transactions[tx_rnd].trx.id;

        break;
    }

    return tx_id;
}

const total_counts = () => {
    return config.legendary_count + config.epic_count + config.rare_count + config.common_count + config.abundant_count;
}

const templates = {
    legendary: [],
    epic: [],
    rare: [],
    common: [],
    abundant: []
}

var knownTemplates = new Map();
var fullTemplates = new Set();
const filterMaxOutTemplates = async (templateIds) => {
    var results = []
    for (const templateId of templateIds) {
        if (fullTemplates.has(templateId)) { continue }
        var template = knownTemplates[templateId]
        if (!template) {
            const res = await rpc.get_table_rows({
                code: config.nft_contract,
                scope: 'alien.worlds',
                table: 'templates',
                limit: 1,
                lower_bound: templateId
            });

            if (res.rows.length) {
                const r = res.rows[0];

                template = { issued_supply: r.issued_supply, max_supply: r.max_supply }
                knownTemplates[templateId] = template
            }
        }
        if (template.max_supply == 0 || template.issued_supply < template.max_supply) {
            results.push(templateId)
        } else {
            fullTemplates.add(templateId);
            console.log("filtering out: ", templateId)
        }
    }
    return results;
}

const get_template = async (rarity) => {
    if (!templates[rarity].length) {
        const res = await rpc.get_table_rows({
            code: config.mining_contract,
            scope: config.mining_contract,
            table: 'miningnfts',
            limit: 20
        });

        if (res.rows.length) {
            res.rows.forEach(r => {
                templates[r.rarity] = r.template_ids
            });
        }
    }

    const usableTemplates = await filterMaxOutTemplates(templates[rarity])

    const rnd = Math.floor(Math.random() * usableTemplates.length);
    return usableTemplates[rnd];
}

const allocate_templates = async (winners, rng) => {
    const allocated = new Map([['legendary', 0], ['epic', 0], ['rare', 0], ['common', 0], ['abundant', 0]]);

    for (let w = 0; w < winners.length; w++) {
        const winner = winners[w];

        let possible_rarities = ['abundant'];
        switch (true) {
            case winner.rarities.has('legendary'):
            case winner.rarities.has('mythic'):
                possible_rarities = ['legendary', 'epic', 'rare', 'common', 'abundant'];
                break;
            case winner.rarities.has('epic'):
                possible_rarities = ['epic', 'rare', 'common', 'abundant'];
                break;
            case winner.rarities.has('rare'):
                possible_rarities = ['rare', 'common', 'abundant'];
                break;
            case winner.rarities.has('common'):
                possible_rarities = ['common', 'abundant'];
                break;
        }

        let won_rarity = 'abundant';
        if (possible_rarities.length > 1) {
            const rarity_rand = rng.get_uint8();
            const num = Math.floor((rarity_rand / 256) * possible_rarities.length);
            if (num == possible_rarities.length) {
                num = possible_rarities.length - 1;
            }
            won_rarity = possible_rarities[num];

            if (config[won_rarity + '_count'] > allocated.get(won_rarity)) {
                allocated.set(won_rarity, allocated.get(won_rarity) + 1);
            }
            else if (won_rarity !== 'abundant') {
                // this rarity has already hit the maximum, try again
                w--;
            }
            else {
                allocated.set(won_rarity, allocated.get(won_rarity) + 1);
            }
            // console.log(winner, possible_rarities, won_rarity, num);
        }
        else {
            allocated.set(won_rarity, allocated.get(won_rarity) + 1);
        }

        winners[w].template_id = await get_template(won_rarity);
        winners[w].rarity = won_rarity;
    }

    console.log("allocated: ", allocated);

    return winners;
}

const run = async (dev) => {
    if (dev) {
        console.log('running in dev mode')
    }
    while (true) {
        knownTemplates = new Map();
        try {
            let time = config.genesis_time;

            // Sample singleton response: {time: 1624978800, oracle_id: 1, last_index: 341, max_index: 341}
            const current_res = await push_rpc.get_table_rows({
                code: config.mining_contract,
                scope: config.mining_contract,
                table: 'nftwins'
            });
            if (current_res.rows.length && current_res.rows[0].time > 0) {
                if (current_res.rows[0].last_index == current_res.rows[0].max_index) {
                    time = current_res.rows[0].time + (60 * 60);
                }
                else {
                    time = current_res.rows[0].time;
                }
            }

            // DEV
            if (dev) {
                time = parseInt((new Date()).getTime() / 1000) - 3600;
            }

            console.log(`Start time`, time);
            const start_time = new Date(time * 1000);
            const end_time = new Date((time + 3600) * 1000);
            if (end_time.getTime() > (new Date()).getTime()) {
                await sleep(end_time.getTime() - (new Date()).getTime());
                continue;
            }

            // const one_hour_ago = new Date(new Date().getTime() - (60 * 60 * 1000));
            const tickets_array = await build_tickets(start_time, dev);

            const all_winners = [];

            const tx_id = await get_tx_id();
            const rng = new RNGData(tx_id);

            for (let t = 0; t < tickets_array.length; t++) {
                const tickets = tickets_array[t].tickets;
                const total_luck = tickets_array[t].total_luck;
                const number_winners = tickets_array[t].number_winners;

                if (!tickets.size) {
                    console.error('No tickets');
                    await sleep(5000);
                    continue;
                }

                let winners = get_winners(tickets, total_luck, rng, number_winners);
                while (winners.length) {
                    all_winners.push(winners.pop());
                }
            }

            const winners = await allocate_templates(all_winners, rng);

            // console.log(winners, 'winners')
            // return;

            // send results
            if (dev) {
                broadcast = false;
            }
            let index = 0;
            const max_index = winners.length;
            if (current_res.rows.length && current_res.rows[0].time > 0 && current_res.rows[0].last_index != current_res.rows[0].max_index) {
                index = current_res.rows[0].last_index;
            }
            while (true) {
                const chunk = winners.slice(index, index + config.chunk_length).map(c => {
                    delete c.rarities;
                    return c;
                });
                // console.log(chunk);
                const res = await send_results(time, index, chunk, max_index);
                // console.log(res, time);
                if (res.success) {
                    index += chunk.length;
                }
                else {
                    console.error("result from sending results: ", JSON.stringify(res));
                    /*if (res.err_code === 'INDEX_OUT_ORDER'){
                        const current_res = await rpc.get_table_rows({
                            code: config.mining_contract,
                            scope: config.mining_contract,
                            table: 'nftwins'
                        });
                        if (current_res.rows.length && current_res.rows[0].time > 0 && current_res.rows[0].last_index != current_res.rows[0].max_index){
                            index = current_res.rows[0].last_index;
                        }
                    }*/
                    // try again
                    await sleep(5000);
                    break;
                }
                if (index >= max_index) {
                    break;
                }

                await sleep(1000);
            }
            console.log("tx_id: ", tx_id);

            // break;
        }
        catch (e) {
            console.error(`Error processing tickets ${e.message}`, e);
            await sleep(5000);
        }
    }

    // get_winners(tickets.tickets, tickets.total_luck, 'dfe4edb89c7e6d49dc0744b08e94aa8f948104def24c4633450e9e3784f70179');
}

const dev = (!!process.argv[2]);

run(dev);
