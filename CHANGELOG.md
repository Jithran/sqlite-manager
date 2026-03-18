# Changelog

All notable changes to SQLite Manager are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.2.0] – Row editing, change history & SQL export – 2026-03-18

### Added
- **Row editing**: double-click any cell in a table view to edit it inline; press Enter to save or Escape to cancel. NULL values show an empty input with a NULL placeholder; typing `NULL` saves a SQL NULL. BLOB cells are read-only.
- **Add row**: click "+ Add Row" in the results toolbar to append a blank editable row; Tab through fields, Enter (or ✓) to insert, Escape (or ✕) to cancel. The INSERT only runs on confirmation, preventing premature constraint errors.
- **Delete rows**: click the selection column (leftmost) to select rows — Click for single, Shift+click for range, Ctrl+click to toggle individual rows — then press Delete or click "Delete N rows" to remove them with a confirmation prompt.
- **Releases page**: click "Releases" in the footer to view the full version history parsed from `CHANGELOG.md`; versions are shown as collapsible sections.
- **Change history**: every cell edit, row insert, and row delete is recorded in an in-session change log. Click "History (N)" in the toolbar to review changes and undo any entry individually. Ctrl+Z undoes the most recent change.
- **Export SQL**: click "Export SQL" in the toolbar to save the current database as a portable `.sql` dump — includes all `CREATE` statements and `INSERT` rows, wrapped in a transaction.

### Changed
- **Row selection column**: replaced the per-row × delete button (far right) with a narrow selection column on the left, keeping it accessible regardless of how many columns a table has.

### Fixed
- **Add row constraint errors**: "+ Add Row" no longer immediately fires `INSERT … DEFAULT VALUES` (which failed on NOT NULL columns without defaults); it now shows a pending row the user fills in before any SQL is executed.
- **MySQL import: CHECK constraint errors**: `CHECK (json_valid(...))` and other CHECK constraints are now stripped during MySQL→SQLite conversion — MySQL historically does not enforce CHECK constraints and dump data may not comply.
- **MySQL import: nested transaction error**: a `ROLLBACK` is issued before running an import script, clearing any transaction left open by a previous failed import.

---

## [0.1.0] – Initial release – 2026-03-02

### Added
- **SQL editor**: write and execute SQL queries with Ctrl+Enter shortcut and Tab indentation.
- **Results table**: query results rendered with TanStack Table, including click-to-sort columns.
- **Sidebar**: table list auto-populated from the open database; click a table to preview it.
- **New / Open / Save / Save As**: full file lifecycle via the File System Access API.
- **CSV export**: export the current result set as a CSV file.
- **Import SQL**: load and execute a `.sql` script via the toolbar.
- **Drag-and-drop**: drag `.db`, `.sqlite`, or `.sql` files onto the app to open or import them; a full-screen overlay appears while dragging.
- **MySQL/MariaDB compatibility**: automatically converts mysqldump / phpMyAdmin output to SQLite-compatible SQL — handles `START TRANSACTION`, `SET` statements, conditional comments (`/*!...*/`), `LOCK/UNLOCK TABLES`, backtick identifiers, `AUTO_INCREMENT`, `UNSIGNED`, MySQL-specific types, `ENUM`, `KEY`/`UNIQUE KEY` inside `CREATE TABLE`, table options (`ENGINE=`, `CHARSET=`), `current_timestamp()`, and multi-operation `ALTER TABLE` statements (ADD PRIMARY KEY, ADD UNIQUE KEY → `CREATE UNIQUE INDEX`, MODIFY, FOREIGN KEY).

---
