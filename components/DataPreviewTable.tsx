'use client';

import { useState, useCallback, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { OrderRecord, ORDER_FIELD_LABELS, OrderField } from '@/lib/types';
import { exportToExcel } from '@/lib/utils';
import { validateRecords, checkDuplicates } from '@/lib/rule-engine';

const COLUMNS: OrderField[] = [
  'externalCode', 'storeName', 'receiverName', 'receiverPhone', 'receiverAddress',
  'skuCode', 'skuName', 'skuQuantity', 'skuSpec', 'remark',
];

/** 类型安全地读取 OrderRecord 字段值 */
function getFieldValue(record: OrderRecord, field: OrderField): string {
  return String(record[field] ?? '');
}

/** 类型安全地设置 OrderRecord 字段值（返回新对象） */
function setFieldValue(record: OrderRecord, field: OrderField, value: string | number): OrderRecord {
  const updated = { ...record };
  if (field === 'skuQuantity') {
    updated.skuQuantity = typeof value === 'number' ? value : (parseFloat(value as string) || 0);
  } else {
    // 所有其他字段都是 string 类型
    (updated as Record<OrderField, unknown>)[field] = String(value);
  }
  return updated;
}

const ROW_HEIGHT = 42;
// 超过此阈值启用虚拟列表
const VIRTUAL_THRESHOLD = 50;

interface DataPreviewTableProps {
  records: OrderRecord[];
  onChange: (records: OrderRecord[]) => void;
  existingCodes?: Set<string>;
}

export default function DataPreviewTable({ records, onChange, existingCodes }: DataPreviewTableProps) {
  const [editCell, setEditCell] = useState<{ row: number; field: OrderField } | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCellClick = useCallback((rowIndex: number, field: OrderField) => {
    const record = records[rowIndex];
    const value = field === 'skuQuantity'
      ? String(record.skuQuantity || '')
      : getFieldValue(record, field);
    setEditValue(value);
    setEditCell({ row: rowIndex, field });
    // 聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [records]);

  const handleCellSave = useCallback(() => {
    if (!editCell) return;
    const newRecords = [...records];
    const record = setFieldValue(newRecords[editCell.row], editCell.field, editValue);
    newRecords[editCell.row] = record;

    // 重新校验
    let validated = validateRecords(newRecords);
    validated = checkDuplicates(validated, existingCodes || new Set());

    onChange(validated);
    setEditCell(null);
  }, [editCell, editValue, records, onChange, existingCodes]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, rowIndex: number, field: OrderField) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCellSave();
      if (rowIndex < records.length - 1) {
        handleCellClick(rowIndex + 1, field);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleCellSave();
      const colIndex = COLUMNS.indexOf(field);
      if (e.shiftKey) {
        if (colIndex > 0) {
          handleCellClick(rowIndex, COLUMNS[colIndex - 1]);
        } else if (rowIndex > 0) {
          handleCellClick(rowIndex - 1, COLUMNS[COLUMNS.length - 1]);
        }
      } else {
        if (colIndex < COLUMNS.length - 1) {
          handleCellClick(rowIndex, COLUMNS[colIndex + 1]);
        } else if (rowIndex < records.length - 1) {
          handleCellClick(rowIndex + 1, COLUMNS[0]);
        }
      }
    } else if (e.key === 'Escape') {
      setEditCell(null);
    }
  }, [handleCellClick, handleCellSave, records]);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    const newRecords = records.filter((_, i) => i !== rowIndex);
    let validated = validateRecords(newRecords);
    validated = checkDuplicates(validated, existingCodes || new Set());
    onChange(validated);
  }, [records, onChange, existingCodes]);

  const handleAddRow = useCallback(() => {
    const newRecord: OrderRecord = {
      externalCode: '', storeName: '', receiverName: '', receiverPhone: '',
      receiverAddress: '', skuCode: '', skuName: '', skuQuantity: 0,
      skuSpec: '', remark: '', _rowIndex: records.length,
    };
    let newRecords = [...records, newRecord];
    newRecords = validateRecords(newRecords);
    newRecords = checkDuplicates(newRecords, existingCodes || new Set());
    onChange(newRecords);
  }, [records, onChange, existingCodes]);

  const handleExport = useCallback(() => {
    exportToExcel(records, '运单数据预览');
  }, [records]);

  const getRowClass = (record: OrderRecord) => {
    if (record._errors?.length) return 'row-error';
    if (record._duplicateWith) return 'row-duplicate';
    return '';
  };

  const useVirtual = records.length > VIRTUAL_THRESHOLD;
  const tableHeight = Math.min(records.length * ROW_HEIGHT, window.innerHeight * 0.55);

  // 渲染单行（用于虚拟列表）
  const renderRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const record = records[index];
    const rowClass = getRowClass(record);

    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          background: rowClass === 'row-error' ? '#fff1f0' : rowClass === 'row-duplicate' ? '#fff7e8' : index % 2 === 0 ? '#fff' : '#fafbfc',
          borderBottom: '1px solid #e5e6eb',
          transition: 'background 0.15s',
        }}
        className="hover:bg-[#f7f8fa]"
      >
        {/* 行号 */}
        <div style={{ width: 50, textAlign: 'center', color: '#86909c', fontSize: 13, flexShrink: 0 }}>
          {index + 1}
          {record._duplicateWith && (
            <span className="tooltip ml-1 cursor-help" data-tooltip={record._duplicateWith}>⚠️</span>
          )}
        </div>
        {/* 数据列 */}
        {COLUMNS.map((field) => {
          const isEditing = editCell?.row === index && editCell?.field === field;
          const value = field === 'skuQuantity'
            ? (record.skuQuantity ?? '')
            : getFieldValue(record, field);
          const hasError = record._errors?.some(e => e.field === field);

          return (
            <div
              key={`${index}-${field}`}
              onClick={() => handleCellClick(index, field)}
              style={{
                cursor: 'pointer',
                background: hasError ? '#fff1f0' : undefined,
                minWidth: field === 'receiverAddress' || field === 'remark' ? 180 : 120,
                flexShrink: 0,
                padding: '4px 8px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  type={field === 'skuQuantity' ? 'number' : 'text'}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleCellSave}
                  onKeyDown={(e) => handleKeyDown(e, index, field)}
                  className="w-full px-1 py-0.5 border border-[#0fc6c2] rounded outline-none text-sm"
                  style={{ minWidth: 80 }}
                />
              ) : (
                <span style={{ color: hasError ? '#cf1322' : '#4e5969', fontSize: 14 }}>
                  {value || (hasError ? <span style={{ color: '#cf1322', fontSize: 12 }}>(必填)</span> : '')}
                </span>
              )}
            </div>
          );
        })}
        {/* 操作列 */}
        <div style={{ width: 80, textAlign: 'center', flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteRow(index); }}
            className="btn btn-danger btn-sm"
            title="删除行"
          >
            删除
          </button>
        </div>
      </div>
    );
  }, [records, editCell, editValue, handleCellClick, handleCellSave, handleKeyDown, handleDeleteRow, getRowClass]);

  // 锁定的表头宽度计算
  const headerWidth = 50 + COLUMNS.reduce((sum, f) => sum + (f === 'receiverAddress' || f === 'remark' ? 180 : 120), 0) + 80;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e6eb]">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#86909c]">共 {records.length} 条记录</span>
          {(records.some(r => r._errors?.length)) && (
            <span className="tag tag-danger">
              {records.filter(r => r._errors?.length).length} 条错误
            </span>
          )}
          {records.some(r => r._duplicateWith) && (
            <span className="tag tag-warning">
              重复编码
            </span>
          )}
          {useVirtual && (
            <span className="tag tag-primary text-xs">虚拟列表优化</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleAddRow} className="btn btn-outline btn-sm">
            + 新增行
          </button>
          <button onClick={handleExport} className="btn btn-outline btn-sm">
            📥 导出 Excel
          </button>
        </div>
      </div>

      {/* 固定表头 */}
      <div style={{ overflowX: 'auto', minWidth: headerWidth }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: '#f7f8fa',
          borderBottom: '2px solid #e5e6eb',
          fontWeight: 600,
          fontSize: 13,
          color: '#1d2129',
          position: 'sticky',
          top: 0,
          zIndex: 2,
          minWidth: headerWidth,
        }}>
          <div style={{ width: 50, textAlign: 'center', padding: '10px 4px', flexShrink: 0 }}>#</div>
          {COLUMNS.map((field) => (
            <div key={field} style={{
              minWidth: field === 'receiverAddress' || field === 'remark' ? 180 : 120,
              padding: '10px 8px',
              flexShrink: 0,
            }}>
              {ORDER_FIELD_LABELS[field]}
            </div>
          ))}
          <div style={{ width: 80, textAlign: 'center', padding: '10px 4px', flexShrink: 0 }}>操作</div>
        </div>

        {/* 虚拟列表 or 普通列表 */}
        {useVirtual ? (
          <div style={{ minWidth: headerWidth }}>
            <AutoSizer disableHeight>
              {({ width }) => (
                <List
                  height={tableHeight}
                  itemCount={records.length}
                  itemSize={ROW_HEIGHT}
                  width={Math.max(width, headerWidth)}
                >
                  {renderRow}
                </List>
              )}
            </AutoSizer>
          </div>
        ) : (
          <div style={{ maxHeight: '60vh', overflowY: 'auto', minWidth: headerWidth }}>
            {records.map((record, idx) => (
              <div key={idx} style={{ height: ROW_HEIGHT }}>
                {renderRow({ index: idx, style: { height: ROW_HEIGHT, width: '100%' } })}
              </div>
            ))}
          </div>
        )}
      </div>

      {records.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <p className="empty-state-text">暂无数据</p>
        </div>
      )}
    </>
  );
}
