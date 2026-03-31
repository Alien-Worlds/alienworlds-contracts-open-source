#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { ExplorerApi } = require('atomicassets');
const { transactCleos } = require('./transact_cleos');
const Uint64LE = require("int64-buffer").Uint64LE;

const { atomicassets_account, federation_account, open_account, collection_name, endpoint, aa_endpoint, CLEOS } = require('./config');

// to prevent calling the api too many times
const template_cache = {};

const rpc = new JsonRpc(endpoint, {fetch});
const api = new Api({ rpc, signatureProvider: null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const sleep = (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const readfilePromise = async (filename) => {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, (err, data) => {
            if (err){
                reject(err);
            }
            else {
                resolve(data);
            }
        });
    });
}

const nameToInt = (name) => {
    const sb = new Serialize.SerialBuffer({
        textEncoder: new TextEncoder,
        textDecoder: new TextDecoder
    });

    sb.pushName(name);

    const name_64 = new Uint64LE(sb.array);

    return name_64 + '';
}

// Join x and y coordinates to form a 64 bit number for the index
const getIndex = (x, y) => {
    const bx = BigInt(x) << 32n;
    const by = BigInt(y);

    return (bx + by).toString();
};

const shuffleArray = (array) => {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}

const getLandTemplate = async (type, planet_name) => {
    let land_template = template_cache[`${type}:${planet_name}`];

    if (typeof land_template === 'undefined'){
        const cardid = type.replace(/^LT[0]*/, '');
        const planet = nameToInt(planet_name);

        // console.log({cardid, planet});
        const land_templates = await atomic.getTemplates({collection_name, schema_name: 'land.worlds'}, 1, 100, {cardid, planet});

        if (!land_templates.length){
            throw new Error(`Could not find template for ${type} on ${planet_name} - run init_nfts.js again`);
        }
        else if (land_templates.length > 1){
            throw new Error(`Too many templates for ${type} on ${planet_name} (${land_templates.length})`);
        }

        land_template = parseInt(land_templates[0].template_id);

        template_cache[`${type}:${planet_name}`] = land_template;
    }

    return land_template;
}

const ensureLand = async (x, y, land_template) => {
    // ensure that land for this planet and coordinate has been minted
    let asset_id = 0;
    const assets = await atomic.getAssets({collection_name, template_id: land_template}, 1, 1, {x, y});
    if (assets.length){
        asset_id = assets[0].asset_id;
        console.log(`Asset exists for ${land_template} (at position ${y}, ${x}) with ID ${asset_id} (${assets[0].name})`);
        // Prevent the api rate limiting us
        await sleep(500);
    }
    else {
        // insert the land after minting the asset
        const mint_data = {
            authorized_minter: federation_account,
            collection_name,
            schema_name: 'land.worlds',
            template_id: land_template,
            new_asset_owner: federation_account,
            immutable_data: [
                {"key":"x", "value":["uint16", x]},
                {"key":"y", "value":["uint16", y]}
            ],
            mutable_data: [
                {"key": "commission", "value":["uint16", 2000]}
            ],
            tokens_to_back: []
        };

        let actions = [{
            account: atomicassets_account,
            name: 'mintasset',
            authorization: [{
                actor: federation_account,
                permission: 'issue',
            }],
            data: mint_data
        }];

        try {
            const push_res = await transactCleos({
                actions
            }, {
                blocksBehind: 3,
                expireSeconds: 30,
                broadcast: false,
                sign: false
            }, [federation_account], CLEOS, api);

            // console.log(JSON.stringify(push_res, '', 2))

            let asset_data;
            if (push_res.processed.action_traces[0].inline_traces && push_res.processed.action_traces[0].inline_traces.length){
                asset_data = push_res.processed.action_traces[0].inline_traces[0].act.data;
                asset_id = asset_data.asset_id;
            }
            else {
                asset_data = push_res.processed.action_traces[1].act.data;
                asset_id = push_res.processed.action_traces[1].act.data.asset_id;
            }
            const name_attr = asset_data.immutable_template_data.find(a => a.key === 'name');
            console.log(`Minted asset for ${land_template} (at position ${y}, ${x}) with ID ${asset_id} (${name_attr.value[1]})`);
        }
        catch (e){
            console.error(`Error minting asset ${e.message}`);
            throw e;
        }
    }

    return asset_id;
}

const updateLand = async (planet_name, land_data) => {
    const x = parseInt(land_data.x);
    const y = parseInt(land_data.y);

    const index = getIndex(x, y);
    const check_res = await rpc.get_table_rows({code: federation_account, scope: planet_name, table: 'maps', lower_bound: index, upper_bound: index});

    if (check_res.rows.length === 0){
        // Get template from the data provided
        if (land_data.type === 'LT21'){
            // no nft needed for this land
            return;
        }

        console.log(`Getting template for ${land_data.type} (at position ${y}, ${x} on ${planet_name})`);
        const land_template = await getLandTemplate(land_data.type, planet_name);
        if (!land_template){
            console.error(`Failed to find template for ${land_data.type} on ${planet_name}`);
        }
        // Check if this piece of land already exists
        let asset_id = await ensureLand(x, y, land_template);

        if (asset_id === 0){
            throw new Error(`Could not get asset_id after minting`);
        }

        // set map in federation account
        actions = [{
            account: federation_account,
            name: 'setmap',
            authorization: [{
                actor: federation_account,
                permission: 'issue',
            }],
            data: {
                planet_name,
                x,
                y,
                asset_id
            }
        }];


        try {
            const map_res = await transactCleos({
                actions
            }, {
                blocksBehind: 3,
                expireSeconds: 30,
                broadcast: false,
                sign: false
            }, [federation_account], CLEOS, api);

            console.log(`Set map data for ${land_data.type} (at position ${y}, ${x} on ${planet_name})`);
        }
        catch (e){
            console.error(e.message);
            throw e;
        }

    }
    else {
        console.log(`Map data already exists at ${x}, ${y} on ${planet_name}`);
    }
};

