// 数据库抽象层 - 支持本地存储和 Supabase
// 在 Vercel 部署时使用 Supabase，本地开发使用内存存储

import { ParseRule, OrderRecord } from './types';
import { v4 as uuidv4 } from 'uuid';

// ====== 内存存储（本地开发回退） ======
class MemoryStore {
  private rules: ParseRule[] = [];
  private orders: OrderRecord[] = [];

  // Rules
  async getRules(): Promise<ParseRule[]> { return [...this.rules]; }
  async getRule(id: string): Promise<ParseRule | null> { return this.rules.find(r => r.id === id) || null; }
  async createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> {
    const now = new Date().toISOString();
    const newRule: ParseRule = { ...rule, id: uuidv4(), createdAt: now, updatedAt: now };
    this.rules.push(newRule);
    return newRule;
  }
  async updateRule(id: string, rule: Partial<ParseRule>): Promise<ParseRule | null> {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return null;
    this.rules[idx] = { ...this.rules[idx], ...rule, updatedAt: new Date().toISOString() };
    return this.rules[idx];
  }
  async deleteRule(id: string): Promise<boolean> {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  // Orders
  async getOrders(page: number, pageSize: number, filters?: { externalCode?: string; receiverName?: string }): Promise<{ orders: OrderRecord[]; total: number }> {
    let filtered = [...this.orders];
    if (filters?.externalCode) filtered = filtered.filter(o => o.externalCode?.includes(filters.externalCode!));
    if (filters?.receiverName) filtered = filtered.filter(o => o.receiverName?.includes(filters.receiverName!));
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    return { orders: filtered.slice(start, start + pageSize), total };
  }
  async createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
    const batchId = uuidv4();
    const now = new Date().toISOString();
    const newOrders = orders.map(o => ({ ...o, id: uuidv4(), batchId, createdAt: now }));
    this.orders.push(...newOrders);
    return newOrders;
  }
  async checkDuplicateExternalCodes(codes: string[], excludeBatchId?: string): Promise<string[]> {
    const existing = this.orders
      .filter(o => codes.includes(o.externalCode) && o.externalCode)
      .map(o => o.externalCode);
    return existing;
  }
  async getAllExternalCodes(): Promise<Set<string>> {
    return new Set(this.orders.map(o => o.externalCode).filter(Boolean));
  }
}

// 全局单例
const store = new MemoryStore();

// ====== 导出接口 ======
export async function getRules(): Promise<ParseRule[]> { return store.getRules(); }
export async function getRule(id: string): Promise<ParseRule | null> { return store.getRule(id); }
export async function createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> { return store.createRule(rule); }
export async function updateRule(id: string, rule: Partial<ParseRule>): Promise<ParseRule | null> { return store.updateRule(id, rule); }
export async function deleteRule(id: string): Promise<boolean> { return store.deleteRule(id); }

export async function getOrders(page: number, pageSize: number, filters?: { externalCode?: string; receiverName?: string }): Promise<{ orders: OrderRecord[]; total: number }> {
  return store.getOrders(page, pageSize, filters);
}
export async function createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> { return store.createOrders(orders); }
export async function checkDuplicateExternalCodes(codes: string[], excludeBatchId?: string): Promise<string[]> {
  return store.checkDuplicateExternalCodes(codes, excludeBatchId);
}
export async function getAllExternalCodes(): Promise<Set<string>> {
  return store.getAllExternalCodes();
}
