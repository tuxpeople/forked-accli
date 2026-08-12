# Plan 001: Reject ambiguous and unconsumed CLI input before dispatch

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f39f061..HEAD -- bin/accli.js __tests__/cli.integration.test.js`
> This plan was written while those files also had unrelated uncommitted output-mode work. Run `git diff -- bin/accli.js __tests__/cli.integration.test.js` and preserve it. If an in-scope file changed since this plan was written, compare the excerpts below with live code; if the parsing behavior no longer matches, STOP and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f39f061`, 2026-08-12

## Why this matters

The parser accepts every `--name value` pair and handlers ignore options and positionals they do not consume. A typo can therefore turn a targeted query into a default query or let a destructive command update/delete a different target while still exiting successfully. Commands must reject unknown flags, surplus positionals, contradictory all-day flags, and multiple single-calendar selectors before invoking JXA.

## Current state

- `bin/accli.js` parses arguments and contains every command handler.
- `__tests__/cli.integration.test.js` launches the real CLI with a mocked `osascript` boundary and asserts exit/output contracts.

Current generic acceptance in `bin/accli.js:24-65`:

```js
if (arg.startsWith('--')) {
  const key = arg.slice(2);
  // known booleans and arrays are special-cased ...
  const value = args[i + 1];
  result.flags[key] = value; // every other key is accepted
} else if (!result.command) {
  result.command = arg;
} else {
  result.positional.push(arg); // no global arity check
}
```

Current destructive positional parsing in `handleDelete` (original `bin/accli.js:964-975`; line numbers may be shifted by the output-mode diff):

```js
if (args.positional.length >= 2) {
  calendarName = args.positional[0];
  eventId = args.positional[1];
}
```

The third and later positionals are ignored. Calendar selection similarly rejects ID+index but can accept a name together with either selector, after which JXA prioritizes the ID/index.

Match existing error conventions: call `output.outputError({ code: ERROR_CODES.INVALID_ARGUMENT, message }, outputOptions(args))`, then exit with `EXIT_VALIDATION_ERROR` (2). The current dirty output-mode work makes JSON the default and human output opt-in; do not revert or redesign it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec jest __tests__/cli.integration.test.js --runInBand` | suite passes |
| Full tests | `pnpm test` | 4+ suites pass |
| Diff check | `git diff --check` | exit 0, no output |

Do not run install, formatting, publishing, or real calendar mutation commands.

## Scope

**In scope**:
- `bin/accli.js`
- `__tests__/cli.integration.test.js`
- `__tests__/helpers/mock-osascript.js` only if a test needs to prove which script/arguments were dispatched

**Out of scope**:
- JXA date/range validation; Plan 003 owns it.
- Refactoring all handlers or extracting the 1,351-line CLI into modules.
- Changing JSON/human output semantics already present in the working tree.
- Removing deprecated numeric `--calendar-id` compatibility.
- Any real EventKit invocation.

## Git workflow

- Work in the current assigned branch/worktree; preserve all pre-existing modifications.
- Keep the change uncommitted unless the operator explicitly asks for a commit.
- If asked to commit, use an imperative message such as `Reject invalid CLI argument combinations`.
- Do not push or open a PR.

## Steps

### Step 1: Add command contracts without rewriting handler behavior

Define one declarative contract per command (and config action where needed) near `parseArgs`. Each contract must declare:

- allowed boolean flags;
- allowed scalar flags;
- allowed repeatable flags;
- minimum/maximum positional count;
- whether exactly one of positional/`--calendar-name`/`--calendar-id`/`--calendar-index` is allowed;
- mutually exclusive flags (`--all-day` and `--no-all-day`).

Global flags accepted for every command are `--help`, `--version`, `--human`, `--compact`, and backward-compatible `--json`. Preserve the current rule that `--calendar`, `--calendar-id`, and `--calendar-index` may repeat only where the command contract says so (`freebusy`; `config set-default` has its narrower contract).

Validation must occur after parsing and after command/help identification, but before any handler invokes `runScript`. Unknown command handling must remain the existing structured `INVALID_ARGUMENT` path.

**Verify**: `node --check bin/accli.js` → exit 0.

### Step 2: Enforce selector and arity invariants

Before dispatch, reject:

- any unknown flag, naming it in the message;
- surplus or missing positionals according to the command usage;
- name plus ID/index on single-calendar commands;
- ID plus index on single-calendar commands;
- multiple IDs/indexes on single-calendar commands;
- both `--all-day` and `--no-all-day`;
- repeated `--calendar`/`--calendar-id` in `config set-default` rather than silently taking element zero.

Do not reject a valid positional calendar override merely because a default calendar exists. Preserve existing valid forms such as `event Work EVENT_ID`, `event EVENT_ID --calendar-id CAL1`, and `event EVENT_ID` with a configured default.

**Verify**: `pnpm exec jest __tests__/cli.integration.test.js --runInBand` → existing tests still pass before new assertions are added.

### Step 3: Add regression coverage for accepted and rejected forms

Add table-driven CLI integration tests using the existing `runCli` helper. At minimum cover:

- unknown scalar flag on `events`;
- misspelled calendar flag on `create` with a configured default (must exit 2 before dispatch);
- extra positional on `delete` and `update`;
- positional calendar plus `--calendar-id` on `create` and `events`;
- `--calendar-name` plus `--calendar-index`;
- `--all-day --no-all-day` on update;
- repeated `--calendar-id` on a single-calendar command;
- repeated calendar selectors remain accepted for `freebusy`;
- existing event positional/default combinations remain accepted.

For machine output, parse stdout and assert `ok === false` and `error.code === 'INVALID_ARGUMENT'`. Also assert status 2. Use `--human` only for one representative stderr test; do not duplicate the output-mode suite.

**Verify**: `pnpm exec jest __tests__/cli.integration.test.js --runInBand` → all tests pass.

## Test plan

Model new tests after `__tests__/cli.integration.test.js`'s existing positional-regression block. Tests must prove rejection occurs before JXA dispatch; if the canned mock's generic `{ok:true}` is sufficient to distinguish this, do not modify the mock. If dispatch observation is required, add a stable, test-only capture mechanism rather than parsing JXA header comments (Plan 002 replaces that fragile convention).

Final verification: `pnpm test && git diff --check` → all suites pass and diff check is clean.

## Done criteria

- [ ] Unknown flags return `INVALID_ARGUMENT`, exit 2.
- [ ] Extra positionals on update/delete are rejected before dispatch.
- [ ] Single-calendar commands reject every conflicting selector combination.
- [ ] Update rejects simultaneous `--all-day` and `--no-all-day`.
- [ ] Valid default-calendar and freebusy repeatable-selector forms still pass.
- [ ] `pnpm test` passes.
- [ ] No files outside the in-scope list (plus `plans/README.md`) were changed by this plan.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- the current output-mode work is absent or materially different and applying this plan would require choosing a new JSON contract;
- valid positional forms cannot be represented declaratively without changing their documented meaning;
- tests require a real Calendar permission prompt or EventKit mutation;
- a reasonable fix requires editing JXA scripts or refactoring handlers beyond argument validation;
- any focused verification fails twice.

## Maintenance notes

Keep command contracts adjacent to parser/dispatch code so new commands must declare their accepted surface. Reviewers should specifically check that no handler can receive unconsumed input and that `freebusy` remains the intentional multi-calendar exception. A broader handler/spec-table refactor is useful but explicitly deferred.