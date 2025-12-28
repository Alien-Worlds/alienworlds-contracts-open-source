# Pseudo code of the NFT drop script

1. Fetch the latest time from the `nftwins` table or use the config.genesis_time.
2. Calculate end_time as an hour later than that time and if the end_time is greater than `now` then sleep until that time has passed.
3. BuildTickets for the start_time from above.
   1. Get the mineluck from the startTime to the end time range: eg. `http://127.0.0.1:8804/v1/alienworlds/mineluck?from=2021-09-27T16:19:37.000Z&to=2021-09-27T17:19:37.000Z`
    2. Filter out any bots using `check_bot`
    3. change the planet array to a field
    4. filter out the miner's with 0 luck
    5. group each miner into a miner keyed map.
    6. Calculate the total luck of miners with Rare,Epic,Legendary or Mythic NFTs as VIP luck.
    7. Calculate the total luck of miners with
    8. Calculate the total for the miners that do not include Rare,Epic,Legendary or Mythic NFTs as commoners luck.
4. Get a random Transaction ID ( by picking a random transaction from a random recent block) 0...30 blocks since the LIB.
5. Use it as a seed for RNG
6. For each ticket type get winners for the given total luck and number of winners.
   1. Find a random number and weight with total_luck.
   2. Find a winner from the winner tickets using the randon number.
   3. Ensure a winner can only win once and the number of winners is not exceeded.
7. Allocated templates for winners.
   1. Create the set of potential winner templates based on winner provided NFT's templates.
   2. Find a possible rarity from a random number
   3. Ensure the number of allocated doesn't goes over configured max for each rarity
8. slice the winners into chunks
9. Send the results to chain to mint and update singleton.
   1. Push `rand` action to chain with results.

