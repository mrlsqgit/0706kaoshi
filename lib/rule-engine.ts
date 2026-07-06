// 规则引擎核心 —— 根据解析规则将原始数据转换为结构化运单数据

import {
  ParseRule,
  OrderRecord,
  ValidationError,
  OrderField,
  ColumnMapping,
  ProcessorConfig,
  TailInfoExtractionOptions,
  CrossRowAggregationOptions,
  MatrixTransposeOptions,
  CardDetectionOptions,
  TextParsingOptions,
  MultiOrderSplitOptions,
} from './types';

// ====== 工具函数 ======

/** 从一行数据中提取字段值 */
function extractField(row: Record<string, unknown>, colIndex: number | string, headers?: string[]): string {
  if (typeof colIndex === 'number') {
    // 按列索引
    const keys = Object.keys(row);
    if (colIndex < keys.length) {
      return String(row[keys[colIndex]] ?? '');
    }
    return '';
  }
  // 按列名
  const val = row[colIndex];
  return val != null ? String(val).trim() : '';
}

/** 解析数量 */
function parseQuantity(val: string): number {
  const cleaned = String(val).replace(/[^\d.]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) || num <= 0 ? 0 : num;
}

/** 解析正则匹配 */
function extractByPattern(text: string, pattern: string): string {
  try {
    const match = text.match(new RegExp(pattern, 'i'));
    return match ? (match[1] || match[0] || '').trim() : '';
  } catch {
    return '';
  }
}

// ====== 行处理 ======

/** 跳过头部行 */
function skipHeaderRows(rows: Record<string, unknown>[], count: number): Record<string, unknown>[] {
  return rows.slice(count);
}

/** 跳过尾部行 */
function skipFooterRows(rows: Record<string, unknown>[], count: number): Record<string, unknown>[] {
  return rows.slice(0, Math.max(0, rows.length - count));
}

/** 跳过汇总行/空行 */
function skipSummaryAndEmpty(
  rows: Record<string, unknown>[],
  rule: ParseRule
): Record<string, unknown>[] {
  return rows.filter((row) => {
    if (rule.skipEmptyRows) {
      const allEmpty = Object.values(row).every(
        (v) => v == null || String(v).trim() === ''
      );
      if (allEmpty) return false;
    }
    if (rule.skipSummaryRows && rule.summaryRowKeywords.length > 0) {
      const rowText = Object.values(row).map(v => String(v ?? '')).join(' ');
      for (const kw of rule.summaryRowKeywords) {
        if (rowText.includes(kw)) return false;
      }
    }
    return true;
  });
}

// ====== 列映射 ======

function applyColumnMappings(
  rows: Record<string, unknown>[],
  mappings: ColumnMapping[],
  headers?: string[]
): Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] {
  return rows.map((row) => {
    const record: Record<string, string | number> = {};

    for (const mapping of mappings) {
      let value = '';

      switch (mapping.sourceType) {
        case 'column':
          value = extractField(row, mapping.sourceColumn ?? '', headers);
          break;
        case 'static':
          value = mapping.staticValue ?? '';
          break;
        case 'cellPattern':
          if (mapping.sourcePattern) {
            const raw = extractField(row, mapping.sourceColumn ?? '', headers);
            value = extractByPattern(raw, mapping.sourcePattern);
          }
          break;
        case 'aiInfer':
          // AI 推断字段，后续由 AI 处理
          value = '';
          break;
        case 'tailExtract':
          // 尾部提取字段，由 tailInfoExtraction 处理器处理
          value = '';
          break;
      }

      if (mapping.targetField === 'skuQuantity') {
        (record as Record<string, unknown>)[mapping.targetField] = parseQuantity(value);
      } else {
        (record as Record<string, unknown>)[mapping.targetField] = value;
      }
    }

    return record as unknown as Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>;
  });
}

// ====== 处理器 ======

