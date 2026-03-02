# Changelog

All notable changes to SQLite Manager are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
