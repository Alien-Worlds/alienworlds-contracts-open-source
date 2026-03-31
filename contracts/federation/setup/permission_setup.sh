#!/bin/bash

# federation setup
CLEOS=~/Projects/EOS/wax-testnet.sh

cmd="$CLEOS set account permission federation refund ./federation-code-perms.json active"
eval $cmd
sleep 1
cmd="$CLEOS set action permission federation tlm.world transfer refund"
eval $cmd

cmd="$CLEOS set account permission federation issue ./federation-code-perms.json active"
eval $cmd
sleep 1
cmd="$CLEOS set action permission federation token.world issue issue"
eval $cmd
cmd="$CLEOS set action permission federation token.world transfer issue"
eval $cmd


# token notify

cmd="$CLEOS set account permission token.world notify ./token-code-perms.json active"
eval $cmd
sleep 1
cmd="$CLEOS set action permission token.world dac.world balanceobsv notify"
eval $cmd
