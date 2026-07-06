'use client';

import * as XLSX from 'xlsx';
import { OrderRecord } from './types';

/** 导出运单数据为 Excel 文件 */
export function exportToExcel(records: OrderRecord[], fileName: string = '运单数据') {
  const headers = [
    '外部编码', '收货门店', '收件人姓名', '收件人电话', '收件人地址',
    'SKU物品编码', 'SKU物品名称', 'SKU发货数量', 'SKU规格型号', '备注'
  ];

  const rows = records.map((r) => [
    r.externalCode || '',
    r.storeName || '',
    r.receiverName || '',
    r.receiverPhone || '',
    r.receiverAddress || '',
    r.skuCode || '',
    r.skuName || '',
    r.skuQuantity || '',
    r.skuSpec || '',
    r.remark || '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '运单数据');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 防抖函数 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** 生成唯一 ID */
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
