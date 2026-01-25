import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('scripts', 'verify-version.cjs');
const tempRoots: string[] = [];

const writeJson = (filePath: string, data: Record<string, unknown>) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const createTempRoot = () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-version-'));
  tempRoots.push(rootDir);
  return rootDir;
};

const runScript = (rootDir: string) => {
  execFileSync(process.execPath, [scriptPath], {
    env: { ...process.env, VERIFY_VERSION_ROOT: rootDir },
    stdio: 'pipe',
  });
};

describe('verify-version script', () => {
  afterEach(() => {
    for (const rootDir of tempRoots.splice(0)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('exits successfully when versions match', () => {
    const rootDir = createTempRoot();
    writeJson(path.join(rootDir, 'package.json'), { version: '1.2.3' });
    writeJson(path.join(rootDir, 'public', 'manifest.json'), { version: '1.2.3' });

    expect(() => runScript(rootDir)).not.toThrow();
  });

  it('fails when versions differ', () => {
    const rootDir = createTempRoot();
    writeJson(path.join(rootDir, 'package.json'), { version: '1.2.3' });
    writeJson(path.join(rootDir, 'public', 'manifest.json'), { version: '1.2.4' });

    expect(() => runScript(rootDir)).toThrow();
  });

  it('fails when version fields are missing', () => {
    const rootDir = createTempRoot();
    writeJson(path.join(rootDir, 'package.json'), {});
    writeJson(path.join(rootDir, 'public', 'manifest.json'), {});

    expect(() => runScript(rootDir)).toThrow();
  });

  it('fails when files are missing', () => {
    const rootDir = createTempRoot();
    writeJson(path.join(rootDir, 'package.json'), { version: '1.2.3' });

    expect(() => runScript(rootDir)).toThrow();
  });
});
