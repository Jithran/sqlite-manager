/**
 * Main application UI.
 *
 * Wires up toolbar buttons, the SQL editor, the sidebar table list, and the
 * TanStack Table results renderer — all without a framework.
 */

import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type Table,
  type TableState,
} from '@tanstack/table-core';

import {
  initSQLite,
  createNewDatabase,
  openFile,
  saveFile,
  saveAsFile,
  execQuery,
  listTables,
  hasFileHandle,
  isOpen,
  type QueryResult,
} from '../db/sqlite.ts';

// ── Element refs ──────────────────────────────────────────────────────────────

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const btnNew      = el<HTMLButtonElement>('btn-new');
const btnOpen     = el<HTMLButtonElement>('btn-open');
const btnSave     = el<HTMLButtonElement>('btn-save');
const btnSaveAs   = el<HTMLButtonElement>('btn-save-as');
const btnRun      = el<HTMLButtonElement>('btn-run');
const btnRefresh  = el<HTMLButtonElement>('btn-refresh-tables');
const btnExportCsv = el<HTMLButtonElement>('btn-export-csv');

const sqlEditor     = el<HTMLTextAreaElement>('sql-editor');
const tableList     = el<HTMLUListElement>('table-list');
const dbFilename    = el<HTMLSpanElement>('db-filename');
const dbStatus      = el<HTMLSpanElement>('db-status');
const queryInfo     = el<HTMLSpanElement>('query-info');
const resultsCount  = el<HTMLSpanElement>('results-count');
const statusMsg     = el<HTMLSpanElement>('status-msg');
const statusBar     = el<HTMLElement>('statusbar');

const resultsPlaceholder = el('results-placeholder');
const resultsTableWrap   = el('results-table-wrap');
const resultsThead       = el('results-thead');
const resultsTbody       = el('results-tbody');

// ── Status helpers ────────────────────────────────────────────────────────────

type StatusKind = 'ok' | 'error' | 'loading' | 'idle';

function setStatus(msg: string, kind: StatusKind = 'ok'): void {
  statusMsg.textContent = msg;
  statusBar.className = kind === 'error' ? 'status-error' : kind === 'ok' ? 'status-ok' : '';
  dbStatus.className = `status-dot status-${kind === 'loading' ? 'loading' : kind === 'error' ? 'error' : 'ok'}`;
}

function setFilename(name: string | null): void {
  dbFilename.textContent = name ?? 'No file open';
  const hasDb = isOpen();
  btnSave.disabled   = !hasDb;
  btnSaveAs.disabled = !hasDb;
  btnRun.disabled    = !hasDb;
}

// ── Table sidebar ─────────────────────────────────────────────────────────────

function refreshTableList(): void {
  const tables = listTables();
  tableList.innerHTML = '';

  if (tables.length === 0) {
    const li = document.createElement('li');
    li.className = 'table-list-empty';
    li.textContent = isOpen() ? 'No tables' : 'No database open';
    tableList.appendChild(li);
    return;
  }

  for (const name of tables) {
    const li = document.createElement('li');
    li.className = 'table-list-item';
    li.textContent = name;
    li.title = `SELECT * FROM "${name}"`;
    li.addEventListener('click', () => {
      // Highlight active
      tableList.querySelectorAll('.table-list-item').forEach((el) =>
        el.classList.remove('active'),
      );
      li.classList.add('active');
      sqlEditor.value = `SELECT * FROM "${name}";`;
      runQuery();
    });
    tableList.appendChild(li);
  }
}

// ── TanStack Table renderer ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

let currentResult: QueryResult | null = null;
let sortingState: SortingState = [];

function buildColumnDefs(columns: string[]): ColumnDef<Row>[] {
  return columns.map((col) => ({
    id: col,
    accessorKey: col,
    header: col,
    cell: (info) => info.getValue(),
  }));
}

function rowsToObjects(columns: string[], rows: unknown[][]): Row[] {
  return rows.map((r) =>
    Object.fromEntries(columns.map((col, i) => [col, r[i]])),
  );
}

function renderResults(result: QueryResult): void {
  currentResult = result;
  sortingState = [];
  buildTable();
}

