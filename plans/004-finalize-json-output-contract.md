# Plan 004: Finalize structured output on every operational path

> **Executor instructions**: This plan has an uncommitted implementation already present in the working tree. Preserve and review it; do not restart or revert it. Follow verification gates, complete only missing requirements, and update the index row. Stop on any STOP condition.
>
> **Drift check (run first)**: `git diff --stat f39f061..HEAD -- README.md docs/index.html bin/accli.js lib/jxa-runner.js lib/output.js __tests__/cli.integration.test.js __tests__/output.test.js`
> Then run `git diff -- <same paths>`. The expected uncommitted baseline introduces JSON-by-default operational output, `--human`, `--compact`, backward-compatible `--json`, `outputOptions(args)`, and structured `INTERNAL_ERROR`. If that baseline is absent or materially different, STOP and report rather than guessing whether to restore JSON-opt-in or JSON-default behavior.

## Status

- **Priority**: P1
- **Effort**: S (remaining verification/closeout)
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f39f061`, 2026-08-12

## Why this matters

The published CLI promises machine-readable output, but the committed baseline emits plain text for unknown commands and uncaught failures. An in-progress working-tree change has chosen a stronger v2 contract: operational output is JSON by default, `--compact` produces NDJSON-friendly single lines, and human/interactive behavior requires `--human`. This plan closes that implementation safely, verifies every path, and synchronizes documentation without reopening the product decision.

## Current state

Expected in-progress behavior:

- `bin/accli.js` recognizes `--human` and `--compact` and centralizes `{ human, compact }` through `outputOptions(args)`.
- Unknown commands call `output.outputError` with `INVALID_ARGUMENT`; uncaught failures use `INTERNAL_ERROR`.
- `lib/output.js` currently implements:

```js
function output(data, options = {}) {
  const { human = false, compact = false, formatter = null } = options;
  if (human && formatter) console.log(formatter(data));
  else console.log(JSON.stringify(data, null, compact ? 0 : 2));
}
```

- `README.md` documents JSON-by-default, `--compact`, `--human`, and compatibility `--json`.
- Tests already cover unknown commands, malformed config, compact output, compatibility `--json`, human precedence, and validation errors.

Known documentation issue to correct in scope: `docs/index.html`'s freebusy example still lacks any required calendar selector. Add `--calendar Work` (or a clearly established default-calendar precondition) so the example is runnable.

Repository conventions: operational JSON errors go to stdout; human errors go to stderr. `--help` and `--version` remain plain text. Exit codes remain 0 success, 1 runtime/internal, 2 validation, 10 authorization.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Output tests | `pnpm exec jest __tests__/output.test.js __tests__/cli.integration.test.js --runInBand` | pass |
| Full tests | `pnpm test` | all pass |
| Docs examples | commands below with mocked osascript | expected status/output |
| Diff check | `git diff --check` | no output |

## Scope

**In scope**:
- `README.md`
- `docs/index.html`
- `bin/accli.js`
- `lib/jxa-runner.js`
- `lib/output.js`
- `__tests__/cli.integration.test.js`
- `__tests__/output.test.js`

**Out of scope**:
- Reconsidering JSON-by-default or the v2 version change.
- Terminal-control sanitization; Plan 005 owns it.
- CLI argument allowlists and date validation.
- Changelog/package-manager/version edits except verifying current docs remain consistent.
- EventKit/JXA behavior.

## Git workflow

Work in the existing dirty tree and preserve all unrelated changes. Do not commit unless asked. If asked, use `Finalize JSON output modes`. Do not publish.

## Steps

### Step 1: Audit every output path against the chosen contract

Inspect all `console.log`, `console.error`, `showHelp`, `output.output`, and `output.outputError` calls in `bin/accli.js`. Confirm:

- operational success and errors default to pretty JSON stdout;
- `--compact` is one-line JSON stdout;
- `--human` uses formatters/human errors and wins over `--compact`/`--json`;
- legacy `--json` is accepted as a no-op;
- parse errors inspect raw argv for `--human`/`--compact` safely;
- unknown command and config action errors are structured;
- uncaught config/runner errors use `INTERNAL_ERROR`, exit 1;
- authorization remains exit 10;
- help/version are always plain text;
- interactive prompts occur only with `--human` and a TTY.

Do not emit stack traces or raw Error objects in JSON. Do not print a second human help block in JSON mode.

**Verify**: `grep -n "console\.\(log\|error\)" bin/accli.js` → every remaining direct call is help/version, an intentional `--human` prompt/result/warning, or delegated output behavior.

### Step 2: Complete output regression tests

Retain current tests and add any missing path from Step 1. At minimum, explicitly cover:

- unknown command: default/compact/human;
- malformed config: default/compact/human;
- parse error: default/human;
- authorization error status 10 and output channel using a configurable mock payload;
- `config show`, `clear`, and noninteractive `set-default` success in default/compact/human modes;
- `--help`/`--version` plain text even when combined with output flags;
- precedence: `--human` over `--compact` and `--json`.

Avoid snapshotting the entire help page; assert stable contract fragments.

**Verify**: `pnpm exec jest __tests__/output.test.js __tests__/cli.integration.test.js --runInBand` → pass.

### Step 3: Synchronize user-facing documentation

Check README, command help, and landing page for the same terms:

- JSON default;
- compact JSON via `--compact`;
- human/interactive via `--human`;
- `--json` compatibility;
- output channels and exit codes.

Fix landing-page commands so each can run in sequence. Specifically change freebusy to include `--calendar Work`. The preceding interactive default selection does not satisfy freebusy because freebusy currently requires an explicit selector. Ensure create/events examples either name a calendar or clearly rely on the just-configured default.

**Verify**:

```bash
PRELOAD="$PWD/__tests__/helpers/mock-osascript.js"
node -r "$PRELOAD" bin/accli.js freebusy --calendar Work --from 2025-01-15 --to 2025-01-16 --compact
```

→ exit 0 and one line of valid JSON.

### Step 4: Run closeout checks

Run `pnpm test`, then inspect `git diff --check` and the scoped diff. Do not run `pnpm pack` because current package-manager/version migration is outside this plan.

**Verify**: `pnpm test && git diff --check` → all tests pass and no diff errors.

## Test plan

Use existing `runCli` and console spies. Tests must assert exit code, stdout/stderr channel, and JSON parseability rather than only matching text. Mock errors at the subprocess boundary; never alter or read live calendars.

## Done criteria

- [ ] Every operational path honors default/compact/human modes.
- [ ] Unknown and uncaught failures are structured outside human mode.
- [ ] Help/version remain plain text.
- [ ] Interactive prompts require `--human` and a TTY.
- [ ] README, help, and landing page agree.
- [ ] Landing-page freebusy example includes a calendar selector.
- [ ] `pnpm test` passes.
- [ ] Only scoped files plus `plans/README.md` changed by this plan.

## STOP conditions

Stop and report if:

- the expected uncommitted JSON-default implementation is missing or replaced;
- completing tests requires deciding a different output-version contract;
- any command necessarily mixes human text into JSON output;
- a fix requires package version, changelog, JXA, or package-manager changes;
- verification fails twice.

## Maintenance notes

Reviewers should treat stdout/stderr and compactness as public API. Any future command must route operational output through `output`/`outputError`; direct console calls are reserved for help/version and explicit human interaction. Plan 005 sanitizes only human rendering and must preserve raw JSON.