const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const rootPackagePath = path.join(rootDir, 'package.json');
const npmPackagePath = path.join(rootDir, 'packages', 'npm', 'package.json');

if (!fs.existsSync(npmPackagePath)) {
  console.error('Missing packages/npm/package.json.');
  process.exit(1);
}

const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const npmPackage = JSON.parse(fs.readFileSync(npmPackagePath, 'utf8'));

npmPackage.version = rootPackage.version;

fs.writeFileSync(npmPackagePath, JSON.stringify(npmPackage, null, 2) + '\n');
console.log(`Synced npm package version to ${rootPackage.version}`);
