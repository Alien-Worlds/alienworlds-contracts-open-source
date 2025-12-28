#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { ExplorerApi } = require('atomicassets');
const {transactCleos} = require('./transact_cleos');
const Uint64LE = require("int64-buffer").Uint64LE;

const { atomicassets_account, federation_account, open_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');


const rpc = new JsonRpc(endpoint, {fetch});
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const createCollection = async () => {

    try {
        console.log(`Creating collection...`);
        const collection_data = {
            author: federation_account,
            collection_name: collection_name,
            allow_notify: true,
            authorized_accounts: [federation_account, open_account, 'm.federation', 'f.federation'],
            notify_accounts: [federation_account],
            market_fee: 0.08,
            data: [
                {
                    "key": "name",
                    "value": ["string", "Alien Worlds"]
                },
                {
                    "key": "description",
                    "value": ["string", "Alien Worlds is a Digital Item Metaverse set in Faraway Space. Own land on distant planets, explore and find strange artefacts, mine for Trilium with hyper-advanced tools or fight using alien weapons."]
                },
                {
                    "key": "img",
                    "value": ["string", "QmVaSXmPQvoHy8Us86ChubLyEMmUzsR4aipCWQv9t74ihP"]
                },
                {
                    "key": "url",
                    "value": ["string", "https://alienworlds.io"]
                }
            ]
        };

        let actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'createcol',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            },{
                actor: 'alien.worlds',
                permission: 'active',
            },{
                actor: 'worlds',
                permission: 'active',
            }],
            data: collection_data
        });
        const res_col = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, [federation_account, 'alien.worlds'], CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('A collection with this name already exists') > -1){
            console.log(`Collection exists`);
        }
        else {
            throw e;
        }
    }
}
const editCollection = async (name, description, img, url) => {

    try {
        console.log(`Updating collection...`);
        const collection_data = {
            collection_name,
            data: [
                {
                    "key": "name",
                    "value": ["string", name]
                },
                {
                    "key": "description",
                    "value": ["string", description]
                },
                {
                    "key": "img",
                    "value": ["string", img]
                },
                {
                    "key": "url",
                    "value": ["string", url]
                }
            ]
        };

        let actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'setcoldata',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: collection_data
        });
        const res_col = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, [federation_account], CLEOS, api);
    }
    catch (e){
        throw e;
    }
}

const createLand = async () => {

    try {
        console.log(`Creating land.worlds schema...`);
        const tool_scheme_data = {
            authorized_creator: federation_account,
            collection_name: collection_name,
            schema_name: 'land.worlds',
            schema_format: [
                { name: "cardid", type: "uint16" },
                { name: "name", type: "string" },
                { name: "img", type: "image" },
                { name: "backimg", type: "image" },
                { name: "commission", type: "uint16" },
                { name: "planet", type: "uint64" },
                { name: "rarity", type: "string" },
                { name: "delay", type: "uint8" }, // Delay on land is a multiplier (x10)
                { name: "difficulty", type: "uint8" },
                { name: "ease", type: "uint8" },
                { name: "luck", type: "uint8" },
                { name: "x", type: "uint16" },
                { name: "y", type: "uint16" }
            ]
        };
        actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'createschema',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: tool_scheme_data
        });
        const res_ts = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, federation_account, CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('A schema with this name already exists for this collection') > -1){
            console.log(`Schema exists`);
        }
        else {
            throw e;
        }
    }