const createPlanet = async (name) => {
    console.log(`Creating ${name} in federation`);

    const json_str = await readfilePromise(`planets/${name}.json`);
    const json = JSON.parse(json_str);

    let actions;

    try {
        const metadata = {
            img: json.img,
            map: json.map,
            description: json.description
        }
        const planet_data = {
            planet_name: `${name}.world`,
            title: json.title,
            dac_symbol: json.symbol,
            metadata: JSON.stringify(metadata)
        };
        actions = [{
            account: federation_account,
            name: 'addplanet',
            authorization: [{
                actor: federation_account,
                permission: 'active',
            }],
            data: planet_data
        }];

        const add_res = await transactCleos({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 30,
            broadcast: false,
            sign: false
        }, [federation_account], CLEOS, api);
    }
    catch (e){
        if (e.message.indexOf('Planet already exists with this name') > -1){
            delete actions[0].data.dac_symbol;
            actions[0].data.active = true;
            actions[0].name = 'updateplanet';

            console.log(`Updating existing planet`);

            const update_res = await transactCleos({
                actions
            }, {
                blocksBehind: 3,
                expireSeconds: 30,
                broadcast: false,
                sign: false
            }, [federation_account], CLEOS, api);
        }
        else {
            throw e;
        }

    }
};

const getCSV = async (planet_name) => {
    const name = planet_name.replace('.world', '');
    const csv_name = `planets/${name}.txt`;
    const headers = ['y', 'x', 'type', 'name'];

    return new Promise(async (resolve, reject) => {
        const land_rows = [];

        if (fs.existsSync(csv_name)) {
            fs.createReadStream(csv_name)
                .pipe(csv(headers))
                .on('data', (data) => land_rows.push(data))
                .on('end', () => {
                    resolve(land_rows);
                });
        } else {
            console.log(`No csv for ${name} - ignoring`);
            resolve(land_rows);
        }
    });
}

const setupPlanet = async (planet_name) => {
    return new Promise(async (resolve, reject) => {
        const name = planet_name.replace('.world', '');
        const csv_name = `planets/${name}.txt`;
        console.log(`Setting up ${name} from ${csv_name}`);

        // create / update the planet in the federation contract
        await createPlanet(name);

        try {
            const land_rows = await getCSV(planet_name);

            console.log(`Found ${land_rows.length} land items in ${name}`);
            // console.log(land_rows);
            for (let i = 0; i < land_rows.length; i++) {
                const lr = land_rows[i];
                try {
                    await updateLand(planet_name, lr);
                } catch (e) {
                    i--;
                }
            }
            resolve();
        }
        catch (e) {
            console.log(e.message);
            reject(e);
        }
    });


};

const premintData = (planet_name) => {
    // Extract premint data which is then randomised before minting

    return new Promise(async (resolve, reject) => {
        const name = planet_name.replace('.world', '');
        const csv_name = `planets/${name}.txt`;
        console.log(`Preminting from ${name} from ${csv_name}`);

        const to_mint = [];

        try {
            const land_rows = await getCSV(planet_name);
            console.log(`Found ${land_rows.length} land items in ${name}`);
            // console.log(land_rows);
            for (let i=0; i<land_rows.length; i++){
                const land_data = land_rows[i];

                if (land_data.type === 'LT21'){
                    // no nft needed for this land
                    continue;
                }

                const x = parseInt(land_data.x);
                const y = parseInt(land_data.y);
                // console.log(`Getting template for ${land_data.type} (at position ${y}, ${x} on ${planet_name})`);

                const land_template = await getLandTemplate(land_data.type, planet_name);
                if (!land_template){
                    console.error(`Failed to find template for ${land_data.type} on ${planet_name}`);
                }

                to_mint.push({x, y, land_template});
            }

            // console.log(to_mint);
            resolve(to_mint);
        }
        catch (e) {
            console.log(e.message);
            reject(e);
        }
    });

}

const doWork = async () => {

    const res = await rpc.get_table_rows({code: federation_account, scope: federation_account, table: 'planets'});
    if (res.rows.length){
        let i = 1;
        let premint_data = [];
        for (let r=0;r<res.rows.length;r++){
            // Premint all of the land, the later function will handle it
            // if (res.rows[r].planet_name === 'eyeke.world') {
                const pm = await premintData(res.rows[r].planet_name);
                premint_data = premint_data.concat(pm);
            // }
        }

        shuffleArray(premint_data);
        console.log(`Have ${premint_data.length} pieces of land to mint`);
        while (premint_data.length){
            const d = premint_data.shift();
            try {
                await ensureLand(d.x, d.y, d.land_template);
            }
            catch (e){
                console.error(`Error ensuring land ${e.message}`);
                // put it back on the end of the array and keep going
                premint_data.push(d);
                await sleep(1000);
            }

        }

        // wait so that the api catches up
        console.log(`Sleeping for the API to catch up...`);
        await sleep(120000);
        // process.exit(0);

        for (let r=0;r<res.rows.length;r++){
            // if (res.rows[r].planet_name === 'eyeke.world'){
                await setupPlanet(res.rows[r].planet_name);
            // }
        }
    }
    else {
        console.error(`No planets found`);
    }
};


doWork();
