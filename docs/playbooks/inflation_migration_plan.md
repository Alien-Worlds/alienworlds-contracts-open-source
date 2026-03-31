# Migration Plan: Federation to Infl for Inflation (v3)

This document outlines the refined steps required to migrate the Alien Worlds inflation mechanism from the [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) contract to the dedicated [infl](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.hpp#141-142) contract.

## 1. Prerequisites

- **Contract Compilation**: The [infl](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.hpp#141-142) contract must be compiled **without** `IS_DEV` defined to ensure production logic is used.
- **Token Contract Deployment**: Deploy the updated `alien.worlds` (tlm.token) contract that includes the [chngissuer](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/tlm.token/tlm.token.cpp#251-265) action logic prior to starting the migration.

## 2. Account Creation & Initial Setup

1. **Account Creation**: Create the `infl.worlds` account using a multi-signature (MSIG) proposal on the [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) account.
2. **Permission Configuration**: Configure the permissions for `infl.worlds` **before** deploying the contract.
   - **Create [issue](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/tlm.token/tlm.token.cpp#25-50) permission**:
     ```bash
     cleos set account permission infl.worlds issue '{"threshold": 1,"keys": [],"accounts": [{"permission":{"actor":"infl.worlds","permission":"eosio.code"},"weight":1}],"waits": []}' active -p infl.worlds@active
     ```
   - **Create `xfer` permission**:
     ```bash
     cleos set account permission infl.worlds xfer '{"threshold": 1,"keys": [],"accounts": [{"permission":{"actor":"infl.worlds","permission":"eosio.code"},"weight":1}],"waits": []}' active -p infl.worlds@active
     ```
   - **Create [claim](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/planet_claim/inflate.js#22-61) permission** (used by the automation script to trigger inflation):
     ```bash
     cleos set account permission infl.worlds claim '{"threshold": 1,"keys": [{"key":"EOS7sPaybfLLBb8asFuP4A9DDAKH1tku6gVbTxEF8eq5CEGfvnDkD","weight":1}],"accounts": [],"waits": []}' active -p infl.worlds@active
     ```

## 3. Deployment & Permission Linking

1. **Deploy [infl](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.hpp#141-142) Contract**: After permissions are fully set up, deploy the production-built `infl.wasm` to `infl.worlds`.
2. **Link Auth**: Link the sub-permissions to the necessary actions:
   - Link [issue](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/tlm.token/tlm.token.cpp#25-50) to `alien.worlds::issue`:
     ```bash
     cleos set action permission infl.worlds alien.worlds issue issue
     ```
   - Link `xfer` to `alien.worlds::transfer`:
     ```bash
     cleos set action permission infl.worlds alien.worlds transfer xfer
     ```
   - Link `xfer` to `m.federation::fill`:
     ```bash
     cleos set action permission infl.worlds m.federation fill xfer
     ```
   - Link [claim](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/planet_claim/inflate.js#22-61) to `infl.worlds::inflate`:
     ```bash
     cleos set action permission infl.worlds infl.worlds inflate claim
     ```

## 4. Planet Claim Permission Configurations

All planets must have their existing [claim](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/planet_claim/inflate.js#22-61) permissions linked to the new `infl.worlds::claim` action, replacing the legacy [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) configuration.
Execute the following for each planet:

```bash
cleos set action permission eyeke.world infl.worlds claim claim
cleos set action permission kavian.world infl.worlds claim claim
cleos set action permission magor.world infl.worlds claim claim
cleos set action permission naron.world infl.worlds claim claim
cleos set action permission neri.world infl.worlds claim claim
cleos set action permission veles.world infl.worlds claim claim
```

## 5. State Migration

The [infl](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.hpp#141-142) contract's [migrate()](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.cpp#9-50) action pulls existing state from [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223).

1. **Execute Migration**:
   ```bash
   cleos push action infl.worlds migrate '{}' -p infl.worlds@active
   ```
   > [!IMPORTANT]
   > The [migrate()](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.cpp#9-50) action can **only be called once**. Ensure all prerequisites are met before execution. This action copies state/reserve values and all pending payout entries.

## 6. Token Issuer Handover

Official handover of TLM issuance authority to `infl.worlds`.

1. **Execute Change Issuer**: Proposed via an **MSIG on `alien.worlds@active`**.
   ```bash
   cleos push action alien.worlds chngissuer '{}' -p alien.worlds@active
   ```
   _Note: This sets the official issuer of TLM to `infl.worlds`._

## 7. Script & Automation Updates

The automated scripts currently running against [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) must be updated to target the new contract.

1. **Update [inflate.js](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/planet_claim/inflate.js)**: Redirect the [inflate](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.cpp#51-186) action from [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) to `infl.worlds` (already completed in codebase).
2. **Update [planet_claim.js](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/planet_claim/planet_claim.js)**: Redirect the [claim](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/planet_claim/inflate.js#22-61) action from [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) to `infl.worlds` (already completed in codebase).
3. **Redeploy Automation**: Restart the updated inflation and claim bots.

## 8. Verification & Post-Migration

1. **Verify Issuer**:
   ```bash
   cleos get table alien.worlds TLM stat
   ```
2. **First Inflation Call**:
   > [!NOTE]
   > After migration, calling [inflate](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/infl/infl.cpp#51-186) on `infl.worlds` will **fail** if it was triggered on the [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) contract less than 24 hours prior (due to the `last_land_fill` timestamp being migrated).
3. **Monitor Logs**: Monitor `infl.worlds` logs for any `missing required authority` or permission-related errors.

## 9. Cleanup

- Deactivate/Archive the legacy [federation](file:///Users/dallasjohnson/Code/alien-worlds/aw_contract-opensource/alienworlds-contracts-open-source-release/contracts/federation/federation.hpp#24-223) inflation triggers.
- Verify that planets and `m.federation` are correctly interacting with the new `infl.worlds` contract logic.
