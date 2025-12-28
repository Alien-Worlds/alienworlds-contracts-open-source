#!/usr/bin/env node

import fetch from 'node-fetch';
import { Api, JsonRpc } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextDecoder, TextEncoder } from 'text-encoding';
import RNGData from './rngdata';
import { randomElement, SingletonFetcher, sleep } from 'eosio-helpers';

import { config } from './config_new';
import {
  Rarity,
  check_bot,
  fetchTemplatesGroupedByRarity,
  fetchFullTemplates,
  filterOutFullTemplates,
} from './common';
const rpc = new JsonRpc(config.endpoint, { fetch });
const push_rpc = new JsonRpc(config.push_endpoint, { fetch });
const signatureProvider = new JsSignatureProvider(config.private_keys);
const api = new Api({
  rpc: push_rpc,
  signatureProvider,
  textDecoder: new TextDecoder(),
  textEncoder: new TextEncoder(),
});

const MAX_UINT32 = 4294967295;
let broadcast = true;

/**
 * Send random results to the chain through the rand action.
 * @param time
 * @param index
 * @param results
 * @param max_index
 * @returns
 */
const send_results = async (
  time: number,
  index: number,
  results: Partial<WinnerResult>[],
  max_index: number
) => {
  const data = {
    oracle_id: config.oracle_id,
    time,
    index,
    max_index,
    results,
  };
  console.log(data);

  const actions = [];
  actions.push({
    account: config.mining_contract,
    name: 'rand',
    authorization: [
      {
        actor: config.mining_contract,
        permission: config.oracle_permission,
      },
    ],
    data,
  });

  try {
    var res: any = await api.transact(
      {
        actions,
      },
      {
        blocksBehind: 3,
        expireSeconds: 30,
        broadcast,
      }
    );

    console.log(`Processed with transacation Id: ${res.transaction_id}`);

    return { success: true, tx_id: res.transaction_id };
  } catch (e) {
    console.error(`Error : ${e.message}`);
    const err = e.message.split('::');
    if (err.length >= 3) {
      console.log(err);
      return { success: false, err_code: err[1], err_msg: err[2] };
    }

    return { success: false, err_code: e.code, err_msg: e.message };
  }
};

interface Winner {
  miner: string;
  planet_name: string;
  rarities: Set<Rarity>;

  //   template_id: number;
  //   rarity: Rarity;
}

interface WinnerResult {
  miner: string;
  planet_name: string;
  rarities: Set<Rarity>;
  template_id: number;
  rarity: Rarity;
}

/**
 * #2 Get winners
 * @param tickets
 * @param total_luck
 * @param rng
 * @param number_winners
 * @returns
 */
const get_winners = (
  tickets: Map<string, MineLuck>,
  total_luck: number,
  rng: { get_uint32: () => any },
  number_winners = 1000
) => {
  console.log(
    `Choosing ${number_winners} winners from ${tickets.size} tickets`
  );

  const winners: Winner[] = [];
  while (true) {
    let current = 0;
    // console.log(rng.get_uint16());
    const r = rng.get_uint32();
    const w = (r / MAX_UINT32) * total_luck;

    for (let [miner, val] of tickets.entries()) {
      // console.log(miner, val)
      // console.log(r);
      current += val.avg_luck;
      if (current >= w) {
        console.log(
          `Winner is ${miner} on ${val.planet_name} with luck ${
            val.avg_luck
          } from ${val.total_mines} mines (${r / MAX_UINT32} ${w} ${current})`
        );
        if (winners.find((a) => a.miner === miner)) {
          console.log(`${miner} has already won!`);
        } else {
          winners.push({
            miner,
            planet_name: val.planet_name,
            rarities: new Set<Rarity>([
              ...val.rarities.map((r: string) => r.toLowerCase() as Rarity),
            ]),
          });
        }
        break;
      }
    }

    if (winners.length >= number_winners) {
      break;
    }
  }

  return winners;
};

interface MineLuckRaw {
  total_luck: number;
  total_mines: number;
  planets: string[];
  tools: number[];
  avg_luck: number;
  rarities: string[];
  miner: string;

  //{"total_luck":5,"total_mines":1,"planets":["magor.world"],"tools":[1099518172193],"avg_luck":5,"rarities":["Common"],"miner":"bkswi.wam"}
}

