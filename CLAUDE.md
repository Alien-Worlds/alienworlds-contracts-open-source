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
