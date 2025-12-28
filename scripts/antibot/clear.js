#!/usr/bin/env node

/*
Clears a previously blacklisted set of accounts, parameters are the account and the type of clearing

type must be delegatebw, transfertlm or transferwax
 */

const fetch = require("node-fetch");
const {Api, JsonRpc, Serialize} = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');

const mining_account = 'm.federation';
const setparam_perm = 'setparam';

const config = require('./config');
// Private key: 5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv
// Public key: EOS7JUT21YpUHbgiEgpBQuCXGmzsmsWupuPWQV25kKxUyWywgLBHd
const private_data = {
    pk: '5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv'
}
const rpc = new JsonRpc(config.eos.endpoint, {fetch});
const signatureProvider = new JsSignatureProvider([private_data.pk]);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });


const { set_bot, submit_actions, check_bot } = require('./bot-control')(api, mining_account, setparam_perm, config.logging);
setInterval(submit_actions, 500);
const { get_delegated_accounts } = require('./modules/delegatebw')(config.eos.hyperion_endpoint, rpc, set_bot, [])
const { wax_get_child_accounts } = require('./modules/transferwax')(config.eos.hyperion_endpoint, set_bot, []);
const { tlm_get_child_accounts } = require('./modules/transfertlm')(config.eos.hyperion_endpoint, set_bot, []);

const clear = async (account, type) => {
    let unique_accounts = [];

    switch (type){
        case 'delegatebw':
            console.log(`Clearing delegates for ${account}`);

            unique_accounts = await get_delegated_accounts(account);
            break;
        case 'transfertlm':
            console.log(`Clearing TLM transfers for ${account}`);

            unique_accounts = await tlm_get_child_accounts(account);
            break;
        case 'transferwax':
            console.log(`Clearing WAX transfers for ${account}`);

            unique_accounts = await wax_get_child_accounts(account);
            break;
        default:
            console.error('Unknown type');
            process.exit(1);
    }

    console.log(unique_accounts);
    unique_accounts.forEach(a => {
        set_bot(a, false, 'Manual clear');
    })
}

if (process.argv.length < 4){
    console.error('Please supply account name and type of clear (delegatebw, transfertlm or transferwax)');
    process.exit(1);
}

clear(process.argv[2], process.argv[3]);
