# AlienWorlds Contracts

## Compiling and Running Tests

```bash
# Run all tests (compiles first)
npm run test

# Run tests matching a pattern (e.g. only TokeLore tests)
npm run test -- -g TokeLore

# Skip the build step (when smart contract code hasn't changed)
npm run test -- -s -g TokeLore

# Run all tests without rebuilding
npm run test -- -s
```

- `-g <pattern>` — filter tests by name pattern (passed to Mocha `--grep`)
- `-s` — skip the build step (skip compiling smart contracts)

## Reading Test Output

Tests can take >30 minutes and produce large amounts of output. **Never read the full output.**

- Run tests with `run_in_background: true`
- On completion, read only the **last ~100 lines** of output to see pass/fail summary and any stack traces:
  ```bash
  tail -100 <output_file>
  ```
- If a failure is shown, read further up only if the tail doesn't contain enough context for the specific error.