/** 尾部信息提取 */
function processTailInfoExtraction(
  allRows: Record<string, unknown>[],
  options: TailInfoExtractionOptions
): Record<string, string> {
  const tailInfo: Record<string, string> = {};
  const tailRows = allRows.slice(Math.max(0, allRows.length - options.tailRowsCount));

  for (const mapping of options.fieldMappings) {
    for (const row of tailRows) {
      const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();
      if (new RegExp(mapping.keywordPattern, 'i').test(rowText)) {
        tailInfo[mapping.targetField] = extractByPattern(rowText, mapping.extractPattern);
        break;
      }
      // 也检查第一列是否包含关键词
      const firstCol = Object.values(row)[0];
      if (firstCol != null && new RegExp(mapping.keywordPattern, 'i').test(String(firstCol))) {
        const fullText = Object.values(row).slice(1).map(v => String(v ?? '')).join(' ').trim();
        tailInfo[mapping.targetField] = fullText || extractByPattern(rowText, mapping.extractPattern);
        break;
      }
    }
  }

  return tailInfo;
}

/** 跨行聚合 */
function processCrossRowAggregation(
  records: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[],
  options: CrossRowAggregationOptions
): typeof records {
  const groups = new Map<string, typeof records>();
  const order: string[] = [];

  for (const record of records) {
    const key = String((record as Record<string, unknown>)[options.groupByField] ?? '');
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(record);
  }

  const result: typeof records = [];
  for (const key of order) {
    const group = groups.get(key)!;
    // 第一条记录保留收货信息
    const first = { ...group[0] };

    // 后续记录作为额外的 SKU 行
    for (let i = 0; i < group.length; i++) {
      if (i === 0) {
        result.push(first);
      } else {
        // 复制收货信息，保留自己的 SKU 信息
        result.push({ ...group[i] });
      }
    }
  }

  return result;
}

/** 矩阵转置 */
function processMatrixTranspose(
  records: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[],
  options: MatrixTransposeOptions,
  headers: string[]
): typeof records {
  if (records.length === 0 || headers.length === 0) return records;

  const result: typeof records = [];
  const colHeaderStartIdx = options.columnHeaderStartIndex;

  // 获取转置列头（门店名/日期等）
  const transposeHeaders = headers.slice(colHeaderStartIdx);

  for (const record of records) {
    const recordObj = record as Record<string, unknown>;

    for (let i = 0; i < transposeHeaders.length; i++) {
      const headerName = transposeHeaders[String(i)] ?? transposeHeaders[i];
      const headerKey = Object.keys(recordObj)[colHeaderStartIdx + i];
      const cellValue = headerKey ? String(recordObj[headerKey] ?? '') : '';

      if (!cellValue || cellValue.trim() === '') continue;

      // 检查是否需要拆分复合单元格
      if (options.cellSplitSeparator) {
        const items = cellValue.split(options.cellSplitSeparator).filter(s => s.trim());
        for (const item of items) {
          const newRecord = { ...recordObj };
          newRecord[options.columnValueField as string] = headerName;

          // 解析复合项: "物品名x数量" 格式
          if (options.cellSplitItemFormat) {
            const parts = item.trim().split(options.cellSplitItemFormat);
            if (parts.length >= 1) {
              // 尝试匹配 "物品名x数量"
              const match = item.trim().match(/^(.+?)[xX×]\s*(\d+)$/);
              if (match) {
                newRecord[options.columnValueField as string] = headerName;
                // 存储 SKU 信息
                const skuFields = ['skuName', 'skuCode', 'skuQuantity'];
                const nameField = options.rowIdentifierFields.find(
                  f => f === 'skuName'
                );
                const qtyField = 'skuQuantity' as string;
                if (nameField) {
                  newRecord[nameField as string] = match[1].trim();
                }
                newRecord[qtyField] = parseInt(match[2], 10);
              }
            }
          }
          result.push(newRecord);
        }
      } else {
        const newRecord = { ...recordObj };
        newRecord[options.columnValueField as string] = headerName;
        result.push(newRecord);
      }
    }
  }

  return result;
}

