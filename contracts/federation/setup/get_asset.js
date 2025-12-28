const fetch = require("node-fetch");
const { RpcApi } = require("atomicassets");

const atomicassets_account = 'atomicassets';
const endpoint = 'https://testnet.waxsweden.org';

const aa_api = new RpcApi(endpoint, atomicassets_account, {fetch, rateLimit: 4});

const getAssetData = async (owner, asset_id) => {
    const asset = await aa_api.getAsset(owner, asset_id);
    if (asset) {
        const asset_data = await asset.toObject();
        console.log(asset_data);
    }
}


const owner = process.argv[2];
const asset_id = process.argv[3];

if (!owner || !asset_id){
    console.error(`You must supply owner and asset id`);
    process.exit(1);
}

getAssetData(owner, asset_id);
