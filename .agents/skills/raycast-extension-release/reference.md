# Raycast Store release reference

Verified live against `developers.raycast.com`, `manual.raycast.com`, the `raycast/extensions` CI scripts, and `@raycast/api` 1.104.25 in September 2026. Where the docs and the CI scripts disagree, the scripts are what actually runs.

## Where the rules actually live

| Source | What it settles |
| --- | --- |
| `developers.raycast.com/basics/prepare-an-extension-for-store.md` | Naming, metadata, icon and screenshot specs, review expectations |
| `developers.raycast.com/information/manifest.md` | Required and optional manifest fields, category list |
| `developers.raycast.com/information/versioning.md` | No-semver model, changelog heading format |
| `developers.raycast.com/information/developer-tools/cli.md` | `ray` commands and flags |
| `manual.raycast.com/extensions-guidelines` | Rejection reasons |
| `raycast/extensions` → `scripts/check_metadata_images.py` | Screenshot size, count, format, background and appearance consistency |
| `raycast/extensions` → `scripts/check_raycast_images.py` | Screenshot padding geometry |
| `raycast/github-actions` → `changelog-enforcer/index.js` | Changelog presence and filename case |

Every docs page is available as Markdown by appending `.md`, and as a cited Q&A by appending `?ask=<question>`.

## Manifest

Required: `name`, `title`, `description`, `icon`, `author`, `platforms`, `categories`, `commands`. There is deliberately **no** `version` field.

- `author` — your Raycast Store handle as a bare string, not npm's `{name, email}` object. The publish flow locates your already-published extension with a GitHub code search on `"name"` + `"author"`, so changing it makes the CLI treat the extension as new.
- `license` — must be `MIT`.
- `platforms` — array of `"macOS"` and/or `"Windows"`. Declaring exactly one platform is what makes the screenshot background/appearance consistency check apply; declaring two exempts you from it.
- `categories` — case-sensitive Title Case, at least one, from exactly: Applications, Communication, Data, Documentation, Design Tools, Developer Tools, Finance, Fun, Media, News, Productivity, Security, System, Web, Other.

Naming follows the Apple Style Guide's Title Case. Extension titles prefer nouns and must be specific (`Emoji Search`, not `Converter`). Command titles are `<verb> <noun>` or `<noun>`, with no articles (`Create Issue`, not `Create an Issue`). Some words are restricted in extension names — "Assistant" is the published example; the full list is not public.

## Icon and screenshots

| | Spec |
| --- | --- |
| Icon | 512 × 512 PNG in `assets/`, works on light and dark. Optional dark variant via an `@dark` filename suffix. Raycast's default icon is an automatic rejection. |
| Screenshots | Exactly 2000 × 1250 PNG in `metadata/`. Max 6, at least 3 recommended. |

Enforced numerically by CI, documented nowhere:

| Constant | Value |
| --- | --- |
| `EXPECTED_SIZE` | `(2000, 1250)` |
| `MAX_SCREENSHOTS` | `6` |
| `STORE_EXT` | `.png` — a JPEG in `metadata/` is detected, then rejected |
| `EXPECTED_PAD` | `0.125` per side |
| `PAD_TOLERANCE` | `0.045` → 8%–17% allowed |
| `MAX_ASYMMETRY` | `0.04` left/right and top/bottom |
| `BACKGROUND_RMS_LIMIT` | `12.0` against the *first* image, fingerprinted at 100×62 with the interior masked |
| light/dark threshold | median window luminance ≥ `130` |

CI also fails if it cannot detect the Raycast window in the image (flat or low-contrast captures), and if a dev-mode extension icon is visible in the bottom bar — it scans the bottom 12%–1% band across 8%–58% of the window width for a green connected blob.

Raycast's built-in Window Capture produces conforming geometry; hand-cropped screenshots usually do not.

## Changelog

