const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const npmDir = path.join(rootDir, 'packages', 'npm');

const copies = [
  { src: 'client/out', dest: 'client/out' },
  { src: 'server/out', dest: 'server/out' },
  { src: 'bin/qcc-lsp', dest: 'bin/qcc-lsp' },
  { src: 'snippets', dest: 'snippets' },
  { src: 'syntaxes', dest: 'syntaxes' },
  { src: 'language-configuration.json', dest: 'language-configuration.json' },
  { src: 'README.md', dest: 'README.md' },
  { src: 'LICENSE', dest: 'LICENSE' }
];

async function copyEntry(entry) {
  const srcPath = path.join(rootDir, entry.src);
  const destPath = path.join(npmDir, entry.dest);

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Missing ${entry.src}. Run npm run compile before publishing.`);
  }

  await fsp.rm(destPath, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.cp(srcPath, destPath, { recursive: true });
}

async function main() {
  if (!fs.existsSync(npmDir)) {
    throw new Error('Missing packages/npm directory.');
  }

  for (const entry of copies) {
    await copyEntry(entry);
  }

  console.log('Prepared packages/npm for publishing.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
