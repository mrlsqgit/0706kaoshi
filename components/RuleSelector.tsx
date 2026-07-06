'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ParsedFileData, getPreviewForAI } from '@/lib/file-parsers';
import { ParseRule, FileType } from '@/lib/types';
import RuleEditorModal from '@/components/RuleEditorModal';

interface RuleSelectorProps {
  parsedData: ParsedFileData;
  onRuleSelected: (rule: ParseRule) => void;
  selectedRule: ParseRule | null;
}

export default function RuleSelector({ parsedData, onRuleSelected, selectedRule }: RuleSelectorProps) {
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    rule: Partial<ParseRule>;
    analysis: string;
    confidence: Record<string, number>;
    error?: string;
  } | null>(null);
  const [showAiDetail, setShowAiDetail] = useState(false);
  // AI 规则手动微调确认
  const [showAiEditor, setShowAiEditor] = useState(false);

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRules = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      setRules(data.rules || []);
    } catch {
      toast.error('加载规则列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAiGenerate = useCallback(async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      const preview = getPreviewForAI(parsedData);
      const res = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePreview: preview,
          fileName: parsedData.fileName,
          fileType: parsedData.fileType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiResult({ rule: {}, analysis: '', confidence: {}, error: data.error || 'AI 生成失败' });
      } else {
        setAiResult(data);
        toast.success('AI 已分析文件结构并生成推荐规则，请检查并确认');
      }
    } catch (err) {
      setAiResult({ rule: {}, analysis: '', confidence: {}, error: `AI 请求失败: ${err}` });
    } finally {
      setAiLoading(false);
    }
  }, [parsedData]);

  // 直接应用 AI 规则并解析
  const handleApplyAiRule = useCallback(async () => {
    if (!aiResult?.rule) return;

    const toastId = toast.loading('正在保存并应用规则...');
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...aiResult.rule,
          isAiGenerated: true,
          aiConfidence: aiResult.confidence || {},
        }),
      });

      // 先检查 HTTP 状态
      if (!res.ok) {
        let errMsg = `服务器错误 (${res.status})`;
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch { /* ignore parse error */ }
        toast.error(`保存失败: ${errMsg}`, { id: toastId });
        return;
      }

      const data = await res.json();

      if (data.rule && data.rule.id) {
        toast.success('AI 规则已保存并应用，开始解析', { id: toastId });
        await loadRules();
        onRuleSelected(data.rule);
      } else {
        console.error('[handleApplyAiRule] API 返回格式异常:', data);
        toast.error(`保存响应格式异常，请尝试"手动微调确认"`, { id: toastId });
      }
    } catch (err) {
      console.error('[handleApplyAiRule] 异常:', err);
      toast.error(`操作失败: ${err instanceof Error ? err.message : '未知错误'}`, { id: toastId });
    }
  }, [aiResult, onRuleSelected]);

  // 打开编辑器手动微调 AI 规则
  const handleEditAiRule = useCallback(() => {
    setShowAiEditor(true);
  }, []);

  // 编辑器保存回调（RuleEditorModal 内部已完成 API 调用）
  const handleAiEditorSave = useCallback(async (savedRule: Partial<ParseRule>) => {
    if (savedRule.id) {
      toast.success('规则已保存，即将应用解析');
      setShowAiEditor(false);
      await loadRules();
      onRuleSelected(savedRule as ParseRule);
    }
  }, [onRuleSelected]);

  const filteredRules = rules.filter(r => r.fileType === parsedData.fileType);

  return (
    <div className="space-y-6">
      {/* AI 生成规则 */}
      <div className="p-5 rounded-xl border border-dashed border-[#0fc6c2] bg-[#e8fafa]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bold text-[#0b6e6e] text-base">🤖 AI 智能生成规则</h3>
            <p className="text-[#4e5969] text-sm mt-1">
              大模型自动分析文件结构，生成推荐解析规则（可手动微调）
            </p>
          </div>
        </div>

        {!aiResult && (
          <button
            onClick={handleAiGenerate}
            disabled={aiLoading}
            className="btn btn-primary"
          >
            {aiLoading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                AI 分析中...
              </>
            ) : (
              '🚀 开始 AI 分析'
            )}
          </button>
        )}

        {aiResult && (
          <div className="animate-fadeIn">
            {aiResult.error ? (
              <div className="p-3 rounded-lg bg-[#fff1f0] border border-[#ffccc7] text-[#cf1322] text-sm">
                {aiResult.error}
                <button onClick={handleAiGenerate} className="ml-3 underline">重试</button>
              </div>
            ) : (
              <div>
                {/* 置信度展示 */}
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <span className={`tag ${(aiResult.confidence?.overall || 0) >= 70 ? 'tag-primary' : (aiResult.confidence?.overall || 0) >= 50 ? 'tag-warning' : 'tag-danger'}`}>
                    整体置信度: {aiResult.confidence?.overall || '--'}%
                  </span>
                  {aiResult.confidence?.overall != null && aiResult.confidence.overall < 70 && (
                    <span className="text-xs text-[#d97b00]">⚠️ 部分映射为AI推测，建议手动确认</span>
                  )}
                  <button
                    onClick={() => setShowAiDetail(!showAiDetail)}
                    className="text-sm text-[#0fc6c2] hover:underline"
                  >
                    {showAiDetail ? '收起分析' : '查看分析详情'}
                  </button>
                </div>

                {showAiDetail && (
                  <div className="mb-4 p-3 bg-white rounded-lg text-sm text-[#4e5969] whitespace-pre-wrap max-h-48 overflow-y-auto">
                    <strong>AI 分析:</strong>
                    <br />
                    {aiResult.analysis || '无详细分析'}
                    {aiResult.confidence && (
                      <>
                        <br /><br />
                        <strong className="text-[#1d2129]">字段置信度（低于70%为推测值）:</strong>
                        <br />
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(aiResult.confidence)
                            .filter(([k]) => k !== 'overall')
                            .map(([k, v]) => (
                              <span key={k} className={`tag ${v >= 70 ? 'tag-primary' : v >= 50 ? 'tag-warning' : 'tag-danger'} mr-1 mb-1`}>
                                {k}: {v}%
                                {v < 70 && ' ⚠推测'}
                              </span>
                            ))}
                        </div>
                      </>
                    )}
                    {/* 推断字段说明 */}
                    {aiResult.rule?.columnMappings && aiResult.rule.columnMappings.some((m: any) => {
                      const fieldConf = aiResult.confidence?.[m.targetField];
                      return fieldConf != null && fieldConf < 70;
                    }) && (
                      <div className="mt-3 p-2 bg-[#fff7e8] rounded-lg border border-[#ffe4ba]">
                        <strong className="text-[#d97b00]">⚠️ AI 推测字段：</strong>
                        <br />
                        <span className="text-[#d97b00]">
                          {aiResult.rule.columnMappings
                            .filter((m: any) => (aiResult.confidence?.[m.targetField] || 100) < 70)
                            .map((m: any) => {
                              const labels: Record<string, string> = {
                                externalCode: '外部编码', storeName: '收货门店', receiverName: '收件人姓名',
                                receiverPhone: '收件人电话', receiverAddress: '收件人地址', skuCode: 'SKU编码',
                                skuName: 'SKU名称', skuQuantity: 'SKU数量', skuSpec: 'SKU规格', remark: '备注',
                              };
                              return `${labels[m.targetField] || m.targetField}（置信度 ${aiResult.confidence?.[m.targetField] || '?'}%）`;
                            })
                            .join('、')
                          }
                          <br />
                          以上字段由AI推测，建议点击"手动微调确认"进行检查
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleEditAiRule}
                    className="btn btn-primary btn-sm"
                  >
                    🔧 手动微调确认
                  </button>
                  <button onClick={handleApplyAiRule} className="btn btn-outline btn-sm">
                    ✅ 直接应用
                  </button>
                  <button
                    onClick={() => { setAiResult(null); }}
                    className="btn btn-outline btn-sm"
                  >
                    重新生成
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 已有规则列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-[#1d2129]">已有解析规则</h3>
          <button
            onClick={() => window.location.href = '/rules?new=true'}
            className="btn btn-outline btn-sm"
          >
            + 新建规则
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-[#86909c]">
            <div className="loading-dots justify-center mb-2">
              <span /><span /><span />
            </div>
            加载规则中...
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="text-center py-8 text-[#86909c] bg-[#fafbfc] rounded-xl">
            <p className="mb-3">暂无适合 {parsedData.fileType === 'excel' ? 'Excel' : parsedData.fileType === 'word' ? 'Word' : 'PDF'} 格式的解析规则</p>
            <p className="text-sm">请使用上方 AI 生成，或手动创建规则</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredRules.map((rule) => (
              <div
                key={rule.id}
                className={`
                  p-4 rounded-xl border cursor-pointer transition-all
                  ${selectedRule?.id === rule.id
                    ? 'border-[#0fc6c2] bg-[#e8fafa]'
                    : 'border-[#e5e6eb] bg-white hover:border-[#0fc6c2] hover:shadow-md'
                  }
                `}
                onClick={() => onRuleSelected(rule)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-[#1d2129]">{rule.name}</span>
                    <span className="tag tag-primary ml-2">{rule.fileType.toUpperCase()}</span>
                    {rule.isAiGenerated && (
                      <span className="tag tag-info ml-1">AI生成</span>
                    )}
                    {rule.isAiGenerated && rule.aiConfidence?.overall != null && rule.aiConfidence.overall < 70 && (
                      <span className="tag tag-warning ml-1">⚠低置信度</span>
                    )}
                  </div>
                  <span className="text-xs text-[#86909c]">
                    {new Date(rule.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                {rule.description && (
                  <p className="text-sm text-[#86909c] mt-1 truncate">{rule.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2 text-xs text-[#86909c]">
                  <span>跳过头部 {rule.headerRowsToSkip} 行</span>
                  <span>·</span>
                  <span>{rule.columnMappings.length} 个字段映射</span>
                  <span>·</span>
                  <span>{rule.processors.filter(p => p.enabled).length} 个处理器</span>
                  {rule.aiConfidence?.overall != null && (
                    <>
                      <span>·</span>
                      <span className={rule.aiConfidence.overall >= 70 ? 'text-[#0fc6c2]' : 'text-[#d97b00]'}>
                        AI置信度 {rule.aiConfidence.overall}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 规则编辑器弹窗（手动微调确认） */}
      {showAiEditor && aiResult?.rule && (
        <RuleEditorModal
          rule={aiResult.rule as ParseRule}
          onSave={handleAiEditorSave}
          onClose={() => setShowAiEditor(false)}
        />
      )}
    </div>
  );
}