// Create land assets

    // get existing preset names
    const existing_presets = [];
    // console.log({collection_name, schema_name: 'land.worlds'});
    const preset_data = await atomic.getTemplates({collection_name, schema_name: 'land.worlds'}, 1, 1000, {});
    // console.log(preset_data);

    for (let p = 0; p < preset_data.length; p++) {
        const pd = await preset_data[p].immutable_data;
        existing_presets.push(pd.name);
    }

    return new Promise((resolve, reject) => {

        const headers = ['cardid', 'name', 'planet', 'rarity', 'img', 'backimg', 'delay', 'difficulty', 'ease', 'luck'];

        const land_rows = [];
        fs.createReadStream('land.csv')
            .pipe(csv(headers))
            .on('data', (data) => land_rows.push(data))
            .on('end', async () => {
                // console.log(land_rows);
                let exp = 0;
                for (let i = 0; i < land_rows.length; i++){
                    const land = land_rows[i];
                    const land_name = `${land.name} on ${land.planet}`
                    if (!land.planet || !land.img || !land.rarity){
                        continue;
                    }

                    if (!existing_presets.includes(land_name)){
                        console.log(`Creating land template ${land_name}...`);

                        const sb = new Serialize.SerialBuffer({
                            textEncoder: new TextEncoder,
                            textDecoder: new TextDecoder
                        });
                        sb.pushName(`${land.planet.toLowerCase()}.world`);
                        const planet_64 = new Uint64LE(sb.array);

                        const land_preset_data = {
                            authorized_creator: federation_account,
                            collection_name: collection_name,
                            schema_name: 'land.worlds',
                            transferable: true,
                            burnable: false,
                            max_supply: 0,
                            immutable_data: [
                                {key:"cardid", value:["uint16", parseInt(land.cardid)]},
                                {key:"img", value:["string", land.img]},
                                {key:"backimg", value:["string", land.backimg]},
                                {key:"name", value:["string", land_name]},
                                {key:"planet", value:["uint64", planet_64]},
                                {key:"rarity", value:["string", land.rarity]},
                                {key:"delay", value:["uint8", parseInt(land.delay)]},
                                {key:"difficulty", value:["uint8", parseInt(land.difficulty)]},
                                {key:"ease", value:["uint8", parseInt(land.ease)]},
                                {key:"luck", value:["uint8", parseInt(land.luck)]}
                            ]
                        };
                        actions = [];
                        actions.push({
                            account: atomicassets_account,
                            name: 'createtempl',
                            authorization: [{
                                actor: federation_account,
                                permission: 'active',
                            }],
                            data: land_preset_data
                        });
                        // console.log(JSON.stringify(actions, '', 4));
                        const res_tp = await transactCleos({
                            actions
                        }, {
                            blocksBehind: 3,
                            expireSeconds: 30 + (++exp),
                            broadcast: false,
                            sign: false
                        }, federation_account, CLEOS, api);
                    }
                    else {
                        console.log(`Land template for ${land_name} exists`);
                    }
                }

                resolve();
            });
    });

}

const createTools = async () => {

    try {
        console.log(`Creating tool.worlds scheme...`);
        const tool_scheme_data = {
            authorized_creator: federation_account,
            collection_name: collection_name,
            schema_name: 'tool.worlds',
            schema_format: [
                {name: 'cardid', type: 'uint16'},
                {name: 'name', type: 'string'},
                {name: 'img', type: 'image'},
                {name: 'backimg', type: 'image'},
                {name: 'rarity', type: 'string'},
                {name: 'shine', type: 'string'},
                {name: 'material_grade', type: 'uint64'},
                {name: 'type', type: 'string'},
                {name: 'delay', type: 'uint16'},
                {name: 'difficulty', type: 'uint8'},
                {name: 'ease', type: 'uint16'},
                {name: 'luck', type: 'uint16'}
            ]
        };
        actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'createschema',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: tool_scheme_data
        });
        const res_ts = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, federation_account, CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('A schema with this name already exists for this collection') > -1){
            console.log(`Scheme exists`);
        }
        else {
            throw e;
        }
    }

    // get existing preset names
    console.log(`Loading existing templates`)
    const existing_presets = [];
    const preset_data = await atomic.getTemplates({collection_name, schema_name: 'tool.worlds'}, 1, 100, {});

    for (let p = 0; p < preset_data.length; p++) {
        const pd = await preset_data[p].immutable_data;
        existing_presets.push(pd.name);
    }