interface MineLuck {
  total_luck: number;
  total_mines: number;
  planet_name: string;
  tools: number[];
  avg_luck: number;
  rarities: Rarity[];
  miner: string;
}
interface Ticket {
  tickets: Map<string, MineLuck>;
  total_luck: number;
  number_winners: number;
}

export const parseMineLucksIntoTickets = (
  mineLuckRaws: MineLuckRaw[]
): Ticket[] => {
  const unsorted = new Map<string, MineLuck>();
  let total_luck = 0;

  for (let r = 0; r < mineLuckRaws.length; r++) {
    const data: MineLuckRaw = mineLuckRaws[r];

    if (r % 10000 === 0) {
      console.log(`Processed ${r} / ${mineLuckRaws.length} bots`);
    }

    // data.planet_name = data.planets[0];
    // delete data.planets;
    const mineLuckCleaned: MineLuck = {
      ...data,
      planet_name: data.planets[0],
      rarities: data.rarities.map((r) => r.toLowerCase() as Rarity),
    };

    // console.log(`${data.miner} is not a bot`, data);
    if (data.avg_luck > 0) {
      unsorted.set(data.miner, mineLuckCleaned);
    }

    total_luck += data.avg_luck;
  }

  // const sorted = new Map([...unsorted].sort());
  // console.log(sorted, total_luck, 'sorted tickets');
  const vips = new Map(
    [...unsorted]
      .filter(([miner, data]) => {
        return (
          data.rarities.includes('rare') ||
          data.rarities.includes('epic') ||
          data.rarities.includes('legendary') ||
          data.rarities.includes('mythical')
        );
      })
      .sort()
  );
  const commoners = new Map(
    [...unsorted]
      .filter(([miner, data]) => {
        return (
          !data.rarities.includes('rare') &&
          !data.rarities.includes('epic') &&
          !data.rarities.includes('legendary') &&
          !data.rarities.includes('mythical')
        );
      })
      .sort()
  );

  let vip_total_luck = 0;
  // console.log(commoners.forEach)
  vips.forEach((data) => {
    vip_total_luck += data.avg_luck;
  });

  // vips.forEach(console.log);
  let common_total_luck = 0;
  commoners.forEach((data) => {
    common_total_luck += data.avg_luck;
  });

  // console.log(vips, [...vips].length);
  //   delete unsorted;
  // process.exit(0)

  const vip_winners = 20;

  return [
    {
      tickets: commoners,
      total_luck: common_total_luck,
      number_winners: total_counts(config) - vip_winners,
    },
    {
      tickets: vips,
      total_luck: common_total_luck,
      number_winners: vip_winners,
    },
  ];
};

/**
 * 1# Build tickets
 * @param start_time
 * @param dev
 * @returns
 */
