#!/bin/bash

CLEOS=~/Projects/EOS/wax-testnet.sh
NUM=$1
CREATOR=evilmikehere
KEY=EOS88dpifYpuZZQwpLZCM9BnAGU9Xb7pm5w1hcPvzZWBewKqMMine

echo "Creating ${NUM} miner accounts"

for i in $(seq 1 $NUM)
do
    ACCOUNT=$(cat /dev/urandom | tr -dc 'a-z1-5' | fold -w 12 | head -n 1)
    CMD="$CLEOS system newaccount --stake-net \"10.00000000 WAX\" --stake-cpu \"10.00000000 WAX\" --buy-ram-bytes 4096 $CREATOR $ACCOUNT \"$KEY\""
    echo $CMD
    eval $CMD
    echo $ACCOUNT >> mining_accounts.txt
done
