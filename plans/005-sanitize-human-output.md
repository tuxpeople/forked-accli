# Plan 005: Escape terminal controls in human-readable output

> **Executor instructions**: Follow each step and verification gate. Stop on a STOP condition instead of improvising. Update the row in `plans/README.md` when done unless a reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat f39f061..HEAD -- lib/output.js __tests__/output.test.js`
> Also inspect uncommitted changes. Plan 004's current output-mode implementation must remain: raw JSON by default and human rendering only with `--human`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/004-finalize-json-output-contract.md`
- **Category**: security
- **Planned at**: commit `f39f061`, 2026-08-12

## Why this matters

Calendar names, titles, locations, descriptions, IDs, and error text can originate from synced/shared calendars or subprocess diagnostics. Human formatters currently interpolate those values directly, allowing ANSI/C0/C1 control characters and embedded newlines to alter terminal state, spoof lines, or poison captured logs. Human output must render controls visibly while structured JSON preserves original values for machine consumers.

## Current state

- `lib/output.js` owns every human formatter and output channel.
- Examples of direct interpolation include:

```js
lines.push(`  ${cal.name}`);
lines.push(`  ID: ${cal.id}`);
let header = event.summary || '(No title)';
lines.push(`  Location: ${event.location}`);
return `Error [${error.code}]: ${error.message}`;
```

- `formatFreeBusy` also prints summary/calendar text directly.
- Plan 004 establishes `output(data, {human})`: JSON must serialize the original object without sanitization. Sanitization belongs only inside human formatter functions and `formatError`.
- Existing tests in `__tests__/output.test.js` call formatters directly and use console spies; follow that style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec jest __tests__/output.test.js --runInBand` | pass |
| Full tests | `pnpm test` | all pass |
| Syntax | `node --check lib/output.js` | exit 0 |
| Diff check | `git diff --check` | no output |

## Scope

**In scope**:
- `lib/output.js`
- `__tests__/output.test.js`

**Out of scope**:
- Mutating or sanitizing JSON response objects.
- Removing non-ASCII Unicode, emoji, combining marks, or ordinary international text.
- Shell escaping or changing `spawn` behavior.
- Redacting calendar contents or changing description truncation length.
- Changing JSON/human mode selection.
- Sanitizing static, source-controlled help text.

## Git workflow

Preserve existing dirty output changes. Keep changes uncommitted unless asked. If asked, use `Escape terminal controls in human output`. Do not publish.

## Steps

### Step 1: Add one human-text escaping primitive

Add a private `escapeTerminalText(value)` near the top of `lib/output.js`. Requirements:

- coerce non-null values with `String(value)`;
- preserve normal printable Unicode unchanged;
- render `\n`, `\r`, and `\t` as visible two-character escapes (`\\n`, `\\r`, `\\t`), not literal controls;
- render ESC (`U+001B`), remaining C0 (`U+0000..U+001F`), DEL (`U+007F`), and C1 (`U+0080..U+009F`) as deterministic visible escapes such as `\\x1b` or `\\u009b`;
- return an empty string for null/undefined only where callers previously treated them as absent; do not change fallback decisions.

Do not use a third-party dependency. Do not strip controls silently—the visible escape helps users diagnose malicious/broken content.

**Verify**: `node --check lib/output.js` → exit 0.

### Step 2: Apply escaping at every human-rendering sink

Apply the helper to all externally derived fields before interpolation:

- calendar name, ID, source, index;
- event summary, calendar, start/end strings, location, description, ID;
- setup message and calendar names;
- create/update/delete calendar/event values and warnings;
- freebusy not-found selectors, times, summary, calendar;
- error code and message in `formatError`.

Preserve formatter structure and static labels. Escape before description truncation or make the order explicit and tested: preferred behavior is truncate the original description to 100 characters, then escape it, so controls cannot inflate the semantic source-length limit. Never mutate input objects.

Audit the entire file with template-literal/interpolation searches, not only the cited lines.

**Verify**:

```bash
grep -n '\${' lib/output.js
```

→ every interpolation of data originating from a function argument passes through `escapeTerminalText` or is a numeric count/static computed label proven safe.

### Step 3: Add comprehensive formatter tests

In `__tests__/output.test.js`, add cases containing:

- ANSI CSI sequence in a summary/calendar name;
- OSC sequence with BEL terminator;
- embedded newline/carriage return/tab in location/description;
- C1 CSI (`U+009B`) and DEL;
- ordinary Unicode/emoji that must remain unchanged.

Assert human formatter output contains visible escapes and does not contain raw ESC, BEL, C1, CR, tab, or attacker-supplied newline. It is acceptable for formatter-owned structural newlines to remain; split lines and verify no extra attacker-created line appears.

Add an output-mode regression:

1. call `output.output(payload)` (JSON default from Plan 004), parse captured stdout, and assert the raw control-containing string round-trips unchanged;
2. call `output.output(payload, { human: true, formatter: ... })` and assert controls are escaped.

Also test `outputError` in human mode versus default JSON so subprocess/error text follows the same rule without altering structured JSON.

**Verify**: `pnpm exec jest __tests__/output.test.js --runInBand` → pass.

### Step 4: Close out

Run the full suite and inspect only the scoped diff. Confirm no formatter was missed and no JSON path calls the escape helper.

**Verify**: `pnpm test && git diff --check` → all tests pass; no diff errors.

## Test plan

Use direct formatter calls for precise sink coverage and console spies for output-channel behavior. Tests should compare raw character presence (`'\x1b'`, `'\u009b'`) separately from visible string escapes (`'\\x1b'`, `'\\u009b'`) to avoid false positives. Include one representative payload per formatter family rather than duplicating every field if a single centralized helper is demonstrably used.

## Done criteria

- [ ] One private escape helper handles C0, ESC, DEL, C1, newline, carriage return, and tab.
- [ ] Every externally derived human-output field is escaped.
- [ ] Printable Unicode is preserved.
- [ ] JSON output round-trips raw values unchanged.
- [ ] Human errors sanitize error code/message.
- [ ] No input object is mutated.
- [ ] `pnpm test` passes.
- [ ] Only `lib/output.js`, `__tests__/output.test.js`, and `plans/README.md` changed by this plan.

## STOP conditions

Stop and report if:

- Plan 004 is not complete or JSON/human mode semantics differ from its plan;
- sanitization appears necessary before JSON serialization to satisfy another requirement;
- preserving ordinary Unicode conflicts with an existing terminal library or documented policy;
- a fix requires changing JXA data or subprocess invocation;
- focused verification fails twice.

## Maintenance notes

Reviewers should search every newly added formatter interpolation. Future human formatters must pass untrusted values through `escapeTerminalText`; JSON must remain raw. This protects presentation, not storage, shell execution, or privacy, and should not be expanded into generic data mutation.