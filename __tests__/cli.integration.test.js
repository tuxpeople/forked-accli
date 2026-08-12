'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function runCli(args, { env } = {}) {
  const preload = path.join(__dirname, 'helpers', 'mock-osascript.js');
  const nodeArgs = ['-r', preload, path.join(__dirname, '..', 'bin', 'accli.js'), ...args];
  return spawnSync(process.execPath, nodeArgs, { encoding: 'utf8', env: { ...process.env, ...env } });
}

function makeTempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accli-cli-home-'));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('accli CLI integration', () => {
  test('--version prints package version', () => {
    const { version } = require('../package.json');
    const r = runCli(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  });

  test('no args prints global help and exits with a validation status', () => {
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/USAGE:/);
    expect(() => JSON.parse(r.stdout)).toThrow();
  });

  test('unknown command returns a JSON validation error by default', () => {
    const r = runCli(['nope']);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout).error.message).toMatch(/Unknown command/);

    const human = runCli(['nope', '--human']);
    expect(human.status).toBe(2);
    expect(human.stdout).toBe('');
    expect(human.stderr).toMatch(/Error \[INVALID_ARGUMENT\]: Unknown command/);
    expect(human.stderr).toMatch(/USAGE:/);
  });

  test('--help remains plain text', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/USAGE:/);
    expect(() => JSON.parse(r.stdout)).toThrow();

    for (const command of ['setup', 'calendars']) {
      const commandHelp = runCli([command, '--help']);
      expect(commandHelp.status).toBe(0);
      expect(commandHelp.stdout).toMatch(/--human/);
      expect(commandHelp.stdout).toMatch(/--compact/);
      expect(commandHelp.stdout).toMatch(/--json/);
    }
  });

  test('unexpected errors follow the selected output mode', () => {
    const tmp = makeTempHome();
    const configPath = path.join(tmp.dir, '.acclirc');
    fs.writeFileSync(configPath, '{invalid json', 'utf8');

    try {
      const json = runCli(['events'], { env: { ACCLI_CONFIG_PATH: configPath } });
      expect(json.status).toBe(1);
      expect(json.stderr).toBe('');
      expect(JSON.parse(json.stdout).error.code).toBe('INTERNAL_ERROR');

      const human = runCli(['events', '--human'], { env: { ACCLI_CONFIG_PATH: configPath } });
      expect(human.status).toBe(1);
      expect(human.stdout).toBe('');
      expect(human.stderr).toMatch(/Error \[INTERNAL_ERROR\]: Failed to read config/);
    } finally {
      tmp.cleanup();
    }
  });

  test('calendars defaults to pretty JSON and --json remains compatible', () => {
    const plain = runCli(['calendars']);
    const compatibility = runCli(['calendars', '--json']);
    expect(plain.status).toBe(0);
    expect(plain.stdout).toContain('\n  "calendars"');
    expect(compatibility.stdout).toBe(plain.stdout);
  });

  test('--compact emits single-line JSON and --human wins over --json', () => {
    const compact = runCli(['calendars', '--compact']);
    expect(compact.status).toBe(0);
    expect(compact.stdout.trim()).not.toContain('\n');
    expect(Array.isArray(JSON.parse(compact.stdout).calendars)).toBe(true);

    const human = runCli(['calendars', '--json', '--human']);
    expect(human.status).toBe(0);
    expect(human.stdout).toMatch(/Calendars:/);
    expect(() => JSON.parse(human.stdout)).toThrow();

    const humanCompact = runCli(['calendars', '--human', '--compact']);
    expect(humanCompact.stdout).toBe(human.stdout);
  });

  test('validation errors default to JSON stdout and use stderr with --human', () => {
    const json = runCli(['create']);
    expect(json.status).toBe(2);
    expect(json.stderr).toBe('');
    expect(JSON.parse(json.stdout).error.code).toBe('MISSING_REQUIRED');

    const compact = runCli(['create', '--compact']);
    expect(compact.status).toBe(2);
    expect(compact.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compact.stdout).error.code).toBe('MISSING_REQUIRED');

    const human = runCli(['create', '--human']);
    expect(human.status).toBe(2);
    expect(human.stdout).toBe('');
    expect(human.stderr).toMatch(/Error \[MISSING_REQUIRED\]/);
  });

  test('parse errors follow the selected output mode', () => {
    const json = runCli(['calendars', '--from']);
    expect(json.status).toBe(2);
    expect(json.stderr).toBe('');
    expect(JSON.parse(json.stdout).error.code).toBe('MISSING_REQUIRED');

    const human = runCli(['calendars', '--from', '--human']);
    expect(human.status).toBe(2);
    expect(human.stdout).toBe('');
    expect(human.stderr).toMatch(/Error \[MISSING_REQUIRED\]/);
  });

  test('config selection is non-interactive unless --human is supplied', () => {
    const json = runCli(['config', 'set-default']);
    expect(json.status).toBe(2);
    expect(JSON.parse(json.stdout).error.message).toMatch(/Non-interactive mode requires/);

    const human = runCli(['config', 'set-default', '--human']);
    expect(human.status).toBe(2);
    expect(human.stderr).toMatch(/Non-interactive mode requires/);
  });

  test('calendars --json returns stubbed calendars', () => {
    const r = runCli(['calendars', '--json']);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data.calendars)).toBe(true);
    expect(data.calendars[0].name).toBe('Work');
  });

  test('events --json without calendar and no default returns MISSING_REQUIRED', () => {
    const tmp = makeTempHome();
    try {
      const r = runCli(['events', '--from', '2025-01-01', '--to', '2025-01-02', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(2);
      const data = JSON.parse(r.stdout);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('MISSING_REQUIRED');
    } finally {
      tmp.cleanup();
    }
  });

  test('config set-default and show uses ~/.acclirc', () => {
    const tmp = makeTempHome();
    try {
      const set = runCli(['config', 'set-default', '--calendar-id', 'CAL1', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(set.status).toBe(0);
      expect(JSON.parse(set.stdout).defaultCalendar.id).toBe('CAL1');

      const show = runCli(['config', 'show', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(show.status).toBe(0);
      expect(JSON.parse(show.stdout).defaultCalendar.id).toBe('CAL1');
    } finally {
      tmp.cleanup();
    }
  });
});

describe('positional parsing for event/update/delete (regression tests)', () => {
  test('event with 2 positionals works (calendar override)', () => {
    const tmp = makeTempHome();
    try {
      // Set a default calendar first
      runCli(['config', 'set-default', '--calendar-id', 'CAL1', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      // Now use 2 positionals - should override default, not error
      const r = runCli(['event', 'Work', 'event-123', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      // Mock returns EVENT_NOT_FOUND, but the point is it didn't fail with "Too many positional arguments"
      expect(r.status).toBe(1); // runtime error, not validation error
      const data = JSON.parse(r.stdout);
      expect(data.error.code).toBe('EVENT_NOT_FOUND');
    } finally {
      tmp.cleanup();
    }
  });

  test('event with 1 positional + default uses default calendar', () => {
    const tmp = makeTempHome();
    try {
      runCli(['config', 'set-default', '--calendar-id', 'CAL1', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      const r = runCli(['event', 'event-123', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(1); // runtime error (EVENT_NOT_FOUND), not validation
      const data = JSON.parse(r.stdout);
      expect(data.error.code).toBe('EVENT_NOT_FOUND');
    } finally {
      tmp.cleanup();
    }
  });

  test('event with 1 positional + --calendar-id flag works', () => {
    const tmp = makeTempHome();
    try {
      const r = runCli(['event', 'event-123', '--calendar-id', 'CAL1', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(1); // runtime error
      const data = JSON.parse(r.stdout);
      expect(data.error.code).toBe('EVENT_NOT_FOUND');
    } finally {
      tmp.cleanup();
    }
  });

  test('event with 1 positional + no default = missing eventId error', () => {
    const tmp = makeTempHome();
    try {
      const r = runCli(['event', 'Work', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(2); // validation error
      const data = JSON.parse(r.stdout);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('MISSING_REQUIRED');
      expect(data.error.message).toMatch(/event ID/i);
    } finally {
      tmp.cleanup();
    }
  });

  test('event with 2 positionals + --calendar-id flag = too many args', () => {
    const tmp = makeTempHome();
    try {
      const r = runCli(['event', 'Work', 'event-123', '--calendar-id', 'CAL1', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(2); // validation error
      const data = JSON.parse(r.stdout);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_ARGUMENT');
      expect(data.error.message).toMatch(/Too many positional arguments/);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('EVENT_NOT_FOUND returns proper error (regression test)', () => {
  test('event command returns exit code 1 for EVENT_NOT_FOUND', () => {
    const tmp = makeTempHome();
    try {
      const r = runCli(['event', 'Work', 'nonexistent', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(1); // runtime error, not 0
      const data = JSON.parse(r.stdout);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('EVENT_NOT_FOUND');
    } finally {
      tmp.cleanup();
    }
  });
});

describe('--json flag works for validation failures (regression test)', () => {
  test('validation errors output JSON when --json is passed', () => {
    const tmp = makeTempHome();
    try {
      const r = runCli(['create', '--json'], { env: { ACCLI_CONFIG_PATH: path.join(tmp.dir, '.acclirc') } });
      expect(r.status).toBe(2);
      // Should be valid JSON, not plain text error
      const data = JSON.parse(r.stdout);
      expect(data.ok).toBe(false);
      expect(data.error).toBeDefined();
    } finally {
      tmp.cleanup();
    }
  });
});
