#!/usr/bin/env -S node --max-old-space-size=32768

const crypto = require('crypto');
const fs = require('fs');
const cluster = require('cluster');
const { Api, JsonRpc, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const { TextDecoder, TextEncoder } = require('text-encoding');
const { RpcApi } = require('atomicassets');
const fetch = require('node-fetch');

const state_table = 'state3';
const atomicassets_account = 'atomicassets';
const federation_account = 'federation';
const mining_account = 'm.federation';
const collection = 'alien.worlds';
const env = process.env.CONFIG ? process.env.CONFIG : 'dev';
console.log(`Config environment set to ${env}`);
const config = require('./config.' + env);

// const eos_rpc = new JsonRpc(config.endpoint, {fetch});
// const signatureProvider = new JsSignatureProvider([config.mine_pk]);
// const eos_api = new Api({ rpc: eos_rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const {
  getBag,
  setBag,
  getLand,
  setLand,
  getLandByPlanet,
  getPlayerData,
  getTools,
  getPlanets,
  getLandMiningParams,
  getBagMiningParams,
  getNextMineDelay,
  lastMineTx,
  doWork,
  doWorkWorker,
} = require('./mine_testing');

const get_nonce = async (account, land_owner, EOSManager) => {
  const aa_api = new RpcApi('http://localhost:8888', 'atomicassets', {
    fetch,
  });

  let [account_name, account_permission] = account.split('@');
  if (!account_permission) {
    account_permission = 'active';
  }
  account = account_name;

  const land = await getLand(
    mining_account,
    account,
    land_owner,
    EOSManager.rpc,
    aa_api
  );
  const bag = await getBag(mining_account, account, EOSManager.rpc, aa_api);

  const params = getBagMiningParams(bag, EOSManager.rpc);
  const land_params = getLandMiningParams(land);

  params.delay *= land_params.delay / 10;
  params.ease *= land_params.ease / 10;
  params.difficulty += land_params.difficulty;

  const last_mine_tx = await lastMineTx(
    mining_account,
    account,
    EOSManager.rpc
  );
  const mine_work = await doWork({
    mining_account,
    account,
    difficulty: params.difficulty,
    last_mine_tx,
  });
  return mine_work.rand_str;
};

module.exports = { get_nonce };
