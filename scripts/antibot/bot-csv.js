const StateReceiver = require('@eosdacio/eosio-statereceiver');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const fs = require('fs');

const mining_account = 'm.federation';
const setparam_perm = 'setparam';

const config = require('./config');
// Private key: 5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv
// Public key: EOS7JUT21YpUHbgiEgpBQuCXGmzsmsWupuPWQV25kKxUyWywgLBHd
const private_data = {
    pk: '5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv'
}

const rpc = new JsonRpc(config.eos.endpoint, { fetch });
const signatureProvider = new JsSignatureProvider([private_data.pk]);
const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });


const { set_bot, submit_actions } = require('./bot-control')(api, mining_account, setparam_perm, config.logging)
setInterval(submit_actions, 500)

const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

const run = async (filename, action) => {
    console.log(`Reading bots from ${filename}`)
    const shouldFlag = action === 'flag'

    const data = fs.readFileSync(filename, { encoding: 'utf-8' })

    const accounts = data.split('\n').filter(l => l).filter(l => l.replace('\r', '')).filter(l => l.replace(/ /g, '')).filter(l => l.toLowerCase())

    for (let a = 0; a < accounts.length; a++) {
        const account = accounts[a].split('\t')[0]
        console.log('account:', account, ' - action: ', shouldFlag ? "Flag" : "Unflag");
        set_bot(account, shouldFlag, 'manual')
        await sleep(100)
    }

    console.log('Finished, waiting for processing')
    await sleep(30000)
    process.exit(0)
}


if (process.argv.length != 4) {
    console.error('Error: Please supply filename and an action. usage: `node bot-csv.js <filename.csv> flag|unflag`')
    process.exit(1)
}

const filename = process.argv[2]
const action = process.argv[3]
if (action != 'flag' && action != 'unflag') {
    console.error('Must supply an action as the last param.')
    console.error('usage: `node bot-csv.js <filename.csv> flag|unflag`')
    process.exit(1)
}
run(filename, action)
