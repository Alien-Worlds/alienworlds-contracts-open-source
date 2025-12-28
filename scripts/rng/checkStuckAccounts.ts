#!/usr/bin/env node

import { randomElement, TableFetcher } from 'eosio-helpers';

import { config } from './config_new';
import {
  fetchTemplatesGroupedByRarity,
  fetchFullTemplates,
  fetchRarityForTemplate,
  filterOutFullTemplates,
  Rarity,
} from './common';

const fetchExistingClaims = async () => {
  const claims: { miner: string; template_ids: number[] }[] =
    await TableFetcher({
      codeContract: 'm.federation',
      batch_size: 500,
      table: 'claims',
      lower_bound: '',
      limit: 100_000,
      endpoint: config.endpoint,
      scope: 'm.federation',
    });
  console.log('number of accounts to claim: ', claims.length, claims);
  return claims;
};

const run = async (dev: boolean) => {
  if (dev) {
    console.log('running in dev mode');
  }
  const groups = await fetchTemplatesGroupedByRarity(config);
  const rarityForTemplates = fetchRarityForTemplate(groups);

  const fullTemplates = await fetchFullTemplates();
  const availableTemplates = filterOutFullTemplates(groups, fullTemplates);

  const pendingClaims = await fetchExistingClaims();

  const full_vs_AvilableClaims = pendingClaims.map(
    ({ miner, template_ids }) => ({
      miner,
      full: template_ids.filter((t) => fullTemplates.has(t)),
      available: template_ids.filter((t) => !fullTemplates.has(t)),
    })
  );

  const stuckAccounts = full_vs_AvilableClaims.filter(
    ({ full }) => full.length > 0
  );
  console.log(
    'Number of accounts stuck from claiming: ',
    stuckAccounts.length,
    '/',
    pendingClaims.length
  );

  const replacementTemplates = stuckAccounts.map(({ miner, full }) => {
    // Map array of full templateIds to array of rarities.
    const rarities: Rarity[] = full.map((t) => rarityForTemplates[t]);
    // Map array of rarities to new available,random templateIds.
    const newTemplates: number[] = rarities
      .map((r) => availableTemplates[r])
      .map((t) => randomElement(t, Math.random()));

    return {
      miner,
      full,
      rarities,
      newTemplates,
    };
  });

  console.log(
    'claims to Repair count: ',
    replacementTemplates.length,
    ' items: ',
    JSON.stringify(replacementTemplates, null, 4)
  );
};

const dev = !!process.argv[2];

run(dev);
