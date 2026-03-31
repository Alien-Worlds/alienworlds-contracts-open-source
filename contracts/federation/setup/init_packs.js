#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { ExplorerApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');

const { atomicassets_account, federation_account, open_account, pack_account, sale_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');

const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const crates = [
    { "name": "common", "type": "template", "rarity": "Common", "exclude": ["Female Human", "Male Human", "Standard Shovel", "Standard Drill"] },
    { "name": "rare", "type": "template", "rarity": "Rare", "exclude": ["Female Cyborg T8", "Male Cyborg T15"] },
    { "name": "epic", "type": "template", "rarity": "Epic", "exclude": ["Dacalizer"] },
    { "name": "legendary", "type": "template", "rarity": "Legendary", "exclude": [] },
    { "name": "mythical", "type": "template", "rarity": "Mythical", "exclude": [] },
    { "name": "dac", "type": "template", "exclude": [], "include": ["Dacalizer"] },
];

const std_drop = [
    { "crate_name": "common", "probability": 598 },
    { "crate_name": "rare", "probability": 310 },
    { "crate_name": "epic", "probability": 81 },
    { "crate_name": "legendary", "probability": 10 },
    { "crate_name": "mythical", "probability": 1 }
];

const rare_drop = [
    { "crate_name": "rare", "probability": 1000 }
];
const epic_drop = [
    { "crate_name": "epic", "probability": 1000 }
];
const legendary_drop = [
    { "crate_name": "legendary", "probability": 1000 }
];
const land_drop = [
    { "crate_name": "land", "probability": 1000 }
];
const dac_drop = [
    { "crate_name": "common", "probability": 578 },
    { "crate_name": "rare", "probability": 300 },
    { "crate_name": "epic", "probability": 80 },
    { "crate_name": "dac", "probability": 20 },
    { "crate_name": "legendary", "probability": 20 },
    { "crate_name": "mythical", "probability": 2 }
];


const std_drop_probabilities = '<ul>' +
    '<li>Common : 59.8%</li>' +
    '<li>Rare : 31%</li>' +
    '<li>Epic : 8.1%</li>' +
    '<li>Legendary : 1%</li>' +
    '<li>Mythical : 0.1%</li>' +
    '</ul>';

const dac_drop_probabilities = '<ul>' +
    '<li>Common : 57.8%</li>' +
    '<li>Rare : 30%</li>' +
    '<li>Epic : 8%</li>' +
    '<li>DAC Special Item : 2%</li>' +
    '<li>Legendary : 2%</li>' +
    '<li>Mythical : 0.2%</li>' +
    '</ul>';

const packs = [
    {
        symbol: 'BASE', key: 'base', fungible: '0.0000 TLM', name: 'Standard Launch Pack',
        max: 6800, description: '<p class="highlight"><b>Type:</b></p><p>Four cards of any type (Tool, Avatar, Weapon or Minion) <b>except Land</b>. ' +
            'Type is random; your pack could contain four cards of the same type.</p>' +
            '<p class="highlight"><b>Rarity:</b></p><p>Each card has the below probabilities of being of the rarity listed. Each card is drawn independently, ' +
            'so your pack could contain four cards of the same rarity.</p>' + std_drop_probabilities,
        cards: [std_drop, std_drop, std_drop, std_drop],
        img: 'QmXLHNLJUiQcNGBnGqQyNvabwvEVTZ4XspjT6vKmtFHFo6'
    },
    {
        symbol: 'RARE', key: 'rare', fungible: '0.0000 TLM', name: 'Rare Launch Pack',
        max: 4500, description: '<p>6 cards have the following probabilities</p>' +
            std_drop_probabilities +
            '<p>In addition, 2 cards are guaranteed to be Rare</p>',
        cards: [std_drop, std_drop, std_drop, std_drop, std_drop, std_drop, rare_drop, rare_drop],
        img: 'QmX7w4mpEXSSZXEffzZ3jmDSUGR6E14vFUPEMMtomwe9XZ'
    },
    {
        symbol: 'LEG', key: 'leg', fungible: '0.0000 TLM', name: 'Legendary Launch Pack',
        max: 3300, description: '<p>6 cards have the following probabilities</p>' +
            std_drop_probabilities +
            '<p>In addition, 1 card is guaranteed to be Epic and 1 card is guaranteed to be Legendary</p>',
        cards: [std_drop, std_drop, std_drop, std_drop, std_drop, std_drop, epic_drop, legendary_drop],
        img: 'QmVWZgQmNCfRuojyQnj8BTtFJ4eVcYy9RUbAiUc5cF6xsm'
    },
    {
        symbol: 'LAND', key: 'land', fungible: '0.0000 TLM', name: 'Special Land Launch Pack',
        max: 3343, description: '<p>4 cards have the following probabilities</p>' +
            std_drop_probabilities +
            '<p>In addition, 2 cards are guaranteed to be Epic and 1 card is guaranteed to be Legendary.  The final card will be a land card.</p>',
        cards: [std_drop, std_drop, std_drop, std_drop, epic_drop, epic_drop, legendary_drop, land_drop],
        img: 'QmT1GmQMif6zugCdRDKYsLpvXe249aiFsZLuFWqTpvacEN'
    },
    {
        symbol: 'PROMO', key: 'promo', fungible: '2000.0000 TLM', name: 'Special Promo Pack',
        max: 16000, description: std_drop_probabilities + '<p>Plus random Trilium bonus up to 2000 TLM</p>',
        cards: [std_drop],
        img: 'QmNtrFMbGydFqFuZdZKvGnzCDKmkjVrkeMKUoS9JhJWiYR'
    },
    {
        symbol: 'DACPRO', key: 'dacpro', fungible: '2000.0000 TLM', name: 'eosDAC Promo Pack',
        max: 2000, description: dac_drop_probabilities + '<p>Plus random Trilium bonus up to 2000 TLM</p>',
        cards: [dac_drop],
        img: 'QmQ11mhSpoKnF3Juz3i9HjWfw8xBgNGoyMjqyuAJWRySHs'
    },
    {
        symbol: 'DACEXC', key: 'dacexc', fungible: '0.0000 TLM', name: 'eosDAC Exclusive Pack',
        max: 1000, description: dac_drop_probabilities,
        cards: [dac_drop, dac_drop, dac_drop, dac_drop],
        img: 'QmbLCA1kVcks7ES9MdMRtuswwsZ8dM53ATLtHr4skTJuqy'
    }
];

const createTokens = async () => {
    for (let p = 0; p < packs.length; p++){
        const pack = packs[p];
        const actions = [];
        actions.push({
            account: pack_account,
            name: 'create',
            authorization: [{
                actor: pack_account,
                permission: 'active',
            }],
            data: {
                issuer: federation_account,
                maximum_supply: `${pack.max} ${pack.symbol}`
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
            }, [pack_account], CLEOS, api);

            console.log(`Token ${pack.symbol} created in transaction ${res_create.processed.id}`);
        }
        catch (e){
            if (e.message.indexOf('token with symbol already exists') > -1){
                console.log(`Token ${pack.symbol} already exists`);
            }
            else {
                throw e;
            }
        }
    }
}

const issueTokens = async () => {
    for (let p = 0; p < packs.length; p++){
        const pack = packs[p];
        const actions = [];
        actions.push({
            account: pack_account,
            name: 'issue',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: {
                to: federation_account,
                quantity: `${pack.max} ${pack.symbol}`,
                memo: 'Issue packs'
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

            console.log(`Token ${pack.symbol} issued in transaction ${res_create.processed.id}`);
        }
        catch (e){
            if (e.message.indexOf('quantity exceeds available supply') > -1){
                console.log(`Token ${pack.symbol} already issued`);
            }
            else {
                throw e;
            }
        }
    }
};

const allocateTokens = async () => {
    // get balance of federation and if equal to max supply then send to sale.worlds
    const balanceRes = await rpc.get_currency_balance(pack_account, federation_account);
    console.log(balanceRes);
    const balances = {};
    balanceRes.forEach((bal) => {
        const [b, s] = bal.split(' ');
        balances[s] = parseInt(b);
    });

    for (let p = 0; p < packs.length; p++) {
        const pack = packs[p];
        if (balances[pack.symbol] === pack.max){
            const send_amount = parseInt(pack.max * 0.8);
            console.log(`Sending ${send_amount} packs to ${sale_account} (${balances[pack.symbol]} !== ${pack.max})`);

            const actions = [];
            actions.push({
                account: pack_account,
                name: 'transfer',
                authorization: [{
                    actor: federation_account,
                    permission: 'active',
                }],
                data: {
                    from: federation_account,
                    to: sale_account,
                    quantity: `${send_amount} ${pack.symbol}`,
                    memo: 'Packs for sale'
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

                console.log(`Token ${pack.symbol} transferred in transaction ${res_create.processed.id}`);
            }
            catch (e){
                throw e;
            }
        }
        else {
            console.log(`${pack.symbol} packs already sent`);
        }
    }
};


const configureOpen = async () => {


    // Create the crates
    console.log(`Creating crates`);
    for (let c = 0; c < crates.length; c++) {
        const crate = crates[c];
        try {
            const data = {};
            data.crate_name = crate.name;
            data.type = crate.type;
            data.ids = [];

            let ids = [];

            if (crate.type === 'template'){
                // get the template ids based on the search
                const search = {};
                if (crate.rarity) {
                    search.rarity = crate.rarity;
                }
                let templates = await atomic.getTemplates({collection_name}, 1, 100, search);
                // console.log(templates);
                if (crate.exclude && crate.exclude.length) {
                    // console.log(`exclude`, crate.exclude);
                    templates = templates.filter(t => !crate.exclude.includes(t.name));
                }
                else if (crate.include && crate.include.length){
                    // console.log(`include`, crate.include);
                    templates = templates.filter(t => crate.include.includes(t.name));
                }

                ids = templates.map(t => t.template_id);
            }

            data.ids = ids;
            // console.log(data);

            let actions = [];
            actions.push({
                account: open_account,
                name: 'addcrate',
                authorization: [{
                    actor: open_account,
                    permission: 'active',
                }],
                data
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

                console.log(`Crate ${crate.name} created on ${open_account} in transaction ${res_create.processed.id}`);
            }
            catch (e){
                if (e.message.indexOf('Crate with this name already exists') > -1){
                    console.log(`Crate ${crate.name} already created`);
                }
                else {
                    console.log(e.message);
                    throw e;
                }
            }
        }
        catch (e) {
            console.log(e.message);
        }
    }

    // configure the packs in open.worlds
    console.log(`Adding packs`);
    for (let p = 0; p < packs.length; p++) {
        const pack = packs[p];
        // add pack
        let actions = [];
        actions.push({
            account: open_account,
            name: 'addpack',
            authorization: [{
                actor: open_account,
                permission: 'active',
            }],
            data: {
                pack_name: pack.key,
                pack_symbol: `0,${pack.symbol}`,
                bonus_ft: {contract: 'alien.worlds', quantity: pack.fungible},
                active: true
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

            console.log(`Pack ${pack.symbol} created on ${open_account} in transaction ${res_create.processed.id}`);
        }
        catch (e){
            if (e.message.indexOf('Pack with this name exists') > -1){
                console.log(`Pack ${pack.symbol} already created`);
            }
            else {
                throw e;
            }
        }

        // Create the cards
        // get all cards for this pack and remove them
        const cards_pack_res = await rpc.get_table_rows({
            code: open_account,
            scope: open_account,
            table: 'cards',
            index_position: 2,
            key_type: 'i64',
            lower_bound: pack.key,
            upper_bound: pack.key
        });
        if (cards_pack_res.rows.length){
            console.log(`Deleting existing cards...`);
            for (let r = 0; r < cards_pack_res.rows.length; r++){
                const row = cards_pack_res.rows[r];
                let actions = [];
                actions.push({
                    account: open_account,
                    name: 'delcard',
                    authorization: [{
                        actor: open_account,
                        permission: 'active',
                    }],
                    data: {
                        card_id: row.card_id
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

                    console.log(`Card for pack ${pack.symbol} deleted on ${open_account} in transaction ${res_create.processed.id}`);
                }
                catch (e){
                    if (e.message.indexOf('Pack with this name exists') > -1){
                        console.log(`Pack ${pack.symbol} already created`);
                    }
                    else {
                        throw e;
                    }
                }
            }
        }


        // get the highest card id and then start adding cards
        const card_id_res = await rpc.get_table_rows({
            code: open_account,
            scope: open_account,
            table: 'cards',
            reverse: true,
            limit: 1
        });
        let next_id = 0;
        if (card_id_res.rows.length){
            next_id = parseInt(card_id_res.rows[0].card_id) + 1;
        }
        for (let c = 0; c < pack.cards.length; c++){
            const card = pack.cards[c];
            console.log(`Adding card ${c+next_id} for ${pack.key}`);

            let actions = [];
            actions.push({
                account: open_account,
                name: 'addcard',
                authorization: [{
                    actor: open_account,
                    permission: 'active',
                }],
                data: {
                    pack_name: pack.key,
                    card_id: c+next_id,
                    card_probabilities: card
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

                console.log(`Cards added for ${pack.symbol} in transaction ${res_create.processed.id}`);
            }
            catch (e){
                throw e;
            }
        }
    }

};

const configureSale = async () => {
    // configure the packs in sale.worlds
    const pack_id_res = await rpc.get_table_rows({
        code: sale_account,
        scope: sale_account,
        table: 'packs',
        reverse: true,
        limit: 1
    });
    let next_id = 0;
    if (pack_id_res.rows.length){
        next_id = parseInt(pack_id_res.rows[0].pack_id) + 1;
    }

    for (let p = 0; p < packs.length; p++) {
        const pack = packs[p];

        let actions = [];
        actions.push({
            account: sale_account,
            name: 'addpack',
            authorization: [{
                actor: sale_account,
                permission: 'active',
            }],
            data: {
                pack_id: p + next_id,
                pack_asset: {contract: pack_account, quantity: `1 ${pack.symbol}`},
                metadata: JSON.stringify({name: pack.name, description: pack.description, img: pack.img}),
                number_cards: pack.cards.length
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

            console.log(`Pack ${pack.symbol} created on ${sale_account} in transaction ${res_create.processed.id}`);
        }
        catch (e){
            if (e.message.indexOf('Pack already exists with this symbol') > -1){
                console.log(`Pack ${pack.symbol} already created`);
            }
            else {
                throw e;
            }
        }
    }
};

const doWork = async () => {
    // create on pack.worlds
    // await createTokens();

    // issue the tokens
    // await issueTokens();

    // send to federation and sale.worlds
    // await allocateTokens();

    // configure in open.worlds with card probabilities
    // await configureOpen();

    // configure in sale.worlds with name and image etc
    await configureSale();
};

/*
mythical = 5
legendary = 10
epic = 18
rare = 25
common = 26
*/

doWork();
