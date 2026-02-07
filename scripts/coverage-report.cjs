const fs = require('fs');
const path = require('path');

/**
 * Parse V8/Istanbul coverage-final.json output.
 * Returns object with 'overall' percentage and 'files' dict, or null.
 */
const parseCoverage = (coveragePath, basePath) => {
  if (!fs.existsSync(coveragePath)) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return null;
  }

  const files = {};
  let totalStatements = 0;
  let coveredStatements = 0;

  for (const [filepath, fileData] of Object.entries(data)) {
    const statements = fileData.s || {};
    const numStatements = Object.keys(statements).length;
    const numCovered = Object.values(statements).filter((v) => v > 0).length;

    let relPath = filepath;
    if (basePath) {
      const normalizedBase = basePath.replace(/\/+$/, '');
      if (filepath.startsWith(normalizedBase + '/')) {
        relPath = filepath.slice(normalizedBase.length + 1);
      }
    }

    if (numStatements > 0) {
      files[relPath] = {
        percent: (numCovered / numStatements) * 100,
        covered: numCovered,
        total: numStatements,
      };
      totalStatements += numStatements;
      coveredStatements += numCovered;
    }
  }

  if (totalStatements === 0) {
    return null;
  }

  return {
    overall: (coveredStatements / totalStatements) * 100,
    files,
  };
};

/**
 * Calculate coverage delta and determine pass/fail status.
 */
const calculateDelta = (basePct, prPct, threshold) => {
  if (basePct == null) {
    return { delta: null, indicator: 'NEW', passed: true };
  }

  const delta = prPct - basePct;

  if (delta >= 0) {
    return { delta, indicator: '+', passed: true };
  }
  if (delta >= -threshold) {
    return { delta, indicator: '~', passed: true };
  }
  return { delta, indicator: '!', passed: false };
};

/**
 * Format delta for display in markdown table.
 */
const formatDelta = (deltaInfo) => {
  if (deltaInfo.delta == null) {
    return deltaInfo.indicator;
  }
  const sign = deltaInfo.delta >= 0 ? '+' : '';
  return `${sign}${deltaInfo.delta.toFixed(1)}% ${deltaInfo.indicator}`;
};

/**
 * Filter coverage data to only include changed files.
 */
const filterChangedFiles = (coverageFiles, changedFiles) => {
  const changedSet = new Set(changedFiles);
  const result = {};
  for (const [filepath, data] of Object.entries(coverageFiles)) {
    if (changedSet.has(filepath)) {
      result[filepath] = data;
    }
  }
  return result;
};

/**
 * Generate markdown coverage report for PR comment.
 */
const generateReport = (baseData, prData, changedFiles, threshold) => {
  if (!prData) {
    return [
      '<!-- coverage-report-marker -->',
      '## Coverage Report',
      '',
      'Coverage data unavailable.',
      '',
      'No coverage artifacts were found for this PR. This can happen when:',
      '- The test workflows have not completed yet',
      '- The coverage artifacts failed to upload',
      '- This is the first run on a new branch',
      '',
      'Coverage will be reported once test workflows complete successfully.',
      '',
    ].join('\n');
  }

  const lines = [
    '<!-- coverage-report-marker -->',
    '## Coverage Report',
    '',
    '### Summary',
    '| Metric | Coverage | Change |',
    '|--------|----------|--------|',
  ];

  const prDelta = calculateDelta(baseData ? baseData.overall : null, prData.overall, threshold);
  lines.push(`| **Overall** | ${prData.overall.toFixed(1)}% | ${formatDelta(prDelta)} |`);

  // Changed files section
  let prChanged = {};
  if (changedFiles.length > 0) {
    prChanged = filterChangedFiles(prData.files || {}, changedFiles);
  }

  if (Object.keys(prChanged).length > 0) {
    lines.push('', '<details>', '<summary>Changed Files</summary>', '');
    lines.push('| File | Coverage | Change |');
    lines.push('|------|----------|--------|');

    for (const filepath of Object.keys(prChanged).sort()) {
      const data = prChanged[filepath];
      let basePct = null;
      if (baseData?.files?.[filepath]) {
        basePct = baseData.files[filepath].percent;
      }
      const delta = calculateDelta(basePct, data.percent, threshold);
      lines.push(`| \`${filepath}\` | ${data.percent.toFixed(1)}% | ${formatDelta(delta)} |`);
    }

    lines.push('', '</details>');
  }

  lines.push('');
  return lines.join('\n');
};

/**
 * Parse CLI arguments.
 */
const parseArgs = (argv) => {
  const args = {
    base: null,
    pr: null,
    changedFiles: '',
    threshold: 1.0,
    output: null,
    basePath: '',
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--base':
        args.base = argv[++i];
        break;
      case '--pr':
        args.pr = argv[++i];
        break;
      case '--changed-files':
        args.changedFiles = argv[++i];
        break;
      case '--threshold':
        args.threshold = parseFloat(argv[++i]);
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--base-path':
        args.basePath = argv[++i];
        break;
    }
  }
  return args;
};

// CLI entry point
if (require.main === module) {
  const args = parseArgs(process.argv);

  if (!args.pr || !args.output) {
    console.error(
      'Usage: coverage-report.cjs --pr <file> --output <file> [--base <file>] [--changed-files <csv>] [--threshold <num>] [--base-path <path>]',
    );
    process.exitCode = 1;
  } else {
    const baseData = args.base ? parseCoverage(path.resolve(args.base), args.basePath) : null;
    const prData = parseCoverage(path.resolve(args.pr), args.basePath);

    const changedFiles = args.changedFiles
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    const report = generateReport(baseData, prData, changedFiles, args.threshold);

    fs.writeFileSync(args.output, report, 'utf8');
    console.log(`Coverage report written to ${args.output}`);

    if (prData && baseData) {
      const delta = calculateDelta(baseData.overall, prData.overall, args.threshold);
      if (!delta.passed) {
        console.error(
          `Coverage dropped by ${Math.abs(delta.delta).toFixed(1)}% (threshold: ${args.threshold}%)`,
        );
        process.exitCode = 1;
      }
    }
  }
}

// Export for testing
module.exports = {
  parseCoverage,
  calculateDelta,
  formatDelta,
  filterChangedFiles,
  generateReport,
  parseArgs,
};
