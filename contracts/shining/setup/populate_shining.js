#!/usr/bin/env node

const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { ExplorerApi } = require('atomicassets');
const { transactCleos } = require('./transact_cleos');

const shining_account = 's.federation';
const schemas = ['arms.worlds', 'crew.worlds'];

const { atomicassets_account, federation_account, open_account, collection_name, mint_perm, endpoint, aa_endpoint, CLEOS } = require('../../federation/setup/config');


const rpc = new JsonRpc(endpoint, { fetch });
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const sleep = async (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const populate = async () => {

    const prices = {
        Abundant: { Gold: 100 },
        Common: { Gold: 100, Stardust: 100 },
        Rare: { Gold: 150, Stardust: 200, Antimatter: 250 },
        Epic: { Gold: 200, Stardust: 250, Antimatter: 300 },
        Legendary: { Gold: 250, Stardust: 300, Antimatter: 500 },
        Mythical: { Gold: 500, Stardust: 1000, Antimatter: 2000 },
    };

    const start_time = '2021-05-21T17:00:00';

    for (let s = 0; s < schemas.length; s++) {
        const schema = schemas[s];
        console.log(`Populating shining templates for schema ${schema}`);
        // get stone items for this schema
        const stone_templates = await atomic.getTemplates({
            collection_name,
            schema_name: schema
        }, 1, 1000, { shine: 'Stone' });

        for (let t = 0; t < stone_templates.length; t++) {
            const stone_template = stone_templates[t];
            console.log(`Processing ${stone_template.name} (${stone_template.template_id})`);
            // if (stone_template.name !== 'Glavor Disc'){
            //     continue;
            // }
            const index = {
                name: stone_template.name,
                rarity: stone_template.immutable_data.rarity
            };
            if (typeof stone_template.immutable_data.element !== 'undefined') {
                index.element = stone_template.immutable_data.element;
            }
            // console.log(index);

            // fetch all templates for this type
            const all_templates = await atomic.getTemplates({
                collection_name,
                schema_name: schema
            }, 1, 5, index);

            const upgrade_to = ['Stone', 'Gold'];
            if (stone_template.immutable_data.rarity !== 'Abundant') {
                upgrade_to.push('Stardust');
                if (stone_template.immutable_data.rarity !== 'Common') {
                    upgrade_to.push('Antimatter');
                }
            }


            // console.log(all_templates[0]);
            const all_template_data = [];

            for (let u = 1; u < upgrade_to.length; u++) {
                const base_template = all_templates.find(tpl => {
                    if (u === 1 && !tpl.immutable_data.shine) {
                        return upgrade_to[u - 1] === 'Stone';
                    }
                    return tpl.immutable_data.shine === upgrade_to[u - 1];
                });
                const upgrade_template = all_templates.find(tpl => {
                    // console.log(`"${upgrade_to[0]}", "${tpl.immutable_data.shine}"`);
                    return tpl.immutable_data.shine === upgrade_to[u];
                });

                if (!upgrade_template) {
                    console.error(`Error updating ${stone_template.name} ${stone_template.immutable_data.shine} - ${upgrade_to[u]}`);
                    if (stone_template.name !== 'Particle Beam Collider'
                        && stone_template.name !== 'Aioshi Holoform'
                        && stone_template.name !== 'Male Reptiloid'
                        && stone_template.name !== 'Female Reptiloid'
                        && stone_template.name !== 'Commander Church') {
                        throw new Error('err');
                    }
                    continue;
                }
                console.log(`Can update ${base_template.name} (${base_template.immutable_data.rarity}) to ${upgrade_to.join(', ')}`);
                const price = prices[upgrade_template.immutable_data.rarity][upgrade_template.immutable_data.shine];

                console.log(`${base_template.template_id} (${base_template.immutable_data.shine}) is upgraded to ${upgrade_template.template_id} (${upgrade_template.immutable_data.shine}) for ${price} TLM`);

                actions = [];
                actions.push({
                    account: shining_account,
                    name: 'addlookup',
                    authorization: [{
                        actor: shining_account,
                        permission: 'active',
                    }],
                    data: {
                        from: base_template.template_id,
                        to: upgrade_template.template_id,
                        cost: `${price.toFixed(4)} TLM`,
                        qty: 4,
                        start_time,
                        active: true
                    }
                });
                // console.log(JSON.stringify(actions));
                try {
                    const res_tp = await transactCleos({
                        actions
                    }, {
                        blocksBehind: 3,
                        expireSeconds: 30,
                        broadcast: false,
                        sign: false
                    }, shining_account, CLEOS, api);

                    console.log(`Lookup added ${res_tp.transaction_id}`);
                }
                catch (e) {
                    if (e.message.indexOf('Lookup for this template exists') === -1) {
                        console.error(e.message);
                        process.exit(1);
                    }
                }
            }

            await sleep(5000);

            // console.log(all_templates, all_templates.length);
        }

        // console.log(stone_templates);
    }
}

populate();
