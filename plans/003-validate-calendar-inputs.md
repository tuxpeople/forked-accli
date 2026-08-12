# Plan 003: Strictly validate calendar inputs and all-day transitions

> **Executor instructions**: Follow every step and verification gate. Stop rather than improvising when a STOP condition occurs. Update the row in `plans/README.md` when complete unless a reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat f39f061..HEAD -- bin/accli.js lib/validation.js scripts/lib/date-utils.jxa scripts/create.jxa scripts/update.jxa scripts/events.jxa scripts/freebusy.jxa __tests__/cli.integration.test.js __tests__/jxa-date-utils.test.js`
> Plan 002 must be DONE and its shared JXA date prelude must exist. Preserve unrelated dirty output-mode changes.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-enforce-cli-contracts.md`, `plans/002-establish-jxa-characterization-tests.md`
- **Category**: bug
- **Planned at**: commit `f39f061`, 2026-08-12

## Why this matters

Current validation checks only a date-shaped regex and whether JavaScript produced a finite `Date`. JavaScript normalizes impossible values such as February 30 into another day, permissive `parseInt` accepts partial indexes/limits, and reversed ranges reach EventKit. All-day updates can combine contradictory flags or partial boundaries and silently discard time information. The CLI and JXA boundary both need strict, machine-readable validation before calendar reads or mutations.

## Current state

- `bin/accli.js:73-85` currently accepts normalized dates:

```js
if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
  const date = new Date(str + 'T00:00:00');
  return !isNaN(date.getTime());
}
```

- `handleEvents` uses `parseInt(args.flags.max, 10)` without validating the whole string.
- JXA calendar lookup uses `parseInt(index, 10)`, so values with suffixes can select a real calendar.
- `events.jxa` and `freebusy.jxa` construct predicates without comparing from/to.
- `update.jxa` gives `--all-day` precedence over `--no-all-day`, allows one-sided conversion boundaries, and parses supplied all-day datetimes down to midnight.
- Error conventions are `INVALID_DATETIME`, `INVALID_RANGE`, or `INVALID_ARGUMENT`, mapped by `lib/jxa-runner.js` to exit 2.

Plan 002 introduces `scripts/lib/date-utils.jxa` and `__tests__/jxa-date-utils.test.js`; extend that shared prelude rather than recreating validators in each script. Node-side validation may live in a small CommonJS `lib/validation.js` with its own test file.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Validation unit tests | `pnpm exec jest __tests__/validation.test.js __tests__/jxa-date-utils.test.js --runInBand` | pass |
| CLI tests | `pnpm exec jest __tests__/cli.integration.test.js --runInBand` | pass |
| Full tests | `pnpm test` | all pass |
| Syntax | `node --check bin/accli.js && node --check lib/validation.js` | exit 0 |

## Scope

**In scope**:
- `lib/validation.js` (new)
- `bin/accli.js`
- `scripts/lib/date-utils.jxa` (created by Plan 002)
- `scripts/create.jxa`
- `scripts/update.jxa`
- `scripts/events.jxa`
- `scripts/freebusy.jxa`
- calendar-index validation sites in `scripts/event.jxa` and `scripts/delete.jxa`
- `__tests__/validation.test.js` (new)
- `__tests__/jxa-date-utils.test.js`
- `__tests__/cli.integration.test.js`

