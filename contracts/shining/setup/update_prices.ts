#!/usr/bin/env node

const { deserialize, ObjectSchema } = require('atomicassets');
import { TableFetcher, BatchRun } from 'eosio-helpers';
import { EosioAction } from 'lamington';
import { column } from 'mathjs';

const shining_account = 's.federation';

import {
  atomicassets_account,
  collection_name,
  endpoint,
  private_key,
  submit_to_blockchain,
  batch_size,
} from './config';

const schema_cache: { [key: string]: any } = {};
const get_schema = async (schema_name: string) => {
  if (typeof schema_cache[`${schema_name}`] !== 'undefined') {
    return schema_cache[`${schema_name}`];
  }

  const schemas: { format: any }[] = await TableFetcher({
    codeContract: atomicassets_account,
    batch_size: 1,
    endpoint: endpoint,
    limit: 1,
    lower_bound: schema_name,
    upper_bound: schema_name,
    scope: collection_name,
    table: 'schemas',
  });

  if (!schemas.length) {
    console.error(
      `Could not find schema with name ${schema_name} in collection`
    );
    return null;
  }

  const schema = ObjectSchema(schemas[0].format);

  schema_cache[`${schema_name}`] = schema;

  return schema;
};

const load_templates = async () => {
  const templates: {
    template_id: number;
    schema_name: string;
    immutable_serialized_data: any;
  }[] = await TableFetcher({
    batch_size: 200,
    codeContract: 'atomicassets',
    endpoint: endpoint,
    limit: 5000,
    lower_bound: '0',
    scope: collection_name,
    table: 'templates',
  });

  const templates_with_data: { [key: string]: any } = {};
  console.log('load templates');
  for await (let template of templates) {
    const schema = await get_schema(template.schema_name);
    // console.log(schema);
    templates_with_data[template.template_id] = await deserialize(
      template.immutable_serialized_data,
      schema
    );
  }
  return templates_with_data;
};

const update = async () => {
  console.log('update');
  const templates = await load_templates();

  const lookups: {
    from: number;
    to: number;
    qty: number;
    cost: string;
    start_time: Date;
    active: number;
  }[] = await TableFetcher({
    batch_size: 200,
    codeContract: shining_account,
    scope: shining_account,
    table: 'lookups',
    endpoint: endpoint,
    lower_bound: '0',
    limit: 500,
  });

  const to_rarity_shine_map = ({
    rarity,
    shine,
  }: {
    rarity: string;
    shine: string;
  }): string => {
    const to_rarity_shine = `${rarity}:${shine}`;

    switch (to_rarity_shine) {
      //Abundant Column
      case 'Abundant:Gold':
        return '20.0000 TLM';
        return '100.0000 TLM'; //old

      //Common Column
      case 'Common:Gold':
        return '30.0000 TLM';
        return '100.0000 TLM'; //old
      case 'Common:Stardust':
        return '150.0000 TLM';
        return '100.0000 TLM'; //old

      //Rare Column
      case 'Rare:Gold':
        return '40.0000 TLM';
        return '150.0000 TLM'; //old
      case 'Rare:Stardust':
        return '200.0000 TLM';
        return '200.0000 TLM'; //old
      case 'Rare:Antimatter':
        return '1000.0000 TLM';
        return '250.0000 TLM'; //old

      //Epic Column
      case 'Epic:Gold':
        return '80.0000 TLM';
        return '200.0000 TLM'; //old
      case 'Epic:Stardust':
        return '400.0000 TLM';
        return '250.0000 TLM'; //old
      case 'Epic:Antimatter':
        return '2000.0000 TLM';
        return '300.0000 TLM'; //old

      // Legendary Column
      case 'Legendary:Gold':
        return '160.0000 TLM';
        return '250.0000 TLM'; //old
      case 'Legendary:Stardust':
        return '800.0000 TLM';
        return '300.0000 TLM'; //old
      case 'Legendary:Antimatter':
        return '4000.0000 TLM';
        return '500.0000 TLM'; //old

      //Mythical Column
      case 'Mythical:Gold':
        return '320.0000 TLM';
        return '500.0000 TLM'; //old
      case 'Mythical:Stardust':
        return '1600.0000 TLM';
        return '1000.0000 TLM'; //old
      case 'Mythical:Antimatter':
        return '8000.0000 TLM';
        return '2000.0000 TLM'; //old
    }
    throw new Error(`undefined rarity:shine combo: ${to_rarity_shine}`);
  };

  const updatePriceActionCreator = async ({
    rawData: { from, to },
  }: {
    rawData: { from: number; to: number };
  }): Promise<EosioAction> => {
    if (!templates[from] || !templates[to]) {
      console.log(`Cant find template ${from} or ${to}`);
    }
    const from_rarity_shine = `${templates[from].rarity}:${templates[from].shine}`;
    const new_price = to_rarity_shine_map({
      rarity: templates[to].rarity,
      shine: templates[to].shine,
    });

    return {
      account: shining_account,
      name: 'setcost',
      authorization: [
        {
          actor: shining_account,
          permission: 'active',
        },
      ],
      data: {
        from_template_id: from,
        cost: new_price,
      },
    };
  };

  console.log('Update the price of', lookups.length, 'templates');

  await BatchRun({
    batch_size,
    createAction: updatePriceActionCreator,
    fields: lookups.map((l) => ({ rawData: { ...l } })),
    eos_endpoint: endpoint,
    submit_to_blockchain,
    private_keys: [{ pk: private_key }],
  });
};

update();
