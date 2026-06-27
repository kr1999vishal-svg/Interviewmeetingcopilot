import fs from 'fs';
import path from 'path';
// @ts-ignore
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import xlsx from 'xlsx';

export interface FileContext {
  fileId: string;
  fileName: string;
  content: string;
}


export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        return await extractFromPDF(filePath);
      case '.doc':
      case '.docx':
        return await extractFromWord(filePath);
      case '.xls':
      case '.xlsx':
        return await extractFromExcel(filePath);
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    console.error(`Error extracting text from ${filePath}:`, error);
    throw error;
  }
}

async function extractFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  // @ts-ignore
  const data = await pdf(dataBuffer);
  return data.text;
}

async function extractFromWord(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function extractFromExcel(filePath: string): Promise<string> {
  const workbook = xlsx.readFile(filePath);
  const sheets = workbook.SheetNames;
  let text = '';
  
  for (const sheetName of sheets) {
    const worksheet = workbook.Sheets[sheetName];
    const sheetText = xlsx.utils.sheet_to_txt(worksheet);
    text += `Sheet: ${sheetName}\n${sheetText}\n\n`;
  }
  
  return text;
}

export async function getFileContext(fileIds: string[]): Promise<FileContext[]> {
  const contexts: FileContext[] = [];
  
  for (const fileId of fileIds) {
    try {
      const filePath = path.join(process.cwd(), 'uploads', fileId);
      
      if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${fileId}`);
        continue;
      }
      
      const content = await extractTextFromFile(filePath, '');
      contexts.push({
        fileId,
        fileName: fileId,
        content: content.substring(0, 10000), // Limit to 10k chars per file
      });
    } catch (error) {
      console.error(`Error processing file ${fileId}:`, error);
    }
  }
  
  return contexts;
}

export function formatFileContextForAI(contexts: FileContext[]): string {
  if (contexts.length === 0) return '';
  
  let formatted = '\n\n--- Attached Documents Context ---\n';
  
  for (const ctx of contexts) {
    formatted += `\nDocument: ${ctx.fileName}\n`;
    formatted += `${ctx.content}\n`;
  }
  
  formatted += '--- End of Documents ---\n';
  
  return formatted;
}