// Create tool assets


    return new Promise((resolve, reject) => {
        const headers = ['cardid', 'name', 'rarity', 'max_issue', 'shine', 'img', 'backimg', 'type', 'delay', 'difficulty', 'ease', 'luck'];

        const tool_rows = [];
        fs.createReadStream('tools.csv')
            .pipe(csv(headers))
            .on('data', (data) => tool_rows.push(data))
            .on('end', async () => {
                console.log(`Read tools.csv file`);
                // console.log(tool_rows[0]);
                // return;
                let exp = 0;
                for (let t=0; t < tool_rows.length; t++) {
                    const tool = tool_rows[t];
                    if (!tool.cardid){
                        continue;
                    }
                    if (!existing_presets.includes(tool.name)){
                        console.log(`Creating tool template ${tool.name}...`);
                        let max_supply = 0;
                        if (tool.max_issue != 'Unlimited'){
                            max_supply = parseInt(tool.max_issue);
                            if (isNaN(max_supply)){
                                max_supply = 0;
                            }
                        }

                        const tool_preset_data = {
                            authorized_creator: federation_account,
                            collection_name: collection_name,
                            schema_name: 'tool.worlds',
                            transferable: true,
                            burnable: true,
                            max_supply,
                            immutable_data: [
                                {key:"cardid", value:["uint16", tool.cardid]},
                                {key:"name", value:["string", tool.name]},
                                {key:"img", value:["string", tool.img]},
                                {key:"backimg", value:["string", tool.backimg]},
                                {key:"rarity", value:["string", tool.rarity]},
                                {key:"type", value:["string", tool.type]},
                                {key:"shine", value:["string", tool.shine]},
                                {key:"delay", value:["uint16", parseInt(tool.delay)]},
                                {key:"difficulty", value:["uint8", parseInt(tool.difficulty)]},
                                {key:"ease", value:["uint16", parseInt(parseFloat(tool.ease) * 10)]},
                                {key:"luck", value:["uint16", parseInt(parseFloat(tool.luck) * 10)]}
                            ]
                        };
                        actions = [];
                        actions.push({
                            account: atomicassets_account,
                            name: 'createtempl',
                            authorization: [{
                                actor: federation_account,
                                permission: 'active',
                            }],
                            data: tool_preset_data
                        });
                        // console.log(JSON.stringify(actions));
                        const res_tp = await transactCleos({
                            actions
                        }, {
                            blocksBehind: 3,
                            expireSeconds: 30 + (++exp),
                            broadcast: false,
                            sign: false
                        }, federation_account, CLEOS, api);

                        console.log(`Tool ${tool.name} created ${res_tp.transaction_id}`);
                    }
                    else {
                        console.log(`Tool ${tool.name} template already exists`);
                    }
                }

                resolve();
            });
    });

}

const createWeapons = async () => {

    try {
        console.log(`Creating arms.worlds scheme...`);
        const weapon_scheme_data = {
            authorized_creator: federation_account,
            collection_name: collection_name,
            schema_name: 'arms.worlds',
            schema_format: [
                {name: 'cardid', type: 'uint16'},
                {name: 'name', type: 'string'},
                {name: 'img', type: 'image'},
                {name: 'backimg', type: 'image'},
                {name: 'rarity', type: 'string'},
                {name: 'shine', type: 'string'},
                {name: 'material_grade', type: 'uint64'},
                {name: 'description', type: 'string'},
                {name: 'class', type: 'string'},
                {name: 'attack', type: 'uint8'},
                {name: 'defense', type: 'uint8'}
            ]
        };
        actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'createschema',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: weapon_scheme_data
        });
        const res_ts = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, federation_account, CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('A schema with this name already exists for this collection') > -1){
            console.log(`Scheme exists`);
        }
        else {
            throw e;
        }
    }

    // get existing preset names
    console.log(`Loading existing templates`)
    const existing_presets = [];
    const preset_data = await atomic.getTemplates({collection_name, schema_name: 'arms.worlds'}, 1, 100, {});

    for (let p = 0; p < preset_data.length; p++) {
        const pd = await preset_data[p].immutable_data;
        existing_presets.push(pd.name);
    }

