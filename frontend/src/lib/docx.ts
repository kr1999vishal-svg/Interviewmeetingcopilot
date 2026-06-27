import JSZip from 'jszip';

/**
 * Minimal, dependency-light DOCX (OOXML) generator.
 *
 * A .docx is a ZIP of XML parts. We build the smallest valid package that
 * Microsoft Word and compatible readers accept, using inline run properties
 * (bold + size) instead of a separate styles part.
 */

export interface DocxBlock {
  text: string;
  bold?: boolean;
  /** Font size in points (defaults to 11). */
  size?: number;
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function paragraph(block: DocxBlock): string {
  const sizeHalfPts = (block.size ?? 11) * 2; // OOXML uses half-points
  const rPr =
    `<w:rPr>${block.bold ? '<w:b/>' : ''}` +
    `<w:sz w:val="${sizeHalfPts}"/><w:szCs w:val="${sizeHalfPts}"/></w:rPr>`;
  return (
    `<w:p><w:pPr>${rPr}</w:pPr>` +
    `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`
  );
}

function buildDocumentXml(blocks: DocxBlock[]): string {
  const body = blocks.map(paragraph).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

/** Build the DOCX and return it as a Blob. */
export async function generateDocx(blocks: DocxBlock[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels')!.file('.rels', ROOT_RELS);
  zip.folder('word')!.file('document.xml', buildDocumentXml(blocks));
  return zip.generateAsync({
    type: 'blob',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
