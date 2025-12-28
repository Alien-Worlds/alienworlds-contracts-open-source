
const fetch = require("node-fetch");
const config = require('./config');

const BOT_ACTION_FLAG = 1;
const BOT_ACTION_UNFLAG = 2;

module.exports = () => {
    const naughty_boys = []
    let batchOfTasks = []
    let token

    const login = async (email, password) => {
        try {
            const result = await fetch(`${config.bottracker.host}/login`, {
                method: 'POST', body: JSON.stringify({ email, password }),
                headers: { 'Content-Type': 'application/json' }
            });
            const resultToken = await result.json()
            console.log('getting new token: ', resultToken.token)
            return resultToken.token;
        }
        catch (e) {
            console.log("Failed log in will try again:", e)
            setTimeout(() => {
                return login(email, password)
            }, 5000);
        }
    }

    const post_tasks_to_api = async (actions) => {

        const options = {
            method: 'POST', body: JSON.stringify(actions), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        }
        console.log("about to post tasks.", actions);

        const result = await fetch(`${config.bottracker.host}/addTasks`, options)
        console.log('result from posting tasks to server: ', result.status)
        if (result.status == 403) {
            token = await login(config.bottracker.username, config.bottracker.password);
            await post_tasks_to_api(actions);
        }
    };

    const submit_actions = async () => {
        const tasksToSend = batchOfTasks;
        batchOfTasks = []

        if (tasksToSend.length === 0) {
            return;
        }
        console.log(`Submitting ${tasksToSend.length} actions`);
        await post_tasks_to_api(tasksToSend);
    }

    const process_tasks_through_api = async () => {

        const options = {
            method: 'POST', body: JSON.stringify({
                "status": [1, 4],
                "batchSize": 400,
                "reason": "Processing tasks from BotScripts trigger."
            }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        }

        const result = await fetch(`${config.bottracker.host}/processTasks`, options)
        const respObject = await result.json()
        console.log('result from processing tasks on server: ', result.status, respObject)
        if (result.status == 403) {
            token = await login(config.bottracker.username, config.bottracker.password);
            await process_tasks_through_api(actions);
        }
    };

    const set_bot = async (account, is_bot = false, reason = '') => {

        try {
            if (naughty_boys.includes(account) || account.substr(-4) !== '.wam') {
                // console.log(`${account} was already marked as naughty`);
                return;
            }
            if (is_bot) {
                naughty_boys.push(account);
            }

            // const on_list = await check_bot(account);
            // if (on_list === is_bot) {
            //     if (is_bot) {
            //         // console.log(`${account} was already marked as bot`);
            //     }
            //     else {
            //         // console.log(`${account} was already marked as NOT A bot`);
            //     }
            //     return;
            // }

            batchOfTasks.push({ blockchainAccount: account, action: is_bot ? BOT_ACTION_FLAG : BOT_ACTION_UNFLAG, reason: `BotScript: ${reason}` });

        }
        catch (e) {
            console.error(`Error in set_bot ${e.message}`)
        }

    }

    return { set_bot, submit_actions, process_tasks_through_api }
}
