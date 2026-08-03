/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License. To view
 * a copy of this license, visit https://creativecommons.org/licenses/by-sa/4.0/
 */
const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/set-version.cjs <MAJOR.MINOR.PATCH>');
  process.exit(1);
}

const root = process.env.VERIFY_VERSION_ROOT
  ? path.resolve(process.env.VERIFY_VERSION_ROOT)
  : path.resolve(__dirname, '..');

let changed = false;

for (const rel of ['package.json', path.join('public', 'manifest.json')]) {
  const filePath = path.join(root, rel);
  const raw = fs.readFileSync(filePath, 'utf8');
  const current = JSON.parse(raw).version;
  if (current === version) {
    continue;
  }
  // Replace only the version value so the rest of the file keeps its exact
  // formatting (JSON.stringify would reflow inline arrays like "permissions").
  const updated = raw.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);
  if (JSON.parse(updated).version !== version) {
    console.error(`${rel}: could not rewrite the version field.`);
    process.exit(1);
  }
  console.log(`${rel}: ${current} -> ${version}`);
  fs.writeFileSync(filePath, updated);
  changed = true;
}

console.log(changed ? 'versions-updated' : 'versions-unchanged');
