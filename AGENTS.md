# Repository Guidelines

Alien Worlds smart contracts for the WAX (EOSIO/Antelope/Leap) blockchain — modular C++ contracts powering mining, staking, governance, TLM token, and NFT systems; built with EOSIO.CDT and tested with Lamington.

## Project Structure & Module Organization

- `contracts/` groups code by account (e.g., `mining/`, `planets/`), with shared headers in `contracts/common/` and local `*.test.ts` harnesses.
- `artifacts/` captures Lamington builds; prune stale WASM/ABI assets before packaging releases.
- `alienworlds-contracts-private/` injects closed code when `BOT_CHECK` is defined; keep it current with `git submodule update`.
- `daemon/` and `scripts/` house operational tooling (PM2 configs, RNG daemons, landholder utilities) plus the reference `scripts/docker-compose.yml`.
- `docs/` stores internal diagrams and brand assets.

## Build, Test, and Development Commands

- `npm install` provisions Lamington, EOSIO bindings, and TS tooling declared in `package.json`.
- `npm run build` emits WASM/ABI artifacts via `.lamingtonrc` include paths into `artifacts/compiled_contracts`.
- `npm run dev_build` adds `-DIS_DEV` flags for experimental iterations without touching release artifacts.
- `npm run test_build` compiles with `-DIS_TEST_DEPLOY` for staging network validation.
- `npm run test` executes Lamington’s Mocha/Chai suites against a local Leap node

## Coding Style & Naming Conventions

- Apply `.clang-format` (LLVM, 4 spaces, 160 columns) to C++ before pushing; run `clang-format -i <file>` or rely on editor hooks.
- Mirror on-chain accounts when naming contract directories (`userpoints`, `packopener`) and suffix entrypoints `.cpp/.hpp`.
- Use Prettier (`npx prettier --write`) for TypeScript/JavaScript; follow the 2-space, single-quote, trailing-comma rules in `.prettierrc.yaml`.
- Store configuration constants in `config.hpp` with enum-style keys that match table field names.

## Testing Guidelines

- Place new tests beside the target contract as `<contract>.test.ts`, reusing helpers in `contracts/TestHelpers.ts`.
- Write suites with Mocha (`describe/it`) and Chai assertions; prefer Lamington fixtures over raw `cleos` invocations.
- Keep randomness deterministic by seeding local RNG or stubbing `orngwax` actions.
- Extend `.lamingtonrc` include lists whenever a new contract must compile; missing entries block deploy/test runs.
- Heads up: This test setup has no rollback capability. That means the state is shared across all describe, context and it blocks.
- The test setup does not support influencing the blockchain time like on EVM. There are 2 possible ways to simulate the passing of time:
  1.  await sleep(5); // wait 5 seconds
  2.  Use the IS_DEV time-parameter pattern:
      - Build with `npm run dev_build` to enable `-DIS_DEV`.
      - In IS_DEV builds, actions that read chain time expose an extra `time_point_sec` parameter so tests can pass an explicit timestamp. In production builds, the same actions omit that parameter and compute the time internally via `current_time_point()`.
      - Pattern (C++):

```cpp
#ifdef IS_DEV
ACTION mycontract::someaction(name user, time_point_sec current_time) {
#else
ACTION mycontract::someaction(name user) {
    const auto current_time = time_point_sec(current_time_point());
#endif
    // use current_time for time-dependent logic
}
```

      - Test call (TypeScript):

```ts
// Build with: npm run dev_build
const simulated = new Date('2025-01-01T00:00:00Z');
await contracts.mycontract.contract.someaction(user.name, simulated, {
  from: user,
});
```

### Running tests

- **Targeted run (by suite/test name pattern)**

  ```bash
  yarn test -g "<pattern>"
  ```

  - The pattern is a Mocha "grep" matching `describe`/`it` titles (substring or regex).
  - Examples: `-g "migration"`, `-g "staking should"`, `-g "PointsProxy"`.

- **Full test suite**

  ```bash
  yarn test
  ```

## Commit & Pull Request Guidelines

- Write concise, present-tense summaries under ~72 characters (`Moves inflate logic to dedicated contract` mirrors history).
- Squash fixups; PR descriptions must note the contract touched, required permissions, and DAO migration steps.
- Link related issues, add screenshots only for UI changes, and call out ABI migrations explicitly.
- Run `npm run test` before opening a PR and report the result so reviewers know Lamington passed.

## Security & Configuration Tips

- Never commit populated `.env` or WAX keys; use secret storage and reference values via environment variables.
- Code inside `#ifdef BOT_CHECK` depends on `alienworlds-contracts-private/closed/`
