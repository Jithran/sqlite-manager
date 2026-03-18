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
  getRow,
  getLastInsertRowid,
  openSqlFile,
  loadDbBuffer,
  saveFile,
  saveAsFile,
  exportAsSql,
  execQuery,
  listTables,
  hasFileHandle,
  isOpen,
  updateCell,
  deleteRow,
  insertRow,
  type QueryResult,
} from '../db/sqlite.ts';
import { convertMysqlToSqlite } from '../db/mysql-compat.ts';
import { showReleases } from './changelog.ts';
import {
  recordUpdate,
  recordDelete,
  recordInsert,
  undoLast,
  getHistoryCount,
  showChangeHistory,
} from './changeHistory.ts';

// ── Element refs ──────────────────────────────────────────────────────────────

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const btnReleases       = el<HTMLButtonElement>('btn-releases');
const btnHistory        = el<HTMLButtonElement>('btn-history');
const btnNew            = el<HTMLButtonElement>('btn-new');
const btnOpen           = el<HTMLButtonElement>('btn-open');
const btnImportSql      = el<HTMLButtonElement>('btn-import-sql');
const btnSave           = el<HTMLButtonElement>('btn-save');
const btnSaveAs         = el<HTMLButtonElement>('btn-save-as');
const btnExportSql      = el<HTMLButtonElement>('btn-export-sql');
const btnRun            = el<HTMLButtonElement>('btn-run');
const btnRefresh        = el<HTMLButtonElement>('btn-refresh-tables');
const btnExportCsv      = el<HTMLButtonElement>('btn-export-csv');
const btnAddRow         = el<HTMLButtonElement>('btn-add-row');
const btnDeleteSelected = el<HTMLButtonElement>('btn-delete-selected');

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
const dropOverlay        = el('drop-overlay');

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
  btnSave.disabled      = !hasDb;
  btnSaveAs.disabled    = !hasDb;
  btnExportSql.disabled = !hasDb;
  btnRun.disabled       = !hasDb;
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
      tableList.querySelectorAll('.table-list-item').forEach((e) =>
        e.classList.remove('active'),
      );
      li.classList.add('active');
      loadTable(name);
    });
    tableList.appendChild(li);
  }
}

/** Load a table in edit-capable mode (includes hidden rowid column). */
function loadTable(name: string): void {
  sqlEditor.value = `SELECT rowid AS __rowid__, * FROM "${name}" LIMIT 500;`;
  runQuery(name);
}

// ── TanStack Table renderer ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

let currentResult: QueryResult | null = null;
let currentTableName: string | null = null;
let currentRowids: number[] = [];
let sortingState: SortingState = [];

// ── Row selection state ───────────────────────────────────────────────────────

/**
 * Pending new row: column values the user is filling in before committing.
 * Null means no pending row.
 */
let pendingNewRow: Record<string, string> | null = null;

/** Set of original-data row indices that are currently selected. */
let selectedRowIndices = new Set<number>();
/** Visual row index of the last click (for shift-range selection). */
let lastClickedVisualIndex: number | null = null;
/** Maps visual position → original data index, rebuilt on each render. */
let currentVisualRowDataIndices: number[] = [];

function clearSelection(): void {
  selectedRowIndices.clear();
  lastClickedVisualIndex = null;
}

function updateHistoryBtn(): void {
  const n = getHistoryCount();
  btnHistory.textContent = n > 0 ? `History (${n})` : 'History';
  btnHistory.classList.toggle('btn-history-active', n > 0);
}

function afterUndo(tableName: string): void {
  if (currentTableName === tableName) refreshCurrentTable();
  setStatus('Change undone', 'ok');
  updateHistoryBtn();
}

function cancelPendingRow(): void {
  pendingNewRow = null;
  document.getElementById('pending-new-row')?.remove();
  updateEditToolbar();
}

