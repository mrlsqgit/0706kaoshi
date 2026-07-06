'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { OrderRecord, ORDER_FIELD_LABELS, OrderField } from '@/lib/types';
import { exportToExcel } from '@/lib/utils';

const DISPLAY_COLUMNS: OrderField[] = [
  'externalCode', 'storeName', 'receiverName', 'receiverPhone',
  'skuCode', 'skuName', 'skuQuantity', 'skuSpec',
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchExternalCode, setSearchExternalCode] = useState('');
  const [searchReceiverName, setSearchReceiverName] = useState('');
  const pageSize = 20;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (searchExternalCode) params.set('externalCode', searchExternalCode);
      if (searchReceiverName) params.set('receiverName', searchReceiverName);

      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();
      setOrders(data.orders || []);
      setTotal(data.total || 0);
    } catch {
      toast.error('加载运单列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, searchExternalCode, searchReceiverName]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleSearch = () => {
    setPage(1);
    loadOrders();
  };

  const handleExport = () => {
    exportToExcel(orders, '已导入运单');
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1d2129]">已导入运单列表</h1>
          <p className="text-[#86909c] text-sm mt-1">查看所有历史导入的运单记录</p>
        </div>
        <button onClick={handleExport} disabled={orders.length === 0} className="btn btn-outline">
          📥 导出 Excel
        </button>
      </div>

      {/* 搜索 */}
      <div className="card card-sm mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#4e5969] whitespace-nowrap">外部编码</label>
            <input
              type="text"
              value={searchExternalCode}
              onChange={e => setSearchExternalCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="form-input text-sm w-48"
              placeholder="输入搜索..."
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#4e5969] whitespace-nowrap">收件人姓名</label>
            <input
              type="text"
              value={searchReceiverName}
              onChange={e => setSearchReceiverName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="form-input text-sm w-48"
              placeholder="输入搜索..."
            />
          </div>
          <button onClick={handleSearch} className="btn btn-primary btn-sm">搜索</button>
          <button
            onClick={() => { setSearchExternalCode(''); setSearchReceiverName(''); setPage(1); }}
            className="btn btn-outline btn-sm"
          >
            重置
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="text-center py-12">
            <div className="loading-dots justify-center mb-3">
              <span /><span /><span />
            </div>
            <p className="text-[#86909c]">加载运单列表...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p className="empty-state-text font-medium text-[#1d2129]">
              {searchExternalCode || searchReceiverName ? '未找到匹配的运单' : '暂无运单数据'}
            </p>
            <p className="text-[#86909c] text-sm">
              {searchExternalCode || searchReceiverName ? '请尝试其他搜索条件' : '导入文件并提交后可在此查看'}
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrapper" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 50, textAlign: 'center' }}>#</th>
                    {DISPLAY_COLUMNS.map(field => (
                      <th key={field}>{ORDER_FIELD_LABELS[field]}</th>
                    ))}
                    <th style={{ width: 160 }}>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order, idx) => (
                    <tr key={order.id || idx} className="hover:bg-[#f7f8fa]">
                      <td style={{ textAlign: 'center', color: '#86909c', fontSize: 13 }}>
                        {(page - 1) * pageSize + idx + 1}
                      </td>
                      {DISPLAY_COLUMNS.map(field => (
                        <td key={field}>
                          <span className="text-sm">
                            {field === 'skuQuantity'
                              ? order.skuQuantity
                              : String((order as Record<string, unknown>)[field] || '')}
                          </span>
                        </td>
                      ))}
                      <td className="text-sm text-[#86909c]">
                        {order.createdAt
                          ? new Date(order.createdAt).toLocaleString('zh-CN')
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#e5e6eb]">
                <span className="text-sm text-[#86909c]">
                  共 {total} 条，第 {page}/{totalPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="btn btn-outline btn-sm"
                  >
                    首页
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="btn btn-outline btn-sm"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="btn btn-outline btn-sm"
                  >
                    下一页
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="btn btn-outline btn-sm"
                  >
                    末页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
