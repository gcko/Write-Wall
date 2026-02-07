const fs = require('fs');
const path = require('path');

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const root = process.env.VERIFY_VERSION_ROOT
  ? path.resolve(process.env.VERIFY_VERSION_ROOT)
  : path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'public', 'manifest.json');

try {
  const packageJson = readJson(packagePath);
  const manifestJson = readJson(manifestPath);

  const packageVersion = packageJson?.version;
  const manifestVersion = manifestJson?.version;

  if (!packageVersion || !manifestVersion) {
    const missing = [];
    if (!packageVersion) {
      missing.push('package.json version');
    }
    if (!manifestVersion) {
      missing.push('public/manifest.json version');
    }
    console.error(`Version check failed: missing ${missing.join(' and ')}.`);
    process.exitCode = 1;
  } else if (packageVersion !== manifestVersion) {
    console.error('Version mismatch detected.');
    console.error(`package.json version: ${packageVersion}`);
    console.error(`public/manifest.json version: ${manifestVersion}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('Version check failed to read version fields.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
