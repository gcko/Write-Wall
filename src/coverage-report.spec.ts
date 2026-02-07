import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('scripts', 'coverage-report.cjs');

interface FileData {
  percent: number;
  covered: number;
  total: number;
}

interface CoverageData {
  overall: number;
  files: Record<string, FileData>;
}

const esmRequire = createRequire(import.meta.url);
const {
  parseCoverage,
  calculateDelta,
  formatDelta,
  filterChangedFiles,
  generateReport,
  parseArgs,
} = esmRequire(scriptPath) as {
  parseCoverage: (coveragePath: string, basePath: string) => CoverageData | null;
  calculateDelta: (
    basePct: number | null,
    prPct: number,
    threshold: number,
  ) => { delta: number | null; indicator: string; passed: boolean };
  formatDelta: (deltaInfo: { delta: number | null; indicator: string }) => string;
  filterChangedFiles: (
    coverageFiles: Record<string, FileData>,
    changedFiles: string[],
  ) => Record<string, FileData>;
  generateReport: (
    baseData: CoverageData | null,
    prData: CoverageData | null,
    changedFiles: string[],
    threshold: number,
  ) => string;
  parseArgs: (argv: string[]) => {
    base: string | null;
    pr: string | null;
    changedFiles: string;
    threshold: number;
    output: string | null;
    basePath: string;
  };
};

const tempDirs: string[] = [];

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-report-'));
  tempDirs.push(dir);
  return dir;
};

const writeCoverageFile = (dir: string, name: string, data: Record<string, unknown>) => {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  return filePath;
};

const makeCoverageJson = (files: Record<string, Record<string, number>>) => {
  const result: Record<string, { s: Record<string, number> }> = {};
  for (const [filepath, statements] of Object.entries(files)) {
    result[filepath] = { s: statements };
  }
  return result;
};

