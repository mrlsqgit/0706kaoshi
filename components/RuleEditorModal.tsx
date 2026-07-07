'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  ParseRule,
  FileType,
  ColumnMapping,
  ProcessorConfig,
  OrderField,
  ORDER_FIELD_LABELS,
  SourceType,
  ProcessorType,
  OrderRecord,
} from '@/lib/types';
import { executeParse, validateRecords } from '@/lib/rule-engine';
import { parseFile } from '@/lib/file-parsers';

interface RuleEditorModalProps {
  rule: ParseRule | null;
  onSave: (rule: Partial<ParseRule>) => void;
  onClose: () => void;
}

const DEFAULT_RULE: Partial<ParseRule> = {
  name: '',
  description: '',
  fileType: 'excel',
  isAiGenerated: false,
  headerRowsToSkip: 0,
  footerRowsToSkip: 0,
  skipEmptyRows: true,
  skipSummaryRows: false,
  summaryRowKeywords: ['合计', '总计', '小计'],
  sheetNames: [],
  sheetMergeMode: 'separate',
  columnMappings: [],
  processors: [],
};

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  column: '列映射',
  static: '静态值',
  cellPattern: '正则提取',
  aiInfer: 'AI 推断',
  tailExtract: '尾部提取',
};

const COLUMN_MAPPING_FIELDS: OrderField[] = [
  'externalCode', 'storeName', 'receiverName', 'receiverPhone', 'receiverAddress',
  'skuCode', 'skuName', 'skuQuantity', 'skuSpec', 'remark',
];

