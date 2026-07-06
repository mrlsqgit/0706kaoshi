'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  ParseRule,
  FileType,
  ColumnMapping,
  ProcessorConfig,
  OrderField,
  ORDER_FIELD_LABELS,
  ORDER_FIELD_GROUPS,
  SourceType,
  ProcessorType,
} from '@/lib/types';
import RuleEditorModal from '@/components/RuleEditorModal';

const PROCESSOR_LABELS: Record<ProcessorType, string> = {
  tailInfoExtraction: '尾部信息提取',
  crossRowAggregation: '跨行聚合',
  matrixTranspose: '矩阵转置',
  cardDetection: '卡片检测',
  compositeCellSplit: '复合单元格拆分',
  multiOrderSplit: '多订单拆分',
  textParsing: '文本解析',
  multiSheet: '多Sheet处理',
  columnMapping: '列映射',
  skipRows: '跳过行',
};

export default function RulesPage() {
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<ParseRule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { loadRules(); }, []);

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

  const handleCreate = () => {
    setEditingRule(null);
    setShowEditor(true);
  };

  const handleEdit = (rule: ParseRule) => {
    setEditingRule(rule);
    setShowEditor(true);
  };

  const handleSave = async (ruleData: Partial<ParseRule>) => {
    try {
      if (editingRule) {
        await fetch(`/api/rules/${editingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ruleData),
        });
        toast.success('规则更新成功');
      } else {
        await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ruleData),
        });
        toast.success('规则创建成功');
      }
      setShowEditor(false);
      loadRules();
    } catch {
      toast.error('保存规则失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      toast.success('规则已删除');
      setConfirmDelete(null);
      loadRules();
    } catch {
      toast.error('删除规则失败');
    }
  };

  const handleCopy = async (rule: ParseRule) => {
    const { id, createdAt, updatedAt, ...ruleData } = rule;
    try {
      await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ruleData, name: `${ruleData.name} (副本)` }),
      });
      toast.success('规则已复制');
      loadRules();
    } catch {
      toast.error('复制规则失败');
    }
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1d2129]">解析规则管理</h1>
          <p className="text-[#86909c] text-sm mt-1">管理文件解析规则，支持手动创建和 AI 辅助生成</p>
        </div>
        <button onClick={handleCreate} className="btn btn-primary">
          + 新建规则
        </button>
      </div>

      {loading ? (
        <div className="card text-center py-12">
          <div className="loading-dots justify-center mb-3">
            <span /><span /><span />
          </div>
          <p className="text-[#86909c]">加载规则列表...</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p className="empty-state-text font-medium text-[#1d2129]">暂无解析规则</p>
            <p className="text-[#86909c] text-sm mb-4">创建规则后即可在导入文件时使用</p>
            <button onClick={handleCreate} className="btn btn-primary">创建第一条规则</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {rules.map((rule) => (
            <div key={rule.id} className="card card-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-[#1d2129]">{rule.name}</h3>
                    <span className="tag tag-primary">{rule.fileType.toUpperCase()}</span>
                    {rule.isAiGenerated && (
                      <span className="tag tag-info">AI 生成</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-sm text-[#86909c] mb-2">{rule.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#86909c]">
                    <span>跳过头部 {rule.headerRowsToSkip} 行</span>
                    <span>·</span>
                    <span>跳过尾部 {rule.footerRowsToSkip} 行</span>
                    <span>·</span>
                    <span>{rule.columnMappings.length} 个映射</span>
                    <span>·</span>
                    <span>{rule.processors.filter(p => p.enabled).length} 个处理器</span>
                    {rule.sheetNames.length > 0 && (
                      <>
                        <span>·</span>
                        <span>Sheet: {rule.sheetNames.join(', ')}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {rule.processors.filter(p => p.enabled).map((p, i) => (
                      <span key={i} className="tag tag-warning text-[10px]">
                        {PROCESSOR_LABELS[p.type] || p.type}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button onClick={() => handleEdit(rule)} className="btn btn-outline btn-sm">编辑</button>
                  <button onClick={() => handleCopy(rule)} className="btn btn-outline btn-sm">复制</button>
                  <button
                    onClick={() => setConfirmDelete(rule.id)}
                    className="btn btn-danger btn-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
              {rule.isAiGenerated && rule.aiConfidence && (
                <div className="mt-2 pt-2 border-t border-[#e5e6eb]">
                  <span className="text-xs text-[#86909c]">
                    AI 置信度: {rule.aiConfidence.overall || '--'}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      {showEditor && (
        <RuleEditorModal
          rule={editingRule}
          onSave={handleSave}
          onClose={() => setShowEditor(false)}
        />
      )}

      {/* 删除确认弹窗 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card animate-fadeIn max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-[#1d2129] mb-2">确认删除</h3>
            <p className="text-[#4e5969] mb-6">确定要删除这条解析规则吗？此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn btn-outline">取消</button>
              <button onClick={() => handleDelete(confirmDelete)} className="btn btn-danger">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
