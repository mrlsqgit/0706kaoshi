// 规则引擎核心 —— 根据解析规则将原始数据转换为结构化运单数据

import {
  ParseRule,
  OrderRecord,
  ValidationError,
  OrderField,
  ColumnMapping,
  ProcessorConfig,
  TailInfoExtractionOptions,
  HeaderInfoExtractionOptions,
  CrossRowAggregationOptions,
  MatrixTransposeOptions,
  CardDetectionOptions,
  TextParsingOptions,
  MultiOrderSplitOptions,
  CompositeCellSplitOptions,
  MultiSheetOptions,
} from './types';

// 内建「非数据行」首单元格关键字：命中则视为标题/合计/页脚尾注行，直接跳过。
// 作为通用兜底，避免 AI 漏设 footerRowsToSkip / summaryRowKeywords 时，
// 底部「合计/制单人/收货门店/联系人/联系电话/收货地址」等键值尾注行被当成 SKU 数据行，
// 导致 skuCode/skuQuantity 缺失而校验失败。
const BUILTIN_NON_DATA_FIRST_CELL_KEYWORDS = [
  '合计', '总计', '小计', '制单', '审核', '签字',
  '收货门店', '收货人', '联系人', '联系电话', '收货地址',
  '出库日期', '打印', '经手', '出纳', '仓库：', '备注：', '说明：',
];

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
  // 按列名（防御性：去掉可能存在的星号 *，与 file-parsers 去星后的表头保持一致）
  const key = String(colIndex).replace(/\*/g, '');
  const val = row[key];
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
    // 兜底：首单元格命中内建非数据行关键字（合计/制单/收货门店/联系人/联系电话/收货地址…）则跳过
    const firstCell = Object.values(row)[0];
    if (
      firstCell != null &&
      BUILTIN_NON_DATA_FIRST_CELL_KEYWORDS.some((k) => String(firstCell).includes(k))
    ) {
      return false;
    }
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

      switch (mapping.sourceType || 'column') {
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
    const otherPatterns = options.fieldMappings.filter(
      m => m.keywordPattern !== mapping.keywordPattern
    );
    for (const row of tailRows) {
      const cells = Object.values(row).map(v => String(v ?? '').trim());
      const rowText = cells.join(' ').trim();
      if (!new RegExp(mapping.keywordPattern, 'i').test(rowText)) continue;

      let extracted = '';
      // 策略1：关键词可在任意列，其值取其后第一个「非关键字」单元格
      // （兼容一行多 KV：如 "收货门店：xx  联系人：yy  收货地址：zz"）
      for (let j = 0; j < cells.length - 1; j++) {
        if (new RegExp(mapping.keywordPattern, 'i').test(cells[j])) {
          for (let k = j + 1; k < cells.length; k++) {
            const candidate = cells[k];
            if (!candidate) continue;
            const isOtherKey = otherPatterns.some(
              p => new RegExp(p.keywordPattern, 'i').test(candidate)
            );
            if (!isOtherKey) {
              extracted = candidate;
              break;
            }
          }
          if (extracted) break;
        }
      }
      // 策略2：正则提取（fallback，取首个冒号后的内容）
      if (!extracted) {
        extracted = extractByPattern(rowText, mapping.extractPattern);
      }
      if (extracted) {
        tailInfo[mapping.targetField] = extracted;
        break;
      }
    }
  }

  return tailInfo;
}

