
const fetch = require("node-fetch")

const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = (hyperion_endpoint, rpc, set_bot, check_bot, whitelist) => {
    const get_delegated_accounts = async (delegator) => {
        const res = await rpc.get_table_rows({
            code: 'eosio',
            scope: delegator,
            table: 'delband',
            limit: 1000
        })

        const receiving_accounts = res.rows.filter(r => r.to.substr(-4) === '.wam').map(r => r.to)

        return receiving_accounts
    }

    const delegatebw = async (delegate_data, retries = 0) => {
        if (retries >= 5){
            return;
        }
        const delegator = delegate_data.from
        if (whitelist.includes(delegator)){
            return;
        }
        let receiving_accounts = []

        if (delegate_data.transfer){
            // console.log(delegate_data)
            try {
                const url = `${hyperion_endpoint}/v2/history/get_actions?limit=1000&account=${delegator}&filter=eosio:delegatebw`;
                const res = await fetch(url);
                const json = await res.json();
                receiving_accounts = json.actions
                    .filter(a => !whitelist.includes(a.act.data.from))
                    .map(a => a.act.data.receiver)
                    .filter(a => a.substr(-4) === '.wam');
            }
            catch (e){
                console.error(e.message);
                await sleep(5000);
                return delegatebw(delegate_data, ++retries);
            }
        }
        else {
            if (whitelist.includes(delegator)){
                return
            }

            receiving_accounts = await get_delegated_accounts(delegator);
        }

        const delegator_is_bot = await check_bot(delegator);

        if (receiving_accounts.length > 7 || delegator_is_bot){
            const is_bot = true

            set_bot(delegator, is_bot, `${delegator} delegates to multiple accounts`);

            for (let r = 0; r < receiving_accounts.length; r++){
                const saccount = receiving_accounts[r]
                if (!whitelist.includes(saccount) && saccount.substr(-4) === '.wam'){
                    console.log(`${delegator} delegates to ${saccount}`)
                    // console.log(`${saccount} is on the naughty list for receiving stake from parent ${delegator}`);

                    set_bot(saccount, is_bot, `${delegator} delegates to ${saccount}`);

                    await sleep(50);
                }
            }
        }
    }

    return { delegatebw, get_delegated_accounts }
}