// Create weapon assets


    return new Promise((resolve, reject) => {
        const headers = ['cardid', 'name', 'rarity', 'max_issue', 'img', 'backimg', 'description', 'class', 'attack', 'defense'];

        const weapon_rows = [];
        fs.createReadStream('weapons.csv')
            .pipe(csv(headers))
            .on('data', (data) => weapon_rows.push(data))
            .on('end', async () => {
                console.log(`Read weapons.csv file`);
                // console.log(weapon_rows[0]);
                // return;
                let exp = 0;
                for (let t=0; t < weapon_rows.length; t++) {
                    const weapon = weapon_rows[t];
                    if (!weapon.cardid){
                        continue;
                    }
                    if (!existing_presets.includes(weapon.name)){
                        console.log(`Creating weapon template ${weapon.name}...`);
                        let max_supply = 0;
                        if (weapon.max_issue != 'Unlimited'){
                            max_supply = parseInt(weapon.max_issue);
                            if (isNaN(max_supply)){
                                max_supply = 0;
                            }
                        }

                        const weapon_preset_data = {
                            authorized_creator: federation_account,
                            collection_name: collection_name,
                            schema_name: 'arms.worlds',
                            transferable: true,
                            burnable: true,
                            max_supply,
                            immutable_data: [
                                {key:"cardid", value:["uint16", weapon.cardid]},
                                {key:"name", value:["string", weapon.name]},
                                {key:"img", value:["string", weapon.img]},
                                {key:"backimg", value:["string", weapon.backimg]},
                                {key:"rarity", value:["string", weapon.rarity]},
                                {key:"description", value:["string", weapon.description]},
                                {key:"shine", value:["string", 'Stone']},
                                {key:"class", value:["string", weapon.class]},
                                {key:"attack", value:["uint8", parseInt(weapon.attack)]},
                                {key:"defense", value:["uint8", parseInt(weapon.defense)]}
                            ]
                        };
                        actions = [];
                        actions.push({
                            account: atomicassets_account,
                            name: 'createtempl',
                            authorization: [{
                                actor: federation_account,
                                permission: 'active',
                            }],
                            data: weapon_preset_data
                        });
                        // console.log(JSON.stringify(actions));
                        const res_tp = await transactCleos({
                            actions
                        }, {
                            blocksBehind: 3,
                            expireSeconds: 30 + (++exp),
                            broadcast: false,
                            sign: false
                        }, federation_account, CLEOS, api);

                        console.log(`Weapon ${weapon.name} created ${res_tp.transaction_id}`);
                    }
                    else {
                        console.log(`Weapon ${weapon.name} template already exists`);
                    }
                }

                resolve();
            });
    });

}


