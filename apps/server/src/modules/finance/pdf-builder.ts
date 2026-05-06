/**
 * Minimal hand-rolled PDF builder for accountant export statements.
 * Produces a single-font (Helvetica) text-only PDF with a simple
 * left-aligned line layout, paginated automatically. No external deps —
 * keeps the server bundle slim. Reused by AccountantExportService for
 * P&L, Cashflow and Balance Sheet PDFs.
 */
const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_Y = 54;
const LINE_HEIGHT = 14;
const FONT_SIZE = 11;
const TITLE_SIZE = 18;
const HEADING_SIZE = 13;
const MAX_LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN_Y * 2) / LINE_HEIGHT);

export type PdfLine =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'row'; left: string; right: string }
  | { kind: 'rule' }
  | { kind: 'spacer' };

function escapePdf(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function renderPage(lines: PdfLine[]): string {
  let y = PAGE_HEIGHT - MARGIN_Y;
  const ops: string[] = [];
  for (const line of lines) {
    if (line.kind === 'spacer') {
      y -= LINE_HEIGHT;
      continue;
    }
    if (line.kind === 'rule') {
      ops.push(
        `${MARGIN_X} ${y} m ${PAGE_WIDTH - MARGIN_X} ${y} l S`,
      );
      y -= LINE_HEIGHT;
      continue;
    }
    const size =
      line.kind === 'title' ? TITLE_SIZE :
      line.kind === 'heading' ? HEADING_SIZE :
      FONT_SIZE;
    if (line.kind === 'row') {
      ops.push(
        `BT /F1 ${size} Tf ${MARGIN_X} ${y - size} Td (${escapePdf(line.left)}) Tj ET`,
      );
      // Right-align: approximate by pushing far right. Width estimate is
      // good enough for currency figures (avg char width ~ size*0.5).
      const approxWidth = line.right.length * size * 0.55;
      const rightX = PAGE_WIDTH - MARGIN_X - approxWidth;
      ops.push(
        `BT /F1 ${size} Tf ${rightX} ${y - size} Td (${escapePdf(line.right)}) Tj ET`,
      );
    } else {
      ops.push(
        `BT /F1 ${size} Tf ${MARGIN_X} ${y - size} Td (${escapePdf(line.text)}) Tj ET`,
      );
    }
    y -= line.kind === 'title' ? LINE_HEIGHT * 2 : LINE_HEIGHT;
  }
  return ops.join('\n');
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let count = 0;
  for (const line of lines) {
    const cost = line.kind === 'title' ? 2 : 1;
    if (count + cost > MAX_LINES_PER_PAGE) {
      pages.push(current);
      current = [];
      count = 0;
    }
    current.push(line);
    count += cost;
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([{ kind: 'text', text: '(empty)' }]);
  return pages;
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const pages = paginate(lines);
  const objects: string[] = [];

  // Object indices we know up front:
  // 1: Catalog, 2: Pages, 3: Font
  // Then for each page: page object + content stream object
  const pageObjIds: number[] = [];
  const contentObjIds: number[] = [];
  let nextId = 4;
  for (let i = 0; i < pages.length; i++) {
    pageObjIds.push(nextId++);
    contentObjIds.push(nextId++);
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`);
  const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>\nendobj`,
  );
  objects.push(
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
  );

  for (let i = 0; i < pages.length; i++) {
    const content = renderPage(pages[i]);
    const stream = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
    objects.push(
      `${pageObjIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjIds[i]} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj`,
    );
    objects.push(`${contentObjIds[i]} 0 obj\n${stream}\nendobj`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj + '\n';
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  const total = objects.length + 1;
  pdf += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += off.toString().padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}
