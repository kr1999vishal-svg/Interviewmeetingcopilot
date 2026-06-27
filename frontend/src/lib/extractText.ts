import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser';
import JSZip from 'jszip';

// pdf.js needs a web worker; point it at the bundled worker asset.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Cap stored text so a single document can't exhaust localStorage. */
export const MAX_TEXT_LENGTH = 100_000;

export interface ExtractionResult {
  text: string;
  truncated: boolean;
}

const finalize = (raw: string): ExtractionResult => {
  const text = raw.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (text.length > MAX_TEXT_LENGTH) {
    return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: true };
  }
  return { text, truncated: false };
};

const extensionOf = (name: string): string =>
  name.split('.').pop()?.toLowerCase() ?? '';

/** Decode the handful of XML entities that appear in OOXML text runs. */
const decodeXml = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

async function extractPdf(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join('\n\n');
}

async function extractDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function extractTxt(file: File): Promise<string> {
  return file.text();
}

async function extractPptx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });

  const slides: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async('string');
    const runs = xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [];
    const slideText = runs
      .map((run) => decodeXml(run.replace(/<\/?a:t>/g, '')))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    slides.push(`--- Slide ${i + 1} ---\n${slideText}`);
  }
  return slides.join('\n\n');
}

/**
 * Reusable text-extraction service. Converts a supported document
 * (PDF, DOCX, TXT, PPTX) into plain text.
 *
 * @throws Error when the file type is unsupported or parsing fails.
 */
export async function extractText(file: File): Promise<ExtractionResult> {
  const ext = extensionOf(file.name);
  let raw: string;
  switch (ext) {
    case 'pdf':
      raw = await extractPdf(file);
      break;
    case 'docx':
      raw = await extractDocx(file);
      break;
    case 'txt':
      raw = await extractTxt(file);
      break;
    case 'pptx':
      raw = await extractPptx(file);
      break;
    default:
      throw new Error(`No text extractor available for ".${ext}" files.`);
  }
  return finalize(raw);
}
