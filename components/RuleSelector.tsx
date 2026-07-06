'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ParsedFileData, getPreviewForAI } from '@/lib/file-parsers';
import { ParseRule, FileType } from '@/lib/types';

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

  useEffect(() => {
    loadRules();
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
        toast.success('AI 已分析文件结构并生成推荐规则');
      }
    } catch (err) {
      setAiResult({ rule: {}, analysis: '', confidence: {}, error: `AI 请求失败: ${err}` });
    } finally {
      setAiLoading(false);
    }
  }, [parsedData]);

  const handleApplyAiRule = useCallback(async () => {
    if (!aiResult?.rule) return;
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiResult.rule),
      });
      const data = await res.json();
      if (data.rule) {
        toast.success('AI 规则已保存');
        await loadRules();
        onRuleSelected(data.rule);
      }
    } catch {
      toast.error('保存 AI 规则失败');
    }
  }, [aiResult, onRuleSelected]);

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
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <span className="tag tag-primary">
                    整体置信度: {aiResult.confidence?.overall || '--'}%
                  </span>
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
                        <strong>字段置信度:</strong>
                        <br />
                        {Object.entries(aiResult.confidence)
                          .filter(([k]) => k !== 'overall')
                          .map(([k, v]) => (
                            <span key={k} className="tag tag-warning mr-1 mb-1">
                              {k}: {v}%
                            </span>
                          ))}
                      </>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button onClick={handleApplyAiRule} className="btn btn-primary btn-sm">
                    ✅ 应用 AI 规则并解析
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
                    {rule.isAiGenerated && <span className="tag tag-info ml-1">AI生成</span>}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
