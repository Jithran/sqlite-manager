/**
 * In-session change history with per-entry undo.
 *
 * Changes are recorded by app.ts after every mutation (updateCell, deleteRow,
 * insertRow).  Each record stores a parameterised undo SQL statement so any
 * entry can be reversed independently.
 */

import { execBound } from '../db/sqlite.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChangeRecord {
  id: number;
  timestamp: Date;
  type: 'update' | 'delete' | 'insert';
  tableName: string;
  description: string;
  detail: string;
  undoSql: string;
  undoBind: unknown[];
}

// ── State ─────────────────────────────────────────────────────────────────────

let history: ChangeRecord[] = [];
let nextId = 1;

// ── Record helpers ────────────────────────────────────────────────────────────

function safe(name: string): string {
  return name.replace(/"/g, '""');
}

function fmt(v: unknown): string {
  return v === null || v === undefined ? 'NULL' : String(v);
}

export function recordUpdate(
  tableName: string,
  rowid: number,
  colName: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  history.unshift({
    id: nextId++,
    timestamp: new Date(),
    type: 'update',
    tableName,
    description: `Updated "${colName}" in "${tableName}"`,
    detail: `${fmt(oldValue)} → ${fmt(newValue)}`,
    undoSql: `UPDATE "${safe(tableName)}" SET "${safe(colName)}" = ? WHERE rowid = ?`,
    undoBind: [oldValue ?? null, rowid],
  });
}

export function recordDelete(
  tableName: string,
  rowid: number,
  columns: string[],
  values: unknown[],
): void {
  const colList = ['"rowid"', ...columns.map((c) => `"${safe(c)}"`)] .join(', ');
  const placeholders = Array(columns.length + 1).fill('?').join(', ');
  history.unshift({
    id: nextId++,
    timestamp: new Date(),
    type: 'delete',
    tableName,
    description: `Deleted row from "${tableName}"`,
    detail: columns.map((c, i) => `${c}: ${fmt(values[i])}`).join(' · '),
    undoSql: `INSERT INTO "${safe(tableName)}" (${colList}) VALUES (${placeholders})`,
    undoBind: [rowid, ...values],
  });
}

export function recordInsert(
  tableName: string,
  rowid: number,
  columns: string[],
  values: (string | number | null)[],
): void {
  history.unshift({
    id: nextId++,
    timestamp: new Date(),
    type: 'insert',
    tableName,
    description: `Inserted row into "${tableName}"`,
    detail: columns.map((c, i) => `${c}: ${fmt(values[i])}`).join(' · '),
    undoSql: `DELETE FROM "${safe(tableName)}" WHERE rowid = ?`,
    undoBind: [rowid],
  });
}

// ── Undo ──────────────────────────────────────────────────────────────────────

/** Undo a specific entry; throws if the SQL fails. */
export function undoById(id: number): string {
  const idx = history.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error('Entry not found');
  const record = history[idx];
  execBound(record.undoSql, record.undoBind);
  history.splice(idx, 1);
  return record.tableName;
}

/** Undo the most recent change; returns the affected table name or null. */
export function undoLast(): string | null {
  if (history.length === 0) return null;
  return undoById(history[0].id);
}

export function getHistoryCount(): number {
  return history.length;
}

export function clearHistory(): void {
  history = [];
}

// ── Modal ─────────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<ChangeRecord['type'], string> = {
  update: '~',
  delete: '−',
  insert: '+',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildEntry(
  record: ChangeRecord,
  onUndo: (tableName: string) => void,
): HTMLElement {
  const entry = document.createElement('div');
  entry.className = `history-entry history-${record.type}`;

  // Icon
  const icon = document.createElement('span');
  icon.className = 'history-icon';
  icon.textContent = TYPE_ICON[record.type];

  // Main row: description + timestamp
  const main = document.createElement('div');
  main.className = 'history-main';

  const desc = document.createElement('span');
  desc.className = 'history-desc';
  desc.textContent = record.description;

  const time = document.createElement('span');
  time.className = 'history-time';
  time.textContent = formatTime(record.timestamp);

  main.appendChild(desc);
  main.appendChild(time);

  // Detail row
  const detail = document.createElement('div');
  detail.className = 'history-detail';
  detail.textContent = record.detail;

  // Undo button
  const undoBtn = document.createElement('button');
  undoBtn.className = 'btn btn-ghost btn-sm history-undo-btn';
  undoBtn.textContent = '↩ Undo';
  undoBtn.addEventListener('click', () => {
    try {
      const tableName = undoById(record.id);
      onUndo(tableName);
    } catch (err) {
      alert(`Undo failed: ${String(err)}`);
    }
  });

  entry.appendChild(icon);
  entry.appendChild(main);
  entry.appendChild(undoBtn);
  entry.appendChild(detail);

  return entry;
}

/**
 * Open the change history modal.
 * @param onAfterUndo  Called with the affected table name after each undo.
 */
export function showChangeHistory(onAfterUndo: (tableName: string) => void): void {
  document.getElementById('history-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'history-modal';
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box';

  // ── Header
  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'modal-title';
  titleEl.textContent = 'Change History';

  const headerRight = document.createElement('div');
  headerRight.style.cssText = 'display:flex;gap:8px;align-items:center';

  const undoLastBtn = document.createElement('button');
  undoLastBtn.className = 'btn btn-ghost btn-sm';
  undoLastBtn.textContent = '↩ Undo last';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon modal-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());

  headerRight.appendChild(undoLastBtn);
  headerRight.appendChild(closeBtn);
  header.appendChild(titleEl);
  header.appendChild(headerRight);

  // ── Content (re-rendered after each undo)
  const content = document.createElement('div');
  content.className = 'modal-content';

  function render(): void {
    content.innerHTML = '';
    undoLastBtn.style.display = history.length > 0 ? '' : 'none';

    if (history.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'No changes recorded yet.';
      content.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'history-list';
    history.forEach((record) =>
      list.appendChild(
        buildEntry(record, (tableName) => {
          onAfterUndo(tableName);
          render();
        }),
      ),
    );
    content.appendChild(list);
  }

  undoLastBtn.addEventListener('click', () => {
    if (history.length === 0) return;
    try {
      const tableName = undoById(history[0].id);
      onAfterUndo(tableName);
      render();
    } catch (err) {
      alert(`Undo failed: ${String(err)}`);
    }
  });

  render();

  box.appendChild(header);
  box.appendChild(content);
  overlay.appendChild(box);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}
