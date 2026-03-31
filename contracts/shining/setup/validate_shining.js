#!/usr/bin/env node

const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const fetch = require("node-fetch");
const { ExplorerApi } = require('atomicassets');
const { transactCleos } = require('./transact_cleos');

const shining_account = 's.federation';
const schemas = ['tool.worlds', 'faces.worlds'];

const { atomicassets_account, federation_account, open_account, collection_name, mint_perm, endpoint, aa_endpoint, CLEOS } = require('../../federation/setup/config');


const rpc = new JsonRpc(endpoint, { fetch });
const signatureProvider = null;
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(aa_endpoint, atomicassets_account, { fetch, rateLimit: 4 });


const validate = async () => {
    console.log(`Checking stone upgrades`);

    const schema = 'tool.worlds';

    const stone_templates = await atomic.getTemplates({
        collection_name,
        schema_name: schema
    }, 1, 1000, { shine: 'Stone' });

    for (let t = 0; t < stone_templates.length; t++) {
        const stone_template = stone_templates[t];

        const upgrade_res = await rpc.get_table_rows({
            code: 's.federation',
            scope: 's.federation',
            table: 'lookups',
            lower_bound: stone_template.template_id,
            upper_bound: stone_template.template_id,
            limit: 1
        });

        if (!upgrade_res.rows.length) {
            console.error(`Could not find upgrade for ${stone_template.name} (${stone_template.template_id})`);
            process.exit(1);
        }
    }
}

validate();
