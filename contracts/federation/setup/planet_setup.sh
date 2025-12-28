#!/bin/bash

#Khomsa
#Kavian
#Magor
#Neri
#Eyeke
#Veles
#Naron

CLEOS=~/Projects/EOS/wax-testnet.sh

PLANETS="khomsa kavian magor neri eyeke veles naron"
TOKEN=token2.world

echo $PLANETS
for planet in $PLANETS; do

  # create planet account
  cmd="$CLEOS system newaccount world ${planet}.world --buy-ram-kbytes 100 --stake-net \"1.00000000 WAX\" --stake-cpu \"1.00000000 WAX\" EOS54NkNpEt9aotyBvEZVfj54NuFAebaDLnyg2GtJ6pyvBoxxg9Aw"
  eval $cmd

  # add planet
  sym=${planet:0:3}
  echo "[\"${planet}.world\", \"${planet}\", \"4,${sym^^}\", \"\"]" > planet_data.json
  cmd="$CLEOS push action federation addplanet planet_data.json -p federation"
  eval $cmd

  # create dac tokenz
  echo "[\"federation\", \"1000000000.0000 ${sym^^}\", true]" > create_data.json
  cmd="$CLEOS push action $TOKEN create create_data.json -p $TOKEN"
  eval $cmd

  # create dacdirectory entry
  echo "[\"${planet}.world\", \"${planet}\", [\"4,${sym^^}\", \"$TOKEN\"], \"${planet}\", [], []]" > dacdirectory_reg.json
  cmd="$CLEOS push action index.world regdac dacdirectory_reg.json -p ${planet}.world"
  eval $cmd
  # auth
  cmd="$CLEOS push action index.world regaccount '[\"${planet}\", \"${planet}.world\", 0]' -p ${planet}.world"
  eval $cmd
  # treasury
  cmd="$CLEOS push action index.world regaccount '[\"${planet}\", \"${planet}.world\", 1]' -p ${planet}.world"
  eval $cmd
  # custodian
  cmd="$CLEOS push action index.world regaccount '[\"${planet}\", \"dac.world\", 2]' -p ${planet}.world"
  eval $cmd
  # msig
  cmd="$CLEOS push action index.world regaccount '[\"${planet}\", \"msig.world\", 3]' -p ${planet}.world"
  eval $cmd

  # Configure DAC
  echo "[ [ [\"0.0000 ${sym^^}\", \"$TOKEN\"], 3, 7, 604800, 0, 50, 1, 4, 3, 2, 0, [\"0.00000000 WAX\", \"eosio.token\"] ], \"${planet}\" ]" > dac_config.json
  cmd="$CLEOS push action dac.world updateconfige dac_config.json -p ${planet}.world"
  eval $cmd

  rm -f create_data.json planet_data.json dac_config.json
done


# Create Trilium (standard token contract)
echo "[\"federation\", \"1000000000.0000 TLM\"]" > create_data.json
cmd="$CLEOS push action tlm.world create create_data.json -p tlm.world"
eval $cmd
rm -f create_data.json
