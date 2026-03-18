# SQLite Manager – Development Standards

These rules apply to every change made to this project.

---

## 0. Git & GitHub

- **Language**: all git commits and GitHub communication (issue comments, PR descriptions, release notes) must be in **English**.
- **Commit style**: follow the existing `-type: short description` format. Examples: `-add: ...`, `-fix: ...`, `-mod: ...`, `-chore: ...`. Never deviate from this style (no Conventional Commits format, no capital first letter, no period at the end).
- **No co-authorship**: do not add `Co-Authored-By` or any AI attribution to commits.
- **Closing issues**: when closing a GitHub issue, always add a closing comment with the following structure:
  1. `Implemented in commit <hash>.` (first line)
  2. `## What was done` — a description of what was implemented; include any information useful to end users (behaviour details, limitations, configuration if any).
  3. `## Release` — state which release the change is included in, with a link to the release tag and to `CHANGELOG.md`. If no release has been made yet, write "Changes are included in the upcoming release."

---

## 1. Language

- All UI text must be in **English**: labels, button text, placeholder text, confirmation dialogs, empty states, error messages — everything visible to the user.
- Variable names, comments, and code stay in English.
- This rule applies even when the user gives instructions in Dutch — always write UI text in English.

---

## 2. Changelog

**REQUIRED after every change — no exceptions, no need to ask.**

- `CHANGELOG.md` in the repository root is the single source of truth, read by CI/CD at release time.
- Update `CHANGELOG.md` as the **last step of every task**, before considering the task done.
- New entries always go under the `## [Unreleased]` section at the top.
- Use the appropriate subsection: `### Added` for new features, `### Changed` for behaviour changes, `### Fixed` for bug fixes, `### Removed` for removed functionality.
- Each subsection heading (`### Added`, `### Fixed`, etc.) must appear **at most once** in the `[Unreleased]` block. Always append to an existing subsection rather than creating a duplicate heading.
- Write entries in English, concise and user-facing (describe what changed, not how).
- Do not create a new versioned section — that happens at release time via CI/CD.

---

## 3. Releases

When asked to create a new release, follow these steps exactly — no additional confirmation needed:

1. **Determine the next version** from the last versioned section in `CHANGELOG.md` (e.g. `0.1.0` → `0.2.0` for features, `0.1.0` → `0.1.1` for fixes only).
2. **Update `CHANGELOG.md`**: replace the `## [Unreleased]` block with a new versioned section `## [X.Y.Z] – Short description – YYYY-MM-DD`, then leave an empty `## [Unreleased]` block above it for future entries.
3. **Commit**: `-chore: release vX.Y.Z`
4. **Tag and push**: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. **Do not create the GitHub Release manually** — GitHub Actions picks up the tag and creates the release automatically, builds the Docker image (`ghcr.io/jithran/sqlite-manager`), and updates the manifest in terraform-playground. No release body text is needed.

---

## 4. Architecture

- **100% client-side** — no backend, no server-side code. All SQLite operations run in the browser via `@sqlite.org/sqlite-wasm`.
- **No framework** — vanilla TypeScript only.
- Source layout:
  - `src/db/sqlite.ts` — SQLite WASM wrapper (file I/O, query execution)
  - `src/db/mysql-compat.ts` — MySQL/MariaDB dump converter
  - `src/ui/app.ts` — all UI logic and event wiring
  - `src/style.css` — all styles (use existing CSS variables)

---

## 5. README

- After **adding a new feature**: add it to the Features section in `README.md` with a short description.
- After **removing a feature**: remove it from the Features section.
- After **significantly changing how something works**: update its description if it no longer reflects reality.
- Do not document internal implementation details — `README.md` is for users, not contributors.

---

## 6. CSS

Use the existing CSS variables defined in `:root` (`--bg-0` through `--bg-3`, `--text-0` through `--text-2`, `--accent`, `--danger`, `--success`, `--border`, `--radius`, `--font-mono`, `--font-ui`). Do not hardcode colours.

---

## 7. SQLite WASM requirements

The app requires `SharedArrayBuffer`, which needs cross-origin isolation headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These are set in `vite.config.ts` for dev/preview and in `nginx.conf` for production.