**Out of scope**:
- New timezone/offset input formats; accepted formats remain `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, and `YYYY-MM-DDTHH:mm:ss` in local time.
- Recurrence span behavior.
- All-day ISO output semantics.
- Event identifier unification.
- Broad JXA helper deduplication beyond Plan 002's prelude.

## Git workflow

Preserve existing changes. Keep uncommitted unless asked. If committing, use `Validate calendar command inputs`. Do not publish or run live mutation commands.

## Steps

### Step 1: Implement strict, component-based Node validators

Create `lib/validation.js` exporting named helpers for:

- `parseLocalDateTime(value)` returning `{ kind: 'date'|'datetime', date }` or a structured failure;
- `isNonNegativeInteger(value)` for complete decimal strings only;
- `parseEventLimit(value)` accepting integers `0..10000` (use this explicit upper bound to avoid pathological queries; update help to state it if help text is touched);
- `validateOrderedRange(from, to)` requiring `from < to` when both exist.

Strict parsing must split numeric components, construct a local `Date`, and compare every supplied component back to the constructed value. Reject invalid leap days, month/day overflow, hour >23, minute/second >59, and DST-normalized nonexistent local times. Do not use UTC parsing for date-only values.

Replace `isValidDatetime`/`isDateOnly` in `bin/accli.js` with these helpers. Preserve error codes and current output mode.

**Verify**: `node --check lib/validation.js && node --check bin/accli.js` → exit 0.

### Step 2: Validate scalar numeric and range inputs before dispatch

At the CLI boundary:

- require every `--calendar-index` to be a complete nonnegative integer;
- validate `--max` as `0..10000`, preserving zero rather than defaulting it to 50;
- reject equal or reversed explicit `events --from/--to` ranges;
- reject equal or reversed required `freebusy` ranges;
- reject create start/end where effective start is not before effective exclusive end;
- validate update's two supplied endpoints when both are present.

For all-day create, user-facing start/end are inclusive dates; converting the end to exclusive `+1 day` means a single-day `start === end` is valid. Timed create requires strict `start < end`.

Use `INVALID_DATETIME` for malformed components, `INVALID_RANGE` for ordering, and `INVALID_ARGUMENT` for index/limit violations.

**Verify**: focused CLI tests pass.

### Step 3: Enforce all-day update invariants

Plan 001 already rejects both mode flags. Add these rules:

- When `--all-day` is supplied, any supplied start/end must be date-only.
- When changing mode (`--all-day` or `--no-all-day`) and either boundary is supplied, require both boundaries. Mode conversion with neither boundary remains valid and preserves current default conversion (all-day current date, or 09:00–10:00 timed).
- When target mode is all-day, validate inclusive dates and store the end exclusively.
- For an already all-day event updated without a mode flag, JXA must reject a supplied timed boundary; Node cannot know current mode, so enforce this in `update.jxa`.
- For timed targets, require datetime-shaped values when boundaries are supplied; do not silently accept date-only midnight unless existing documented behavior explicitly requires it. If tests reveal a documented dependency on date-only timed inputs, STOP rather than choose.
- JXA must compare effective current/new boundaries so one-sided non-conversion updates cannot invert an event.

Return structured `INVALID_DATETIME`/`INVALID_RANGE`; never rely on EventKit to reject it.

**Verify**: `pnpm exec jest __tests__/jxa-date-utils.test.js __tests__/cli.integration.test.js --runInBand` → pass.

### Step 4: Add defense-in-depth validators to the JXA prelude and scripts

Extend `AccliDateUtils` with strict parsing and complete-integer validation equivalent to the Node implementation. Update all scoped scripts to validate before `toNSDate`, array indexing, or predicate creation. A malformed library-level call to exported `runScript` must receive `{ok:false,error}` from JXA, not normalized behavior.

Avoid copy/paste: strict JXA parsing belongs only in the prelude. Ensure `events.jxa` uses a nullish-style explicit default (`args.max === null || args.max === undefined ? 50 : args.max`) so zero remains zero.

**Verify**: `grep -R "parseInt(index" scripts/*.jxa` → no permissive calendar-index parsing remains.

### Step 5: Add boundary-focused tests

Node and JXA helper tests must cover:

- valid leap day and invalid non-leap February 29;
- February 30, April 31, month 00/13;
- hour 24, minute/second 60;
- valid date-only and both timed formats;
- full-string index acceptance/rejection (`0`, `01`, negative, decimal, suffix, whitespace);
- max 0, 1, 10000 accepted; negative, suffix, decimal, 10001 rejected;
- equal/reversed timed and date-only ranges;
- same-day all-day create accepted;
- contradictory mode flags (Plan 001 regression remains passing);
- partial all-day conversion rejected;
- timed boundary supplied to an existing all-day event rejected in JXA helper/script coverage.

Replace Plan 002's impossible-date normalization characterization with rejection assertions.

**Verify**: `pnpm test && git diff --check` → all suites pass; no whitespace errors.

## Test plan

Use `__tests__/validation.test.js` for Node boundary grammar, `__tests__/jxa-date-utils.test.js` for the exact JavaScriptCore-compatible helper source, and `__tests__/cli.integration.test.js` for exit-code/output/dispatch behavior. Keep cases table-driven and assert exact error codes. Tests must be timezone-robust: compare local components for accepted values and avoid hard-coded UTC offsets or 24-hour millisecond assumptions across DST. No test may invoke live EventKit.

Final verification: `pnpm test` → all existing and new tests pass.

## Done criteria

- [ ] Impossible dates/times are rejected before EventKit access.
- [ ] Node and JXA apply equivalent strict parsing.
- [ ] Calendar indexes and `--max` require complete bounded integers; max zero is preserved.
- [ ] Equal/reversed query and mutation ranges return `INVALID_RANGE`, exit 2.
- [ ] All-day conversion rules are explicit and tested.
- [ ] No permissive `parseInt(index, 10)` remains in JXA calendar selection.
- [ ] `pnpm test` passes.
- [ ] Only scoped files plus `plans/README.md` changed.

## STOP conditions

Stop and report if:

- Plan 002 is not complete or its prelude cannot be executed directly in Jest;
- current public docs intentionally support date-only values for timed update targets and requirements conflict with this plan;
- strict local-time round-trip differs between Node/V8 and JavaScriptCore for valid input;
- validation requires timezone-offset or IANA-zone support;
- a fix would alter recurrence semantics or all-day ISO response fields;
- any focused verification fails twice.

## Maintenance notes

Keep the accepted grammar centralized and documented. Reviewers should scrutinize DST boundaries and the inclusive-user/end-exclusive-EventKit all-day convention. Future timezone support must replace, not layer ad-hoc exceptions onto, these local-time parsers.