# Changelog

## 2.0.0

- Make JSON the default output for operational commands and errors.
- Add `--human` for human-readable output and interactive behavior.
- Add `--compact` for single-line JSON output.
- Retain `--json` as a backward-compatible no-op.
- Reject unknown, conflicting, and invalid CLI inputs before accessing Calendar.
- Validate dates, ranges, event limits, and calendar indexes strictly.
- Escape terminal control characters in human-readable output while preserving raw JSON.
- Add `INTERNAL_ERROR` for unexpected top-level failures.
