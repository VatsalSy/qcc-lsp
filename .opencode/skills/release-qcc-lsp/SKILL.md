---
name: release-qcc-lsp
description: Create versioned releases with proper tagging and automation for qcc-lsp. Use when asked to "release", "cut a release", "bump version", "create tag", "publish", or when preparing a new version.
---

# Release Workflow

`package.json` version is the single source of truth for VS Code and Open VSX. The GitHub Packages npm package (`packages/npm/package.json`) must match the same version. Tags must be `vMAJOR.MINOR.PATCH`.

## Automated Release (Preferred)

1. Run the GitHub workflow `Release QCC LSP` with `bump=patch|minor|major`.
2. This creates the commit + tag.
3. The `Publish Extension` workflow runs on the tag and publishes to VS Marketplace, Open VSX, and npm.

Required secrets: `VS_MARKETPLACE_TOKEN`, `OPEN_VSX_TOKEN`. GitHub Packages uses the built-in `GITHUB_TOKEN` with `packages: write`.

## Manual Release (Fallback)

### Pre-flight Checks

```bash
git branch --show-current  # Must be "main"
git status --porcelain     # Must be empty
git fetch origin main && git diff HEAD origin/main --quiet
```

### Analyze Changes

```bash
git describe --tags --abbrev=0
git log $(git describe --tags --abbrev=0)..HEAD --oneline
node -p "require('./package.json').version"
```

### Version Bump Decision

| Change Type | Bump | Example |
|-------------|------|---------|
| Breaking changes | `major` | 0.1.1 → 1.0.0 |
| New features | `minor` | 0.1.1 → 0.2.0 |
| Fixes/docs/refactors | `patch` | 0.1.1 → 0.1.2 |

### Pre-release Validation

```bash
npm run lint && npm test && npm run compile
```

### Execute Release

```bash
node scripts/bump-version.js <patch|minor|major>
VERSION=$(node -p "require('./package.json').version")
git add package.json package-lock.json packages/npm/package.json
git commit -m "Release v$VERSION"
git tag "v$VERSION"
git push --follow-tags
```

## Post-release Verification

```bash
git ls-remote --tags origin | tail -3
echo "package.json: $(node -p \"require('./package.json').version\")"
echo "Latest tag: $(git describe --tags --abbrev=0)"
```

## Rollback (if needed)

If a tag needs to be removed, delete it locally and remotely, then create a revert commit.

```bash
git tag -d vX.Y.Z
git push origin --delete vX.Y.Z
git revert <release-commit-sha>
git push
```
