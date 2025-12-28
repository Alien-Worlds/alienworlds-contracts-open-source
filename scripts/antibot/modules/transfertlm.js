
const fetch = require("node-fetch")

const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}


const blacklist_account = (taccount, sinkhole, whitelist, set_bot, reason) => {
    if (!whitelist.includes(taccount) && taccount.substr(-4) === '.wam'){
        console.log(`${taccount} is on the naughty list for sending to sinkhole ${sinkhole}`)

        set_bot(taccount, true, reason)
    }
}

module.exports = (hyperion_endpoint, set_bot, whitelist) => {

    const get_child_accounts = async (account) => {
        let unique_accounts = []
        try {
            // Account receiving tlm
            const turl = `${hyperion_endpoint}/v2/history/get_actions?limit=1000&account=${account}&filter=alien.worlds:transfer&@transfer.to=${account}`;
            console.log(turl)
            const tres = await fetch(turl);
            const tjson = await tres.json();
            const taccounts = tjson.actions.map(a => a.act.data.from).filter(a => !whitelist.includes(a));
            // console.log(`Transfer to ${account}`, taccounts);
            // return
            // process.exit(0)
            unique_accounts = [...new Set(taccounts)]
        }
        catch (e){
            console.error(e)
        }

        return unique_accounts
    }

    const queue = []
    const processqueue = async () => {
        // console.log(queue)
        if (!queue.length){
            return
        }

        const data = queue.shift()
        // console.log('processqueue', data)
        const account = data.to
        if (account.substr(-7) === '.worlds' || account.substr(-11) === '.federation'){
            return
        }
        // console.log(`Checking ${account}`)
        if (whitelist.includes(account)){
            console.log(`${account} is on the whitelist`)
            return
        }

        const unique_accounts = await get_child_accounts(account)
        // console.log(unique_accounts)
        let is_bot = true;

        if (unique_accounts.length > 4){
            console.log(`${account} is a sinkhole`)
            if (account.substr(-4) === '.wam'){
                set_bot(account, is_bot, 'is sinkhole')
                // set_bot(account, false, 'is sinkhole')
            }

            for (let t = 0; t < unique_accounts.length; t++){
                const taccount = unique_accounts[t]
                if (!is_bot){
                    set_bot(account, is_bot, 'is sinkhole')
                }
                else {
                    blacklist_account(taccount, account, whitelist, set_bot, `sending to sinkhole ${account}`)
                }

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

    const transfertlm = async (data) => {
        queue.push(data)
    }

    return { transfertlm, tlm_get_child_accounts: get_child_accounts }
}
