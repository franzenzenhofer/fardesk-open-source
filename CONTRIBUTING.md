# Contributing

Thanks for looking. Fardesk is small on purpose; please open an issue before a large change.

## Ground rules

- One change, one purpose. Explain the problem first, then the fix.
- Security-relevant changes (auth, pairing, bind address, permission handling, Coordinator) need a test that
  fails without the change, and a note in `SECURITY.md` if behaviour changes.
- Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
- No real tokens, addresses, host names, account names or screenshots of real sessions in code, tests, issues or
  pull requests. Use `100.64.0.x` addresses, `example.com`, and names like "Studio" and "Laptop".

## Code standards

- TypeScript strict in the daemon, Swift 6 with strict concurrency in the app and package.
- Small files and small functions, named exports, early returns, no commented-out code, no TODO comments.
- Fail early and loudly. No silent fallbacks.
- No mocks in tests: use real temporary folders, real sockets, real processes.
- No copy-paste: the duplication gate (`scripts/dry-gate.sh`, zero clones) is part of the build.

## Before you open a pull request

```bash
cd daemon/fardeskd
npm ci
npm run gates:daemon        # typecheck, lint, tests with coverage, build
npm run schema              # only if you changed src/contract; commit the generated files
cd ../../packages/FardeskKit
swift test
cd ../..
bash scripts/gates.sh       # everything, including the duplication gate
```

For the app: copy `apps/Fardesk/Config/Local.example.xcconfig` to `Local.xcconfig`, set a bundle prefix of your
own, run `xcodegen generate` in `apps/Fardesk` and build the `Fardesk` scheme. Do not commit `Local.xcconfig`
or `fardesk.env`.

## Test fixtures

Transcript fixtures under `daemon/fardeskd/test/fixtures/transcripts` come from real Claude Code sessions with all
free text replaced. If you add one, anonymise it with `daemon/fardeskd/scripts/anonymise-transcript.mjs` and add
a row to its `INDEX.md`. The script reads the words it must remove from a file you keep outside the repository.

## Licence

By contributing you agree that your contribution is licensed under the Apache License 2.0, as the rest of the
project. The name and icon are not part of that licence, see [NOTICE](NOTICE).
