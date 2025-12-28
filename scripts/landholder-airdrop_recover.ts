#!/usr/bin/env node

import fetch from 'node-fetch';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  sleep,
  getCurrencyBalance,
  BatchRun,
  CSVBatchRun,
} from 'eosio-helpers';

// const endpoint = 'https://wax.pink.gg';
// const endpoint = 'http://127.0.0.1:28888';
const endpoint = 'https://wax.eosdac.io';
// const endpoint = 'https://waxnode.alienworlds.io';
// const endpoint = 'http://51.222.44.49';
// const endpoint = 'http://neri.alienworlds.io:58888';
const aa_endpoint = 'https://wax.api.atomicassets.io';
// const aa_endpoint = 'https://test.wax.api.atomicassets.io';
const collection_name = 'alien.worlds';
const terra_account = 'terra.worlds';

const terraWorldXferKey = '5Jnbxv6zuiLqUqQKjxZP7tCwJ2uXCX6QVsXcmWyv4qjEcqipfXc';

const landownersFilename = 'landowners.json';
const landownerAmountsFilename = 'landownerAmountsDue.json';

const memo = 'Alien Worlds: Landowner allocation';

const send = (batch_size: number, filename: string, dry_run: boolean) => {
  const batchRun = CSVBatchRun({
    filename,
    batch_size,
    submit_to_blockchain: !dry_run,
    eos_endpoint: endpoint,
    private_keys: [{ pk: terraWorldXferKey }],
    csvParseOptions: { columns: ['to', 'quantity'] },
    createAction: (p) => {
      return {
        account: 'alien.worlds',
        name: 'transfer',
        authorization: [{ actor: 'terra.worlds', permission: 'xfer' }],
        data: { from: 'terra.worlds', to: p.to, quantity: p.quantity, memo },
      };
    },
  });
};

var batch_size = undefined;

const run = async () => {
  batch_size = parseInt(process.argv[4]);
  if (isNaN(batch_size)) {
    console.error('Must supply batch size');
    process.exit(1);
  }

  const filename = process.argv[3];

  switch (process.argv[2]) {
    case '--daemon-dry-run':
      await send(batch_size, filename, true);
      break;
    case '--daemon':
      await send(batch_size, filename, false);
      break;
    default:
      console.error(`Incorrect usage!`);
  }
};

run();
