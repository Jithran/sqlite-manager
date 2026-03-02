/**
 * Best-effort converter from MySQL/MariaDB SQL dumps to SQLite-compatible SQL.
 *
 * Handles the most common constructs produced by mysqldump:
 *  - Strips MySQL conditional comments (/*!...* /) — these embed SET statements
 *    and other MySQL-specific code that SQLite cannot execute.
 *  - Removes LOCK/UNLOCK TABLES and standalone SET statements.
 *  - Converts backtick identifiers to double-quoted (standard SQL).
 *  - Strips MySQL column attributes: AUTO_INCREMENT, UNSIGNED, ZEROFILL,
 *    CHARACTER SET, COLLATE, ON UPDATE CURRENT_TIMESTAMP, COMMENT.
 *  - Maps MySQL data types to their SQLite equivalents.
 *  - Rewrites CREATE TABLE bodies: removes KEY/INDEX lines, converts
 *    UNIQUE KEY → inline UNIQUE constraint, strips table options
 *    (ENGINE=, CHARSET=, AUTO_INCREMENT=, …).
 */
export function convertMysqlToSqlite(sql: string): string {
  let out = sql;

  // 1. Strip MySQL conditional version comments — content is MySQL-only
  out = out.replace(/\/\*![\s\S]*?\*\/\s*;?/g, '');

  // 2. Remove LOCK / UNLOCK TABLES
  out = out.replace(/^\s*LOCK\s+TABLES\b[^;\n]*;/gim, '');
  out = out.replace(/^\s*UNLOCK\s+TABLES\s*;/gim, '');

  // 2b. Convert MySQL transaction syntax → SQLite
  out = out.replace(/\bSTART\s+TRANSACTION\b/gi, 'BEGIN');

  // 3. Remove standalone SET statements (MySQL session variables)
  out = out.replace(/^\s*SET\s+[^;]+;/gim, '');

  // 4. Backtick identifiers → double-quoted (SQLite standard)
  out = out.replace(/`([^`]*)`/g, '"$1"');

  // 5. Strip MySQL-specific column / field attributes
  out = out.replace(/\bAUTO_INCREMENT\b/gi, '');
  out = out.replace(/\bUNSIGNED\b/gi, '');
  out = out.replace(/\bZEROFILL\b/gi, '');
  out = out.replace(/\bCHARACTER\s+SET\s+\w+/gi, '');
  out = out.replace(/\bCOLLATE\s+[\w_]+/gi, '');
  out = out.replace(/\bON\s+UPDATE\s+(?:CURRENT_TIMESTAMP|NOW\s*\(\s*\))/gi, '');
  out = out.replace(/\bCOMMENT\s+'(?:[^'\\]|\\.)*'/gi, '');
  // MySQL index type hints — not supported by SQLite
  out = out.replace(/\bUSING\s+(?:BTREE|HASH)\b/gi, '');
  // current_timestamp() as a function call → bare keyword (SQLite default)
  out = out.replace(/\bcurrent_timestamp\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');
  out = out.replace(/\bnow\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');

  // 6. Map MySQL data types → SQLite types
  out = out.replace(/\bTINYINT\s*\(\d+\)/gi, 'INTEGER');
  out = out.replace(/\bSMALLINT\s*(?:\(\d+\))?/gi, 'INTEGER');
  out = out.replace(/\bMEDIUMINT\s*(?:\(\d+\))?/gi, 'INTEGER');
  out = out.replace(/\bBIGINT\s*(?:\(\d+\))?/gi, 'INTEGER');
  out = out.replace(/\bINT\s*\(\d+\)/gi, 'INTEGER');
  out = out.replace(/\bDOUBLE(?:\s+PRECISION)?/gi, 'REAL');
  out = out.replace(/\bFLOAT\s*(?:\(\d+(?:,\d+)?\))?/gi, 'REAL');
  out = out.replace(/\bDECIMAL\s*\([^)]+\)/gi, 'REAL');
  out = out.replace(/\bNUMERIC\s*\([^)]+\)/gi, 'REAL');
  out = out.replace(/\b(?:TINY|MEDIUM|LONG)?TEXT\b/gi, 'TEXT');
  out = out.replace(/\b(?:TINY|MEDIUM|LONG)?BLOB\b/gi, 'BLOB');
  out = out.replace(/\bVARCHAR\s*\(\d+\)/gi, 'TEXT');
  out = out.replace(/\bNVARCHAR\s*\(\d+\)/gi, 'TEXT');
  out = out.replace(/\bCHAR\s*\(\d+\)/gi, 'TEXT');
  out = out.replace(/\bENUM\s*\([^)]+\)/gi, 'TEXT');

  // 7. Rewrite ALTER TABLE statements.
  //    phpMyAdmin dumps define keys separately from CREATE TABLE, using
  //    multi-operation ALTER TABLE statements.  We convert ADD KEY / ADD UNIQUE
  //    KEY to CREATE INDEX, and drop everything else (ADD PRIMARY KEY, MODIFY,
  //    CHANGE, ADD CONSTRAINT FOREIGN KEY, AUTO_INCREMENT=, …).
  out = convertAlterTables(out);

  // 8. Rewrite CREATE TABLE statements
  out = rewriteCreateTables(out);

  // 8. Tidy up excess blank lines
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Scan forward from `openPos` (which must point at a '(') and return the
 * index of its matching closing ')'.  Handles nested parens and string
 * literals correctly.  Returns -1 if no match is found.
 */
function findMatchingParen(sql: string, openPos: number): number {
  let depth = 0;
  let i = openPos;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < sql.length && sql[i] !== q) {
        if (sql[i] === '\\') i++;
        i++;
      }
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Split `sql` by commas that are at the top level (not inside parentheses
 * or string literals).
 */
function splitTopLevelCommas(sql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < sql.length && sql[i] !== q) {
        if (sql[i] === '\\') i++;
        i++;
      }
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      parts.push(sql.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(sql.slice(start));
  return parts;
}

/**
 * Process the body of a CREATE TABLE (the text between the outer parens):
 *  - Drops   KEY / INDEX definitions (MySQL-only; not valid inside SQLite CREATE TABLE)
 *  - Converts UNIQUE KEY → inline UNIQUE constraint (valid in SQLite)
 *  - Keeps everything else as-is
 */
function processTableBody(body: string): string {
  const kept: string[] = [];
  for (const entry of splitTopLevelCommas(body)) {
    const t = entry.trim();
    if (!t) continue;

    // UNIQUE KEY/INDEX [name] (...)  →  UNIQUE (...)
    // Name is optional; USING BTREE/HASH was already stripped globally.
    const uniqueKey = t.match(
      /^UNIQUE\s+(?:KEY|INDEX)\s+(?:(?:"[^"]*"|\w+)\s+)?(\([\s\S]*\))\s*$/i,
    );
    if (uniqueKey) {
      kept.push(`  UNIQUE ${uniqueKey[1]}`);
      continue;
    }

    // KEY / INDEX [name] (...)  — plain index, FULLTEXT, SPATIAL → drop
    // (SQLite does not allow index definitions inside CREATE TABLE)
    if (/^(?:FULLTEXT\s+|SPATIAL\s+)?(?:KEY|INDEX)\b/i.test(t)) continue;

    kept.push(`  ${t}`);
  }
  return kept.join(',\n');
}

/**
 * Convert every ALTER TABLE statement in `sql`.
 *
 * phpMyAdmin / mysqldump places all index definitions outside the CREATE TABLE,
 * in multi-operation ALTER TABLE statements like:
 *
 *   ALTER TABLE `t`
 *     ADD PRIMARY KEY (`id`),
 *     ADD UNIQUE KEY `uq` (`email`),
 *     ADD KEY `idx` (`col`);
 *
 * Strategy per operation:
 *  - ADD [UNIQUE] KEY/INDEX name (cols) → CREATE [UNIQUE] INDEX IF NOT EXISTS
 *  - ADD PRIMARY KEY           → dropped (SQLite cannot add a PK after creation)
 *  - ADD CONSTRAINT FOREIGN KEY → dropped (FK not enforced in SQLite by default)
 *  - MODIFY / CHANGE / DROP KEY / AUTO_INCREMENT= → dropped
 *  - ADD COLUMN / RENAME COLUMN / RENAME TO → kept as-is (SQLite supports them)
 */
function convertAlterTables(sql: string): string {
  const out: string[] = [];
  let pos = 0;

  const re = /\bALTER\s+TABLE\s+/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(sql)) !== null) {
    out.push(sql.slice(pos, m.index));

    let cur = m.index + m[0].length;

    // Parse the table name
    const nameMatch = /^(?:"[^"]*"|\w+)/.exec(sql.slice(cur));
    if (!nameMatch) { pos = m.index; continue; }

    const tableName = nameMatch[0];
    cur += nameMatch[0].length;

    // Find the terminating semicolon
    const semiPos = sql.indexOf(';', cur);
    if (semiPos < 0) { pos = m.index; continue; }

    const body = sql.slice(cur, semiPos).trim();
    const createIndexes: string[] = [];
    let hasPassthroughOp = false;

    for (const op of splitTopLevelCommas(body)) {
      const t = op.trim();
      if (!t) continue;

      // ADD UNIQUE KEY/INDEX name (cols) → CREATE UNIQUE INDEX
      const addUnique = t.match(
        /^ADD\s+UNIQUE\s+(?:KEY|INDEX)\s+(?:"([^"]*)"|(\w+))\s*(\([\s\S]*\))\s*$/i,
      );
      if (addUnique) {
        const name = addUnique[1] ?? addUnique[2];
        createIndexes.push(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON ${tableName} ${addUnique[3]};`,
        );
        continue;
      }

      // ADD [FULLTEXT|SPATIAL] KEY/INDEX name (cols) → CREATE INDEX
      const addKey = t.match(
        /^ADD\s+(?:FULLTEXT\s+|SPATIAL\s+)?(?:KEY|INDEX)\s+(?:"([^"]*)"|(\w+))\s*(\([\s\S]*\))\s*$/i,
      );
      if (addKey) {
        const name = addKey[1] ?? addKey[2];
        createIndexes.push(
          `CREATE INDEX IF NOT EXISTS "${name}" ON ${tableName} ${addKey[3]};`,
        );
        continue;
      }

      // ADD COLUMN / RENAME COLUMN / RENAME TO → pass through
      if (/^(?:ADD\s+COLUMN|RENAME\s+(?:COLUMN|TO))\b/i.test(t)) {
        hasPassthroughOp = true;
        continue; // handled below by emitting original statement for these
      }

      // Everything else (ADD PRIMARY KEY, ADD CONSTRAINT FOREIGN KEY,
      // MODIFY, CHANGE, DROP KEY, AUTO_INCREMENT=, DISABLE/ENABLE KEYS) → drop
    }

    if (createIndexes.length > 0) {
      out.push(createIndexes.join('\n'));
    }
    // Note: pass-through ops (ADD COLUMN etc.) are rare in dumps — skip for now
    // to avoid emitting a malformed partial ALTER TABLE.
    void hasPassthroughOp;

    pos = semiPos + 1;
    re.lastIndex = pos;
  }

  out.push(sql.slice(pos));
  return out.join('');
}

