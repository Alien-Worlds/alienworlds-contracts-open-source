
const fetch = require("node-fetch")

const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = (hyperion_endpoint, set_bot, whitelist) => {
    const queue = []
    const processqueue = async () => {
        if (!queue.length){
            return
        }

        const data = queue.shift()
        console.log('processqueue', data)
        // console.log(`Checking ${account}`)
        if (whitelist.includes(data.to)){
            console.log(`${data.to} is on the whitelist`)
            return
        }
        if (whitelist.includes(data.from)){
            console.log(`${data.from} is on the whitelist`)
            return
        }

        if (check_bot(data.from)){
            console.log(`${data.from} is a bot sending assets to ${data.to}`)
            set_bot(data.to, true, 'Received assets from a bot account');
        }
    }

    // setInterval(processqueue, 500)

    const transferasset = async (data) => {
        queue.push(data)
    }

    return { transferasset }
}