export default function RuleEditorModal({ rule, onSave, onClose }: RuleEditorModalProps) {
  const [form, setForm] = useState<Partial<ParseRule>>(rule || DEFAULT_RULE);
  const [activeTab, setActiveTab] = useState<'basic' | 'mappings' | 'processors' | 'test'>('basic');
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testRecords, setTestRecords] = useState<OrderRecord[]>([]);
  const [testFileName, setTestFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (rule) setForm(rule);
  }, [rule]);

  const updateField = <K extends keyof ParseRule>(key: K, value: ParseRule[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const addMapping = () => {
    const mappings = [...(form.columnMappings || [])];
    mappings.push({
      targetField: 'skuName' as OrderField,
      sourceType: 'column' as SourceType,
      sourceColumn: '',
    });
    updateField('columnMappings', mappings);
  };

  const updateMapping = (index: number, field: Partial<ColumnMapping>) => {
    const mappings = [...(form.columnMappings || [])];
    mappings[index] = { ...mappings[index], ...field };
    updateField('columnMappings', mappings);
  };

  const removeMapping = (index: number) => {
    const mappings = (form.columnMappings || []).filter((_, i) => i !== index);
    updateField('columnMappings', mappings);
  };

  const addProcessor = (type: ProcessorType) => {
    const processors = [...(form.processors || [])];
    let defaultOptions: Record<string, unknown> = {};
    switch (type) {
      case 'tailInfoExtraction':
        defaultOptions = { tailRowsCount: 5, fieldMappings: [] };
        break;
      case 'crossRowAggregation':
        defaultOptions = { groupByField: 'externalCode' };
        break;
      case 'matrixTranspose':
        defaultOptions = { rowIdentifierFields: ['skuName'], columnHeaderStartIndex: 2, columnValueField: 'storeName' };
        break;
      case 'cardDetection':
        defaultOptions = {
          cardStartKeyword: '▶ 调拨记录',
          internalFieldPatterns: [],
          subHeaderKeywords: ['物品编码', 'SKU编码', '产品编码'],
        };
        break;
      case 'compositeCellSplit':
        defaultOptions = { cellSeparator: '\\n', nameQtyPattern: '(.+?)[xX×](\\d+)', skipFields: ['storeName', 'externalCode'] };
        break;
      case 'multiOrderSplit':
        defaultOptions = { orderSeparator: '---+' };
        break;
      case 'textParsing':
        defaultOptions = { recordSeparator: '---+', fieldPatterns: [] };
        break;
      case 'multiSheet':
        defaultOptions = { sheetNameFieldMappings: [{ targetField: 'storeName' as OrderField }] };
        break;
    }
    processors.push({ type, enabled: true, options: defaultOptions });
    updateField('processors', processors);
  };

  const toggleProcessor = (index: number) => {
    const processors = [...(form.processors || [])];
    processors[index] = { ...processors[index], enabled: !processors[index].enabled };
    updateField('processors', processors);
  };

  const updateProcessorOptions = (index: number, options: Record<string, unknown>) => {
    const processors = [...(form.processors || [])];
    processors[index] = { ...processors[index], options };
    updateField('processors', processors);
  };

  const removeProcessor = (index: number) => {
    const processors = (form.processors || []).filter((_, i) => i !== index);
    updateField('processors', processors);
  };

  const handleTestFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTestFile(file);
      setTestFileName(file.name);
      setTestRecords([]);
    }
  };

  const handleTestParse = useCallback(async () => {
    if (!testFile) return;
    setTestLoading(true);
    setTestRecords([]);
    try {
      const testRule: ParseRule = {
        ...DEFAULT_RULE,
        ...form,
        id: 'test-temp',
        createdAt: '',
        updatedAt: '',
      } as ParseRule;

      const parsedData = await parseFile(testFile);
      const allRecords: Omit<OrderRecord, 'id' | 'batchId' | 'createdAt' | '_rowIndex' | '_errors' | '_duplicateWith'>[] = [];

      for (const sheet of parsedData.sheets) {
        const parsed = executeParse(
          sheet.rows,
          sheet.headers,
          testRule,
          parsedData.rawText,
          sheet.sheetName
        );
        allRecords.push(...parsed);
      }

      const validated = validateRecords(
        allRecords.map((r, i) => ({ ...r, _rowIndex: i, _errors: [], _duplicateWith: undefined })) as OrderRecord[]
      );

      setTestRecords(validated);
      toast.success(`解析完成: ${validated.length} 条记录`);
    } catch (err) {
      toast.error(`测试解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setTestLoading(false);
    }
  }, [testFile, form]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="card animate-fadeIn w-full max-w-3xl max-h-[90vh] flex flex-col mx-4">
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e6eb]">
          <h2 className="text-xl font-bold text-[#1d2129]">
            {rule ? '编辑规则' : '新建规则'}
          </h2>
          <button onClick={onClose} className="text-[#86909c] hover:text-[#1d2129] text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="flex gap-1 pt-4 pb-2 border-b border-[#e5e6eb]">
          {[
            { key: 'basic' as const, label: '基本信息' },
            { key: 'mappings' as const, label: '字段映射' },
            { key: 'processors' as const, label: '处理器' },
            { key: 'test' as const, label: '🧪 测试解析' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-[#e8fafa] text-[#0b6e6e]'
                  : 'text-[#86909c] hover:text-[#4e5969]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="form-label">规则名称 *</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={e => updateField('name', e.target.value)}
                  className="form-input"
                  placeholder="例如：湖南仓发货单解析规则"
                />
              </div>
              <div>
                <label className="form-label">描述</label>
                <textarea
                  value={form.description || ''}
                  onChange={e => updateField('description', e.target.value)}
                  className="form-input"
                  rows={2}
                  placeholder="描述该规则的用途..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">文件类型</label>
                  <select
                    value={form.fileType || 'excel'}
                    onChange={e => updateField('fileType', e.target.value as FileType)}
                    className="form-input form-select"
                  >
                    <option value="excel">Excel (.xlsx/.xls)</option>
                    <option value="word">Word (.docx)</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Sheet 合并模式</label>
                  <select
                    value={form.sheetMergeMode || 'separate'}
                    onChange={e => updateField('sheetMergeMode', e.target.value as 'separate' | 'concatenate')}
                    className="form-input form-select"
                  >
                    <option value="separate">独立处理</option>
                    <option value="concatenate">合并处理</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">跳过头部行数</label>
                  <input
                    type="number"
                    min={0}
                    value={form.headerRowsToSkip || 0}
                    onChange={e => updateField('headerRowsToSkip', parseInt(e.target.value) || 0)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">跳过尾部行数</label>
                  <input
                    type="number"
                    min={0}
                    value={form.footerRowsToSkip || 0}
                    onChange={e => updateField('footerRowsToSkip', parseInt(e.target.value) || 0)}
                    className="form-input"
                  />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.skipEmptyRows}
                    onChange={e => updateField('skipEmptyRows', e.target.checked)}
                    className="w-4 h-4 accent-[#0fc6c2]"
                  />
                  <span className="text-sm text-[#4e5969]">跳过空行</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.skipSummaryRows}
                    onChange={e => updateField('skipSummaryRows', e.target.checked)}
                    className="w-4 h-4 accent-[#0fc6c2]"
                  />
                  <span className="text-sm text-[#4e5969]">跳过汇总行</span>
                </label>
              </div>
              {form.skipSummaryRows && (
                <div>
                  <label className="form-label">汇总行关键词（逗号分隔）</label>
                  <input
                    type="text"
                    value={(form.summaryRowKeywords || []).join(', ')}
                    onChange={e => updateField('summaryRowKeywords', e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean))}
                    className="form-input"
                    placeholder="合计, 总计, 小计"
                  />
                </div>
              )}
              <div>
                <label className="form-label">Sheet 名称（留空则处理所有Sheet，逗号分隔）</label>
                <input
                  type="text"
                  value={(form.sheetNames || []).join(', ')}
                  onChange={e => updateField('sheetNames', e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean))}
                  className="form-input"
                  placeholder="Sheet1, Sheet2"
                />
              </div>
            </div>
          )}

          {activeTab === 'mappings' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-[#86909c]">定义文件列到系统字段的映射关系</p>
                <button onClick={addMapping} className="btn btn-outline btn-sm">+ 添加映射</button>
              </div>
              {(form.columnMappings || []).length === 0 ? (
                <div className="text-center py-8 text-[#86909c] bg-[#fafbfc] rounded-xl">
                  暂无字段映射，请点击"添加映射"
                </div>
              ) : (
                <div className="space-y-3">
                  {(form.columnMappings || []).map((mapping, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-[#e5e6eb] bg-white">
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-3">
                          <label className="text-xs text-[#86909c] mb-1 block">目标字段</label>
                          <select
                            value={mapping.targetField}
                            onChange={e => updateMapping(idx, { targetField: e.target.value as OrderField })}
                            className="form-input form-select text-sm"
                          >
                            {COLUMN_MAPPING_FIELDS.map(f => (
                              <option key={f} value={f}>{ORDER_FIELD_LABELS[f]}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="text-xs text-[#86909c] mb-1 block">映射方式</label>
                          <select
                            value={mapping.sourceType}
                            onChange={e => updateMapping(idx, { sourceType: e.target.value as SourceType })}
                            className="form-input form-select text-sm"
                          >
                            <option value="column">列映射</option>
                            <option value="static">静态值</option>
                            <option value="cellPattern">正则提取</option>
                          </select>
                        </div>
                        {mapping.sourceType === 'column' && (
                          <div className="col-span-4">
                            <label className="text-xs text-[#86909c] mb-1 block">源列名/列索引</label>
                            <input
                              type="text"
                              value={String(mapping.sourceColumn || '')}
                              onChange={e => updateMapping(idx, { sourceColumn: e.target.value })}
                              className="form-input text-sm"
                              placeholder="列名 或 0开始的列号"
                            />
                          </div>
                        )}
                        {mapping.sourceType === 'static' && (
                          <div className="col-span-4">
                            <label className="text-xs text-[#86909c] mb-1 block">静态值</label>
                            <input
                              type="text"
                              value={mapping.staticValue || ''}
                              onChange={e => updateMapping(idx, { staticValue: e.target.value })}
                              className="form-input text-sm"
                            />
                          </div>
                        )}
                        {mapping.sourceType === 'cellPattern' && (
                          <div className="col-span-4">
                            <label className="text-xs text-[#86909c] mb-1 block">正则表达式</label>
                            <input
                              type="text"
                              value={mapping.sourcePattern || ''}
                              onChange={e => updateMapping(idx, { sourcePattern: e.target.value })}
                              className="form-input text-sm"
                              placeholder="例如: \d+"
                            />
                          </div>
                        )}
                        <div className="col-span-2 col-start-12 flex justify-end">
                          <button
                            onClick={() => removeMapping(idx)}
                            className="btn btn-danger btn-sm"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'processors' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-[#86909c] mr-2">添加处理器:</span>
                {[
                  { type: 'tailInfoExtraction' as const, label: '尾部信息提取' },
                  { type: 'crossRowAggregation' as const, label: '跨行聚合' },
                  { type: 'matrixTranspose' as const, label: '矩阵转置' },
                  { type: 'cardDetection' as const, label: '卡片检测' },
                  { type: 'compositeCellSplit' as const, label: '复合单元格拆分' },
                  { type: 'multiOrderSplit' as const, label: '多订单拆分' },
                  { type: 'textParsing' as const, label: '文本解析' },
                  { type: 'multiSheet' as const, label: '多Sheet处理(门店名)' },
                ].map(p => (
                  <button
                    key={p.type}
                    onClick={() => addProcessor(p.type)}
                    className="btn btn-outline btn-sm"
                  >
                    + {p.label}
                  </button>
                ))}
              </div>

              {(form.processors || []).length === 0 ? (
                <div className="text-center py-8 text-[#86909c] bg-[#fafbfc] rounded-xl">
                  暂无处理器。处理器用于处理特殊文件结构（尾部信息、矩阵转置等）
                </div>
              ) : (
                <div className="space-y-3">
                  {(form.processors || []).map((proc, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-[#e5e6eb] bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={proc.enabled}
                              onChange={() => toggleProcessor(idx)}
                              className="w-4 h-4 accent-[#0fc6c2]"
                            />
                            <span className="font-semibold text-[#1d2129] text-sm">
                              {proc.type === 'tailInfoExtraction' && '尾部信息提取'}
                              {proc.type === 'crossRowAggregation' && '跨行聚合'}
                              {proc.type === 'matrixTranspose' && '矩阵转置'}
                              {proc.type === 'cardDetection' && '卡片检测'}
                              {proc.type === 'compositeCellSplit' && '复合单元格拆分'}
                              {proc.type === 'multiOrderSplit' && '多订单拆分'}
                              {proc.type === 'textParsing' && '文本解析'}
                              {proc.type === 'multiSheet' && '多Sheet处理(门店名)'}
                            </span>
                          </label>
                        </div>
                        <button onClick={() => removeProcessor(idx)} className="btn btn-danger btn-sm">删除</button>
                      </div>

                      {proc.enabled && (
                        <div className="pl-6 space-y-2">
                          {proc.type === 'tailInfoExtraction' && (
                            <div>
                              <label className="text-xs text-[#86909c]">尾部行数</label>
                              <input
                                type="number"
                                value={Number((proc.options as Record<string, unknown>).tailRowsCount || 5)}
                                onChange={e => updateProcessorOptions(idx, { ...proc.options, tailRowsCount: parseInt(e.target.value) || 5 })}
                                className="form-input text-sm w-24"
                              />
                            </div>
                          )}
                          {proc.type === 'crossRowAggregation' && (
                            <div>
                              <label className="text-xs text-[#86909c]">分组字段</label>
                              <select
                                value={String((proc.options as Record<string, unknown>).groupByField || 'externalCode')}
                                onChange={e => updateProcessorOptions(idx, { groupByField: e.target.value })}
                                className="form-input form-select text-sm w-48"
                              >
                                {COLUMN_MAPPING_FIELDS.map(f => (
                                  <option key={f} value={f}>{ORDER_FIELD_LABELS[f]}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {proc.type === 'matrixTranspose' && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-[#86909c]">列头起始索引</label>
                                <input
                                  type="number"
                                  value={Number((proc.options as Record<string, unknown>).columnHeaderStartIndex || 2)}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, columnHeaderStartIndex: parseInt(e.target.value) || 0 })}
                                  className="form-input text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-[#86909c]">转置目标字段</label>
                                <select
                                  value={String((proc.options as Record<string, unknown>).columnValueField || 'storeName')}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, columnValueField: e.target.value })}
                                  className="form-input form-select text-sm"
                                >
                                  <option value="storeName">收货门店</option>
                                  <option value="externalCode">外部编码</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-[#86909c]">单元格分隔符</label>
                                <input
                                  type="text"
                                  value={String((proc.options as Record<string, unknown>).cellSplitSeparator || '')}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, cellSplitSeparator: e.target.value })}
                                  className="form-input text-sm"
                                  placeholder="例如 \n (换行)"
                                />
                              </div>
                            </div>
                          )}
                          {proc.type === 'cardDetection' && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-[#86909c]">卡片起始标识关键词</label>
                                <input
                                  type="text"
                                  value={String((proc.options as Record<string, unknown>).cardStartKeyword || '▶ 调拨记录')}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, cardStartKeyword: e.target.value })}
                                  className="form-input text-sm"
                                  placeholder="例如: ▶ 调拨记录"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-[#86909c]">子表头关键词（逗号分隔）</label>
                                <input
                                  type="text"
                                  value={String(((proc.options as Record<string, unknown>).subHeaderKeywords as string[] || ['物品编码']).join(', '))}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, subHeaderKeywords: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}
                                  className="form-input text-sm"
                                  placeholder="例如: 物品编码, SKU编码"
                                />
                              </div>
                            </div>
                          )}
                          {proc.type === 'compositeCellSplit' && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-[#86909c]">单元格分隔符</label>
                                <input
                                  type="text"
                                  value={String((proc.options as Record<string, unknown>).cellSeparator || '\\n')}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, cellSeparator: e.target.value })}
                                  className="form-input text-sm"
                                  placeholder="如 \\n 换行"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-[#86909c]">名称x数量匹配</label>
                                <input
                                  type="text"
                                  value={String((proc.options as Record<string, unknown>).nameQtyPattern || '(.+?)[xX×](\\d+)')}
                                  onChange={e => updateProcessorOptions(idx, { ...proc.options, nameQtyPattern: e.target.value })}
                                  className="form-input text-sm"
                                />
                              </div>
                            </div>
                          )}
                          {proc.type === 'multiOrderSplit' && (
                            <div>
                              <label className="text-xs text-[#86909c]">订单分隔正则</label>
                              <input
                                type="text"
                                value={String((proc.options as Record<string, unknown>).orderSeparator || '---+')}
                                onChange={e => updateProcessorOptions(idx, { ...proc.options, orderSeparator: e.target.value })}
                                className="form-input text-sm"
                                placeholder="如 ---- 或 ==="
                              />
                            </div>
                          )}
                          {proc.type === 'textParsing' && (
                            <div>
                              <label className="text-xs text-[#86909c]">记录分隔正则</label>
                              <input
                                type="text"
                                value={String((proc.options as Record<string, unknown>).recordSeparator || '---+')}
                                onChange={e => updateProcessorOptions(idx, { ...proc.options, recordSeparator: e.target.value })}
                                className="form-input text-sm"
                                placeholder="如 ----"
                              />
                            </div>
                          )}
                          {proc.type === 'multiSheet' && (
                            <div>
                              <p className="text-xs text-[#0b6e6e] mb-2 font-medium">从 Sheet 名称提取字段值（适用于每个Sheet代表一个门店的出库单）</p>
                              <div className="space-y-2">
                                {(((proc.options as Record<string, unknown>).sheetNameFieldMappings) as Array<{ targetField: OrderField; extractPattern?: string }> || []).map((mapping, mi) => (
                                  <div key={mi} className="flex items-center gap-2">
                                    <select
                                      value={mapping.targetField}
                                      onChange={e => {
                                        const mappings = [...(((proc.options as Record<string, unknown>).sheetNameFieldMappings) as Array<{ targetField: OrderField; extractPattern?: string }> || [])];
                                        mappings[mi] = { ...mappings[mi], targetField: e.target.value as OrderField };
                                        updateProcessorOptions(idx, { ...proc.options, sheetNameFieldMappings: mappings });
                                      }}
                                      className="form-input form-select text-sm w-36"
                                    >
                                      {COLUMN_MAPPING_FIELDS.map(f => (
                                        <option key={f} value={f}>{ORDER_FIELD_LABELS[f]}</option>
                                      ))}
                                    </select>
                                    <label className="text-xs text-[#86909c] whitespace-nowrap">= Sheet名</label>
                                    <input
                                      type="text"
                                      value={mapping.extractPattern || ''}
                                      onChange={e => {
                                        const mappings = [...(((proc.options as Record<string, unknown>).sheetNameFieldMappings) as Array<{ targetField: OrderField; extractPattern?: string }> || [])];
                                        mappings[mi] = { ...mappings[mi], extractPattern: e.target.value };
                                        updateProcessorOptions(idx, { ...proc.options, sheetNameFieldMappings: mappings });
                                      }}
                                      className="form-input text-sm flex-1"
                                      placeholder="可选正则提取，留空则用完整Sheet名"
                                    />
                                    <button
                                      onClick={() => {
                                        const mappings = [...(((proc.options as Record<string, unknown>).sheetNameFieldMappings) as Array<{ targetField: OrderField; extractPattern?: string }> || [])];
                                        mappings.splice(mi, 1);
                                        updateProcessorOptions(idx, { ...proc.options, sheetNameFieldMappings: mappings });
                                      }}
                                      className="text-[#cf1322] text-sm hover:underline"
                                    >删除</button>
                                  </div>
                                ))}
                                <button
                                  onClick={() => {
                                    const mappings = [...(((proc.options as Record<string, unknown>).sheetNameFieldMappings) as Array<{ targetField: OrderField; extractPattern?: string }> || [])];
                                    mappings.push({ targetField: 'storeName' as OrderField });
                                    updateProcessorOptions(idx, { ...proc.options, sheetNameFieldMappings: mappings });
                                  }}
                                  className="btn btn-outline btn-sm"
                                >+ 添加字段映射</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'test' && (
            <div className="space-y-4">
              <p className="text-sm text-[#86909c]">上传一个样例文件，用当前规则试解析，实时查看结果</p>

              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.docx,.pdf"
                  onChange={handleTestFileSelect}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-outline btn-sm"
                >
                  📁 选择测试文件
                </button>
                {testFileName && (
                  <span className="text-sm text-[#4e5969]">{testFileName}</span>
                )}
              </div>

              {testFile && (
                <button
                  onClick={handleTestParse}
                  disabled={testLoading}
                  className="btn btn-primary btn-sm"
                >
                  {testLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                      解析中...
                    </span>
                  ) : (
                    '🚀 开始测试解析'
                  )}
                </button>
              )}

              {testRecords.length > 0 && (
                <div>
                  <p className="text-sm text-[#86909c] mb-2">
                    解析结果: {testRecords.length} 条记录
                    {' | '}
                    {testRecords.filter(r => (r._errors || []).length > 0).length} 条有校验错误
                  </p>
                  <div className="max-h-64 overflow-auto rounded-lg border border-[#e5e6eb]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#f7f8fa] sticky top-0">
                        <tr>
                          {COLUMN_MAPPING_FIELDS.map(f => (
                            <th key={f} className="px-2 py-1 text-left text-[#86909c] whitespace-nowrap border-b">
                              {ORDER_FIELD_LABELS[f]}
                            </th>
                          ))}
                          <th className="px-2 py-1 text-left text-[#86909c] whitespace-nowrap border-b">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testRecords.map((rec, i) => {
                          const hasError = (rec._errors || []).length > 0;
                          return (
                            <tr key={i} className={hasError ? 'bg-[#fff1f0]' : i % 2 === 0 ? 'bg-white' : 'bg-[#fafbfc]'}>
                              {COLUMN_MAPPING_FIELDS.map(f => (
                                <td key={f} className="px-2 py-1 border-b border-[#e5e6eb] max-w-[120px] truncate">
                                  {String(((rec as unknown) as Record<string, unknown>)[f] ?? '')}
                                </td>
                              ))}
                              <td className="px-2 py-1 border-b border-[#e5e6eb]">
                                {hasError ? (
                                  <span className="text-[#cf1322]">
                                    {(rec._errors || []).map(e => e.message).join('; ')}
                                  </span>
                                ) : (
                                  <span className="text-[#00b42a]">✓</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-[#e5e6eb]">
          <button onClick={onClose} className="btn btn-outline">取消</button>
          <button
            onClick={async () => {
              if (!form.name) {
                toast.error('请输入规则名称');
                return;
              }
              // 保存中状态提示
              const toastId = toast.loading('正在保存规则...');
              try {
                const isEdit = !!(rule?.id);
                const url = isEdit ? `/api/rules/${rule!.id}` : '/api/rules';
                const method = isEdit ? 'PUT' : 'POST';
                const body = isEdit
                  ? form
                  : { ...form, isAiGenerated: rule?.isAiGenerated ?? false, aiConfidence: rule?.aiConfidence || {} };

                const res = await fetch(url, {
                  method,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const data = await res.json();

                if (data.rule) {
                  toast.success(isEdit ? '规则更新成功' : '规则创建成功', { id: toastId });
                  onSave(data.rule);
                } else {
                  toast.error(data.error || '保存失败', { id: toastId });
                }
              } catch (err) {
                toast.error(`保存规则失败: ${err instanceof Error ? err.message : '未知错误'}`, { id: toastId });
              }
            }}
            disabled={!form.name}
            className="btn btn-primary"
          >
            保存规则
          </button>
        </div>
      </div>
    </div>
  );
}