- Filename must be exactly `CHANGELOG.md`. A case mismatch is its own distinct CI failure, and the Versioning docs page contradicts this by writing "changelog.md" — follow the CI.
- The file must be **modified in the PR**, not merely exist. The Changelog Enforcer runs on every PR touching `extensions/<name>/**`, including ones with no user-visible change. There is an undocumented `skip-changelog` label bypass.
- `{PR_MERGE_DATE}` is substituted by `sed -i "" "s/{PR_MERGE_DATE}/$(date '+%Y-%m-%d')/g"` in the merge workflow. The `/g` means every occurrence in the file becomes the same date. The string appears nowhere in `@raycast/api`, so it ships literally if you publish to a private or organization store.
- A literal `YYYY-MM-DD` is an accepted alternative, but `{PR_MERGE_DATE}` is preferred because review can take days.
- Ordering is never applied by Raycast; the store renders file order verbatim, out-of-order entries included.
- Convention is an `# <Extension Title> Changelog` h1 first line. It is not parsed and a file without it still works.
- `### Added` / `### Fixed` subsections **are** allowed — they are ordinary body content under the `## ` entry. The splitter keys on `## ` only.
- `ray lint` validates nothing about the changelog. Neither does any other local tool. A deliberately mangled entry exits 0.

## CLI

| Command | Notes |
| --- | --- |
| `npm run publish` → `npx @raycast/api@latest publish` | Opens the PR as a **draft** with `maintainer_can_modify: true`, and never marks it ready. Rejected under `--non-interactive` for public-store extensions. |
| `ray build` | Defaults to `-e dev`. The store wants `-e dist`; the official template ships `"build": "ray build -e dist"`. |
| `ray lint [-f] [-r]` | Validates the manifest, icons, and metadata as well as running ESLint and Prettier. `-r/--relaxed` turns off the manifest/icon/metadata validation. |
| `npx @raycast/api@latest pull-contributions` | Required after anyone pushes to the PR branch, including Raycast's own merge job. |
| `ray migrate` | Wraps `@raycast/migration` to move to a newer API version. |
| `ray evals`, `ray validate` | Undocumented on the CLI page. `ray evals` runs AI evals declared in `package.json` — unrelated to any promptfoo harness. |

`-e` is `--environment` on `build` and `--extension` on `evals`. `--exit-on-error` has no short form.

## What `publish` actually ships

`copy-dir.js` recursively copies the extension directory, excluding only these eight names at any depth:

```
.git  .github  node_modules  raycast-env.d.ts
.raycast-swift-build  .swiftpm  compiled_raycast_swift  compiled_raycast_rust
```

It never reads `.gitignore`. Ignored files are copied into the monorepo checkout and then left unstaged only because your `.gitignore` travels with them — so removing an entry from `.gitignore` is enough to commit a secret to a public PR.

The directory branch is `lstat(path).isDirectory()`, which is false for every symlink. A symlink to a file therefore reaches `copyFileSync` and is copied as a regular file (this is why a `CLAUDE.md -> AGENTS.md` symlink publishes as a normal 194-line file); a symlink to a directory reaches the same call and throws.

## Merge-time behavior

The merge job commits back to your fork branch: the changelog date substitution, a `platforms` field if missing, and losslessly recompressed images. This is why "Allow edits from maintainers" is a hard CI gate checked by two separate workflows, and why `pull-contributions` is so often needed without any human having touched the PR.

Store CI provisions Node 22.22.2 / npm 10.9.7 on macOS with a pinned Ray CLI action. Use npm and commit `package-lock.json`.

## Review rejection reasons

Keychain access, external analytics, non-US-English or custom localization, configuration through a command instead of the preferences API, replacing view content instead of pushing a screen via the Navigation API, duplicating a native Raycast feature or an existing extension, bundling opaque binaries, and violating a third-party service's terms. Collected user data may only be used to connect to the service.

Contribute to an existing extension rather than forking a near-duplicate, and contact the author before investing in a significant change.