/** 卡片检测 */
function processCardDetection(
  allRows: Record<string, unknown>[],
  options: CardDetectionOptions
): { records: Record<string, unknown>[][]; cardInfos: Record<string, string>[] } {
  const cards: Record<string, unknown>[][] = [];
  const cardInfos: Record<string, string>[] = [];
  let currentCard: Record<string, unknown>[] = [];

  for (const row of allRows) {
    const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();

    if (new RegExp(options.cardStartKeyword, 'i').test(rowText)) {
      if (currentCard.length > 0) {
        cards.push(currentCard);
      }
      currentCard = [];
      continue;
    }

    currentCard.push(row);
  }

  if (currentCard.length > 0) {
    cards.push(currentCard);
  }

  // 为每个卡片解析内部字段
  for (const cardRows of cards) {
    const info: Record<string, string> = {};
    for (const mapping of options.internalFieldPatterns) {
      for (const row of cardRows) {
        const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();
        if (new RegExp(mapping.keyword, 'i').test(rowText)) {
          if (mapping.extractPattern) {
            info[mapping.targetField] = extractByPattern(rowText, mapping.extractPattern);
          } else {
            info[mapping.targetField] = rowText.replace(new RegExp(mapping.keyword, 'i'), '').trim();
          }
          break;
        }
      }
    }
    cardInfos.push(info);
  }

  return { records: cards, cardInfos };
}

/** 文本解析 */
function processTextParsing(
  text: string,
  options: TextParsingOptions
): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  const parts = text.split(new RegExp(options.recordSeparator)).filter(s => s.trim());

  for (const part of parts) {
    const record: Record<string, string> = {};
    for (const fp of options.fieldPatterns) {
      try {
        const match = part.match(new RegExp(fp.pattern, 'i'));
        if (match) {
          record[fp.targetField] = (fp.group != null ? match[fp.group] : match[0] || '').trim();
        }
      } catch {
        // 正则错误，跳过
      }
    }
    if (Object.keys(record).length > 0) {
      records.push(record);
    }
  }

  return records;
}

// ====== 主解析函数 ======

export function executeParse(
  rawRows: Record<string, unknown>[],
  headers: string[],
  rule: ParseRule,
  rawText?: string
): Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] {
  let rows = [...rawRows];
  const tailInfo: Record<string, string> = {};

  // 1. 跳过头部/尾部
  rows = skipHeaderRows(rows, rule.headerRowsToSkip);
  rows = skipFooterRows(rows, rule.footerRowsToSkip);

  // 2. 跳过汇总/空行
  rows = skipSummaryAndEmpty(rows, rule);

  // 3. 执行处理器
  let needsCardMode = false;
  let processedRecords: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] = [];

  for (const proc of rule.processors) {
    if (!proc.enabled) continue;

    switch (proc.type) {
      case 'tailInfoExtraction': {
        const opts = proc.options as unknown as TailInfoExtractionOptions;
        Object.assign(tailInfo, processTailInfoExtraction(rawRows, opts));
        break;
      }

      case 'crossRowAggregation':
        needsCardMode = false;
        break;

      case 'matrixTranspose': {
        const opts = proc.options as unknown as MatrixTransposeOptions;
        const mapped = applyColumnMappings(rows, rule.columnMappings, headers);
        processedRecords = processMatrixTranspose(mapped, opts, headers);
        break;
      }

      case 'cardDetection': {
        needsCardMode = true;
        const opts = proc.options as unknown as CardDetectionOptions;
        const { records: cardRows, cardInfos } = processCardDetection(rawRows, opts);
        processedRecords = [];
        for (let i = 0; i < cardRows.length; i++) {
          const cardMapped = applyColumnMappings(cardRows[i], rule.columnMappings, headers);
          for (const rec of cardMapped) {
            const merged = { ...rec, ...cardInfos[i] };
            processedRecords.push(merged);
          }
        }
        break;
      }
    }
  }

  // 4. 如果没有特殊处理器，直接列映射
  if (!needsCardMode && processedRecords.length === 0) {
    processedRecords = applyColumnMappings(rows, rule.columnMappings, headers);
  }

  // 5. 执行聚合（在列映射之后）
  for (const proc of rule.processors) {
    if (!proc.enabled) continue;
    if (proc.type === 'crossRowAggregation') {
      const opts = proc.options as unknown as CrossRowAggregationOptions;
      processedRecords = processCrossRowAggregation(processedRecords, opts);
    }
  }

  // 6. 注入尾部提取的信息到每条记录
  if (Object.keys(tailInfo).length > 0) {
    processedRecords = processedRecords.map((rec) => ({
      ...rec,
      ...tailInfo,
    }));
  }

  return processedRecords;
}

