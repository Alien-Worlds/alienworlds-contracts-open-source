
module.exports = (set_bot, whitelist) => {

    const lazyusername = async (data) => {
        if (whitelist.includes(data.account)){
            return
        }

        if (data.account.replace('.', '').toLowerCase() === data.tag.toLowerCase()){
            console.log(`${data.account} uses a lazy username`)
            set_bot(data.account, true, 'lazy username')
        }
    }

    return { lazyusername }
}
