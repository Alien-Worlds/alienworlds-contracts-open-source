/*
 * Set LIVE_MODE to true and fill in variables to run on live network
 */
const LIVE_MODE = true;
const LIVE_KEY = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';
const LIVE_ACTOR = 'uspts.worlds'; // account used to send the transaction
const LIVE_PERMISSION = 'active';
const LIVE_ENDPOINT = 'https://waxnode.alienworlds.io';
const INACTIVITY_THRESHOLD = 60 * 60 * 24 * 180; // 180 days (should match smart contract)
const BATCH_SIZE = 300; // Number of users to reclaim in a single transaction
/* End of config */

const { Api, JsonRpc } = require('eosjs');
const fetch = require('node-fetch');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const fs = require('fs');

let keys;
let permission;
let READ_ENDPOINT;
let TRANSACTION_ENDPOINT;
let actor_account;
if (LIVE_MODE) {
  keys = [LIVE_KEY];
  permission = LIVE_PERMISSION;
  actor_account = LIVE_ACTOR;
  READ_ENDPOINT = LIVE_ENDPOINT;
  TRANSACTION_ENDPOINT = LIVE_ENDPOINT;
} else {
  // Dummy key for dev
  keys = ['5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'];
  permission = 'active';
  actor_account = 'uspts.worlds';
  READ_ENDPOINT = LIVE_ENDPOINT; // Read from live endpoint for dev
  TRANSACTION_ENDPOINT = 'http://localhost:8888'; // But transact on local
}

const rpc = new JsonRpc(READ_ENDPOINT, { fetch });

const signatureProvider = new JsSignatureProvider(keys);

const eos = new Api({
  rpc: new JsonRpc(TRANSACTION_ENDPOINT, { fetch }),
  signatureProvider,
  textDecoder: new TextDecoder(),
  textEncoder: new TextEncoder(),
});

let users_to_reclaim = [];

const SAVE_FILE = 'last_processed_key.json';

// Add function to load last key
function loadLastProcessedKey() {
  let last_key = null;
  if (fs.existsSync(SAVE_FILE)) {
    const data = JSON.parse(fs.readFileSync(SAVE_FILE));
    const mode = LIVE_MODE ? 'live' : 'dev';
    last_key = data[mode]?.lastKey || null;
  }
  console.log(`Starting from ${last_key ? `key: ${last_key}` : 'beginning'}`);
  return last_key;
}

// Add function to save last key
function saveLastProcessedKey(key) {
  const mode = LIVE_MODE ? 'live' : 'dev';
  let data = {};

  // Load existing data if file exists
  if (fs.existsSync(SAVE_FILE)) {
    data = JSON.parse(fs.readFileSync(SAVE_FILE));
  }

  // Update the key for current mode
  data[mode] = { lastKey: key };

  fs.writeFileSync(SAVE_FILE, JSON.stringify(data, null, 2));
  console.log(`Saved last key: ${key}`);
}

const last_key = loadLastProcessedKey();

// Modify the config initialization to include the last processed key
const config = {
  code: 'uspts.worlds',
  scope: 'uspts.worlds',
  table: 'userpoints',
  limit: 100,
  json: true,
};
if (last_key) {
  config.lower_bound = last_key;
}

async function* fetchUserPointsStream() {
  let hasMore = true;
  let rowCount = 0;

  while (hasMore) {
    const results = await rpc.get_table_rows(config);
    rowCount += results.rows.length;
    console.log(`Processing batch of ${results.rows.length} rows. Total processed: ${rowCount}`);
    

    for (const row of results.rows) {
      yield row;
    }

    hasMore = results.more;
    if (hasMore) {
      config.lower_bound = results.next_key;
    }

  }
}

async function main() {
  try {
    for await (const userPoint of fetchUserPointsStream()) {
      await process_rows([userPoint]);
    }
  } catch (error) {
    console.error('Error processing user points:', error);
  }
}

async function process_rows(rows) {
  for (const userpoint of rows) {
    if (is_inactive(userpoint)) {
      // console.log(`Reclaiming user: ${userpoint.user}`);
      users_to_reclaim.push(userpoint.user);
      if (users_to_reclaim.length >= BATCH_SIZE) {
        await reclaim_batch();
      }
    } else {
      // console.log(`Not reclaiming user: ${userpoint.user}`);
    }
  }
}

async function reclaim_batch() {
  console.log(`Reclaiming batch of ${users_to_reclaim.length} users`);
  await execute_transaction();
  users_to_reclaim = [];
  saveLastProcessedKey(config.lower_bound);
}

async function execute_transaction() {
  const actions = [
    {
      account: actor_account,
      name: 'reclaim',
      authorization: [
        {
          actor: actor_account,
          permission,
        },
      ],
      data: {
        users: users_to_reclaim,
      },
    },
  ];
  if (!LIVE_MODE) {
    actions[0].data.current_time = new Date();
  }
  console.log(`Executing transaction: ${JSON.stringify(actions)}`);
  await eos.transact(
    { actions },
    {
      blocksBehind: 3,
      expireSeconds: 30,
    }
  );
}

function is_inactive(userpoint) {
  const last_action =
    new Date(userpoint.last_action_timestamp).getTime() / 1000;
  const expires_at = last_action + INACTIVITY_THRESHOLD;
  const now = Math.floor(Date.now() / 1000);
  // console.log(`User: ${userpoint.user} Current time: ${new Date(now * 1000).toISOString()}`);
  // console.log(`Last action: ${new Date(last_action * 1000).toISOString()}`);
  // console.log(`Expires at: ${new Date(expires_at * 1000).toISOString()}`);
  return now > expires_at;
}

main();
