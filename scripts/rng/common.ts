#!/usr/bin/env node

import fetch from 'node-fetch';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextDecoder, TextEncoder } from 'text-encoding';
import { TableFetcher } from 'eosio-helpers';

import { config } from './config_new';

const rpc = new JsonRpc(config.endpoint, { fetch });
const signatureProvider = new JsSignatureProvider(config.private_keys);

const read_api = new Api({
  rpc,
  signatureProvider,
  textDecoder: new TextDecoder(),
  textEncoder: new TextEncoder(),
});

export const rarities = [
  'abundant',
  'common',
  'rare',
  'epic',
  'legendary',
  'mythical',
];

export type Rarity = typeof rarities[number];

const bots = new Map<string, boolean>();
export const check_bot = async (account: string, useCache: boolean) => {
  try {
    if (useCache && bots.has(account)) {
      return bots.get(account);
    }

    const actions = [
      {
        account: config.mining_contract,
        name: 'testparam',
        authorization: [
          {
            actor: config.mining_contract,
            permission: config.test_permission,
          },
        ],
        data: {
          key: account,
        },
      },
    ];
    const res = await read_api.transact(
      {
        actions,
      },
      {
        blocksBehind: 3,
        expireSeconds: 30,
      }
    );

    console.log(`Sent tx ${res}`);
  } catch (e) {
    let found = true;
    // console.error(e.message);
    if (e.message.indexOf('not found') > -1) {
      found = false;
    }

    bots.set(account, found);

    return found;
  }
};

export const fetchTemplatesGroupedByRarity = async (config: {
  mining_contract: string;
  endpoint: string;
}): Promise<Record<Rarity, number[]>> => {
  const templates: Record<Rarity, number[]> = {
    mythical: [],
    legendary: [],
    epic: [],
    rare: [],
    common: [],
    abundant: [],
  };

  try {
    const templatesArray: { rarity: string; template_ids: number[] }[] =
      await TableFetcher({
        codeContract: config.mining_contract,
        batch_size: 50,
        table: 'miningnfts',
        lower_bound: '',
        limit: 10000,
        endpoint: config.endpoint,
        scope: config.mining_contract,
      });

    templatesArray.forEach((t) => {
      templates[t.rarity] = t.template_ids;
    });
  } catch (e) {
    console.log('error while fetching templates: ', e.message);
  }
  return templates;
};

export const fetchFullTemplates = async () => {
  var templates: {
    template_id: number;
    max_supply: number;
    issued_supply: number;
  }[] = await TableFetcher({
    codeContract: config.nft_contract,
    batch_size: 500,
    table: 'templates',
    lower_bound: '',
    limit: 1000000,
    endpoint: config.endpoint,
    scope: 'alien.worlds',
  });

  const fullTemplates = templates
    .filter(
      ({ max_supply, issued_supply }) =>
        max_supply != 0 && issued_supply == max_supply
    )
    .map((t) => t.template_id);
  console.log(
    'number of full templates: ',
    fullTemplates.length,
    'out of: ',
    templates.length
  );
  console.log('full templates: ', JSON.stringify(fullTemplates));
  return new Set(fullTemplates);
};

export const filterOutFullTemplates = (
  templates: Record<Rarity, number[]>,
  fullTemplates: Set<number>
): Record<Rarity, number[]> => {
  let filtered: Record<Rarity, number[]> = {};
  for (const iterator of rarities) {
    filtered[iterator] = templates[iterator].filter(
      (t) => !fullTemplates.has(t)
    );
  }
  return filtered;
};

export const fetchRarityForTemplate = (
  groups: Record<Rarity, number[]>
): Map<number, Rarity> => {
  let filtered: Map<number, Rarity> = new Map();
  for (const rarity of rarities) {
    for (const templateId of groups[rarity]) {
      filtered[templateId] = rarity;
    }
  }
  return filtered;
};
