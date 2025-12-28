const MongoClient = require('mongodb').MongoClient;

let db = null
module.exports = (config) => {

    const connect = async (config) => {
        if (db){
            return db
        }

        return new Promise((resolve, reject) => {
            MongoClient.connect(config.url, {useNewUrlParser: true, useUnifiedTopology: true }, (err, client) => {
                if (err) {
                    console.error("\nFailed to connect\n", err);
                    reject(err)
                } else if (client) {
                    console.log(`Connected to mongo at ${config.url}`);
                    console.log(`Got DB `)
                    db = client.db(config.dbName)
                    resolve(client.db(config.dbName))
                }
            })
        })
    }


    let queue = []
    const process_queue = async () => {
        const connection = await connect(config)
        const data = queue
        queue = []

        if (!data.length){
            return
        }

        const col = connection.collection('bots')
        col.insertMany(data, {ordered: false})
    }

    setInterval(process_queue, 1000)

    const log = (account, reason) => {
        const data = {
            account,
            reason
        }

        queue.push(data)
    }

    return log
}