function commitPendingRow(): void {
  if (!currentTableName || !pendingNewRow || !currentResult) return;

  const cols = currentResult.columns;
  const values: (string | number | null)[] = cols.map((col) => {
    const raw = pendingNewRow![col] ?? '';
    if (raw === '' || raw.toUpperCase() === 'NULL') return null;
    if (raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw);
    return raw;
  });

  try {
    insertRow(currentTableName, cols, values);
    const newRowid = getLastInsertRowid();
    recordInsert(currentTableName, newRowid, cols, values);
    updateHistoryBtn();
    pendingNewRow = null;
    setStatus('Row inserted', 'ok');
    refreshCurrentTable();
  } catch (err) {
    setStatus(`Insert failed: ${String(err)}`, 'error');
    // Keep pending row visible so user can fix values
  }
}

function renderPendingRow(): void {
  if (!pendingNewRow || !currentResult) return;

  document.getElementById('pending-new-row')?.remove();

  const tr = document.createElement('tr');
  tr.id = 'pending-new-row';
  tr.className = 'row-pending-new';

  // Action cell (save / cancel)
  const actionTd = document.createElement('td');
  actionTd.className = 'selection-cell pending-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-pending btn-pending-save';
  saveBtn.textContent = '✓';
  saveBtn.title = 'Save row (Enter)';
  saveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); commitPendingRow(); });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-pending btn-pending-cancel';
  cancelBtn.textContent = '✕';
  cancelBtn.title = 'Cancel (Escape)';
  cancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelPendingRow(); });

  actionTd.appendChild(saveBtn);
  actionTd.appendChild(cancelBtn);
  tr.appendChild(actionTd);

  const inputs: HTMLInputElement[] = [];
  for (const col of currentResult.columns) {
    const td = document.createElement('td');
    td.className = 'td-pending-cell';

    const input = document.createElement('input');
    input.className = 'cell-edit-input';
    input.placeholder = 'NULL';
    input.value = pendingNewRow[col] ?? '';
    input.addEventListener('input', () => { pendingNewRow![col] = input.value; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitPendingRow(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelPendingRow(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const i = inputs.indexOf(input);
        const next = inputs[i + (e.shiftKey ? -1 : 1)];
        if (next) next.focus();
        else if (!e.shiftKey) commitPendingRow();
      }
    });
    inputs.push(input);
    td.appendChild(input);
    tr.appendChild(td);
  }

  resultsTbody.appendChild(tr);
  if (inputs[0]) inputs[0].focus();
  setStatus('Fill in values • Enter to save • Escape to cancel', 'idle');
}

/** Update the "Delete N rows" button without re-rendering the table. */
function updateSelectionToolbar(): void {
  const count = selectedRowIndices.size;
  if (count > 0 && currentTableName) {
    btnDeleteSelected.style.display = 'inline-flex';
    btnDeleteSelected.textContent = `Delete ${count} row${count !== 1 ? 's' : ''}`;
  } else {
    btnDeleteSelected.style.display = 'none';
  }
}

function updateEditToolbar(): void {
  const editing = currentTableName !== null;
  btnAddRow.style.display = (editing && !pendingNewRow) ? 'inline-flex' : 'none';
  updateSelectionToolbar();
}

/**
 * Repaint only the selection-related DOM (row highlights + column indicators)
 * without rebuilding the entire table via TanStack.
 */
function repaintSelectionDOM(): void {
  const rows = resultsTbody.querySelectorAll('tr:not(#pending-new-row)');
  const total = currentVisualRowDataIndices.length;

  rows.forEach((tr, vIdx) => {
    const dIdx = currentVisualRowDataIndices[vIdx];
    const sel = selectedRowIndices.has(dIdx);
    tr.classList.toggle('row-selected', sel);
    const cell = tr.querySelector<HTMLElement>('.selection-cell');
    if (cell) cell.dataset['selected'] = sel ? '1' : '0';
  });

  const headerCell = resultsThead.querySelector<HTMLElement>('.selection-col-header');
  if (headerCell) {
    const allSel = total > 0 && currentVisualRowDataIndices.every((i) => selectedRowIndices.has(i));
    headerCell.dataset['selected'] = allSel ? '1' : '0';
    headerCell.title = allSel ? 'Deselect all' : 'Select all';
  }

  updateSelectionToolbar();
}