describe('coverage-report', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('parseCoverage', () => {
    it('returns null for non-existent file', () => {
      expect(parseCoverage('/nonexistent/file.json', '')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const dir = createTempDir();
      const filePath = path.join(dir, 'bad.json');
      fs.writeFileSync(filePath, 'not json', 'utf8');
      expect(parseCoverage(filePath, '')).toBeNull();
    });

    it('returns null for empty object', () => {
      const dir = createTempDir();
      const filePath = writeCoverageFile(dir, 'empty.json', {});
      expect(parseCoverage(filePath, '')).toBeNull();
    });

    it('parses coverage-final.json with statement counts', () => {
      const dir = createTempDir();
      const data = makeCoverageJson({
        '/project/src/a.ts': { '0': 1, '1': 1, '2': 0, '3': 1 },
        '/project/src/b.ts': { '0': 1, '1': 1 },
      });
      const filePath = writeCoverageFile(dir, 'coverage.json', data);

      const result = parseCoverage(filePath, '/project') as CoverageData;
      expect(result).not.toBeNull();
      expect(result.overall).toBeCloseTo(83.33, 1);
      expect(result.files['src/a.ts'].percent).toBe(75);
      expect(result.files['src/a.ts'].covered).toBe(3);
      expect(result.files['src/a.ts'].total).toBe(4);
      expect(result.files['src/b.ts'].percent).toBe(100);
    });

    it('strips trailing slashes from basePath', () => {
      const dir = createTempDir();
      const data = makeCoverageJson({
        '/project/src/a.ts': { '0': 1 },
      });
      const filePath = writeCoverageFile(dir, 'coverage.json', data);

      const result = parseCoverage(filePath, '/project/') as CoverageData;
      expect(result.files['src/a.ts']).toBeDefined();
    });

    it('returns null when all files have zero statements', () => {
      const dir = createTempDir();
      const data = { '/project/src/a.ts': { s: {} } };
      const filePath = writeCoverageFile(dir, 'coverage.json', data);
      expect(parseCoverage(filePath, '')).toBeNull();
    });
  });

  describe('calculateDelta', () => {
    it('returns NEW when base is null', () => {
      const result = calculateDelta(null, 80, 1.0);
      expect(result).toEqual({ delta: null, indicator: 'NEW', passed: true });
    });

    it('returns positive delta when coverage increased', () => {
      const result = calculateDelta(80, 85, 1.0);
      expect(result.delta).toBe(5);
      expect(result.indicator).toBe('+');
      expect(result.passed).toBe(true);
    });

    it('returns warning when drop is within threshold', () => {
      const result = calculateDelta(80, 79.5, 1.0);
      expect(result.delta).toBe(-0.5);
      expect(result.indicator).toBe('~');
      expect(result.passed).toBe(true);
    });

    it('returns failure when drop exceeds threshold', () => {
      const result = calculateDelta(80, 78, 1.0);
      expect(result.delta).toBe(-2);
      expect(result.indicator).toBe('!');
      expect(result.passed).toBe(false);
    });

    it('returns positive for zero delta', () => {
      const result = calculateDelta(80, 80, 1.0);
      expect(result.delta).toBe(0);
      expect(result.indicator).toBe('+');
      expect(result.passed).toBe(true);
    });
  });

  describe('formatDelta', () => {
    it('formats NEW indicator', () => {
      expect(formatDelta({ delta: null, indicator: 'NEW' })).toBe('NEW');
    });

    it('formats positive delta', () => {
      expect(formatDelta({ delta: 5.0, indicator: '+' })).toBe('+5.0% +');
    });

    it('formats negative delta', () => {
      expect(formatDelta({ delta: -2.3, indicator: '!' })).toBe('-2.3% !');
    });

    it('formats zero delta', () => {
      expect(formatDelta({ delta: 0, indicator: '+' })).toBe('+0.0% +');
    });
  });

  describe('filterChangedFiles', () => {
    it('returns only files in the changed list', () => {
      const coverageFiles = {
        'src/a.ts': { percent: 80, covered: 4, total: 5 },
        'src/b.ts': { percent: 90, covered: 9, total: 10 },
        'src/c.ts': { percent: 100, covered: 3, total: 3 },
      };
      const result = filterChangedFiles(coverageFiles, ['src/a.ts', 'src/c.ts']);
      expect(Object.keys(result)).toEqual(['src/a.ts', 'src/c.ts']);
    });

    it('returns empty when no files match', () => {
      const coverageFiles = {
        'src/a.ts': { percent: 80, covered: 4, total: 5 },
      };
      const result = filterChangedFiles(coverageFiles, ['src/other.ts']);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('generateReport', () => {
    it('returns unavailable message when prData is null', () => {
      const report = generateReport(null, null, [], 1.0);
      expect(report).toContain('<!-- coverage-report-marker -->');
      expect(report).toContain('Coverage data unavailable');
    });

    it('generates summary with NEW indicator when no base', () => {
      const prData = {
        overall: 85.5,
        files: { 'src/a.ts': { percent: 85.5, covered: 17, total: 20 } },
      };
      const report = generateReport(null, prData, [], 1.0);
      expect(report).toContain('85.5%');
      expect(report).toContain('NEW');
      expect(report).not.toContain('<details>');
    });

    it('generates summary with delta when base exists', () => {
      const baseData = { overall: 80, files: {} };
      const prData = { overall: 85, files: {} };
      const report = generateReport(baseData, prData, [], 1.0);
      expect(report).toContain('85.0%');
      expect(report).toContain('+5.0%');
    });

    it('includes changed files section', () => {
      const baseData = {
        overall: 80,
        files: { 'src/a.ts': { percent: 70, covered: 7, total: 10 } },
      };
      const prData = {
        overall: 90,
        files: { 'src/a.ts': { percent: 90, covered: 9, total: 10 } },
      };
      const report = generateReport(baseData, prData, ['src/a.ts'], 1.0);
      expect(report).toContain('<details>');
      expect(report).toContain('`src/a.ts`');
      expect(report).toContain('90.0%');
      expect(report).toContain('+20.0%');
    });

    it('shows NEW for changed files not in base', () => {
      const prData = {
        overall: 100,
        files: { 'src/new.ts': { percent: 100, covered: 5, total: 5 } },
      };
      const report = generateReport(null, prData, ['src/new.ts'], 1.0);
      expect(report).toContain('`src/new.ts`');
      expect(report).toContain('NEW');
    });
  });

  describe('parseArgs', () => {
    it('parses all arguments', () => {
      const argv = [
        'node',
        'script.cjs',
        '--base',
        'base.json',
        '--pr',
        'pr.json',
        '--changed-files',
        'a.ts,b.ts',
        '--threshold',
        '2.5',
        '--output',
        'out.md',
        '--base-path',
        '/project',
      ];
      const args = parseArgs(argv);
      expect(args.base).toBe('base.json');
      expect(args.pr).toBe('pr.json');
      expect(args.changedFiles).toBe('a.ts,b.ts');
      expect(args.threshold).toBe(2.5);
      expect(args.output).toBe('out.md');
      expect(args.basePath).toBe('/project');
    });

    it('has sensible defaults', () => {
      const args = parseArgs(['node', 'script.cjs']);
      expect(args.base).toBeNull();
      expect(args.pr).toBeNull();
      expect(args.threshold).toBe(1.0);
      expect(args.basePath).toBe('');
    });
  });

  describe('CLI integration', () => {
    it('generates a report file from coverage-final.json', () => {
      const dir = createTempDir();
      const prCoverage = makeCoverageJson({
        '/project/src/a.ts': { '0': 1, '1': 1, '2': 1 },
      });
      const prPath = writeCoverageFile(dir, 'pr.json', prCoverage);
      const outputPath = path.join(dir, 'report.md');

      execFileSync(process.execPath, [
        scriptPath,
        '--pr',
        prPath,
        '--output',
        outputPath,
        '--base-path',
        '/project',
      ]);

      const report = fs.readFileSync(outputPath, 'utf8');
      expect(report).toContain('<!-- coverage-report-marker -->');
      expect(report).toContain('100.0%');
    });

    it('generates report with base comparison', () => {
      const dir = createTempDir();
      const baseCoverage = makeCoverageJson({
        'src/a.ts': { '0': 1, '1': 0 },
      });
      const prCoverage = makeCoverageJson({
        'src/a.ts': { '0': 1, '1': 1 },
      });
      const basePath = writeCoverageFile(dir, 'base.json', baseCoverage);
      const prPath = writeCoverageFile(dir, 'pr.json', prCoverage);
      const outputPath = path.join(dir, 'report.md');

      execFileSync(process.execPath, [
        scriptPath,
        '--base',
        basePath,
        '--pr',
        prPath,
        '--output',
        outputPath,
        '--changed-files',
        'src/a.ts',
      ]);

      const report = fs.readFileSync(outputPath, 'utf8');
      expect(report).toContain('+50.0%');
      expect(report).toContain('`src/a.ts`');
    });

    it('exits with error when required args are missing', () => {
      expect(() => execFileSync(process.execPath, [scriptPath], { stdio: 'pipe' })).toThrow();
    });

    it('exits with error when coverage drops beyond threshold', () => {
      const dir = createTempDir();
      const baseCoverage = makeCoverageJson({
        'src/a.ts': { '0': 1, '1': 1, '2': 1, '3': 1 },
      });
      const prCoverage = makeCoverageJson({
        'src/a.ts': { '0': 1, '1': 0, '2': 0, '3': 0 },
      });
      const basePath = writeCoverageFile(dir, 'base.json', baseCoverage);
      const prPath = writeCoverageFile(dir, 'pr.json', prCoverage);
      const outputPath = path.join(dir, 'report.md');

      expect(() =>
        execFileSync(
          process.execPath,
          [
            scriptPath,
            '--base',
            basePath,
            '--pr',
            prPath,
            '--output',
            outputPath,
            '--threshold',
            '1.0',
          ],
          { stdio: 'pipe' },
        ),
      ).toThrow();
    });

    it('handles empty coverage gracefully', () => {
      const dir = createTempDir();
      const prPath = writeCoverageFile(dir, 'pr.json', {});
      const outputPath = path.join(dir, 'report.md');

      execFileSync(process.execPath, [scriptPath, '--pr', prPath, '--output', outputPath]);

      const report = fs.readFileSync(outputPath, 'utf8');
      expect(report).toContain('Coverage data unavailable');
    });
  });
});
