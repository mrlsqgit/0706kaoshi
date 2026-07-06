'use client';

import { useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { parseFile, ParsedFileData, getPreviewForAI } from '@/lib/file-parsers';
import { executeParse, validateRecords, checkDuplicates } from '@/lib/rule-engine';
import { ParseRule, OrderRecord, ParseResult } from '@/lib/types';
import DataPreviewTable from '@/components/DataPreviewTable';
import RuleSelector from '@/components/RuleSelector';
import ProgressBar from '@/components/ProgressBar';

type Step = 'upload' | 'selectRule' | 'preview' | 'submitted';

export default function HomePage() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedFileData | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [records, setRecords] = useState<OrderRecord[]>([]);
  const [selectedRule, setSelectedRule] = useState<ParseRule | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: number; total: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ====== 文件处理 ======
  const handleFile = useCallback(async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'docx', 'pdf'].includes(ext || '')) {
      toast.error('不支持的文件格式，请上传 Excel / Word / PDF 文件');
      return;
    }
    setFile(f);
    setIsParsing(true);
    setParseProgress(10);
    try {
      const data = await parseFile(f);
      setParseProgress(50);
      setParsedData(data);
      setParseProgress(100);
      setStep('selectRule');
      toast.success(`文件解析成功，共 ${data.metadata.rowCount} 行，${data.metadata.sheetCount} 个 Sheet`);
    } catch (err) {
      toast.error(`文件解析失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsParsing(false);
      setParseProgress(0);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ====== 规则选择与执行解析 ======
  const handleRuleSelected = useCallback(async (rule: ParseRule) => {
    if (!parsedData) return;
    setSelectedRule(rule);
    setIsParsing(true);
    setParseProgress(0);

    try {
      // 模拟解析进度
      const progressInterval = setInterval(() => {
        setParseProgress((p) => Math.min(p + 15, 90));
      }, 200);

      let allRecords: OrderRecord[] = [];

      // 对于 Excel，逐 Sheet 解析
      if (parsedData.fileType === 'excel') {
        const sheetsToProcess = rule.sheetNames.length > 0
          ? parsedData.sheets.filter(s => rule.sheetNames.includes(s.sheetName))
          : parsedData.sheets;

        for (const sheet of sheetsToProcess) {
          const parsed = executeParse(sheet.rows, sheet.headers, rule);
          allRecords.push(...parsed);
        }
      } else {
        // Word / PDF 使用第一个 Sheet
        const sheet = parsedData.sheets[0];
        if (sheet) {
          // 对于 Word/PDF，尝试文本解析
          if (parsedData.rawText) {
            const parsed = executeParse(sheet.rows, sheet.headers, rule, parsedData.rawText);
            allRecords = parsed;
          } else {
            const parsed = executeParse(sheet.rows, sheet.headers, rule);
            allRecords = parsed;
          }
        }
      }

      clearInterval(progressInterval);

      // 校验
      let validated = validateRecords(allRecords);

      // 重复检测
      const { getAllExternalCodes } = await import('@/lib/db');
      const existingCodes = await getAllExternalCodes();
      validated = checkDuplicates(validated, existingCodes);

      // 添加行号
      validated = validated.map((r, i) => ({ ...r, _rowIndex: i }));

      setRecords(validated);
      setParseResult({
        fileName: file?.name || '',
        ruleName: rule.name,
        records: validated,
        errors: validated.flatMap((r, i) => (r._errors || []).map(e => ({ ...e, row: i + 1 }))),
      });

      const errorCount = validated.filter(r => (r._errors?.length || 0) > 0).length;
      setParseProgress(100);
      setStep('preview');

      if (errorCount > 0) {
        toast(`${validated.length} 条记录，${errorCount} 条有校验错误`, { icon: '⚠️' });
      } else {
        toast.success(`解析成功，共 ${validated.length} 条记录`);
      }
    } catch (err) {
      toast.error(`解析执行失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsParsing(false);
    }
  }, [parsedData, file]);

  // ====== 记录更新 ======
  const handleRecordsChange = useCallback((updatedRecords: OrderRecord[]) => {
    setRecords(updatedRecords);
    setParseResult(prev => prev ? {
      ...prev,
      records: updatedRecords,
      errors: updatedRecords.flatMap((r, i) => (r._errors || []).map(e => ({ ...e, row: i + 1 }))),
    } : null);
  }, []);

  // ====== 重新选择规则 ======
  const handleReselectRule = useCallback(() => {
    setSelectedRule(null);
    setRecords([]);
    setParseResult(null);
    setStep('selectRule');
  }, []);

  // ====== 重新上传 ======
  const handleReupload = useCallback(() => {
    setFile(null);
    setParsedData(null);
    setSelectedRule(null);
    setRecords([]);
    setParseResult(null);
    setSubmitResult(null);
    setStep('upload');
  }, []);

  // ====== 提交 ======
  const handleSubmit = useCallback(async () => {
    const hasErrors = records.some(r => (r._errors?.length || 0) > 0);
    if (hasErrors) {
      toast.error('存在校验错误，请先修正后再提交');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: records }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          toast.error('存在重复的外部编码，请检查');
          return;
        }
        toast.error(result.error || '提交失败');
        return;
      }

      setSubmitResult({ success: result.successCount, total: result.totalCount });
      setStep('submitted');
      toast.success(`提交成功！${result.successCount} 条运单已入库`);
    } catch {
      toast.error('提交失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  }, [records]);

  const hasErrors = records.some(r => (r._errors?.length || 0) > 0);
  const fileSize = file ? `${(file.size / 1024).toFixed(1)} KB` : '';

  return (
    <div>
      {/* 步骤指示器 */}
      <div className="flex items-center justify-center gap-4 mb-8">
        {[
          { key: 'upload', label: '上传文件', num: 1 },
          { key: 'selectRule', label: '选择规则', num: 2 },
          { key: 'preview', label: '预览编辑', num: 3 },
          { key: 'submitted', label: '完成', num: 4 },
        ].map((s, i) => {
          const currentStepIndex = ['upload', 'selectRule', 'preview', 'submitted'].indexOf(step);
          const stepIndex = i;
          const isDone = stepIndex < currentStepIndex || (step === 'submitted' && stepIndex <= 3);
          const isActive = stepIndex === currentStepIndex;

          return (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                  ${isDone ? 'bg-[#0fc6c2] text-white' : ''}
                  ${isActive ? 'bg-[#0fc6c2] text-white scale-110 shadow-lg shadow-[#0fc6c2]/30' : ''}
                  ${!isDone && !isActive ? 'bg-[#e5e6eb] text-[#86909c]' : ''}
                `}
              >
                {isDone ? '✓' : s.num}
              </div>
              <span className={`text-sm font-medium ${isActive || isDone ? 'text-[#1d2129]' : 'text-[#86909c]'}`}>
                {s.label}
              </span>
              {i < 3 && (
                <div className={`w-12 h-0.5 rounded-full ${stepIndex > stepIndex || isDone ? 'bg-[#0fc6c2]' : 'bg-[#e5e6eb]'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* 步骤1：上传 */}
      {step === 'upload' && (
        <div className="card animate-fadeIn">
          <h2 className="text-xl font-bold text-[#1d2129] mb-2">导入出库单文件</h2>
          <p className="text-[#86909c] mb-6">支持 Excel (.xlsx/.xls)、Word (.docx)、PDF 格式</p>

          {isParsing ? (
            <div className="py-16 text-center">
              <div className="animate-spin inline-block w-10 h-10 border-3 border-[#e5e6eb] border-t-[#0fc6c2] rounded-full mb-4" />
              <p className="text-[#4e5969]">正在解析文件...</p>
              <div className="mt-4 max-w-sm mx-auto">
                <ProgressBar percent={parseProgress} />
              </div>
            </div>
          ) : (
            <div
              className={`drop-zone ${dragActive ? 'drag-active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-[#4e5969] font-medium mb-1">拖拽文件到此处，或点击上传</p>
              <p className="text-[#86909c] text-sm">支持 .xlsx .xls .docx .pdf</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.docx,.pdf"
                onChange={onFileChange}
                className="hidden"
              />
            </div>
          )}
        </div>
      )}

      {/* 步骤2：选择/新建规则 */}
      {step === 'selectRule' && parsedData && (
        <div className="card animate-fadeIn">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-[#1d2129]">选择解析规则</h2>
              <p className="text-[#86909c] text-sm mt-1">
                文件: {file?.name} ({fileSize}) · {parsedData.metadata.sheetCount} Sheet · {parsedData.metadata.rowCount} 行
              </p>
            </div>
            <button onClick={handleReupload} className="btn btn-outline btn-sm">
              重新上传
            </button>
          </div>

          <RuleSelector
            parsedData={parsedData}
            onRuleSelected={handleRuleSelected}
            selectedRule={selectedRule}
          />
        </div>
      )}

      {/* 步骤3：预览 */}
      {step === 'preview' && parseResult && (
        <div className="animate-fadeIn">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-[#1d2129]">数据预览</h2>
              <p className="text-[#86909c] text-sm mt-1">
                {parseResult.records.length} 条记录 · 规则: {parseResult.ruleName}
                {hasErrors && (
                  <span className="tag tag-danger ml-2">
                    {parseResult.records.filter(r => (r._errors?.length || 0) > 0).length} 条错误
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleReselectRule} className="btn btn-outline btn-sm">
                重新选择规则
              </button>
              <button onClick={handleReupload} className="btn btn-outline btn-sm">
                重新上传
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || hasErrors}
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                    提交中...
                  </>
                ) : (
                  '提交下单'
                )}
              </button>
            </div>
          </div>

          {/* 错误汇总 */}
          {hasErrors && (
            <div className="card-sm mb-4" style={{ background: '#fff1f0', border: '1px solid #ffccc7' }}>
              <h3 className="font-bold text-[#cf1322] mb-2">校验错误汇总</h3>
              <div className="max-h-40 overflow-y-auto text-sm text-[#cf1322] space-y-1">
                {records.filter(r => (r._errors?.length || 0) > 0).map(r => (
                  r._errors!.map((e, ei) => (
                    <div key={`${r._rowIndex}-${ei}`} className="pl-3 border-l-2 border-[#ffccc7]">
                      第 {e.row} 行 · {e.field}: {e.message}
                    </div>
                  ))
                ))}
              </div>
            </div>
          )}

          <div className="card p-0 overflow-hidden">
            <DataPreviewTable
              records={records}
              onChange={handleRecordsChange}
            />
          </div>
        </div>
      )}

      {/* 步骤4：完成 */}
      {step === 'submitted' && submitResult && (
        <div className="card animate-fadeIn text-center py-12">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-[#1d2129] mb-2">提交成功！</h2>
          <p className="text-[#4e5969] mb-6">
            成功提交 <span className="text-[#0fc6c2] font-bold text-lg">{submitResult.success}</span> 条运单
            {submitResult.success < submitResult.total && (
              <span className="text-[#cf1322]">，{submitResult.total - submitResult.success} 条失败</span>
            )}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={handleReupload} className="btn btn-primary btn-lg">
              导入新文件
            </button>
            <button
              onClick={() => window.location.href = '/orders'}
              className="btn btn-outline btn-lg"
            >
              查看运单列表
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