// ====== 数据校验 ======

export function validateRecords(records: OrderRecord[]): OrderRecord[] {
  const errors: Map<number, ValidationError[]> = new Map();

  function addError(rowIdx: number, field: OrderField, message: string) {
    if (!errors.has(rowIdx)) errors.set(rowIdx, []);
    errors.get(rowIdx)!.push({ row: rowIdx + 1, field, message });
  }

  records.forEach((record, idx) => {
    // A组 vs B组 二选一校验
    const hasGroupA = !!(record.storeName && record.storeName.trim());
    const hasGroupB = !!(
      record.receiverName?.trim() &&
      record.receiverPhone?.trim() &&
      record.receiverAddress?.trim()
    );
    if (!hasGroupA && !hasGroupB) {
      addError(idx, 'storeName', 'A组(收货门店) 和 B组(收件人信息) 至少填一组');
    }

    // SKU 必填校验
    if (!record.skuCode?.trim()) {
      addError(idx, 'skuCode', 'SKU物品编码为必填项');
    }
    if (!record.skuName?.trim()) {
      addError(idx, 'skuName', 'SKU物品名称为必填项');
    }

    const qty = typeof record.skuQuantity === 'number'
      ? record.skuQuantity
      : parseFloat(String(record.skuQuantity));
    if (!qty || qty <= 0) {
      addError(idx, 'skuQuantity', 'SKU发货数量必须为正数');
    }

    // 电话格式校验
    if (record.receiverPhone?.trim()) {
      const phone = record.receiverPhone.replace(/\s/g, '');
      if (!/^1[3-9]\d{9}$/.test(phone) && phone.length > 0) {
        // 宽松校验：如果是纯数字且长度合理
        if (!/^[\d\-（）()]+$/.test(phone)) {
          addError(idx, 'receiverPhone', '收件人电话格式不正确');
        }
      }
    }
  });

  // 附加错误信息到记录
  return records.map((record, idx) => ({
    ...record,
    _rowIndex: idx,
    _errors: errors.get(idx) || [],
    _duplicateWith: undefined,
  }));
}

// ====== 外部编码重复检测 ======

export function checkDuplicates(
  records: OrderRecord[],
  existingCodes: Set<string>
): OrderRecord[] {
  const codeMap = new Map<string, number[]>(); // code -> [row indices]

  records.forEach((record, idx) => {
    const code = record.externalCode?.trim();
    if (!code) return;
    if (!codeMap.has(code)) codeMap.set(code, []);
    codeMap.get(code)!.push(idx);
  });

  const duplicateStatus = new Map<number, string>(); // rowIdx -> message

  for (const [code, indices] of codeMap) {
    if (existingCodes.has(code)) {
      indices.forEach((idx) => {
        duplicateStatus.set(idx, '与已存在的运单外部编码重复');
      });
    }
    if (indices.length > 1) {
      indices.slice(1).forEach((idx) => {
        const prevMsg = duplicateStatus.get(idx);
        const msg = `与第 ${indices[0] + 1} 行外部编码重复`;
        duplicateStatus.set(idx, prevMsg ? `${prevMsg}; ${msg}` : msg);
      });
    }
  }

  return records.map((record, idx) => ({
    ...record,
    _duplicateWith: duplicateStatus.get(idx) || undefined,
  }));
}