function handleRowSelectionClick(visualIdx: number, dataIdx: number, e: MouseEvent): void {
  if (e.shiftKey && lastClickedVisualIndex !== null) {
    const lo = Math.min(lastClickedVisualIndex, visualIdx);
    const hi = Math.max(lastClickedVisualIndex, visualIdx);
    if (!e.ctrlKey && !e.metaKey) selectedRowIndices.clear();
    for (let v = lo; v <= hi; v++) selectedRowIndices.add(currentVisualRowDataIndices[v]);
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedRowIndices.has(dataIdx)) selectedRowIndices.delete(dataIdx);
    else selectedRowIndices.add(dataIdx);
  } else {
    if (selectedRowIndices.size === 1 && selectedRowIndices.has(dataIdx)) {
      selectedRowIndices.clear();
    } else {
      selectedRowIndices.clear();
      selectedRowIndices.add(dataIdx);
    }
  }
  lastClickedVisualIndex = visualIdx;
  repaintSelectionDOM();
}

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

function renderResults(result: QueryResult, tableContext: string | null = null): void {
  pendingNewRow = null;
  clearSelection();

  if (tableContext !== null && result.columns[0] === '__rowid__') {
    currentTableName = tableContext;
    currentRowids = result.rows.map((r) => r[0] as number);
    currentResult = {
      columns: result.columns.slice(1),
      rows: result.rows.map((r) => r.slice(1)),
    };
  } else {
    currentTableName = null;
    currentRowids = [];
    currentResult = result;
  }
  sortingState = [];
  updateEditToolbar();
  buildTable();
}

/**
 * Create a new TanStack Table instance for the current result set.
 *
 * Key pattern for vanilla-JS TanStack Table v8:
 *   1. Create the table WITHOUT a `state` option so we can read `table.initialState`.
 *   2. Merge `table.initialState` with our sorting preference via `setOptions`.
 *   3. Keep the table instance alive so sorting clicks only re-render the DOM.
 */
function buildTable(): void {
  if (!currentResult) return;

  resultsPlaceholder.style.display = 'none';
  resultsTableWrap.style.display = 'block';

  const { columns, rows } = currentResult;
  const data = rowsToObjects(columns, rows);
  const columnDefs = buildColumnDefs(columns);

  const table = createTable<Row>({
    data,
    columns: columnDefs,
    state: {} as TableState,
    onStateChange() {},
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    renderFallbackValue: null,
  });

  let tableState: TableState = { ...table.initialState, sorting: sortingState };

  table.setOptions((prev) => ({
    ...prev,
    state: tableState,
    onStateChange(updater) {
      tableState =
        typeof updater === 'function' ? updater(tableState) : updater;
      sortingState = tableState.sorting ?? [];
      table.setOptions((o) => ({ ...o, state: tableState }));
      pendingNewRow = null;
      renderTableDOM(table, rows.length, columns.length);
    },
  }));

  renderTableDOM(table, rows.length, columns.length);
}

function renderTableDOM(
  table: Table<Row>,
  rowCount: number,
  colCount: number,
): void {
  const editMode = currentTableName !== null;
  const modelRows = table.getRowModel().rows;

  currentVisualRowDataIndices = modelRows.map((r) => r.index);

  // ── thead
  resultsThead.innerHTML = '';
  for (const headerGroup of table.getHeaderGroups()) {
    const tr = document.createElement('tr');

    if (editMode) {
      const th = document.createElement('th');
      th.className = 'selection-col-header';
      const allSel = modelRows.length > 0 && modelRows.every((r) => selectedRowIndices.has(r.index));
      th.dataset['selected'] = allSel ? '1' : '0';
      th.title = allSel ? 'Deselect all' : 'Select all';
      th.addEventListener('click', () => {
        const nowAll = modelRows.every((r) => selectedRowIndices.has(r.index));
        if (nowAll) selectedRowIndices.clear();
        else modelRows.forEach((r) => selectedRowIndices.add(r.index));
        lastClickedVisualIndex = null;
        repaintSelectionDOM();
      });
      tr.appendChild(th);
    }

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
  for (let vIdx = 0; vIdx < modelRows.length; vIdx++) {
    const row = modelRows[vIdx];
    const isSelected = selectedRowIndices.has(row.index);
    const tr = document.createElement('tr');
    if (isSelected) tr.classList.add('row-selected');

    if (editMode) {
      const td = document.createElement('td');
      td.className = 'selection-cell';
      td.dataset['selected'] = isSelected ? '1' : '0';
      td.title = 'Click to select • Shift+click for range • Ctrl+click to toggle';
      const capturedVIdx = vIdx;
      const capturedDIdx = row.index;
      td.addEventListener('click', (e) => handleRowSelectionClick(capturedVIdx, capturedDIdx, e));
      tr.appendChild(td);
    }

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

      if (editMode && !(val instanceof Uint8Array)) {
        td.classList.add('editable-cell');
        const rowIndex = row.index;
        const colId = cell.column.id;
        td.addEventListener('dblclick', () => startCellEdit(td, rowIndex, colId, val));
      }

      tr.appendChild(td);
    }

    resultsTbody.appendChild(tr);
  }

  resultsCount.textContent =
    `${rowCount} row${rowCount !== 1 ? 's' : ''} • ${colCount} column${colCount !== 1 ? 's' : ''}`;
  btnExportCsv.style.display = rowCount > 0 ? 'inline-flex' : 'none';
  updateSelectionToolbar();
}

