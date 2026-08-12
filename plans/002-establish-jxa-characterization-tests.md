# Plan 002: Establish executable characterization tests for JXA domain logic

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report. Update this plan's row in `plans/README.md` when done unless a reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat f39f061..HEAD -- lib/jxa-runner.js scripts/create.jxa scripts/update.jxa scripts/event.jxa scripts/events.jxa scripts/freebusy.jxa __tests__/jxa-runner.test.js __tests__/helpers/mock-osascript.js`
> Also inspect uncommitted changes with `git diff -- <same paths>` and preserve them. If the current excerpts no longer match behavior, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `f39f061`, 2026-08-12

## Why this matters

All real date conversion and EventKit mutation logic lives in about 2,000 lines of JXA, but the Jest suite replaces `osascript` with canned responses. The mock even identifies commands through filenames that happen to appear in header comments. This plan creates a stable script marker and extracts the pure, runtime-independent JXA date helpers into a prelude that Jest can execute directly, providing a regression baseline before Plan 003 changes validation semantics.

## Current state

- `lib/jxa-runner.js:64-70` reads a command script and prepends only serialized arguments:

```js
const scriptContent = fs.readFileSync(scriptPath, 'utf8');
const argsJson = JSON.stringify(args);
const wrappedScript = `var __args = ${argsJson};\n${scriptContent}`;
```

- `__tests__/helpers/mock-osascript.js:8-24` dispatches canned responses using `wrappedScript.includes('events.jxa')`; these strings exist only in comments at the top of scripts.
- Date helpers are duplicated in command scripts. For example, `scripts/create.jxa:95-106` parses date-only inputs and adds one day to an all-day end; `scripts/update.jxa:108-126` has another implementation; `event.jxa` and `events.jxa` each implement inclusive all-day display ends.
- Existing `__tests__/jxa-runner.test.js` is the pattern for mocking `child_process.spawn` and inspecting wrapped source.

The JXA environment is JavaScriptCore, not Node. Shared source must remain ES5-compatible (`var`, function declarations; no `require`, module exports, optional chaining, or Node globals). Jest may evaluate only the pure helper prelude via Node's built-in `vm`; it must never evaluate files that call `ObjC.import`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Runner tests | `pnpm exec jest __tests__/jxa-runner.test.js --runInBand` | pass |
| JXA helper tests | `pnpm exec jest __tests__/jxa-date-utils.test.js --runInBand` | pass |
| Full tests | `pnpm test` | all pass |
| Syntax | `node --check lib/jxa-runner.js` | exit 0 |

## Scope

**In scope**:
- `scripts/lib/date-utils.jxa` (new)
- `lib/jxa-runner.js`
- `scripts/create.jxa`
- `scripts/update.jxa`
- `scripts/event.jxa`
- `scripts/events.jxa`
- `scripts/freebusy.jxa`
- `__tests__/jxa-date-utils.test.js` (new)
- `__tests__/jxa-runner.test.js`
- `__tests__/helpers/mock-osascript.js`
- `__tests__/cli.integration.test.js` only if stable-marker integration assertions belong there

**Out of scope**:
- Authorization and calendar-resolution helper deduplication.
- Changing accepted date formats or rejecting normalized dates; Plan 003 owns those behavior changes.
- Live create/update/delete tests against the user's calendars.
- Adding dependencies or a general JXA build system.
- Refactoring unrelated serialization fields.

## Git workflow

Preserve all existing dirty changes. Keep work uncommitted unless asked. If asked to commit, use `Add JXA date characterization tests`. Do not push or publish.

## Steps

### Step 1: Add a stable command marker and date prelude loading

Create `scripts/lib/date-utils.jxa` as a pure IIFE that assigns one global object, `AccliDateUtils`. Initially move only behavior-preserving helpers:

- local datetime formatting;
- date-only formatting;
- current permissive date parsing;
- start-of-day;
- all-day exclusive-end parsing;
- inclusive display-end calculation.

Function names and parameters must be explicit and documented in the file. Avoid references to `$`, `ObjC`, `__args`, EventKit, filesystem, or process state.

Update `runScript` to read this fixed prelude and produce wrapped source in this order:

1. `var __accliScriptName = <JSON string>;`
2. `var __args = <JSON string>;`
3. date utility prelude;
4. command script.

The script name marker must be data, not a comment, so tests do not depend on comments. If the prelude is missing/unreadable, return a structured `JXA_ERROR` rather than throwing out of the Promise executor.

**Verify**: `pnpm exec jest __tests__/jxa-runner.test.js --runInBand` → runner tests pass after updating wrapped-source expectations.

### Step 2: Switch command scripts to the shared pure helpers

Replace duplicated date helper bodies in the five scoped scripts with calls to `AccliDateUtils`. Preserve exact current semantics, including:

- date-only inputs are local midnight;
- create's all-day end is stored exclusively by adding one day;
- event/events/update display all-day end inclusively without returning a date before start;
- timed values remain local, offset-free formatted strings;
- ISO fields retain their current behavior in this plan (all-day ISO correctness is a later finding).

Do not move authorization, calendar lookup, or EventKit object conversion (`toNSDate`) in this plan.

**Verify**: `grep -n "function parseDateTime\|function formatDateOnly\|function displayEndDateForAllDay" scripts/{create,update,event,events,freebusy}.jxa` → no duplicated definitions that are now supplied by `AccliDateUtils`.

### Step 3: Add direct characterization tests for the prelude

Create `__tests__/jxa-date-utils.test.js`. Read `scripts/lib/date-utils.jxa` as text and execute it in a fresh `vm` context. Test the public helper object directly. Cover:

- timed parse for seconds-present and minutes-only values;
- local date-only midnight behavior;
- all-day create end adds exactly one local calendar day across a DST boundary (assert calendar components, not a hard-coded millisecond duration);
- inclusive display end subtracts one calendar day;
- defensive clamp prevents display end before start;
- valid leap day;
- current normalization behavior for an impossible date, explicitly labeled characterization to be changed by Plan 003;
- local timed and date-only formatting.

Do not assert timezone-dependent UTC strings. Use `getFullYear/getMonth/getDate/getHours`.

**Verify**: `pnpm exec jest __tests__/jxa-date-utils.test.js --runInBand` → all new tests pass.

### Step 4: Make the CLI mock use the stable marker

Change `respondForWrappedScript` to detect `var __accliScriptName = "calendars";` (or parse the marker robustly), not header comments. Add specific canned success payloads for `create`, `update`, and `delete`; do not let mutation scripts fall through to generic `{ok:true}`. Add a test proving deletion of a script's filename comment would not affect routing—prefer a runner unit assertion over editing production comments merely for a test.

**Verify**: `pnpm exec jest __tests__/cli.integration.test.js __tests__/jxa-runner.test.js --runInBand` → both suites pass.

## Test plan

The new direct suite tests pure code that is actually concatenated into every JXA invocation. The runner suite proves concatenation order and marker stability. Existing CLI integration tests continue to test Node-to-osascript contracts with deterministic payloads. No test may request Calendar permission or mutate live data.

Final verification: `pnpm test && git diff --check` → all suites pass and no whitespace errors.

## Done criteria

- [ ] A pure ES5-compatible `scripts/lib/date-utils.jxa` exists and is loaded by every `runScript` call.
- [ ] Five command scripts use the same tested date helper implementations.
- [ ] Jest directly executes and tests the exact prelude source.
- [ ] CLI mock routing uses `__accliScriptName`, not filename comments.
- [ ] Create/update/delete have explicit mock payloads.
- [ ] Existing behavior is unchanged; impossible-date normalization remains characterized for Plan 003.
- [ ] `pnpm test` passes.
- [ ] Only in-scope files plus `plans/README.md` changed.

## STOP conditions

Stop and report if:

- JavaScriptCore cannot access a global declared by the prepended prelude in a read-only `osascript` smoke expression;
- sharing helpers requires a build/transpile dependency;
- behavior-preserving extraction changes timezone or all-day output;
- a test would need real Calendar data or authorization;
- current dirty runner changes conflict with prelude ordering;
- verification fails twice.

## Maintenance notes

Reviewers should compare output before/after for valid dates and scrutinize DST behavior. Keep the prelude pure so Node `vm` remains a faithful executable test. Authorization/calendar helper deduplication is deliberately deferred until this characterization layer exists.