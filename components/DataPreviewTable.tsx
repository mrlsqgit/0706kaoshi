'use client';

import { useState, useCallback, useMemo } from 'react';
import { OrderRecord, ORDER_FIELD_LABELS, OrderField } from '@/lib/types';
import { exportToExcel } from '@/lib/utils';
import { validateRecords, checkDuplicates } from '@/lib/rule-engine';

const COLUMNS: OrderField[] = [
  'externalCode', 'storeName', 'receiverName', 'receiverPhone', 'receiverAddress',
  'skuCode', 'skuName', 'skuQuantity', 'skuSpec', 'remark',
];

interface DataPreviewTableProps {
  records: OrderRecord[];
  onChange: (records: OrderRecord[]) => void;
  existingCodes?: Set<string>;
}

export default function DataPreviewTable({ records, onChange, existingCodes }: DataPreviewTableProps) {
  const [editCell, setEditCell] = useState<{ row: number; field: OrderField } | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleCellClick = useCallback((rowIndex: number, field: OrderField) => {
    const record = records[rowIndex];
    const value = field === 'skuQuantity'
      ? String(record.skuQuantity || '')
      : String((record as Record<string, unknown>)[field] || '');
    setEditValue(value);
    setEditCell({ row: rowIndex, field });
  }, [records]);

  const handleCellSave = useCallback(() => {
    if (!editCell) return;
    const newRecords = [...records];
    const record = { ...newRecords[editCell.row] };

    if (editCell.field === 'skuQuantity') {
      record.skuQuantity = parseFloat(editValue) || 0;
    } else {
      (record as Record<string, unknown>)[editCell.field] = editValue;
    }

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
      // 移到下一行同列
      if (rowIndex < records.length - 1) {
        handleCellClick(rowIndex + 1, field);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleCellSave();
      const colIndex = COLUMNS.indexOf(field);
      if (e.shiftKey) {
        // 移到上一列
        if (colIndex > 0) {
          handleCellClick(rowIndex, COLUMNS[colIndex - 1]);
        } else if (rowIndex > 0) {
          handleCellClick(rowIndex - 1, COLUMNS[COLUMNS.length - 1]);
        }
      } else {
        // 移到下一列
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

      <div className="table-wrapper" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 50, textAlign: 'center', position: 'sticky', top: 0, zIndex: 2, background: '#f7f8fa' }}>#</th>
              {COLUMNS.map((field) => (
                <th key={field} style={{ minWidth: field === 'receiverAddress' || field === 'remark' ? 180 : 120, position: 'sticky', top: 0, zIndex: 2, background: '#f7f8fa' }}>
                  {ORDER_FIELD_LABELS[field]}
                </th>
              ))}
              <th style={{ width: 80, textAlign: 'center', position: 'sticky', top: 0, zIndex: 2, background: '#f7f8fa' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, rowIndex) => (
              <tr key={rowIndex} className={getRowClass(record)}>
                <td style={{ textAlign: 'center', color: '#86909c', fontSize: 13 }}>
                  {rowIndex + 1}
                  {record._duplicateWith && (
                    <span className="tooltip ml-1 cursor-help" data-tooltip={record._duplicateWith}>⚠️</span>
                  )}
                </td>
                {COLUMNS.map((field) => {
                  const isEditing = editCell?.row === rowIndex && editCell?.field === field;
                  const value = field === 'skuQuantity'
                    ? (record.skuQuantity || '')
                    : String((record as Record<string, unknown>)[field] || '');
                  const hasError = record._errors?.some(e => e.field === field);

                  return (
                    <td
                      key={`${rowIndex}-${field}`}
                      onClick={() => handleCellClick(rowIndex, field)}
                      style={{
                        cursor: 'pointer',
                        background: hasError ? '#fff1f0' : undefined,
                        minWidth: field === 'receiverAddress' || field === 'remark' ? 180 : 120,
                      }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          type={field === 'skuQuantity' ? 'number' : 'text'}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleCellSave}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, field)}
                          className="w-full px-1 py-0.5 border border-[#0fc6c2] rounded outline-none text-sm"
                          style={{ minWidth: 100 }}
                        />
                      ) : (
                        <span style={{ color: hasError ? '#cf1322' : undefined }}>
                          {value || (hasError ? '(必填)' : '')}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td style={{ textAlign: 'center' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteRow(rowIndex); }}
                    className="btn btn-danger btn-sm"
                    title="删除行"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