// ── Inline cell editing ───────────────────────────────────────────────────────

function startCellEdit(
  td: HTMLTableCellElement,
  rowIndex: number,
  colName: string,
  currentVal: unknown,
): void {
  if (!currentTableName) return;

  const rowid = currentRowids[rowIndex];
  if (rowid == null) return;

  const originalText = td.textContent ?? '';
  const originalClass = td.className;
  const isNull = currentVal === null || currentVal === undefined;

  const input = document.createElement('input');
  input.className = 'cell-edit-input';
  input.value = isNull ? '' : String(currentVal);
  if (isNull) input.placeholder = 'NULL';

  td.textContent = '';
  td.className = 'td-editing';
  td.appendChild(input);
  input.focus();
  input.select();

  let done = false;

  function restore(): void {
    if (done) return;
    done = true;
    td.textContent = originalText;
    td.className = originalClass;
  }

  function commit(): void {
    if (done) return;
    done = true;

    const raw = input.value;
    let newVal: string | number | null;

    if (raw.toUpperCase() === 'NULL') {
      newVal = null;
    } else if (raw === '' && isNull) {
      td.textContent = originalText;
      td.className = originalClass;
      return;
    } else if (raw !== '' && raw.trim() !== '' && !isNaN(Number(raw))) {
      newVal = Number(raw);
    } else {
      newVal = raw;
    }

    const originalNorm = isNull
      ? null
      : typeof currentVal === 'number'
        ? currentVal
        : String(currentVal);
    if (newVal === originalNorm) {
      td.textContent = originalText;
      td.className = originalClass;
      return;
    }

    try {
      updateCell(currentTableName!, rowid, colName, newVal);
      recordUpdate(currentTableName!, rowid, colName, currentVal ?? null, newVal);
      updateHistoryBtn();
      setStatus(`Updated "${colName}"`, 'ok');
      refreshCurrentTable();
    } catch (err) {
      setStatus(`Update failed: ${String(err)}`, 'error');
      td.textContent = originalText;
      td.className = originalClass;
    }
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); restore(); }
  });

  input.addEventListener('blur', () => setTimeout(() => commit(), 120));
}

// ── Row delete / insert ───────────────────────────────────────────────────────

function handleDeleteSelected(): void {
  if (!currentTableName || selectedRowIndices.size === 0) return;
  const count = selectedRowIndices.size;
  if (!window.confirm(`Delete ${count} row${count !== 1 ? 's' : ''}?`)) return;

  try {
    for (const idx of selectedRowIndices) {
      const rowid = currentRowids[idx];
      if (rowid != null) {
        const rowData = getRow(currentTableName, rowid);
        deleteRow(currentTableName, rowid);
        if (rowData) recordDelete(currentTableName, rowid, rowData.columns, rowData.values);
      }
    }
    updateHistoryBtn();
    setStatus(`Deleted ${count} row${count !== 1 ? 's' : ''}`, 'ok');
    clearSelection();
    refreshCurrentTable();
  } catch (err) {
    setStatus(`Delete failed: ${String(err)}`, 'error');
  }
}

