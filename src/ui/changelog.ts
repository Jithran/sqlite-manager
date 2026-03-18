/**
 * Releases modal — parses CHANGELOG.md and renders collapsible version sections.
 *
 * CHANGELOG.md is inlined at build time via Vite's `?raw` import.
 */

import changelogRaw from '../../CHANGELOG.md?raw';

// ── Parser ────────────────────────────────────────────────────────────────────

interface Section {
  title: string;
  body: string;
}

function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  const regex = /^## \[([^\]]+)\](.*?)$/gm;
  let match: RegExpExecArray | null;
  let lastTitle = '';
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (lastTitle) {
      sections.push({ title: lastTitle, body: text.slice(lastIndex, match.index) });
    }
    lastTitle = match[1] + match[2];
    lastIndex = match.index + match[0].length;
  }
  if (lastTitle) {
    sections.push({ title: lastTitle, body: text.slice(lastIndex) });
  }

  // Drop empty [Unreleased] sections (nothing to show yet)
  return sections.filter((s) => {
    if (s.title.trim() !== 'Unreleased') return true;
    return s.body.replace(/^---$/gm, '').trim().length > 0;
  });
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/** Escape HTML then apply inline markdown: **bold**, `code`. */
function renderInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Convert markdown body (### headings + - bullets) to HTML. */
function renderBody(text: string): string {
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h5 class="cl-sub">${renderInline(line.slice(4))}</h5>`;
    } else if (line.startsWith('- ')) {
      if (!inList) { html += '<ul class="cl-entries">'; inList = true; }
      html += `<li>${renderInline(line.slice(2))}</li>`;
    } else if (line.startsWith('---') || line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function buildSection(section: Section, open: boolean): HTMLElement {
  const item = document.createElement('div');
  item.className = 'cl-item';

  const btn = document.createElement('button');
  btn.className = open ? 'cl-header cl-open' : 'cl-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'cl-title';
  titleSpan.textContent = section.title;

  const chevron = document.createElement('span');
  chevron.className = 'cl-chevron';
  chevron.textContent = '▾';

  btn.appendChild(titleSpan);
  btn.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'cl-body';
  body.innerHTML = renderBody(section.body);
  if (!open) body.style.display = 'none';

  btn.addEventListener('click', () => {
    const isOpen = btn.classList.toggle('cl-open');
    body.style.display = isOpen ? '' : 'none';
  });

  item.appendChild(btn);
  item.appendChild(body);
  return item;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function showReleases(): void {
  document.getElementById('releases-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'releases-modal';
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box';

  // Header
  const header = document.createElement('div');
  header.className = 'modal-header';

  const title = document.createElement('span');
  title.className = 'modal-title';
  title.textContent = 'Releases';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon modal-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Content
  const content = document.createElement('div');
  content.className = 'modal-content';

  const list = document.createElement('div');
  list.className = 'cl-list';

  const sections = parseSections(changelogRaw);
  if (sections.length === 0) {
    list.textContent = 'No releases yet.';
  } else {
    sections.forEach((s, i) => list.appendChild(buildSection(s, i === 0)));
  }

  content.appendChild(list);
  box.appendChild(header);
  box.appendChild(content);
  overlay.appendChild(box);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  // Close on Escape
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}
