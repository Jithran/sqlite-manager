# SQLite Manager

A browser-based SQLite editor that runs entirely client-side. No server, no uploads — your database files never leave your machine.

## Features

- **Open & save** `.db`, `.sqlite`, and `.sqlite3` files via the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- **SQL editor** with `Ctrl+Enter` to run and `Tab` for indentation
- **Results table** powered by [TanStack Table](https://tanstack.com/table) with clickable column sorting
- **Table sidebar** — click any table to instantly browse it
- **CSV export** of query results
- **New in-memory database** — start from scratch without opening a file
- `Ctrl+S` to save, falls back to Save As when no file is open

## Tech stack

| Tool | Purpose |
|---|---|
| [Vite](https://vitejs.dev) | Build tool & dev server |
| [TypeScript](https://www.typescriptlang.org) | Language |
| [@sqlite.org/sqlite-wasm](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm) | SQLite compiled to WebAssembly |
| [@tanstack/table-core](https://tanstack.com/table/v8/docs/introduction) | Headless table (vanilla DOM) |

## Getting started

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Note:** The dev server sets the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers automatically. These are needed for SQLite WASM to function correctly.

## Available scripts

```bash
npm run dev      # Start dev server (localhost:5173)
npm run build    # Type-check + production build → dist/
npm run preview  # Serve the production build locally
```

## Browser support

Requires a browser with [File System Access API](https://caniuse.com/native-filesystem-api) support. Chromium-based browsers (Chrome 86+, Edge 86+) are fully supported. Firefox and Safari have limited or no support for the save/open file picker.

## How it works

SQLite databases are loaded into memory using `sqlite3_deserialize` and exported back to bytes using `sqlite3_js_db_export`. The File System Access API handles reading and writing the actual `.db` file on disk — no data is ever sent to a server.
