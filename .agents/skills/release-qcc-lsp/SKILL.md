---
name: release-qcc-lsp
description: Create versioned releases with proper tagging and automation for qcc-lsp. Use when asked to "release", "cut a release", "bump version", "create tag", "publish", or when preparing a new version.
---

# Release Workflow (Local, after merge, before tag)

`package.json` version is the single source of truth for VS Code and Open VSX. The GitHub Packages npm package (`packages/npm/package.json`) must match the same version. Tags must be `vMAJOR.MINOR.PATCH`.

This workflow is run after all changes are merged to `main` and before creating a new tag. It bumps versions locally, builds the VSIX, commits release artifacts, tags, and pushes so GitHub Actions can publish.

## Pre-flight Checks

```bash
git branch --show-current  # Must be "main"
git status --porcelain     # Must be empty
git fetch origin main && git diff HEAD origin/main --quiet
```

## Analyze Changes Since Last Tag

```bash
git describe --tags --abbrev=0
git log $(git describe --tags --abbrev=0)..HEAD --oneline
node -p "require('./package.json').version"
```

## Decide Bump and Tag

| Change Type | Bump | Example |
| --- | --- | --- |
| Breaking changes | `major` | 0.5.4 → 1.0.0 |
| New features | `minor` | 0.5.4 → 0.6.0 |
| Fixes/docs/refactors | `patch` | 0.5.4 → 0.5.5 |

Compute the next version and tag name once the bump type is chosen:

```bash
BUMP=<patch|minor|major>
CURRENT=$(node -p "require('./package.json').version")
NEXT=$(node -e "const v=process.argv[1].split('.').map(Number); const bump=process.argv[2]; if (v.length!==3) process.exit(1); let [maj,min,pat]=v; if (bump==='major') { maj+=1; min=0; pat=0; } else if (bump==='minor') { min+=1; pat=0; } else { pat+=1; } console.log([maj,min,pat].join('.'));" "$CURRENT" "$BUMP")
TAG="v$NEXT"
```

## Bump Versions Locally

Preferred (updates root + `packages/npm` + lockfile):

```bash
node scripts/bump-version.js "$BUMP"
```

Verify versions match the planned tag:

```bash
node -p "require('./package.json').version"
node -p "require('./packages/npm/package.json').version"
```

If you use `npm version` instead, ensure `package.json`, `packages/npm/package.json`, and `package-lock.json` all match `NEXT`.

## Build and Validate

```bash
npm run lint
npm run test
npm run compile
npx @vscode/vsce package
```

## Update VSIX Alias

```bash
VERSION=$(node -p "require('./package.json').version")
VSIX="basilisk-lsp-$VERSION.vsix"
test -f "$VSIX"
rm -f basilisk-lsp.vsix
cp "$VSIX" basilisk-lsp.vsix
test -f basilisk-lsp.vsix
```

Ensure the versioned VSIX exists before copying, and confirm the new `basilisk-lsp.vsix` was created.

## Commit, Tag, Push

```bash
git add package.json package-lock.json packages/npm/package.json "$VSIX" basilisk-lsp.vsix
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"
git push --follow-tags
```

## Automation Checks (before or after push)

Confirm GitHub Actions are set up to publish on tag push:

- `.github/workflows/publish-extension.yml` triggers on tags `v*.*.*` and creates the GitHub Release asset.
- Required secrets: `GH_PUBLISH` (GitHub release), `VS_MARKETPLACE_TOKEN`, `OPEN_VSX_TOKEN`.
- GitHub Packages uses `GITHUB_TOKEN` with `packages: write`.

The tag push should trigger publishing to GitHub Releases, GitHub Packages, VS Marketplace, and Open VSX.

## Post-release Verification

Check GitHub Actions for a successful `Publish Extension` run and confirm:

- GitHub release created with `basilisk-lsp-$VERSION.vsix` asset.
- GitHub Packages shows the new npm version.
- VS Marketplace and Open VSX list the new extension version.

## Rollback (if needed)

If a tag needs to be removed, delete it locally and remotely, then create a revert commit.

```bash
git tag -d vX.Y.Z
git push origin --delete vX.Y.Z
git revert <release-commit-sha>
git push
```
