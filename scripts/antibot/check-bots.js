#!/usr/bin/env node

const fetch = require("node-fetch");
const fs = require("fs");
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const mining_account = 'm.federation';
const endpoint = 'https://wax.eosdac.io';
// const endpoint = 'http://127.0.0.1:28888';
const setparam_perm = 'setparam';


// Private key: 5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv
// Public key: EOS7JUT21YpUHbgiEgpBQuCXGmzsmsWupuPWQV25kKxUyWywgLBHd
const private_data = {
    pk: '5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv'
}


const rpc = new JsonRpc(endpoint, { fetch });
const signatureProvider = new JsSignatureProvider([private_data.pk]);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });


const check_bot = async (account) => {
    try {
        const actions = [{
            account: mining_account,
            name: 'testparam',
            authorization: [{
                actor: mining_account,
                permission: setparam_perm,
            }],
            data: {
                key: account
            }
        }];
        const res = await api.transact({
            actions
        }, {
            blocksBehind: 3,
            expireSeconds: 300
        });

        console.log(`Sent tx ${res.transaction_id}`);
    }
    catch (e) {
        // console.error('Error checking existing bot' + e);
        if (e.message.indexOf('not found') > -1) {
            return false;
        }
        else if (e.message.indexOf('found') > -1) {
            return true;
        }
        else {
            throw e
        }
    }
}

const processChunk = async (checks) => {
    await Promise.all(checks).then(result => {
        result.forEach(res => { console.log(res) })
    }).catch(e => {
        console.log(`error during checking: ${e}`)
    });
}

(async () => {

    if (process.argv.length < 2) {
        console.error(`Please supply filename`)
    }

    const filename = process.argv[2]
    const lines = (fs.readFileSync(filename, { encoding: 'utf-8' })).replace(/\r\n/g, '\n').split('\n');
    // console.log(lines);

    var allChecks = []

    for (let l = 0; l < lines.length; l++) {
        const account = lines[l].split('\t')[0];
        if (account === '') {
            continue;
        }
        // if (l % 10 == 0) {
        //     console.log(`started processing: #${l}`)
        // }
        const p = check_bot(account).then(is_bot => {
            return `${account},${(is_bot) ? 'FLAGGED' : 'NOT_FLAGGED'}`;
        }).catch(e => {
            return `**Error: #{account} : ${e}`;
        });
        allChecks.push(p)
        if (allChecks.length % 20 == 1) {
            await processChunk(allChecks);
            allChecks = []
        }
    }
    processChunk(allChecks)
})()