/** 顶部信息提取（扫描被 headerRowsToSkip 跳过的表头/标题行） */
function processHeaderInfoExtraction(
  allRows: Record<string, unknown>[],
  options: HeaderInfoExtractionOptions
): Record<string, string> {
  const headerInfo: Record<string, string> = {};
  const headerRows = allRows.slice(0, Math.max(0, options.headerRowsCount));

  for (const mapping of options.fieldMappings) {
    for (const row of headerRows) {
      const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();
      if (new RegExp(mapping.keywordPattern, 'i').test(rowText)) {
        // 策略1：第一列匹配关键词 → 取第二列作为值（交替 KV 格式）
        const firstCol = Object.values(row)[0];
        if (firstCol != null && new RegExp(mapping.keywordPattern, 'i').test(String(firstCol))) {
          const cells = Object.values(row).slice(1).map(v => String(v ?? '').trim());
          const otherPatterns = options.fieldMappings.filter(
            m => m.keywordPattern !== mapping.keywordPattern
          );
          for (const cell of cells) {
            if (!cell) continue;
            const isOtherKey = otherPatterns.some(
              p => new RegExp(p.keywordPattern, 'i').test(cell)
            );
            if (!isOtherKey) {
              headerInfo[mapping.targetField] = cell;
              break;
            }
          }
          if (headerInfo[mapping.targetField]) break;
        }
        // 策略2：正则提取（fallback）
        if (!headerInfo[mapping.targetField]) {
          headerInfo[mapping.targetField] = extractByPattern(rowText, mapping.extractPattern);
        }
        break;
      }
    }
  }

  return headerInfo;
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

/** 卡片检测（增强版：支持一对多 —— 1个收货信息 + N个SKU商品行展开） */
function processCardDetection(
  allRows: Record<string, unknown>[],
  options: CardDetectionOptions
): {
  records: Record<string, unknown>[][];   // 每个卡片的原始行
  cardInfos: Record<string, string>[];    // 每个卡片提取的键值对信息（storeName/receiverName 等）
  skuDataList: {                         // 每个卡片的商品数据行列表
    headers: string[];                   // 子表头
    rows: Record<string, unknown>[];     // 商品数据行
  }[];
} {
  const cards: Record<string, unknown>[][] = [];
  const cardInfos: Record<string, string>[] = [];
  const skuDataList: { headers: string[]; rows: Record<string, unknown>[] }[] = [];
  let currentCard: Record<string, unknown>[] = [];
  let started = false;

  for (const row of allRows) {
    const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();

    // 检测新卡片开始
    if (new RegExp(options.cardStartKeyword, 'i').test(rowText)) {
      if (started && currentCard.length > 0) {
        // 结束上一个卡片：提取信息和商品数据
        cards.push(currentCard);
        cardInfos.push(extractCardInfo(currentCard, options.internalFieldPatterns));
        skuDataList.push(extractSkuData(currentCard, options));
      }
      currentCard = [];
      started = true;
      continue;
    }

    // 第一个卡片起始标记之前的行（标题/说明）直接忽略
    if (!started) continue;

    currentCard.push(row);
  }

  // 处理最后一个卡片
  if (currentCard.length > 0) {
    cards.push(currentCard);
    cardInfos.push(extractCardInfo(currentCard, options.internalFieldPatterns));
    skuDataList.push(extractSkuData(currentCard, options));
  }

  return { records: cards, cardInfos, skuDataList };
}

/** 从卡片行中提取键值对字段信息（支持交替 KV 格式和非交替格式） */
function extractCardInfo(
  cardRows: Record<string, unknown>[],
  patterns: { targetField: OrderField; keyword: string; extractPattern?: string }[]
): Record<string, string> {
  const info: Record<string, string> = {};
  for (const mapping of patterns) {
    for (const row of cardRows) {
      const cells = Object.values(row).map(v => String(v ?? ''));
      const rowText = cells.join(' ').trim();

      if (!new RegExp(mapping.keyword, 'i').test(rowText)) continue;

      let extracted = '';

      // 策略1：使用 extractPattern 正则捕获
      if (mapping.extractPattern) {
        extracted = extractByPattern(rowText, mapping.extractPattern);
      }
      // 策略2：按列取位置（交替KV格式：key在偶数列，value在奇数列）
      if (!extracted) {
        for (let j = 0; j < cells.length - 1; j++) {
          if (new RegExp(mapping.keyword, 'i').test(cells[j].trim())) {
            // key 的下一个非空单元格就是 value
            for (let k = j + 1; k < cells.length; k++) {
              const candidate = cells[k].trim();
              if (candidate) {
                // 排除这个候选看起来像另一个 key 的情况
                const looksLikeKey = patterns.some(
                  p => p.keyword !== mapping.keyword && new RegExp(p.keyword, 'i').test(candidate)
                );
                if (!looksLikeKey) {
                  extracted = candidate;
                }
                break;
              }
            }
            break;
          }
        }
      }
      // 策略3：全文去除关键词（兜底策略，但排除其他已知关键词）
      if (!extracted) {
        extracted = rowText.replace(new RegExp(mapping.keyword, 'i'), '').trim();
        // 移除后面可能跟的其他 key
        for (const p of patterns) {
          extracted = extracted.replace(new RegExp(p.keyword, 'i'), '').trim();
        }
      }

      // 策略4：如果没有已知 patterns，取第2列作为值
      if (!extracted && patterns.length === 0) {
        for (let k = 1; k < cells.length; k++) {
          const candidate = cells[k].trim();
          if (candidate) {
            extracted = candidate;
            break;
          }
        }
      }

      if (extracted) {
        info[mapping.targetField] = extracted;
        break; // 找到后跳出当前卡片行循环
      }
    }
  }
  return info;
}

/** 从卡片行中检测子表头并提取商品数据行（支持自动检测回落） */
function extractSkuData(
  cardRows: Record<string, unknown>[],
  options: CardDetectionOptions
): { headers: string[]; rows: Record<string, unknown>[] } {
  const defaultResult = { headers: [], rows: [] };

  // 常见的键值对信息关键词（第一列包含这些是收货信息行，不是子表头）
  const kvKeywords = ['门店', '店', '收货', '电话', '地址', '人', '单号', '仓库', '日期', '备注', '出库'];

  // 尝试找到子表头行
  let headerIdx = -1;

  // 方法1：用配置的 subHeaderKeywords 匹配
  const keywords = options.subHeaderKeywords || [];
  if (keywords.length > 0) {
    for (let i = 0; i < cardRows.length; i++) {
      const firstColVal = String(Object.values(cardRows[i])[0] ?? '');
      for (const kw of keywords) {
        if (new RegExp(kw, 'i').test(firstColVal)) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx >= 0) break;
    }
  }

  // 方法2：自动检测回落 —— 找到第一行不是键值对信息、且包含多个非空值的行作为子表头
  if (headerIdx < 0) {
    for (let i = 0; i < cardRows.length; i++) {
      const row = cardRows[i];
      const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();
      if (!rowText) continue; // 跳过空行

      const firstCol = String(Object.values(row)[0] ?? '').trim();
      // 跳过明显的键值对信息行
      const isKvRow = kvKeywords.some(kw => firstCol.includes(kw));
      if (isKvRow) continue;

      // 跳过可能的分隔符/标题行
      if (/^(▶|▸|●|○|第|part|section)/i.test(firstCol) ||
          /^(调拨单|出库单|配送单|汇总)/i.test(rowText)) {
        continue;
      }

      // 候选子表头：第一列非空 且 有至少1个非空后续列（至少是2列表格）
      const nonEmptyCount = Object.values(row).filter(
        v => String(v ?? '').trim() !== ''
      ).length;

      // 卡片式布局中，子表头行通常有2-6个非空列
      if (nonEmptyCount >= 2 && nonEmptyCount <= 8) {
        // 额外检查：下面紧跟的行看起来像数据行（有至少2个非空值）
        let nextHasData = false;
        for (let j = i + 1; j < Math.min(i + 3, cardRows.length); j++) {
          const nextNonEmpty = Object.values(cardRows[j]).filter(
            v => String(v ?? '').trim() !== ''
          ).length;
          if (nextNonEmpty >= 2) {
            nextHasData = true;
            break;
          }
        }
        if (nextHasData) {
          headerIdx = i;
          break;
        }
      }
    }
  }

  if (headerIdx < 0) {
    return defaultResult;
  }

  // 子表头就是该行的 values
  const subHeaders = Object.values(cardRows[headerIdx]).map((v, idx) => {
    const strVal = String(v ?? '').trim();
    return strVal || `Col_${idx}`;
  });

  // 商品数据行 = 表头之后的所有非空行（直到下一个卡片或末尾）
  const dataRows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < cardRows.length; i++) {
    const row = cardRows[i];
    const rowText = Object.values(row).map(v => String(v ?? '')).join(' ').trim();
    if (!rowText) continue;
    // 跳过汇总行
    if (/^(合计|小计|总计|sum|total)$/i.test(rowText)) continue;
    // 如果又出现了键值对关键词，说明进入了下一个信息段，停止
    const firstCol = String(Object.values(row)[0] ?? '').trim();
    const isKvRow = kvKeywords.some(kw => firstCol.includes(kw));
    if (isKvRow) break;

    // 用子表头重建行对象
    const values = Object.values(row);
    const newRow: Record<string, unknown> = {};
    for (let j = 0; j < subHeaders.length && j < values.length; j++) {
      newRow[subHeaders[j]] = values[j];
    }
    dataRows.push(newRow);
  }

  return { headers: subHeaders, rows: dataRows };
}

