
const Int64LE = require("int64-buffer").Uint64LE;
const {Api, JsonRpc, Serialize} = require('eosjs');

module.exports = (api, mining_account, setparam_perm, logging_config) => {
    console.log(logging_config)
    const naughty_boys = []
    let global_actions = []
    const logging = require('./logging');
    // console.log('Loaded logging')

    const name_to_int = (name) => {
        const sb = new Serialize.SerialBuffer({
            textEncoder: new TextEncoder,
            textDecoder: new TextDecoder
        });

        sb.pushName(name);

        const name_64 = new Int64LE(sb.array);

        return BigInt(`${name_64}`) ^ BigInt('0xb00b1e50b00b1e50');
    }

    const check_bot = async (account) => {
        try {
            // console.log('Checking bot ', account)
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
            // console.log(JSON.stringify(actions))
            // console.log(api)
            const res = await api.transact({
                actions
            }, {
                blocksBehind: 3,
                expireSeconds: 180
            });

            // console.log(`Sent tx ${res.transaction_id}`);
        }
        catch (e) {
            // console.error('Error checking existing bot' + e.message);
            if (e.message.indexOf('not found') > -1){
                return false;
            }
            else if (e.message.indexOf('found') > -1){
                return true;
            }
            else {
                throw e
            }
        }
    }

    const do_submit_actions = async (actions) => {
        try {
            const res = await api.transact({
                actions
            }, {
                blocksBehind: 3,
                expireSeconds: 180
            });

            console.log(`Sent tx ${res.transaction_id}`);
        }
        catch (e) {
            console.error(e.message);
            // throw e;

            setTimeout(() => {
                do_submit_actions(actions)
            }, 5000);
        }
    }

    const submit_actions = async () => {
        actions = global_actions;
        global_actions = [];

        if (actions.length === 0){
            return;
        }
        console.log(`Submitting ${actions.length} actions`);
        await do_submit_actions(actions);

        actions = [];
    }


    const set_bot = async (account, is_bot = false, reason = '') => {
        // console.log(logging_config)
        const log = await logging(logging_config)

        try {
            if (naughty_boys.includes(account) || account.substr(-4) !== '.wam'){
                // console.log(`${account} was already marked as naughty`);
                return;
            }
            if (is_bot){
                // console.log(`Adding ${account} to naughty boys`);
                naughty_boys.push(account);
            }

            const on_list = await check_bot(account);
            if (on_list === is_bot){
                if (is_bot){
                    // console.log(`${account} was already marked as bot`);
                }
                else {
                    // console.log(`${account} was already marked as NOT A bot`);
                }
                return;
            }

            const miner_key = name_to_int(account);

            let rnd_value = 0;
            if (is_bot){
                rnd_value = parseInt(Math.random() * 1000000);
                while ((rnd_value % 3) !== 0){
                    rnd_value++;
                }
            }

            console.log(`Setting miner ${account} to ${rnd_value} - ${reason}`);

            global_actions.push({
                account: mining_account,
                name: 'setparam',
                authorization: [{
                    actor: mining_account,
                    permission: setparam_perm,
                }],
                data: {
                    key: `${miner_key}`,
                    value: rnd_value
                }
            });

            // console.log(global_actions)
            if (is_bot){
                log(account, reason)
            }
        }
        catch (e){
            console.error(`Error in set_bot ${e.message}`)
        }

    }

    return { set_bot, check_bot, submit_actions }
}
