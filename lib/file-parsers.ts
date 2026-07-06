'use client';

// 文件解析器 —— 在前端将 Excel/Word/PDF 文件转换为行数据

import * as XLSX from 'xlsx';

export interface ParsedSheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ParsedFileData {
  fileName: string;
  fileType: 'excel' | 'word' | 'pdf';
  sheets: ParsedSheetData[];
  rawText?: string;
  metadata: {
    rowCount: number;
    sheetCount: number;
    columnCount: number;
  };
}

/** 读取 Excel 文件的所有 Sheet */
export async function parseExcelFile(file: File): Promise<ParsedFileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheets: ParsedSheetData[] = [];
        let totalRows = 0;
        let maxCols = 0;

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
            defval: '',
            header: 1,
          });

          if (json.length === 0) {
            sheets.push({ sheetName, headers: [], rows: [] });
            continue;
          }

          // 使用第一行作为默认表头
          const rawHeaders = json[0] as unknown[];
          const headers = rawHeaders.map((h, i) => String(h ?? `Column_${i}`));

          // 转换为带表头的行对象
          const rows: Record<string, unknown>[] = [];
          for (let i = 1; i < json.length; i++) {
            const rowData = json[i] as unknown[];
            const row: Record<string, unknown> = {};
            headers.forEach((header, colIdx) => {
              row[header] = rowData[colIdx] != null ? rowData[colIdx] : '';
            });
            rows.push(row);
          }

          totalRows += rows.length;
          maxCols = Math.max(maxCols, headers.length);
          sheets.push({ sheetName, headers, rows });
        }

        resolve({
          fileName: file.name,
          fileType: 'excel',
          sheets,
          metadata: {
            rowCount: totalRows,
            sheetCount: sheets.length,
            columnCount: maxCols,
          },
        });
      } catch (err) {
        reject(new Error(`Excel 文件解析失败: ${err}`));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

/** 读取 Word 文件提取文本 */
export async function parseWordFile(file: File): Promise<ParsedFileData> {
  try {
    const mammoth = (await import('mammoth')).default;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;

    // Word 以纯文本形式解析
    return {
      fileName: file.name,
      fileType: 'word',
      sheets: [
        {
          sheetName: 'Word文档内容',
          headers: ['text'],
          rows: text.split('\n').map((line) => ({ text: line })),
        },
      ],
      rawText: text,
      metadata: {
        rowCount: text.split('\n').length,
        sheetCount: 1,
        columnCount: 1,
      },
    };
  } catch (err) {
    throw new Error(`Word 文件解析失败: ${err}`);
  }
}

/** 读取 PDF 文件提取文本 */
export async function parsePdfFile(file: File): Promise<ParsedFileData> {
  try {
    // 动态导入 pdfjs-dist
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const allText: string[] = [];
    const allRows: Record<string, unknown>[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      let lastY: number | null = null;
      let currentLine = '';

      for (const item of content.items) {
        if ('str' in item && 'transform' in item) {
          const textItem = item as { str: string; transform: number[] };
          const y = textItem.transform[5];

          if (lastY !== null && Math.abs(y - lastY) > 2) {
            allText.push(currentLine.trim());
            allRows.push({ text: currentLine.trim(), page: pageNum });
            currentLine = '';
          }
          currentLine += textItem.str + ' ';
          lastY = y;
        }
      }
      if (currentLine.trim()) {
        allText.push(currentLine.trim());
        allRows.push({ text: currentLine.trim(), page: pageNum });
      }
    }

    const text = allText.join('\n');

    return {
      fileName: file.name,
      fileType: 'pdf',
      sheets: [
        {
          sheetName: 'PDF内容',
          headers: ['text', 'page'],
          rows: allRows,
        },
      ],
      rawText: text,
      metadata: {
        rowCount: allRows.length,
        sheetCount: 1,
        columnCount: 2,
      },
    };
  } catch (err) {
    throw new Error(`PDF 文件解析失败: ${err}`);
  }
}

/** 统一文件解析入口 */
export async function parseFile(file: File): Promise<ParsedFileData> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'xlsx' || ext === 'xls') {
    return parseExcelFile(file);
  } else if (ext === 'docx' || ext === 'doc') {
    return parseWordFile(file);
  } else if (ext === 'pdf') {
    return parsePdfFile(file);
  }

  throw new Error(`不支持的文件格式: .${ext}`);
}

/** 获取文件类型的预览信息（用于 AI 分析） */
export function getPreviewForAI(data: ParsedFileData): unknown {
  if (data.fileType === 'excel') {
    return {
      fileName: data.fileName,
      fileType: data.fileType,
      sheets: data.sheets.map((sheet) => ({
        name: sheet.sheetName,
        headers: sheet.headers,
        rowCount: sheet.rows.length,
        sampleRows: sheet.rows.slice(0, 5),
        sampleRowsTail: sheet.rows.slice(Math.max(0, sheet.rows.length - 5)),
      })),
    };
  }

  return {
    fileName: data.fileName,
    fileType: data.fileType,
    rawText: (data.rawText || '').slice(0, 3000),
    lineCount: data.metadata.rowCount,
  };
}
