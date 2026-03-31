#!/usr/bin/env node

const { Api, JsonRpc } = require('eosjs');
const { TextDecoder, TextEncoder } = require('text-encoding');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
const fetch = require('node-fetch');

const config = require('./config');

const keys = config.keys
  .filter((k) => k.name === 'infl.worlds')
  .map((conf) => {
    return conf.claim_key;
  });

const signatureProvider = new JsSignatureProvider([...new Set(keys)]);
const rpc = new JsonRpc(config.endpoint, { fetch });
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
let api = new Api({ rpc, signatureProvider, textDecoder, textEncoder });

async function claim(config) {
  config.keys
    .filter((k) => k.name === 'infl.worlds')
    .forEach(async (conf) => {
      try {
        let data = {};

        await api.transact(
          {
            actions: [
              {
                account: 'infl.worlds',
                name: 'inflate',
                authorization: [
                  {
                    actor: conf.name,
                    permission: conf.permission,
                  },
                ],
                data,
              },
            ],
          },
          {
            blocksBehind: 3,
            expireSeconds: 30,
          }
        );

        console.log(`Succesffuly triggered inflate action`);
      } catch (e) {
        let msg = e.message;

        if (msg.indexOf('Last fill was less than 24 hours ago') === -1) {
          console.error(`Failed to claim landowner allocation - ${e.message}`);
        }
      }
    });
}

setInterval(() => {
  claim(config);
}, 60000);

claim(config);
