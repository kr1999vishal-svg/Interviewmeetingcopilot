/**
 * Minimal, dependency-free PDF generator for text documents.
 *
 * Produces a multi-page PDF using the standard Helvetica / Helvetica-Bold
 * fonts (no embedding required). Supports basic blocks with bold + size, word
 * wrapping, and automatic pagination. Sufficient for exporting summaries.
 */

export interface PdfBlock {
  text: string;
  bold?: boolean;
  size?: number;
  /** Extra vertical space (pt) added after the block. */
  gap?: number;
}

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 56;
const USABLE_W = PAGE_W - MARGIN * 2;

/** Escape characters that are special inside PDF string literals. */
const escapeText = (s: string): string =>
  s
    // Drop characters outside Latin-1 (standard fonts can't render them).
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

/** Approximate Helvetica text width (avg glyph ~0.5em). */
const maxCharsForSize = (size: number): number =>
  Math.max(8, Math.floor(USABLE_W / (size * 0.5)));

function wrap(text: string, size: number): string[] {
  const limit = maxCharsForSize(size);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit && current) {
      lines.push(current);
      current = word;
    } else if (candidate.length > limit) {
      // Single word longer than the line: hard-split it.
      for (let i = 0; i < word.length; i += limit) {
        lines.push(word.slice(i, i + limit));
      }
      current = '';
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface PositionedLine {
  text: string;
  bold: boolean;
  size: number;
}

/** Build the PDF and return it as a Blob. */
export function generatePdf(blocks: PdfBlock[]): Blob {
  // 1. Lay out blocks into pages.
  const pages: PositionedLine[][] = [];
  let page: PositionedLine[] = [];
  let y = PAGE_H - MARGIN;

  const pushPage = () => {
    pages.push(page);
    page = [];
    y = PAGE_H - MARGIN;
  };

  for (const block of blocks) {
    const size = block.size ?? 11;
    const lineHeight = size * 1.35;
    const wrapped = wrap(block.text, size);
    for (const line of wrapped) {
      if (y - lineHeight < MARGIN) pushPage();
      page.push({ text: line, bold: Boolean(block.bold), size });
      y -= lineHeight;
    }
    y -= block.gap ?? 4;
  }
  if (page.length > 0) pages.push(page);
  if (pages.length === 0) pages.push([]);

  // 2. Build content streams for each page.
  const contentStreams = pages.map((lines) => {
    let stream = 'BT\n';
    let cursorY = PAGE_H - MARGIN;
    let first = true;
    for (const line of lines) {
      const font = line.bold ? '/F2' : '/F1';
      const lineHeight = line.size * 1.35;
      if (first) {
        stream += `1 0 0 1 ${MARGIN} ${cursorY.toFixed(2)} Tm\n`;
        first = false;
      } else {
        stream += `0 -${lineHeight.toFixed(2)} Td\n`;
      }
      cursorY -= lineHeight;
      stream += `${font} ${line.size} Tf\n`;
      stream += `(${escapeText(line.text)}) Tj\n`;
    }
    stream += 'ET';
    return stream;
  });

  // 3. Assemble PDF objects. Object numbering:
  //    1: Catalog, 2: Pages, 3: Font F1, 4: Font F2,
  //    then per page: page object + content object.
  const objects: string[] = [];
  const pageObjNums: number[] = [];
  const baseObjs = 4;
  pages.forEach((_, i) => {
    pageObjNums.push(baseObjs + 1 + i * 2);
  });

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums
    .map((n) => `${n} 0 R`)
    .join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  pages.forEach((_, i) => {
    const pageNum = baseObjs + 1 + i * 2;
    const contentNum = pageNum + 1;
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`;
    const stream = contentStreams[i];
    objects[contentNum] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // 4. Serialize with a cross-reference table.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    if (objects[i] === undefined) continue;
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  const total = objects.length; // highest obj number + 1
  pdf += `xref\n0 ${total}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < total; i++) {
    if (offsets[i] === undefined) {
      pdf += '0000000000 65535 f \n';
    } else {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
  }
  pdf += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  // Convert the Latin-1 string to bytes so offsets line up exactly.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}