/** 文本解析（Word/PDF 纯文本） */
function processTextParsing(
  text: string,
  options: TextParsingOptions
): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  const sep = options.recordSeparator || '';
  const parts = text.split(new RegExp(sep)).filter(s => s.trim());

  // 对于正向预查型分隔符（如 "(?=ZBWP\d+)"），被分割出的片段仍保留锚点文本；
  // 但首部/尾部的说明文字（不含锚点）也会被切成一个片段，应剔除，避免产生空记录。
  let anchorRe: RegExp | null = null;
  if (sep && /^\(\?=/.test(sep)) {
    const m = sep.match(/^\(\?=(.*)\)$/s);
    if (m) anchorRe = new RegExp(m[1]);
  }

  for (const part of parts) {
    if (anchorRe && !anchorRe.test(part)) continue; // 不含锚点（如文件头）的片段跳过
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

/** 复合单元格拆分（周配送计划：一个单元格内 "物品名x数量\n物品名x数量" 需要拆成多行） */
function processCompositeCellSplit(
  records: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[],
  options: CompositeCellSplitOptions
): typeof records {
  const result: typeof records = [];

  for (const record of records) {
    const recordObj = record as Record<string, unknown>;
    // 收集所有可能需要拆分的字段
    const fieldValues: Record<string, string> = {};
    Object.keys(recordObj).forEach(key => {
      fieldValues[key] = String(recordObj[key] ?? '');
    });

    // 检查是否有包含分隔符的字段
    let maxItems = 1;
    const splitFields: Record<string, string[]> = {};
    let fieldToSplit = '';

    for (const [key, value] of Object.entries(fieldValues)) {
      if (!options.skipFields.includes(key as OrderField) && value) {
        const parts = value.split(new RegExp(options.cellSeparator)).filter(s => s.trim());
        if (parts.length > maxItems) {
          maxItems = parts.length;
          fieldToSplit = key;
        }
        splitFields[key] = parts;
      } else {
        splitFields[key] = [value];
      }
    }

    if (maxItems <= 1) {
      result.push(record);
      continue;
    }

    // 展开拆分的字段为多行
    const splitValues = splitFields[fieldToSplit] || [];
    for (let i = 0; i < splitValues.length; i++) {
      const newRecord: Record<string, unknown> = {};
      for (const [key, values] of Object.entries(splitFields)) {
        if (key === fieldToSplit) {
          const item = splitValues[i].trim();
          // 尝试解析 "名称X数量" 格式
          const qtyMatch = item.match(new RegExp(options.nameQtyPattern));
          if (qtyMatch) {
            newRecord[key] = qtyMatch[1]?.trim() || item;
            newRecord.skuQuantity = parseInt(qtyMatch[2], 10) || 1;
          } else {
            newRecord[key] = item;
          }
        } else if (options.skipFields.includes(key as OrderField)) {
          // skipFields 中的字段从原行复制
          newRecord[key] = recordObj[key];
        } else {
          newRecord[key] = values[i] ?? values[0] ?? '';
        }
      }
      result.push(newRecord as unknown as typeof record);
    }
  }

  return result;
}

/** 多订单拆分（一个 PDF 含多个独立配送单） */
function processMultiOrderSplit(
  rawText: string,
  options: MultiOrderSplitOptions
): string[] {
  const parts = rawText.split(new RegExp(options.orderSeparator)).filter(s => s.trim());
  return parts.map(part => part.trim());
}

/** 多Sheet处理：从 Sheet 名称提取字段值注入到每条记录 */
function processMultiSheet(
  records: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[],
  options: MultiSheetOptions,
  sheetName: string
): typeof records {
  if (!sheetName || !options.sheetNameFieldMappings?.length) return records;

  const sheetInfo: Record<string, string> = {};
  for (const mapping of options.sheetNameFieldMappings) {
    if (mapping.extractPattern) {
      sheetInfo[mapping.targetField] = extractByPattern(sheetName, mapping.extractPattern);
    } else {
      sheetInfo[mapping.targetField] = sheetName.trim();
    }
  }

  return records.map(rec => ({ ...rec, ...sheetInfo }));
}

// ====== 主解析函数 ======

export function executeParse(
  rawRows: Record<string, unknown>[],
  headers: string[],
  rule: ParseRule,
  rawText?: string,
  sheetName?: string
): Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] {
  let rows = [...rawRows];
  const tailInfo: Record<string, string> = {};
  const headerInfo: Record<string, string> = {};

  // 0. Header 重定向（修复核心问题）：
  //    file-parsers.ts 固定用 Excel 第1行作为 headers，
  //    但当第1行是说明/标题行时（如湖南仓.xlsx），需要用后续某行作为真正的表头。
  //    当 headerRowsToSkip=N 时，意味着前N行都是标题/说明，第N+1行才是真正表头。
  //    由于 file-parsers 已把第1行当作 headers、第2行起作为 rows[0]，
  //    所以 rawRows[N-1] 就是真正的表头行，其 values 应成为新的 headers。
  if (rule.headerRowsToSkip > 0 && rule.headerRowsToSkip <= rawRows.length) {
    const realHeaderRow = rawRows[rule.headerRowsToSkip - 1];
    const newHeaders: string[] = Object.values(realHeaderRow).map((v, i) => {
      const strVal = String(v ?? '').trim().replace(/\*/g, '');
      return strVal || `Column_${i}`;
    });

    // 用新 headers 重建数据行（从真正表头的下一行开始）
    const dataStartIdx = rule.headerRowsToSkip;
    if (dataStartIdx < rawRows.length) {
      rows = rawRows.slice(dataStartIdx).map((oldRow) => {
        const oldValues = Object.values(oldRow);
        const newRow: Record<string, unknown> = {};
        for (let i = 0; i < newHeaders.length; i++) {
          newRow[newHeaders[i]] = i < oldValues.length ? oldValues[i] : '';
        }
        return newRow;
      });
    } else {
      rows = [];
    }

    // 替换 headers，后续列映射将使用正确的列名
    headers = newHeaders;
  }

  // 1. 跳过头部/尾部（header重定向后通常不需要再额外跳过，但保留以兼容）
  rows = skipHeaderRows(rows, 0); // 已在上面处理完 header 跳过
  rows = skipFooterRows(rows, rule.footerRowsToSkip);

  // 2. 跳过汇总/空行
  rows = skipSummaryAndEmpty(rows, rule);

  // 2b/2c. 文本解析（Word/PDF）：先解析出 SKU 记录，尾部信息（收货人/地址等）
  //          稍后在第 6 步统一合并到每条记录，因此此处不再提前 return。
  let textParsed = false;
  let needsCardMode = false;
  let processedRecords: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] = [];

  if (rawText) {
    const textProc = rule.processors.find(
      p => p.enabled && p.type === 'textParsing'
    );
    if (textProc) {
      const opts = textProc.options as unknown as TextParsingOptions;
      const multiOrderProc = rule.processors.find(
        p => p.enabled && p.type === 'multiOrderSplit'
      );
      if (multiOrderProc) {
        const mOpts = multiOrderProc.options as unknown as MultiOrderSplitOptions;
        const orderTexts = processMultiOrderSplit(rawText, mOpts);
        const all: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] = [];
        for (const orderText of orderTexts) {
          all.push(...(processTextParsing(orderText, opts) as unknown as Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[]));
        }
        processedRecords = all;
      } else {
        processedRecords = processTextParsing(rawText, opts) as unknown as Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[];
      }
      textParsed = true;
    }
  }

  // 3. 执行处理器
  for (const proc of rule.processors) {
    if (!proc.enabled) continue;

    switch (proc.type) {
      case 'tailInfoExtraction': {
        const opts = proc.options as unknown as TailInfoExtractionOptions;
        Object.assign(tailInfo, processTailInfoExtraction(rawRows, opts));
        break;
      }

      case 'headerInfoExtraction': {
        const opts = proc.options as unknown as HeaderInfoExtractionOptions;
        Object.assign(headerInfo, processHeaderInfoExtraction(rawRows, opts));
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
        const { cardInfos, skuDataList } = processCardDetection(rawRows, opts);
        processedRecords = [];

        // 使用 SKU 列映射（优先用 skuColumnMappings，fallback 到全局 columnMappings）
        const skuMappings = opts.skuColumnMappings && opts.skuColumnMappings.length > 0
          ? opts.skuColumnMappings
          : rule.columnMappings;

        for (let i = 0; i < skuDataList.length; i++) {
          const { headers: subHeaders, rows: skuRows } = skuDataList[i];
          const info = cardInfos[i] || {};

          if (skuRows.length === 0) {
            // 没有商品数据行，生成一条只有收货信息的记录
            processedRecords.push({ ...info });
            continue;
          }

          // 对每个商品数据行：应用列映射 + 合并收货信息 → 一条记录
          for (const skuRow of skuRows) {
            // 将单行商品数据转为数组以使用 applyColumnMappings
            const mapped = applyColumnMappings([skuRow], skuMappings, subHeaders);
            if (mapped.length > 0) {
              // 合并：收货信息 + 商品字段
              const merged = { ...info, ...mapped[0] };
              processedRecords.push(merged);
            }
          }
        }
        break;
      }

      case 'compositeCellSplit': {
        // 在列映射后执行拆分
        if (processedRecords.length === 0) {
          processedRecords = applyColumnMappings(rows, rule.columnMappings, headers);
        }
        const opts = proc.options as unknown as CompositeCellSplitOptions;
        processedRecords = processCompositeCellSplit(processedRecords, opts);
        break;
      }

      case 'multiSheet': {
        // 从 Sheet 名称提取字段值（如 storeName = Sheet名）
        if (processedRecords.length === 0) {
          processedRecords = applyColumnMappings(rows, rule.columnMappings, headers);
        }
        const opts = proc.options as unknown as MultiSheetOptions;
        if (sheetName) {
          processedRecords = processMultiSheet(processedRecords, opts, sheetName);
        }
        break;
      }
    }
  }

  // 4. 如果没有特殊处理器，直接列映射
  if (!textParsed && !needsCardMode && processedRecords.length === 0) {
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

  // 6. 注入顶部/尾部提取的信息到每条记录（顶部先注入，尾部后注入，冲突时尾部优先）
  if (Object.keys(headerInfo).length > 0) {
    processedRecords = processedRecords.map((rec) => ({
      ...rec,
      ...headerInfo,
    }));
  }
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