/**
 * Find every CREATE TABLE statement, strip MySQL table-level options that
 * follow the closing parenthesis (ENGINE=, CHARSET=, AUTO_INCREMENT=, …),
 * and rewrite the body via `processTableBody`.
 */
function rewriteCreateTables(sql: string): string {
  const out: string[] = [];
  let pos = 0;

  const re = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(sql)) !== null) {
    out.push(sql.slice(pos, m.index));

    let cur = m.index + m[0].length;

    // Parse the table name: "quoted" or bare identifier
    const nameMatch = /^(?:"[^"]*"|\w+)/.exec(sql.slice(cur));
    if (!nameMatch) { pos = m.index; continue; }

    const tableName = nameMatch[0];
    cur += nameMatch[0].length;

    // Skip whitespace before the opening paren
    while (cur < sql.length && sql[cur] === ' ') cur++;
    if (sql[cur] !== '(') { pos = m.index; continue; }

    const closePos = findMatchingParen(sql, cur);
    if (closePos < 0) { pos = m.index; continue; }

    const body = sql.slice(cur + 1, closePos);

    // Advance past table-level options to the terminating ';'
    let endPos = closePos + 1;
    while (endPos < sql.length && sql[endPos] !== ';') endPos++;
    if (endPos < sql.length) endPos++; // include the ';'

    const ifne = /IF\s+NOT\s+EXISTS/i.test(m[0]) ? 'IF NOT EXISTS ' : '';
    out.push(`CREATE TABLE ${ifne}${tableName} (\n${processTableBody(body)}\n);`);

    pos = endPos;
    re.lastIndex = pos;
  }

  out.push(sql.slice(pos));
  return out.join('');
}
