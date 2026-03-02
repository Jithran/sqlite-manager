# SQLite Manager – Development Standards

These rules apply to every change made to this project.

---

## 0. Git & GitHub

- **Language**: all git commits and GitHub communication must be in **English**.
- **Commit style**: follow the existing `-type: short description` format. Examples: `-add: ...`, `-fix: ...`, `-mod: ...`, `-chore: ...`. No Conventional Commits format, no capital first letter, no period at the end.
- **No co-authorship**: do not add `Co-Authored-By` or any AI attribution to commits.

---

## 1. Changelog

**REQUIRED after every change — no exceptions, no need to ask.**

- `CHANGELOG.md` in the repository root is the single source of truth, read by CI/CD at release time.
- Update `CHANGELOG.md` as the **last step of every task**, before considering the task done.
- New entries always go under the `## [Unreleased]` section at the top.
- Use the appropriate subsection: `### Added` for new features, `### Changed` for behaviour changes, `### Fixed` for bug fixes, `### Removed` for removed functionality.
- Write entries in English, concise and user-facing (describe what changed, not how).
- Do not create a new versioned section — that happens at release time via CI/CD.

---

## 2. Releases

1. Update `CHANGELOG.md`: move `[Unreleased]` entries under a new `## [X.Y.Z] – Description – YYYY-MM-DD` section.
2. Commit: `-chore: release vX.Y.Z`
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
4. GitHub Actions automatically creates the GitHub Release, builds the Docker image (`ghcr.io/jithran/sqlite-manager`), and updates the manifest in terraform-playground.

---

## 3. Architecture

- **100% client-side** — no backend, no server-side code. All SQLite operations run in the browser via `@sqlite.org/sqlite-wasm`.
- **No framework** — vanilla TypeScript only.
- Source layout:
  - `src/db/sqlite.ts` — SQLite WASM wrapper (file I/O, query execution)
  - `src/db/mysql-compat.ts` — MySQL/MariaDB dump converter
  - `src/ui/app.ts` — all UI logic and event wiring
  - `src/style.css` — all styles (use existing CSS variables)

---

## 4. CSS

Use the existing CSS variables defined in `:root` (`--bg-0` through `--bg-3`, `--text-0` through `--text-2`, `--accent`, `--danger`, `--success`, `--border`, `--radius`, `--font-mono`, `--font-ui`). Do not hardcode colours.

---

## 5. SQLite WASM requirements

The app requires `SharedArrayBuffer`, which needs cross-origin isolation headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These are set in `vite.config.ts` for dev/preview and in `nginx.conf` for production.
