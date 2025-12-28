
module.exports = (set_bot, check_bot, whitelist) => {

    const firstbiller = async (action, block_timestamp) => {
        // console.log(action.act.authorization);
        const auth = action.act.authorization
        if (auth.length > 1 && !whitelist.includes(auth[0].actor)) {
            set_bot(auth[1].actor, true, `Actions paid by first biller ${auth[0].actor}`)
        }
    }

    return { firstbiller }
}
