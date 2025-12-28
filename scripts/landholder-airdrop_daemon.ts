#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getCurrencyBalance, BatchRun, TableFetcher } from 'eosio-helpers';

import yargs from 'yargs';
import { arg } from 'mathjs';

// const endpoint = 'https://wax.pink.gg';
// const endpoint = 'http://127.0.0.1:28888';
const endpoint = 'https://api.waxsweden.org';
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

const blacklist = ['open.worlds', 'atomictoolsx', 'atomicmarket', 's.rplanet'];
const memo = 'Alien Worlds: Landowner allocation';

interface FilterAmount {
  account: string;
  quantity: number;
}

interface LandownersRun {
  date: string;
  status?: string;
  landowners: { account: string; qty: number }[];
}

interface LandownersAmountsRun {
  date: string;
  status?: string;
  amounts: { account: string; qty: string }[];
}

const generateLandholdersList = async (date) => {
  let page = 1;
  var outputObject = [];
  if (existsSync(landownersFilename)) {
    try {
      outputObject = JSON.parse(readFileSync(landownersFilename, 'utf-8'));
    } catch (e) {
      outputObject = [];
    }
  }
  var landowners = {};

  const landholders: { id: number; owner: string }[] = await TableFetcher({
    endpoint: endpoint,
    batch_size: 1000,
    limit: 5000,
    codeContract: 'federation',
    table: 'landregs',
    lower_bound: '',
    sleepMS: 0,
    scope: 'federation',
  });

  landholders.forEach((a) => {
    if (typeof landowners[a.owner] === 'undefined') {
      landowners[a.owner] = {
        account: a.owner,
        qty: 0,
      };
    }
    landowners[a.owner].qty++;
  });

  const amounts: any[] = Object.values(landowners);

  // remove non player accounts
  const to_drop = amounts
    .filter((d: any) => !blacklist.includes(d.account))
    .sort((a, b) => (a.qty > b.qty ? 0 : -1));

  //delete repeat runs of the same day and records more than 10 days old
  outputObject = outputObject.filter(
    (o) =>
      o.date != date &&
      Date.parse(o.date) > Date.now() - 10 * 24 * 60 * 60 * 1000
  );

  outputObject.push({ date, landowners: to_drop });
  writeFileSync(landownersFilename, JSON.stringify(outputObject, null, 2));
};

const calculateAmounts = async (
  date,
  filterJSON: FilterAmount[] | undefined
) => {
  var landOwners: LandownersRun[] = JSON.parse(
    readFileSync(landownersFilename, 'utf-8')
  );
  const data = landOwners[landOwners.length - 1].landowners;

  var each_land_allocation = 0.0;

  const total_lands = data.reduce((a, b) => a + b.qty, 0);

  // get balance of the landholders account to distribute equally
  const bal = await getCurrencyBalance(
    'alien.worlds',
    terra_account,
    'TLM',
    endpoint
  );
  const [total_str] = bal[0].split(' ');

  const total = parseFloat(total_str); // for 10 tests

  each_land_allocation = Math.floor((total / total_lands) * 10000) / 10000;
  let stillOverPaid = [];
  let filtered_to_send = [];

  for (const { account, qty } of data) {
    let qty_amount = each_land_allocation * qty;
    if (filterJSON) {
      const filterRecord = filterJSON.find((f) => f.account == account);
      if (filterRecord) {
        console.log('filtering: ', filterRecord, qty, qty_amount);
        qty_amount = qty_amount - filterRecord.quantity;
      }
    }
    if (qty_amount < 0) {
      stillOverPaid.push({ account, quantity: `${0 - qty_amount}` });
    } else {
      const amount_to_send = `${qty_amount.toFixed(4)} TLM`;
      filtered_to_send.push({
        account: account,
        qty: amount_to_send,
      });
    }
  }

  console.log(
    'overpaid:',
    stillOverPaid.length,
    JSON.stringify(stillOverPaid, null, 2)
  );

  console.log('filtered_to_send length:', filtered_to_send.length);

  var output: LandownersAmountsRun[] = [];
  if (existsSync(landownerAmountsFilename)) {
    try {
      output = JSON.parse(readFileSync(landownerAmountsFilename, 'utf-8'));
    } catch (e) {
      console.log('catchchic');
      output = [];
    }
  }
  //delete repeat runs of the same day and records more than 10 days old
  output = output.filter(
    (o) =>
      o.date != date &&
      Date.parse(o.date) > Date.now() - 10 * 24 * 60 * 60 * 1000
  );

  output.push({ date, status: 'NotSent', amounts: filtered_to_send });

  writeFileSync(landownerAmountsFilename, JSON.stringify(output, null, 2));
};

const send = async (batch_size: number, dry_run: boolean) => {
  const amountsToSend: {
    date: string;
    status: string;
    amounts: {
      account: string;
      qty: string;
    }[];
  }[] = JSON.parse(readFileSync(landownerAmountsFilename, 'utf-8'));

  const dailyBatch = amountsToSend[amountsToSend.length - 1];
  const to_send = dailyBatch.amounts;
  if (to_send.length === 0 || dailyBatch.status != 'NotSent') {
    console.error(`Nothing to send!`);
    return;
  }

  console.log(`Sending to ${to_send.length} accounts`);

  const batchRunResult = await BatchRun({
    fields: to_send,
    batch_size: batch_size,
    eos_endpoint: endpoint,
    private_keys: [{ pk: terraWorldXferKey }],
    submit_to_blockchain: !dry_run,
    createAction: ({ account, qty }) => {
      return {
        account: 'alien.worlds',
        name: 'transfer',
        authorization: [
          {
            actor: terra_account,
            permission: 'xfer',
          },
        ],
        data: {
          from: terra_account,
          to: account,
          quantity: qty,
          memo,
        },
      };
    },
  });

  console.log('Batchrun complete:', batchRunResult);
  if (!dry_run) {
    amountsToSend[amountsToSend.length - 1].status = 'Sent';
    //Only keep the most recent 10 runs
    if (amountsToSend.length > 10) {
      amountsToSend.shift();
    }
    writeFileSync(
      landownerAmountsFilename,
      JSON.stringify(amountsToSend, null, 2)
    );
  }
};

var filterJSON: FilterAmount[] | undefined = undefined;

const run = async () => {
  const argv = await yargs(process.argv)
    .option('submit', { demandOption: false, boolean: true, default: false })
    .option('over_paid_filter', {
      string: true,
      demandOption: false,
      default: null,
    })
    .option('batch_size', { number: true, demandOption: true, default: 60 })
    .argv;

  const date = new Date().toDateString();

  const filterJSONFile = argv.over_paid_filter;
  if (filterJSONFile) {
    filterJSON = JSON.parse(readFileSync(filterJSONFile, 'utf-8'));
  }

  await generateLandholdersList(date);
  await calculateAmounts(date, filterJSON);
  await send(argv.batch_size, !argv.submit);
};

run();
