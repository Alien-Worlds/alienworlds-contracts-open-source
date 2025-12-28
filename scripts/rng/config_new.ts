//These keys are fairly sensitive so should not be in Git for setParam and Rand function
export const config = {
  private_keys: [
    '5KVti8rZZUjVSr3zcNoRmDXKbxhe23gHjLbAJwxHvt1DoGfm9aJ',
    '5HwYVPPnaFoajixE7Yve8izS6HELoCMhqucvf4UhCgr7xiLzqJv',
  ],
  mining_contract: 'm.federation',
  nft_contract: 'atomicassets',
  oracle_permission: 'rando',
  test_permission: 'setparam',
  oracle_id: 1,
  api_url: 'https://api.alienworlds.io',
  // api_url: 'http://127.0.0.1:8804/',
  endpoint: 'https://api.waxsweden.org', //'http://127.0.0.1:28888',
  push_endpoint: 'https://api.waxsweden.org', //'http://127.0.0.1:28888',
  legendary_count: 1,
  epic_count: 4,
  rare_count: 16,
  common_count: 64,
  abundant_count: 256,
  chunk_length: 10,
  genesis_time: 1631532093777, // 2021-09-13T11:22:00
};