const createMinions = async () => {

    try {
        console.log(`Creating crew.worlds scheme...`);
        const minion_scheme_data = {
            authorized_creator: federation_account,
            collection_name: collection_name,
            schema_name: 'crew.worlds',
            schema_format: [
                {name: 'cardid', type: 'uint16'},
                {name: 'name', type: 'string'},
                {name: 'img', type: 'image'},
                {name: 'backimg', type: 'image'},
                {name: 'rarity', type: 'string'},
                {name: 'shine', type: 'string'},
                {name: 'material_grade', type: 'uint64'},
                {name: 'race', type: 'string'},
                {name: 'description', type: 'string'},
                {name: 'element', type: 'string'},
                {name: 'attack', type: 'uint8'},
                {name: 'defense', type: 'uint8'},
                {name: 'movecost', type: 'uint8'},
                {name: 'td_fights', type: 'uint16'},
                {name: 'td_wins', type: 'uint16'},
                {name: 'td_winstreak', type: 'uint16'}
            ]
        };
        actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'createschema',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: minion_scheme_data
        });
        const res_ts = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, federation_account, CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('A schema with this name already exists for this collection') > -1){
            console.log(`Scheme exists`);
        }
        else {
            throw e;
        }
    }

    // get existing preset names
    console.log(`Loading existing templates`)
    const existing_presets = [];
    const preset_data = await atomic.getTemplates({collection_name, schema_name: 'crew.worlds'}, 1, 100, {});

    for (let p = 0; p < preset_data.length; p++) {
        const pd = await preset_data[p].immutable_data;
        existing_presets.push(pd.name);
    }

// Create minion assets


    return new Promise((resolve, reject) => {
        const headers = ['cardid', 'code', 'element', 'name', 'rarity', 'max_issue', 'img', 'backimg', 'race', 'attack', 'defense', 'movecost', 'description'];

        const minion_rows = [];
        fs.createReadStream('minions.csv')
            .pipe(csv(headers))
            .on('data', (data) => minion_rows.push(data))
            .on('end', async () => {
                console.log(`Read minions.csv file`);
                // console.log(minion_rows[0]);
                // return;
                let exp = 0;
                for (let t=0; t < minion_rows.length; t++) {
                    const minion = minion_rows[t];
                    if (!minion.cardid){
                        continue;
                    }
                    if (!existing_presets.includes(minion.name)){
                        console.log(`Creating minion template ${minion.name}...`);
                        let max_supply = 0;
                        if (minion.max_issue != 'Unlimited'){
                            max_supply = parseInt(minion.max_issue);
                            if (isNaN(max_supply)){
                                max_supply = 0;
                            }
                        }

                        const minion_preset_data = {
                            authorized_creator: federation_account,
                            collection_name: collection_name,
                            schema_name: 'crew.worlds',
                            transferable: true,
                            burnable: true,
                            max_supply,
                            immutable_data: [
                                {key:"cardid", value:["uint16", minion.cardid]},
                                {key:"name", value:["string", minion.name]},
                                {key:"img", value:["string", minion.img]},
                                {key:"backimg", value:["string", minion.backimg]},
                                {key:"rarity", value:["string", minion.rarity]},
                                {key:"race", value:["string", minion.race]},
                                {key:"shine", value:["string", 'Stone']},
                                {key:"description", value:["string", minion.description]},
                                {key:"element", value:["string", minion.element]},
                                {key:"attack", value:["uint8", parseInt(minion.attack)]},
                                {key:"defense", value:["uint8", parseInt(minion.defense)]},
                                {key:"movecost", value:["uint8", parseInt(minion.movecost)]}
                            ]
                        };
                        actions = [];
                        actions.push({
                            account: atomicassets_account,
                            name: 'createtempl',
                            authorization: [{
                                actor: federation_account,
                                permission: 'active',
                            }],
                            data: minion_preset_data
                        });
                        // console.log(JSON.stringify(actions));
                        const res_tp = await transactCleos({
                            actions
                        }, {
                            blocksBehind: 3,
                            expireSeconds: 30 + (++exp),
                            broadcast: false,
                            sign: false
                        }, federation_account, CLEOS, api);

                        console.log(`Minion ${minion.name} created ${res_tp.transaction_id}`);
                    }
                    else {
                        console.log(`Minion ${minion.name} template already exists`);
                    }
                }

                resolve();
            });
    });

}

