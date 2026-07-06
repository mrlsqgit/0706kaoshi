// ====== 运单数据模型 ======
export interface OrderRecord {
  id?: string;
  batchId?: string;
  externalCode: string;
  storeName: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec: string;
  remark: string;
  createdAt?: string;
  // UI 状态
  _rowIndex?: number;
  _errors?: ValidationError[];
  _duplicateWith?: string;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

// ====== 解析规则模型 ======
export type FileType = 'excel' | 'word' | 'pdf';
export type SheetMergeMode = 'separate' | 'concatenate';
export type SourceType = 'column' | 'cellPattern' | 'static' | 'aiInfer' | 'tailExtract';

export interface ColumnMapping {
  targetField: OrderField;
  sourceType: SourceType;
  sourceColumn?: string | number;
  sourcePattern?: string;
  staticValue?: string;
}

export type OrderField =
  | 'externalCode'
  | 'storeName'
  | 'receiverName'
  | 'receiverPhone'
  | 'receiverAddress'
  | 'skuCode'
  | 'skuName'
  | 'skuQuantity'
  | 'skuSpec'
  | 'remark';

export const ORDER_FIELD_LABELS: Record<OrderField, string> = {
  externalCode: '外部编码',
  storeName: '收货门店',
  receiverName: '收件人姓名',
  receiverPhone: '收件人电话',
  receiverAddress: '收件人地址',
  skuCode: 'SKU物品编码',
  skuName: 'SKU物品名称',
  skuQuantity: 'SKU发货数量',
  skuSpec: 'SKU规格型号',
  remark: '备注',
};

export const ORDER_FIELD_GROUPS: { label: string; fields: OrderField[] }[] = [
  { label: '运单信息', fields: ['externalCode'] },
  { label: 'A组-门店模式', fields: ['storeName'] },
  { label: 'B组-收件人模式', fields: ['receiverName', 'receiverPhone', 'receiverAddress'] },
  { label: 'SKU信息', fields: ['skuCode', 'skuName', 'skuQuantity', 'skuSpec'] },
  { label: '其他', fields: ['remark'] },
];

export type ProcessorType =
  | 'columnMapping'
  | 'skipRows'
  | 'tailInfoExtraction'
  | 'crossRowAggregation'
  | 'matrixTranspose'
  | 'cardDetection'
  | 'compositeCellSplit'
  | 'multiOrderSplit'
  | 'textParsing'
  | 'multiSheet';

export interface ParseRule {
  id: string;
  name: string;
  description: string;
  fileType: FileType;
  isAiGenerated: boolean;
  aiConfidence?: Record<string, number>; // field -> confidence score

  // 通用设置
  headerRowsToSkip: number;
  footerRowsToSkip: number;
  skipEmptyRows: boolean;
  skipSummaryRows: boolean;
  summaryRowKeywords: string[];

  // Excel 特有
  sheetNames: string[];
  sheetMergeMode: SheetMergeMode;

  // 列映射
  columnMappings: ColumnMapping[];

  // 后处理器
  processors: ProcessorConfig[];

  // 时间戳
  createdAt: string;
  updatedAt: string;
}

export interface ProcessorConfig {
  type: ProcessorType;
  enabled: boolean;
  options: Record<string, unknown>;
}

// 尾部信息提取配置
export interface TailInfoExtractionOptions {
  tailRowsCount: number;
  fieldMappings: {
    targetField: OrderField;
    keywordPattern: string;
    extractPattern: string;
  }[];
}

// 跨行聚合配置
export interface CrossRowAggregationOptions {
  groupByField: OrderField;
}

// 矩阵转置配置
export interface MatrixTransposeOptions {
  rowIdentifierFields: OrderField[];
  columnHeaderStartIndex: number;
  columnValueField: OrderField;
  cellSplitSeparator?: string;
  cellSplitItemFormat?: string;
}

// 卡片检测配置
export interface CardDetectionOptions {
  cardStartKeyword: string;
  internalFieldPatterns: {
    targetField: OrderField;
    keyword: string;
    extractPattern?: string;
  }[];
}

// 文本解析配置（Word/PDF 纯文本）
export interface TextParsingOptions {
  recordSeparator: string;
  fieldPatterns: {
    targetField: OrderField;
    pattern: string;
    group?: number;
  }[];
}

// 多订单拆分配置（PDF 多单）
export interface MultiOrderSplitOptions {
  orderSeparator: string;
  orderNamePattern?: string;
}

// ====== 批量下单提交结果 ======
export interface SubmitResult {
  success: boolean;
  totalCount: number;
  successCount: number;
  failCount: number;
  errors?: { row: number; message: string }[];
}

// ====== 文件上传相关 ======
export interface UploadedFile {
  name: string;
  size: number;
  type: string;
  file: File;
}

// ====== 解析结果 ======
export interface ParseResult {
  fileName: string;
  ruleName: string;
  records: OrderRecord[];
  errors: ValidationError[];
  rawPreview?: Record<string, unknown>;
}

// ====== AI 规则生成 ======
export interface AiGenerateRuleRequest {
  fileName: string;
  fileType: FileType;
  previewData: unknown; // 文件预览数据（行/列信息）
}

export interface AiGenerateRuleResponse {
  rule: Partial<ParseRule>;
  analysis: string;
  confidence: Record<string, number>;
}
