const { RpcApi } = require('atomicassets');
const { sleep } = require('lamington');
const fetch = require('node-fetch');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const schema_name = 'land.worlds';

const schema_format_extension = [
  { name: 'landrating', type: 'uint64' },
  { name: 'openslots', type: 'uint8' },
  { name: 'MinBoostAmount', type: 'int64' },
  { name: 'BoostLastUsedDay', type: 'uint32' },
  { name: 'UsedBoostsDay', type: 'uint8' },
  { name: "TopReachedAt", type: "uint32" },
];
let config;
let atomic;
const DEV = true;
if (DEV) {
  config = {
    atomicassets_account: 'atomicassets',
    federation_account: 'awlndratings',
    open_account: 'alien.worlds',
    collection_name: 'alien.worlds',
    endpoint: 'http://localhost:8888',
    aa_endpoint: 'http://localhost:8888',
  };
} else {
  config = require('./config');
}

async function alr(eos) {
  let rpc, signatureProvider;
  if (!eos) {
    rpc = new JsonRpc(config.endpoint, { fetch });
    signatureProvider = null;
    eos = new Api({
      rpc,
      signatureProvider,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    });
  } else {
    rpc = eos.rpc;
  }
  atomic = new RpcApi(config.aa_endpoint, config.atomicassets_account, {
    fetch,
  });
  await extendschema(eos);

  const options = {
    code: config.federation_account,
    scope: config.federation_account,
    table: 'landregs',
    index_position: 0,
    json: true,
  };
  let results = await rpc.get_table_rows(options);
  await setassetdata(results.rows, eos);
  while (results.more) {
    options['lower_bound'] = results.next_key;
    results = await rpc.get_table_rows(options);
    await setassetdata(results.rows, eos);
  }
}

async function setassetdata(rows, eos) {
  const actions = [];
  for (const { owner, id } of rows) {
    const old_data = await get_mutable_data_for_update(owner, id);
    const data_to_add = [
      {
        key: 'landrating',
        value: ['uint64', 10 ** 6],
      },
      {
        key: 'openslots',
        value: ['uint8', 1],
      },
      {
        key: 'MinBoostAmount',
        value: ['int64', 0],
      },
      {
        key: 'BoostLastUsedDay',
        value: ['uint32', 0],
      },
      {
        key: 'UsedBoostsDay',
        value: ['uint8', 0],
      },
    ];
    const new_data = old_data.concat(data_to_add);
    actions.push({
      account: config.atomicassets_account,
      name: 'setassetdata',
      authorization: [
        {
          actor: config.open_account,
          permission: 'active',
        },
      ],
      data: {
        authorized_editor: config.open_account,
        asset_owner: owner,
        asset_id: id,
        new_mutable_data: new_data,
      },
    });
  }
  try {
    await eos.transact(
      { actions },
      {
        blocksBehind: 1,
        expireSeconds: 30,
      }
    );
  } catch (e) {
    console.log({ actions })
    throw e;
  }

}

async function extendschema(eos) {
  const actions = [
    {
      account: config.atomicassets_account,
      name: 'extendschema',
      authorization: [
        {
          actor: config.open_account,
          permission: 'active',
        },
      ],
      data: {
        authorized_editor: config.open_account,
        collection_name: config.collection_name,
        schema_name: 'land.worlds',
        schema_format_extension,
      },
    },
  ];
  await eos.transact(
    { actions },
    {
      blocksBehind: 1,
      expireSeconds: 30,
    }
  );
}

function get_type(attr, format) {
  return format.find((x) => x.name == attr).type;
}

async function get_mutable_data_for_update(owner, id) {
  const asset = await atomic.getAsset(owner, id);
  const data = await asset.mutableData();
  const schema = await asset.schema();
  const format = await schema.rawFormat();
  return atomicdata_to_weird_eos_dictionary(data, format);
}

function atomicdata_to_weird_eos_dictionary(data, format) {
  let retdata = [];
  for (const [key, value] of Object.entries(data)) {
    retdata.push({ key, value: [get_type(key, format), value] });
  }
  return retdata;
}

module.exports = { alr, setassetdata };