function handleAddRow(): void {
  if (!currentTableName || !currentResult || pendingNewRow) return;
  pendingNewRow = Object.fromEntries(currentResult.columns.map((c) => [c, '']));
  updateEditToolbar();
  renderPendingRow();
}

function refreshCurrentTable(): void {
  const name = currentTableName;
  if (!name) return;
  sqlEditor.value = `SELECT rowid AS __rowid__, * FROM "${name}" LIMIT 500;`;
  runQuery(name);
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

function runQuery(tableContext: string | null = null): void {
  const sql = sqlEditor.value.trim();
  if (!sql) return;

  currentTableName = null;
  currentRowids = [];
  pendingNewRow = null;
  clearSelection();

  const t0 = performance.now();
  try {
    const result = execQuery(sql);
    const elapsed = (performance.now() - t0).toFixed(1);

    if (result.columns.length > 0) {
      renderResults(result, tableContext);
      queryInfo.textContent = `${result.rows.length} rows in ${elapsed} ms`;
      setStatus(`Query OK — ${result.rows.length} rows (${elapsed} ms)`);
    } else {
      resultsPlaceholder.style.display = 'flex';
      resultsTableWrap.style.display = 'none';
      resultsCount.textContent = '';
      btnExportCsv.style.display = 'none';
      updateEditToolbar();
      queryInfo.textContent = `Done in ${elapsed} ms`;
      setStatus(`Query OK (${elapsed} ms)`);
      refreshTableList();
    }
  } catch (err) {
    updateEditToolbar();
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

// ── SQL dump export ───────────────────────────────────────────────────────────

async function handleExportSql(): Promise<void> {
  try {
    const sql = exportAsSql();
    const blob = new Blob([sql], { type: 'text/plain' });

    if ('showSaveFilePicker' in window) {
      const handle = await (
        window as unknown as {
          showSaveFilePicker(opts: object): Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName: 'database.sql',
        types: [{ description: 'SQL Script', accept: { 'text/plain': ['.sql'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`Exported: ${(await handle.getFile()).name}`);
    } else {
      // Fallback for browsers without File System Access API
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'database.sql';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('SQL dump downloaded');
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      setStatus('Export cancelled', 'idle');
    } else {
      setStatus(`Export failed: ${String(err)}`, 'error');
    }
  }
}

// ── Toolbar handlers ──────────────────────────────────────────────────────────

async function handleNew(): Promise<void> {
  createNewDatabase();
  currentTableName = null;
  currentRowids = [];
  pendingNewRow = null;
  clearSelection();
  setFilename('(new database)');
  refreshTableList();
  sqlEditor.value = '';
  resultsPlaceholder.style.display = 'flex';
  resultsTableWrap.style.display = 'none';
  currentResult = null;
  resultsCount.textContent = '';
  btnExportCsv.style.display = 'none';
  updateEditToolbar();
  setStatus('New in-memory database created');
}

async function handleOpen(): Promise<void> {
  try {
    setStatus('Opening file…', 'loading');
    const name = await openFile();
    setFilename(name);
    refreshTableList();
    setStatus(`Opened: ${name}`);
    const tables = listTables();
    if (tables.length > 0) {
      const firstItem = tableList.querySelector<HTMLElement>('.table-list-item');
      if (firstItem) firstItem.classList.add('active');
      loadTable(tables[0]);
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      setStatus('Open cancelled', 'idle');
    } else {
      setStatus(`Open failed: ${String(err)}`, 'error');
    }
  }
}

/** Execute a SQL script (converting MySQL syntax if needed) and update the UI. */
function importSql(name: string, rawSql: string): void {
  if (!isOpen()) {
    createNewDatabase();
    setFilename('(new database)');
  }

  const sql = convertMysqlToSqlite(rawSql);
  const t0 = performance.now();
  execQuery(sql);
  const elapsed = (performance.now() - t0).toFixed(1);

  sqlEditor.value = sql;
  resultsPlaceholder.style.display = 'flex';
  resultsTableWrap.style.display = 'none';
  resultsCount.textContent = '';
  btnExportCsv.style.display = 'none';
  queryInfo.textContent = `Done in ${elapsed} ms`;
  refreshTableList();
  setStatus(`Imported: ${name} (${elapsed} ms)`);
}

async function handleImportSql(): Promise<void> {
  try {
    setStatus('Selecting SQL file…', 'loading');
    const { name, sql } = await openSqlFile();
    setStatus(`Running ${name}…`, 'loading');
    importSql(name, sql);
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      setStatus('Import cancelled', 'idle');
    } else {
      setStatus(`Import failed: ${String(err)}`, 'error');
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runQuery();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end } = sqlEditor;
    sqlEditor.setRangeText('  ', start, end, 'end');
  }
}

document.addEventListener('keydown', (e) => {
  // Delete selected rows
  if (e.key === 'Delete' && currentTableName && selectedRowIndices.size > 0) {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') {
      e.preventDefault();
      handleDeleteSelected();
      return;
    }
  }
  // Ctrl+Z — undo last change
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') {
      e.preventDefault();
      try {
        const tableName = undoLast();
        if (tableName !== null) afterUndo(tableName);
      } catch (err) {
        setStatus(`Undo failed: ${String(err)}`, 'error');
      }
      return;
    }
  }
  // Save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!btnSave.disabled) {
      if (hasFileHandle()) handleSave();
      else handleSaveAs();
    }
  }
});

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

const DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3', '.db3']);

function droppedFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function handleDroppedDb(name: string, data: Uint8Array): void {
  try {
    loadDbBuffer(data);
    setFilename(name);
    refreshTableList();
    const tables = listTables();
    if (tables.length > 0) {
      const firstItem = tableList.querySelector<HTMLElement>('.table-list-item');
      if (firstItem) firstItem.classList.add('active');
      loadTable(tables[0]);
    }
    setStatus(`Opened: ${name}`);
  } catch (err) {
    setStatus(`Open failed: ${String(err)}`, 'error');
  }
}

function handleDroppedSql(name: string, sql: string): void {
  try {
    importSql(name, sql);
  } catch (err) {
    setStatus(`Import failed: ${String(err)}`, 'error');
  }
}

function initDragAndDrop(): void {
  let dragDepth = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.add('visible');
  });

  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth === 0) dropOverlay.classList.remove('visible');
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('visible');

    const file = e.dataTransfer?.files[0];
    if (!file) return;

    const ext = droppedFileExtension(file.name);

    if (ext === '.sql') {
      const sql = await file.text();
      handleDroppedSql(file.name, sql);
    } else if (DB_EXTENSIONS.has(ext)) {
      const buffer = await file.arrayBuffer();
      handleDroppedDb(file.name, new Uint8Array(buffer));
    } else {
      setStatus(`Unsupported file type: ${file.name}`, 'error');
    }
  });
}