/**
 * Create a new TanStack Table instance for the current result set.
 *
 * Key pattern for vanilla-JS TanStack Table v8:
 *   1. Create the table WITHOUT a `state` option so we can read `table.initialState`,
 *      which contains fully-initialised defaults for every feature (columnPinning,
 *      columnSizing, etc.).  Providing only `{ sorting: [] }` omits those fields and
 *      causes "Cannot read properties of undefined (reading 'left')" when the column-
 *      pinning feature tries to access `state.columnPinning.left`.
 *   2. Merge `table.initialState` with our sorting preference via `setOptions`.
 *   3. Keep the table instance alive so sorting clicks only re-render the DOM,
 *      not the entire table.
 */
function buildTable(): void {
  if (!currentResult) return;

  resultsPlaceholder.style.display = 'none';
  resultsTableWrap.style.display = 'block';

  const { columns, rows } = currentResult;
  const data = rowsToObjects(columns, rows);
  const columnDefs = buildColumnDefs(columns);

  // Step 1 — create with a temporary empty state so we can read `table.initialState`.
  // TanStack Table does not call getState() during createTable itself, so this
  // placeholder is safe.  We replace it in step 2 before any rendering happens.
  const table = createTable<Row>({
    data,
    columns: columnDefs,
    state: {} as TableState,      // placeholder — replaced immediately below
    onStateChange() {},           // placeholder — replaced immediately below
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    renderFallbackValue: null,
  });

  // Step 2 — build a complete state from the table's own initialState (all
  // feature defaults present) then override just our sorting preference.
  let tableState: TableState = { ...table.initialState, sorting: sortingState };

  table.setOptions((prev) => ({
    ...prev,
    state: tableState,
    onStateChange(updater) {
      tableState =
        typeof updater === 'function' ? updater(tableState) : updater;
      sortingState = tableState.sorting ?? [];
      // Update state on the existing instance — no new table needed
      table.setOptions((o) => ({ ...o, state: tableState }));
      renderTableDOM(table, rows.length, columns.length);
    },
  }));

  // Step 3 — initial DOM render
  renderTableDOM(table, rows.length, columns.length);
}

function renderTableDOM(
  table: Table<Row>,
  rowCount: number,
  colCount: number,
): void {
  // ── thead
  resultsThead.innerHTML = '';
  for (const headerGroup of table.getHeaderGroups()) {
    const tr = document.createElement('tr');
    for (const header of headerGroup.headers) {
      const th = document.createElement('th');
      th.textContent = String(header.column.columnDef.header ?? header.id);

      if (header.column.getCanSort()) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        const dir = header.column.getIsSorted();
        arrow.textContent = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '⇅';
        th.appendChild(arrow);
        const sortHandler = header.column.getToggleSortingHandler();
        if (sortHandler) th.addEventListener('click', sortHandler as EventListener);
      }
      tr.appendChild(th);
    }
    resultsThead.appendChild(tr);
  }

  // ── tbody
  resultsTbody.innerHTML = '';
  for (const row of table.getRowModel().rows) {
    const tr = document.createElement('tr');
    for (const cell of row.getVisibleCells()) {
      const td = document.createElement('td');
      const val = cell.getValue();

      if (val === null || val === undefined) {
        td.textContent = 'NULL';
        td.className = 'null-value';
      } else if (val instanceof Uint8Array) {
        td.textContent = `<BLOB ${val.byteLength}B>`;
        td.className = 'blob-value';
      } else if (typeof val === 'number' || typeof val === 'bigint') {
        td.textContent = String(val);
        td.className = 'num-value';
      } else {
        td.textContent = String(val);
      }
      tr.appendChild(td);
    }
    resultsTbody.appendChild(tr);
  }

  // ── counters
  resultsCount.textContent =
    `${rowCount} row${rowCount !== 1 ? 's' : ''} • ${colCount} column${colCount !== 1 ? 's' : ''}`;
  btnExportCsv.style.display = rowCount > 0 ? 'inline-flex' : 'none';
}

function showError(err: unknown): void {
  resultsPlaceholder.style.display = 'none';
  resultsTableWrap.style.display = 'block';
  resultsThead.innerHTML = '';
  resultsTbody.innerHTML = `<tr><td class="error-message">${String(err)}</td></tr>`;
  resultsCount.textContent = '';
  btnExportCsv.style.display = 'none';
  setStatus(String(err), 'error');
}

