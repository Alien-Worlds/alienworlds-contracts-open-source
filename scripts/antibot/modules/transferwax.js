
const fetch = require("node-fetch")

const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = (hyperion_endpoint, set_bot, whitelist) => {

    const filterWhiteListedParties = ({
        act: {
            data: {
                from, to
            }
        }
    }) => (!whitelist.includes(from) && !whitelist.includes(to))

    const get_child_accounts = async (account) => {
        let unique_accounts = []
        try {
            // Account receiving wax
            const turl = `${hyperion_endpoint}/v2/history/get_actions?limit=1000&account=${account}&filter=eosio.token:transfer&@transfer.from=${account}`;
            // console.log(turl)
            const tres = await fetch(turl);
            const tjson = await tres.json();
            const taccounts = tjson.actions
                .filter(filterWhiteListedParties)
                .map(a => a.act.data.to)
                .filter(a => a.substr(-4) === '.wam');

            //accounts sending wax back
            const furl = `${hyperion_endpoint}/v2/history/get_actions?limit=1000&account=${account}&filter=eosio.token:transfer&@transfer.to=${account}`;
            // console.log(turl)
            const fres = await fetch(furl);
            const fjson = await fres.json();

            const faccounts = fjson.actions
                .filter(filterWhiteListedParties)
                .map(a => a.act.data.from)
                .filter(a => a.substr(-4) === '.wam');

            unique_accounts = [...new Set([...new Set(taccounts), ...new Set(faccounts)])]
        }
        catch (e) {
            console.error(e)
        }

        return unique_accounts
    }


    const queue = []
    const processqueue = async () => {
        // console.log(queue)
        if (!queue.length) {
            return
        }

        const data = queue.shift()
        // console.log('processqueue', data)
        const account = data.from
        if (whitelist.includes(account)) {
            console.log(`${account} is on the whitelist`)
            return
        }
        let is_bot = true;

        const unique_accounts = await get_child_accounts(account, hyperion_endpoint, whitelist)
        // console.log(unique_accounts)

        if (unique_accounts.length > 30) {
            console.log(`${account} is a daddy`)
            if (account.substr(-4) === '.wam') {
                set_bot(account, is_bot, 'is daddy')
                // set_bot(account, false, 'is sinkhole')
            }

            for (let t = 0; t < unique_accounts.length; t++) {
                const taccount = unique_accounts[t]
                set_bot(taccount, is_bot, `receiving from daddy ${account}`)

                /*const child_accounts = await get_child_accounts(taccount, hyperion_endpoint, whitelist)
                // console.log(child_accounts)
    
                if (child_accounts.length > 4){
                    for (let t = 0; t < child_accounts.length; t++) {
                        const caccount = child_accounts[t]
                        blacklist_account(caccount, taccount, whitelist, set_bot, `sending to sinkhole ${taccount} who sends to ${account}`)
                        await sleep(50)
                    }
                }*/

                await sleep(50)
            }
        }
    }

    setInterval(processqueue, 500)

    const transferwax = async (data) => {
        queue.push(data)
    }

    return { transferwax, wax_get_child_accounts: get_child_accounts }
}
