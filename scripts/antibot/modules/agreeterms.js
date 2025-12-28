
module.exports = (hyperion_endpoint, set_bot, whitelist) => {

    const agreeterms = async (data, block_timestamp) => {
        // if (whitelist.includes(data.account)){
        //     return
        // }
        // check for raw transfers of tools before this
        if (data.account !== 'va3s.wam'){
            return;
        }

        console.log(block_timestamp.toString())

        console.log('agreeterms', data)
        const url = `${hyperion_endpoint}/v2/history/get_actions?account=${data.account}&filter=atomicassets:transfer&before=${block_timestamp.toISOString()}`
        console.log(url)
        process.exit(0)
    }

    return { agreeterms }
}