const build_tickets = async (
  start_time: Date,
  config: { api_url: string },
  dev = false
): Promise<MineLuckRaw[]> => {
  const end_time = new Date(start_time.getTime() + 60 * 60 * 1000);

  while (true) {
    try {
      /*
      const sample = [
        {
          total_luck: 6,
          total_mines: 1,
          planets: ['eyeke.world'],
          tools: [1099542842875, 1099542842876, 1099542842928],
          avg_luck: 6,
          rarities: ['Abundant', 'Abundant', 'Abundant'],
          miner: 'z3.ey.wam',
        },
        {
          total_luck: 90,
          total_mines: 1,
          planets: ['eyeke.world'],
          tools: [1099540102516, 1099538586807, 1099528530567],
          avg_luck: 90,
          rarities: ['Rare', 'Rare', 'Rare'],
          miner: 'yhjri.wam',
        },
      ];
*/
      console.log(`Fetching mineluck`);

      const url = `${
        config.api_url
      }/v1/alienworlds/mineluck?from=${start_time.toISOString()}&to=${end_time.toISOString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.results && json.results.length === 0) {
        break;
      }
      if (!json.results) {
        throw new Error(`Error fetching minelucks`);
      }

      var minelucks: MineLuckRaw[] = json.results;

      return minelucks;
    } catch (e) {
      console.error(e.message);
      await sleep(1000);
    }
  }
};

/** Get transaction id */
const get_random_tx_id = async () => {
  let tx_id: string;

  while (true) {
    const info = await rpc.get_info();
    const lib = info.last_irreversible_block_num;
    // console.log(lib);
    const add_to_lib = Math.floor(Math.random() * 30);
    // console.log(add_to_lib);
    const my_block = lib + add_to_lib;
    const block_data = await rpc.get_block(my_block);
    // console.log(block_data);
    if (!block_data.transactions.length) {
      console.log(`No transactions in block!`);
      await sleep(1000);
      continue;
    }
    // get random tx from that block
    const tx_rnd = Math.floor(
      Math.random() * (block_data.transactions.length - 1)
    );
    tx_id = block_data.transactions[tx_rnd].trx.id;
    if (!tx_id) {
      console.error(`Couldnt get tx_id for ${tx_rnd}`, block_data.transactions);
      continue;
    }
    break;
  }

  return tx_id;
};

interface RarityCountsConfig {
  legendary_count: number;
  epic_count: number;
  rare_count: number;
  common_count: number;
  abundant_count: number;
}

/**
 * Gets the total counts of all rarities from the config.
 * @returns
 */
const total_counts = (config: RarityCountsConfig) => {
  return (
    config.legendary_count +
    config.epic_count +
    config.rare_count +
    config.common_count +
    config.abundant_count
  );
};

/**
 * #3 Allocate a template to each winner
 * @param winners
 * @param rng
 * @returns
 */
const allocate_templates = (
  winners: Winner[],
  // Random number generator for a number 0 => n <= 1
  rng: { get_uint8: () => any },
  config: RarityCountsConfig & { mining_contract: string; endpoint: string },
  templates: Record<Rarity, number[]>
): WinnerResult[] => {
  const allocated = new Map<Rarity, number>([
    ['legendary', 0],
    ['epic', 0],
    ['rare', 0],
    ['common', 0],
    ['abundant', 0],
  ]);

  var winnerResults: WinnerResult[] = [];

  for (let w = 0; w < winners.length; w++) {
    const winner = winners[w];

    // limit the possible rarities to the winner's rarities or lower.
    var possible_rarities: Rarity[] = ['abundant'];
    switch (true) {
      case winner.rarities.has('legendary'):
      case winner.rarities.has('mythical'):
        possible_rarities = ['legendary', 'epic', 'rare', 'common', 'abundant'];
        break;
      case winner.rarities.has('epic'):
        possible_rarities = ['epic', 'rare', 'common', 'abundant'];
        break;
      case winner.rarities.has('rare'):
        possible_rarities = ['rare', 'common', 'abundant'];
        break;
      case winner.rarities.has('common'):
        possible_rarities = ['common', 'abundant'];
        break;
    }
    let won_rarity: Rarity = 'abundant';
    // Pick a random rarity from the possible rarities for the winner.
    if (possible_rarities.length > 1) {
      won_rarity = randomElement(possible_rarities, rng.get_uint8() / 256);

      //Ensure the config raritiy max numbers have not exceeded. If they have and it's not abundant try again.
      if (config[won_rarity + '_count'] > allocated.get(won_rarity)) {
        allocated.set(won_rarity, allocated.get(won_rarity) + 1);
      } else if (won_rarity !== 'abundant') {
        // this rarity has already hit the maximum, try again
        w--;
      } else {
        allocated.set(won_rarity, allocated.get(won_rarity) + 1);
      }
      // console.log(winner, possible_rarities, won_rarity, num);
    } else {
      allocated.set(won_rarity, allocated.get(won_rarity) + 1);
    }
    // Update the winnerResults with the winner and a random templateId for a given rarity.
    const chosenTemplateId = randomElement(
      templates[won_rarity],
      Math.random()
    );
    winnerResults.push({
      ...winners[w],
      template_id: chosenTemplateId,
      rarity: won_rarity,
    });
  }

  console.log('allocated: ', allocated);

  return winnerResults;
};

const filterOutBots = async (tickets_array_raw: MineLuckRaw[]) => {
  if (!dev) {
    console.log(`Checking ${tickets_array_raw.length} accounts for bot`);
    return tickets_array_raw.filter(async (data: { miner: string }) => {
      return await check_bot(data.miner, true);
    });
  }
  return tickets_array_raw;
};

function indexForNFTProcessingState(nftProcessingState: {
  time: number;
  oracle_id: number;
  last_index: number;
  max_index: number;
}) {
  if (
    nftProcessingState &&
    nftProcessingState.time > 0 &&
    nftProcessingState.last_index != nftProcessingState.max_index
  ) {
    return nftProcessingState.last_index;
  }
  return 0;
}

function adjustTimeForNFTProcessingState(
  firstRow: {
    time: number;
    oracle_id: number;
    last_index: number;
    max_index: number;
  },
  time: number
) {
  if (firstRow.time > 0) {
    if (firstRow.last_index == firstRow.max_index) {
      time = firstRow.time + 60 * 60;
    } else {
      time = firstRow.time;
    }
  }
  return time;
}

const run = async (dev: boolean) => {
  if (dev) {
    console.log('running in dev mode');
  }
  do {
    try {
      // Get the nftWins
      let time: number = config.genesis_time;

      let nftProcessingState:
        | {
            time: number;
            oracle_id: number;
            last_index: number;
            max_index: number;
          }
        | undefined = await SingletonFetcher({
        codeContract: config.mining_contract,
        scope: config.mining_contract,
        table: 'nftwins',
        endpoint: config.endpoint,
      });

      time = adjustTimeForNFTProcessingState(nftProcessingState, time);

      // DEV
      if (dev) {
        time = Math.floor(new Date().getTime() / 1000) - 3600;
      }

      // Find the start and end time.
      //If the first and max index as no difference skip to the next hour

      console.log(`Start time`, time);
      const start_time = new Date(time * 1000);
      const end_time = new Date((time + 3600) * 1000);

      // If the end time is in the future sleep until that time then loop again.
      if (end_time.getTime() > new Date().getTime()) {
        await sleep(end_time.getTime() - new Date().getTime());
        continue;
      }

      // const one_hour_ago = new Date(new Date().getTime() - (60 * 60 * 1000));
      var tickets_array_raw = await build_tickets(start_time, config, dev);
      tickets_array_raw = await filterOutBots(tickets_array_raw);
      const tickets_array = parseMineLucksIntoTickets(tickets_array_raw);
      const all_winners: Winner[] = [];

      const tx_id = await get_random_tx_id();
      const rng = new RNGData(tx_id);

      for (const { tickets, total_luck, number_winners } of tickets_array) {
        if (!tickets.size) {
          console.error('No tickets');
          await sleep(5000);
          continue;
        }

        let winners = get_winners(tickets, total_luck, rng, number_winners);

        all_winners.push(...winners);
      }
      const templates = await fetchTemplatesGroupedByRarity(config);
      const fullTemplates = await fetchFullTemplates();
      const filteredTemplates = filterOutFullTemplates(
        templates,
        fullTemplates
      );

      const allocatedWinners = allocate_templates(
        all_winners,
        rng,
        config,
        filteredTemplates
      );
      // send results
      if (dev) {
        broadcast = false;
      }
      const max_index = allocatedWinners.length;
      let index = indexForNFTProcessingState(nftProcessingState);
      do {
        const chunk = allocatedWinners
          .slice(index, index + config.chunk_length)
          .map((c) => {
            delete c.rarities;
            return c;
          });

        const res = await send_results(time, index, chunk, max_index);
        // console.log(res, time);
        if (res.success) {
          index += chunk.length;
        } else {
          console.error(res);
          // if (res.err_code === 'INDEX_OUT_ORDER'){
          //                 const current_res = await rpc.get_table_rows({
          //                     code: config.mining_contract,
          //                     scope: config.mining_contract,
          //                     table: 'nftwins'
          //                 });
          //                 if (current_res.rows.length && current_res.rows[0].time > 0 && current_res.rows[0].last_index != current_res.rows[0].max_index){
          //                     index = current_res.rows[0].last_index;
          //                 }
          //             }
          // try again
          await sleep(5000);
          break;
        }

        await sleep(1000);
      } while (index < max_index);

      console.log(tx_id);

      // break;
    } catch (e) {
      console.error(`Error processing tickets ${e.message}`, e);
      await sleep(5000);
    }
  } while (!dev);
};

const dev = !!process.argv[2];

run(dev);