// ── Query runner ──────────────────────────────────────────────────────────────

function runQuery(): void {
  const sql = sqlEditor.value.trim();
  if (!sql) return;

  const t0 = performance.now();
  try {
    const result = execQuery(sql);
    const elapsed = (performance.now() - t0).toFixed(1);

    if (result.columns.length > 0) {
      renderResults(result);
      queryInfo.textContent = `${result.rows.length} rows in ${elapsed} ms`;
      setStatus(`Query OK — ${result.rows.length} rows (${elapsed} ms)`);
    } else {
      // DML / DDL — no result set
      resultsPlaceholder.style.display = 'flex';
      resultsTableWrap.style.display = 'none';
      resultsCount.textContent = '';
      btnExportCsv.style.display = 'none';
      queryInfo.textContent = `Done in ${elapsed} ms`;
      setStatus(`Query OK (${elapsed} ms)`);
      refreshTableList(); // DDL may have changed the schema
    }
  } catch (err) {
    queryInfo.textContent = '';
    showError(err);
  }
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(): void {
  if (!currentResult) return;
  const { columns, rows } = currentResult;

  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    columns.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'results.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Toolbar handlers ──────────────────────────────────────────────────────────

async function handleNew(): Promise<void> {
  createNewDatabase();
  setFilename('(new database)');
  refreshTableList();
  sqlEditor.value = '';
  resultsPlaceholder.style.display = 'flex';
  resultsTableWrap.style.display = 'none';
  currentResult = null;
  resultsCount.textContent = '';
  btnExportCsv.style.display = 'none';
  setStatus('New in-memory database created');
}

async function handleOpen(): Promise<void> {
  try {
    setStatus('Opening file…', 'loading');
    const name = await openFile();
    setFilename(name);
    refreshTableList();
    setStatus(`Opened: ${name}`);
    // Auto-preview the first table
    const tables = listTables();
    if (tables.length > 0) {
      sqlEditor.value = `SELECT * FROM "${tables[0]}" LIMIT 100;`;
      runQuery();
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      setStatus('Open cancelled', 'idle');
    } else {
      setStatus(`Open failed: ${String(err)}`, 'error');
    }
  }
}

async function handleSave(): Promise<void> {
  try {
    setStatus('Saving…', 'loading');
    const name = await saveFile();
    setFilename(name);
    setStatus(`Saved: ${name}`);
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      setStatus('Save cancelled', 'idle');
    } else {
      setStatus(`Save failed: ${String(err)}`, 'error');
    }
  }
}

async function handleSaveAs(): Promise<void> {
  try {
    setStatus('Saving…', 'loading');
    const name = await saveAsFile();
    setFilename(name);
    setStatus(`Saved as: ${name}`);
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      setStatus('Save cancelled', 'idle');
    } else {
      setStatus(`Save failed: ${String(err)}`, 'error');
    }
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function handleEditorKeydown(e: KeyboardEvent): void {
  // Ctrl+Enter / Cmd+Enter → run
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runQuery();
    return;
  }
  // Tab → insert spaces instead of losing focus
  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end } = sqlEditor;
    sqlEditor.setRangeText('  ', start, end, 'end');
  }
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!btnSave.disabled) {
      if (hasFileHandle()) handleSave();
      else handleSaveAs();
    }
  }
});

// ── Initialise ────────────────────────────────────────────────────────────────

export async function initApp(): Promise<void> {
  setStatus('Initialising SQLite WASM…', 'loading');

  try {
    await initSQLite();
  } catch (err) {
    setStatus(`Failed to load SQLite WASM: ${String(err)}`, 'error');
    return;
  }

  // Wire up events
  btnNew.addEventListener('click', handleNew);
  btnOpen.addEventListener('click', handleOpen);
  btnSave.addEventListener('click', handleSave);
  btnSaveAs.addEventListener('click', handleSaveAs);
  btnRun.addEventListener('click', runQuery);
  btnRefresh.addEventListener('click', refreshTableList);
  btnExportCsv.addEventListener('click', exportCsv);
  sqlEditor.addEventListener('keydown', handleEditorKeydown);

  // Start with a blank in-memory DB so the editor is immediately usable
  createNewDatabase();
  setFilename('(new database)');
  refreshTableList();
  setStatus('Ready — SQLite WASM loaded');
}