// ── Initialise ────────────────────────────────────────────────────────────────

export async function initApp(): Promise<void> {
  setStatus('Initialising SQLite WASM…', 'loading');

  try {
    await initSQLite();
  } catch (err) {
    setStatus(`Failed to load SQLite WASM: ${String(err)}`, 'error');
    return;
  }

  initDragAndDrop();

  btnReleases.addEventListener('click', showReleases);
  btnHistory.addEventListener('click', () => showChangeHistory(afterUndo));
  btnNew.addEventListener('click', handleNew);
  btnOpen.addEventListener('click', handleOpen);
  btnImportSql.addEventListener('click', handleImportSql);
  btnSave.addEventListener('click', handleSave);
  btnSaveAs.addEventListener('click', handleSaveAs);
  btnExportSql.addEventListener('click', handleExportSql);
  btnRun.addEventListener('click', () => runQuery());
  btnRefresh.addEventListener('click', refreshTableList);
  btnExportCsv.addEventListener('click', exportCsv);
  btnAddRow.addEventListener('click', handleAddRow);
  btnDeleteSelected.addEventListener('click', handleDeleteSelected);
  sqlEditor.addEventListener('keydown', handleEditorKeydown);

  createNewDatabase();
  setFilename('(new database)');
  refreshTableList();
  updateEditToolbar();
  setStatus('Ready — SQLite WASM loaded');
}