const createAvatars = async () => {

    try {
        console.log(`Creating faces.worlds scheme...`);
        const tool_scheme_data = {
            authorized_creator: federation_account,
            collection_name: collection_name,
            schema_name: 'faces.worlds',
            schema_format: [
                {name: 'cardid', type: 'uint16'},
                {name: 'name', type: 'string'},
                {name: 'img', type: 'image'},
                {name: 'backimg', type: 'image'},
                {name: 'description', type: 'string'},
                {name: 'rarity', type: 'string'},
                {name: 'type', type: 'string'},
                {name: 'race', type: 'string'},
                {name: 'shine', type: 'string'},
                {name: 'material_grade', type: 'uint64'}
            ]
        };
        actions = [];
        actions.push({
            account: atomicassets_account,
            name: 'createschema',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: tool_scheme_data
        });
        const res_ts = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, federation_account, CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('A schema with this name already exists for this collection') > -1){
            console.log(`Scheme exists`);
        }
        else {
            throw e;
        }
    }

    // get existing preset names
    const existing_presets = [];
    const preset_data = await atomic.getTemplates({collection_name, schema_name: 'faces.worlds'}, 1, 100, {});

    for (let p = 0; p < preset_data.length; p++) {
        const pd = await preset_data[p].immutable_data;
        existing_presets.push(pd.name);
    }

// Create avatar assets

    return new Promise((resolve, reject) => {
        const headers = ['cardid', 'name', 'rarity', 'max_issue', 'img', 'backimg', 'description', 'type', 'race'];
        const avatar_rows = [];
        fs.createReadStream('avatars.csv')
            .pipe(csv(headers))
            .on('data', (data) => avatar_rows.push(data))
            .on('end', async () => {
                console.log(`Read csv file`);
                // console.log(tool_rows);
                let exp = 0;
                for (let a=0; a<avatar_rows.length; a++){
                    const avatar = avatar_rows[a];

                    if (!existing_presets.includes(avatar.name)){
                        console.log(`Creating avatar template ${avatar.name}...`);
                        let max_supply = 0;
                        if (avatar.max_issue != 'Unlimited'){
                            max_supply = parseInt(avatar.max_issue);
                            if (isNaN(max_supply)){
                                max_supply = 0;
                            }
                        }

                        const avatar_preset_data = {
                            authorized_creator: federation_account,
                            collection_name: collection_name,
                            schema_name: 'faces.worlds',
                            transferable: true,
                            burnable: true,
                            max_supply,
                            immutable_data: [
                                {key:"cardid", value:["uint16", parseInt(avatar.cardid)]},
                                {key:"name", value:["string", avatar.name]},
                                {key:"rarity", value:["string", avatar.rarity]},
                                {key:"img", value:["string", avatar.img]},
                                {key:"backimg", value:["string", avatar.backimg]},
                                {key:"description", value:["string", avatar.description]},
                                {key:"type", value:["string", avatar.type]},
                                {key:"race", value:["string", avatar.race]},
                                {key:"shine", value:["string", 'Stone']}
                            ]
                        };
                        actions = [];
                        actions.push({
                            account: atomicassets_account,
                            name: 'createtempl',
                            authorization: [{
                                actor: federation_account,
                                permission: 'active',
                            }],
                            data: avatar_preset_data
                        });
                        // console.log(JSON.stringify(actions));
                        const res_tp = await transactCleos({
                            actions
                        }, {
                            blocksBehind: 3,
                            expireSeconds: 30 + (++exp),
                            broadcast: false,
                            sign: false
                        }, federation_account, CLEOS, api);

                        console.log(`Avatar created ${res_tp.transaction_id}`);
                    }
                    else {
                        console.log(`Avatar ${avatar.name} template already exists`);
                    }
                }

                resolve();
            });
    });

}




const doWork = async () => {
    // await editCollection('Alien Worlds', 'Test description 2', 'QmVaSXmPQvoHy8Us86ChubLyEMmUzsR4aipCWQv9t74ihP', 'https://alienworlds.io');
    await createCollection();

    await createLand();

    await createTools();

    await createWeapons();

    await createAvatars();

    await createMinions();
};



doWork();
