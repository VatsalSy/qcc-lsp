const { execSync } = require('child_process');

const bump = process.argv[2];
const allowed = new Set(['patch', 'minor', 'major']);

if (!allowed.has(bump)) {
  console.error('Usage: node scripts/bump-version.js <patch|minor|major>');
  process.exit(1);
}

execSync(`npm version ${bump} --no-git-tag-version`, { stdio: 'inherit' });
execSync('node scripts/sync-npm-version.js', { stdio: 'inherit' });
