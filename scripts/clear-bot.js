#!/usr/bin/env node

const fetch = require("node-fetch");
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');

const Int64LE = require("int64-buffer").Uint64LE;

const mining_account = 'm.federation';
// const endpoint = 'https://wax-test.eosdac.io';
const endpoint = 'https://api.waxsweden.org';

const setparam_perm = 'setparam';

const private_data = {
    pk: '5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv'
}

const rpc = new JsonRpc(endpoint, { fetch });
const signatureProvider = new JsSignatureProvider([private_data.pk]);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const name_to_int = (name) => {
    const sb = new Serialize.SerialBuffer({
        textEncoder: new TextEncoder,
        textDecoder: new TextDecoder
    });

    sb.pushName(name);

    const name_64 = new Int64LE(sb.array);

    return BigInt(`${name_64}`) ^ BigInt('0xb00b1e50b00b1e50');
}

const clear_bot = async (account) => {
    const actions = [{
        account: mining_account,
        name: 'setparam',
        authorization: [{
            actor: mining_account,
            permission: setparam_perm,
        }],
        data: {
            key: name_to_int(account),
            value: 0
        }
    }];
    const res = await api.transact({
        actions
    }, {
        blocksBehind: 3,
        expireSeconds: 30
    });

    console.log(`Sent tx ${res.transaction_id}`);
}

const account = process.argv[2];
if (!account) {
    console.error(`You must supply the account to clear`);
    process.exit(1);
}

clear_bot(account);
