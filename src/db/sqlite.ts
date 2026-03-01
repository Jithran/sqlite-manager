/**
 * SQLite WASM wrapper.
 *
 * Uses the official @sqlite.org/sqlite-wasm package with the OO1 (Object-Oriented)
 * API for convenience.  Databases are held in-memory; serialise/deserialise is
 * used to import/export real .db files via the File System Access API.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — the package ships its own types that don't always align perfectly
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// ── Types ────────────────────────────────────────────────────────────────────

// Minimal typings that cover what we actually use from the OO1 API
interface Sqlite3Capi {
  sqlite3_deserialize(
    db: number,
    schema: string,
    data: number,
    dbSize: number,
    bufSize: number,
    flags: number,
  ): number;
  sqlite3_js_db_export(db: number): Uint8Array;
  SQLITE_DESERIALIZE_FREEONCLOSE: number;
  SQLITE_DESERIALIZE_RESIZEABLE: number;
}

interface Sqlite3Wasm {
  allocFromTypedArray(data: Uint8Array): number;
}

interface Oo1DB {
  pointer: number;
  exec(opts: {
    sql: string;
    columnNames?: string[];
    resultRows?: unknown[][];
  }): void;
  close(): void;
}

interface Sqlite3Static {
  oo1: { DB: new (opts: string | { filename: string }) => Oo1DB };
  capi: Sqlite3Capi;
  wasm: Sqlite3Wasm;
}

// ── Module state ─────────────────────────────────────────────────────────────

let sqlite3: Sqlite3Static | null = null;
let db: Oo1DB | null = null;
let fileHandle: FileSystemFileHandle | null = null;

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initSQLite(): Promise<void> {
  sqlite3 = (await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  })) as Sqlite3Static;
}

// ── Database lifecycle ────────────────────────────────────────────────────────

/** Open a new empty in-memory database. */
export function createNewDatabase(): void {
  closeCurrentDb();
  db = new sqlite3!.oo1.DB(':memory:');
  fileHandle = null;
}

/** Deserialise a raw SQLite file buffer into an in-memory database. */
function loadFromBuffer(data: Uint8Array): void {
  closeCurrentDb();
  db = new sqlite3!.oo1.DB(':memory:');

  if (data.byteLength === 0) return; // empty file → blank db

  const { capi, wasm } = sqlite3!;
  const ptr = wasm.allocFromTypedArray(data);
  const rc = capi.sqlite3_deserialize(
    db.pointer,
    'main',
    ptr,
    data.byteLength,
    data.byteLength,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  if (rc !== 0) throw new Error(`sqlite3_deserialize failed (code ${rc})`);
}

function closeCurrentDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ── File System Access API ────────────────────────────────────────────────────

const FILE_PICKER_TYPES = [
  {
    description: 'SQLite Database',
    accept: { 'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3', '.db3'] },
  },
];

/** Prompt the user to pick a .db file, load it, and return the filename. */
export async function openFile(): Promise<string> {
  const [handle] = await (
    window as unknown as {
      showOpenFilePicker(opts: object): Promise<FileSystemFileHandle[]>;
    }
  ).showOpenFilePicker({ types: FILE_PICKER_TYPES, multiple: false });

  fileHandle = handle;
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  loadFromBuffer(new Uint8Array(buffer));
  return file.name;
}

/** Serialise the current in-memory database to bytes. */
export function exportDb(): Uint8Array {
  if (!db) throw new Error('No database open');
  return sqlite3!.capi.sqlite3_js_db_export(db.pointer);
}

/** Save to the previously opened file handle (or fall back to Save As). */
export async function saveFile(): Promise<string> {
  if (!fileHandle) return saveAsFile();
  await writeToHandle(fileHandle);
  return (await fileHandle.getFile()).name;
}

/** Prompt the user for a save location and write the database. */
export async function saveAsFile(): Promise<string> {
  const handle = await (
    window as unknown as {
      showSaveFilePicker(opts: object): Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker({
    suggestedName: 'database.db',
    types: FILE_PICKER_TYPES,
  });
  fileHandle = handle;
  await writeToHandle(handle);
  return (await handle.getFile()).name;
}

async function writeToHandle(handle: FileSystemFileHandle): Promise<void> {
  const writable = await handle.createWritable();
  // sqlite3_js_db_export may return a Uint8Array backed by a SharedArrayBuffer.
  // Copy into a plain ArrayBuffer so FileSystemWritableFileStream accepts it.
  const raw = exportDb();
  const plain = new ArrayBuffer(raw.byteLength);
  new Uint8Array(plain).set(raw);
  await writable.write(plain);
  await writable.close();
}

/** Whether the user has an open file handle (so Save doesn't need Save As). */
export function hasFileHandle(): boolean {
  return fileHandle !== null;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  /** Number of rows changed by a DML statement (INSERT/UPDATE/DELETE). */
  rowsAffected?: number;
}

/** Execute arbitrary SQL and return column names + rows. */
export function execQuery(sql: string): QueryResult {
  if (!db) throw new Error('No database open');

  const columns: string[] = [];
  const rows: unknown[][] = [];

  db.exec({ sql, columnNames: columns, resultRows: rows });

  return { columns, rows };
}

/** Return all user table names in the current database. */
export function listTables(): string[] {
  if (!db) return [];
  const result = execQuery(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return result.rows.map((r) => r[0] as string);
}

/** Whether a database is currently open. */
export function isOpen(): boolean {
  return db !== null;
}
