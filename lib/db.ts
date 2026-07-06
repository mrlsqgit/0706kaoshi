// 数据库抽象层 - Supabase (PostgreSQL)
// 回退：内存存储（未配置 Supabase 时自动使用）

import { ParseRule, OrderRecord, ColumnMapping, ProcessorConfig, FileType, SheetMergeMode } from './types';
import { v4 as uuidv4 } from 'uuid';
import { supabase, isSupabaseConfigured } from './supabase';

// ====== camelCase <-> snake_case 转换 ======

type DbRule = {
  id: string;
  name: string;
  description: string;
  file_type: string;
  is_ai_generated: boolean;
  ai_confidence: Record<string, number>;
  header_rows_to_skip: number;
  footer_rows_to_skip: number;
  skip_empty_rows: boolean;
  skip_summary_rows: boolean;
  summary_row_keywords: string[];
  sheet_names: string[];
  sheet_merge_mode: string;
  column_mappings: ColumnMapping[];
  processors: ProcessorConfig[];
  created_at: string;
  updated_at: string;
};

function ruleToDb(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Omit<DbRule, 'id' | 'created_at' | 'updated_at'> {
  return {
    name: rule.name,
    description: rule.description,
    file_type: rule.fileType,
    is_ai_generated: rule.isAiGenerated,
    ai_confidence: rule.aiConfidence || {},
    header_rows_to_skip: rule.headerRowsToSkip,
    footer_rows_to_skip: rule.footerRowsToSkip,
    skip_empty_rows: rule.skipEmptyRows,
    skip_summary_rows: rule.skipSummaryRows,
    summary_row_keywords: rule.summaryRowKeywords,
    sheet_names: rule.sheetNames,
    sheet_merge_mode: rule.sheetMergeMode,
    column_mappings: rule.columnMappings,
    processors: rule.processors,
  };
}

function ruleToJs(row: DbRule): ParseRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    fileType: (row.file_type as FileType) || 'excel',
    isAiGenerated: row.is_ai_generated ?? false,
    aiConfidence: row.ai_confidence || {},
    headerRowsToSkip: row.header_rows_to_skip ?? 0,
    footerRowsToSkip: row.footer_rows_to_skip ?? 0,
    skipEmptyRows: row.skip_empty_rows ?? true,
    skipSummaryRows: row.skip_summary_rows ?? false,
    summaryRowKeywords: row.summary_row_keywords || [],
    sheetNames: row.sheet_names || [],
    sheetMergeMode: (row.sheet_merge_mode as SheetMergeMode) || 'separate',
    columnMappings: row.column_mappings || [],
    processors: row.processors || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type DbOrder = {
  id: string;
  batch_id: string | null;
  external_code: string;
  store_name: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  sku_code: string;
  sku_name: string;
  sku_quantity: number;
  sku_spec: string;
  remark: string;
  created_at: string;
};

function orderToDb(order: OrderRecord): Partial<DbOrder> {
  return {
    batch_id: order.batchId || null,
    external_code: order.externalCode || '',
    store_name: order.storeName || '',
    receiver_name: order.receiverName || '',
    receiver_phone: order.receiverPhone || '',
    receiver_address: order.receiverAddress || '',
    sku_code: order.skuCode || '',
    sku_name: order.skuName || '',
    sku_quantity: typeof order.skuQuantity === 'number' ? order.skuQuantity : parseInt(String(order.skuQuantity), 10) || 0,
    sku_spec: order.skuSpec || '',
    remark: order.remark || '',
  };
}

function orderToJs(row: DbOrder): OrderRecord {
  return {
    id: row.id,
    batchId: row.batch_id || undefined,
    externalCode: row.external_code || '',
    storeName: row.store_name || '',
    receiverName: row.receiver_name || '',
    receiverPhone: row.receiver_phone || '',
    receiverAddress: row.receiver_address || '',
    skuCode: row.sku_code || '',
    skuName: row.sku_name || '',
    skuQuantity: row.sku_quantity ?? 0,
    skuSpec: row.sku_spec || '',
    remark: row.remark || '',
    createdAt: row.created_at,
  };
}

// ====== Supabase 实现 ======

const SupabaseStore = {
  // ---- Rules ----

  async getRules(): Promise<ParseRule[]> {
    const { data, error } = await supabase
      .from('parse_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`获取规则列表失败: ${error.message}`);
    return (data || []).map(ruleToJs);
  },

  async getRule(id: string): Promise<ParseRule | null> {
    const { data, error } = await supabase
      .from('parse_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`获取规则失败: ${error.message}`);
    }
    return ruleToJs(data as DbRule);
  },

  async createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> {
    const dbRule = ruleToDb(rule);
    const { data, error } = await supabase
      .from('parse_rules')
      .insert(dbRule)
      .select('*')
      .single();

    if (error) throw new Error(`创建规则失败: ${error.message}`);
    return ruleToJs(data as DbRule);
  },

  async updateRule(id: string, rule: Partial<ParseRule>): Promise<ParseRule | null> {
    const updates: Record<string, unknown> = {};
    if (rule.name !== undefined) updates.name = rule.name;
    if (rule.description !== undefined) updates.description = rule.description;
    if (rule.fileType !== undefined) updates.file_type = rule.fileType;
    if (rule.isAiGenerated !== undefined) updates.is_ai_generated = rule.isAiGenerated;
    if (rule.aiConfidence !== undefined) updates.ai_confidence = rule.aiConfidence;
    if (rule.headerRowsToSkip !== undefined) updates.header_rows_to_skip = rule.headerRowsToSkip;
    if (rule.footerRowsToSkip !== undefined) updates.footer_rows_to_skip = rule.footerRowsToSkip;
    if (rule.skipEmptyRows !== undefined) updates.skip_empty_rows = rule.skipEmptyRows;
    if (rule.skipSummaryRows !== undefined) updates.skip_summary_rows = rule.skipSummaryRows;
    if (rule.summaryRowKeywords !== undefined) updates.summary_row_keywords = rule.summaryRowKeywords;
    if (rule.sheetNames !== undefined) updates.sheet_names = rule.sheetNames;
    if (rule.sheetMergeMode !== undefined) updates.sheet_merge_mode = rule.sheetMergeMode;
    if (rule.columnMappings !== undefined) updates.column_mappings = rule.columnMappings;
    if (rule.processors !== undefined) updates.processors = rule.processors;

    if (Object.keys(updates).length === 0) {
      return SupabaseStore.getRule(id);
    }

    const { data, error } = await supabase
      .from('parse_rules')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`更新规则失败: ${error.message}`);
    }
    return ruleToJs(data as DbRule);
  },

  async deleteRule(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('parse_rules')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`删除规则失败: ${error.message}`);
    return true;
  },

  // ---- Orders ----

  async getOrders(page: number, pageSize: number, filters?: { externalCode?: string; receiverName?: string }): Promise<{ orders: OrderRecord[]; total: number }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' });

    if (filters?.externalCode) {
      query = query.ilike('external_code', `%${filters.externalCode}%`);
    }
    if (filters?.receiverName) {
      query = query.ilike('receiver_name', `%${filters.receiverName}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new Error(`获取运单列表失败: ${error.message}`);
    return {
      orders: (data || []).map(orderToJs),
      total: count || 0,
    };
  },

  async createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
    const batchId = uuidv4();
    const dbOrders = orders.map(o => ({
      ...orderToDb(o),
      id: uuidv4(),
      batch_id: batchId,
    }));

    const { data, error } = await supabase
      .from('orders')
      .insert(dbOrders)
      .select('*');

    if (error) throw new Error(`创建运单失败: ${error.message}`);
    return (data || []).map(orderToJs);
  },

  async checkDuplicateExternalCodes(codes: string[], excludeBatchId?: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('external_code')
      .in('external_code', codes);

    if (error) throw new Error(`重复检测失败: ${error.message}`);
    return (data || []).map((r: { external_code: string }) => r.external_code);
  },

  async getAllExternalCodes(): Promise<Set<string>> {
    const { data, error } = await supabase
      .from('orders')
      .select('external_code');

    if (error) throw new Error(`获取外部编码失败: ${error.message}`);
    return new Set((data || []).map((r: { external_code: string }) => r.external_code));
  },
};

// ====== 内存存储实例（回退） ======

class MemoryStore {
  private rules: ParseRule[] = [];
  private orders: OrderRecord[] = [];

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
    return this.orders
      .filter(o => codes.includes(o.externalCode) && o.externalCode)
      .map(o => o.externalCode);
  }
  async getAllExternalCodes(): Promise<Set<string>> {
    return new Set(this.orders.map(o => o.externalCode).filter(Boolean));
  }
}

const memoryStore = new MemoryStore();

// ====== 自动选择存储引擎 ======

const useSupabase = isSupabaseConfigured();
console.log(`[DB] 存储引擎: ${useSupabase ? 'Supabase (PostgreSQL)' : '内存存储 (Memory)'}`);

// 对外导出统一接口
export async function getRules(): Promise<ParseRule[]> {
  return useSupabase ? SupabaseStore.getRules() : memoryStore.getRules();
}

export async function getRule(id: string): Promise<ParseRule | null> {
  return useSupabase ? SupabaseStore.getRule(id) : memoryStore.getRule(id);
}

export async function createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> {
  return useSupabase ? SupabaseStore.createRule(rule) : memoryStore.createRule(rule);
}

export async function updateRule(id: string, rule: Partial<ParseRule>): Promise<ParseRule | null> {
  return useSupabase ? SupabaseStore.updateRule(id, rule) : memoryStore.updateRule(id, rule);
}

export async function deleteRule(id: string): Promise<boolean> {
  return useSupabase ? SupabaseStore.deleteRule(id) : memoryStore.deleteRule(id);
}

export async function getOrders(page: number, pageSize: number, filters?: { externalCode?: string; receiverName?: string }): Promise<{ orders: OrderRecord[]; total: number }> {
  return useSupabase ? SupabaseStore.getOrders(page, pageSize, filters) : memoryStore.getOrders(page, pageSize, filters);
}

export async function createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
  return useSupabase ? SupabaseStore.createOrders(orders) : memoryStore.createOrders(orders);
}

export async function checkDuplicateExternalCodes(codes: string[], excludeBatchId?: string): Promise<string[]> {
  return useSupabase ? SupabaseStore.checkDuplicateExternalCodes(codes, excludeBatchId) : memoryStore.checkDuplicateExternalCodes(codes, excludeBatchId);
}

export async function getAllExternalCodes(): Promise<Set<string>> {
  return useSupabase ? SupabaseStore.getAllExternalCodes() : memoryStore.getAllExternalCodes();
}
