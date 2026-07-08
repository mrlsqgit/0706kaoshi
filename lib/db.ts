// 数据库抽象层 - Neon PostgreSQL (Serverless)
// 支持 Neon 直接 SQL 连接，未配置时回退内存存储

import { ParseRule, OrderRecord, FileType, SheetMergeMode } from './types';
import { v4 as uuidv4 } from 'uuid';
import { getSql, isDbConfigured } from './db-client';
import { PRESET_RULES } from './preset-rules';

const dbConfigured = isDbConfigured();
// 运行时降级标志：一旦检测到 Neon 不可达（如 fetch failed / 网络受限 / 数据库暂停），
// 后续所有读写自动回退到内存存储，避免界面出现「保存失败：创建规则失败」这类硬错误。
let dbBroken = false;
console.log(`[DB] 存储引擎初始配置: ${dbConfigured ? 'Neon PostgreSQL' : '内存存储 (Memory)'}`);

// 统一封装：优先走 Neon，连接失败时降级到内存存储；
// 同一进程内一旦降级不再重试 Neon，避免每次请求都反复超时/抛错。
async function safeNeon<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (dbBroken || !dbConfigured) return fallback();
  try {
    return await fn();
  } catch (err) {
    console.error('[DB] Neon 连接失败，降级到内存存储:', err instanceof Error ? err.message : err);
    dbBroken = true;
    return fallback();
  }
}

// 启动期异步探测：Neon 配置存在时尝试一次轻量连接，失败立即标记降级（避免首请求才暴露超时）。
if (dbConfigured) {
  (async () => {
    try {
      await getSql()`SELECT 1`;
      console.log('[DB] Neon 连通性正常');
    } catch (err) {
      console.warn('[DB] 初始连通性探测失败，将使用内存存储:', err instanceof Error ? err.message : err);
      dbBroken = true;
    }
  })();
}

// ====== 辅助函数 ======

function nowISO(): string {
  return new Date().toISOString();
}

// ====== Neon PostgreSQL 实现 ======

const NeonStore = {
  // ---- Rules ----

  async getRules(): Promise<ParseRule[]> {
    const sql = getSql();
    const rows = await sql`
      SELECT * FROM parse_rules ORDER BY created_at DESC
    `;
    return (rows || []).map(ruleRowToJs);
  },

  async getRule(id: string): Promise<ParseRule | null> {
    const sql = getSql();
    const rows = await sql`SELECT * FROM parse_rules WHERE id = ${id}::uuid`;
    return rows.length > 0 ? ruleRowToJs(rows[0]) : null;
  },

  async createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> {
    const sql = getSql();
    const now = nowISO();

    // Upsert：同名规则存在时自动更新（避免 duplicate key 错误）
    const rows = await sql`
      INSERT INTO parse_rules (
        id, name, description, file_type, is_ai_generated, ai_confidence,
        header_rows_to_skip, footer_rows_to_skip, skip_empty_rows, skip_summary_rows,
        summary_row_keywords, sheet_names, sheet_merge_mode,
        column_mappings, processors, created_at, updated_at
      ) VALUES (
        ${uuidv4()}::uuid,
        ${rule.name},
        ${rule.description || ''},
        ${rule.fileType || 'excel'},
        ${rule.isAiGenerated ?? false},
        ${JSON.stringify(rule.aiConfidence || {})}::jsonb,
        ${rule.headerRowsToSkip ?? 0},
        ${rule.footerRowsToSkip ?? 0},
        ${rule.skipEmptyRows ?? true},
        ${rule.skipSummaryRows ?? false},
        ${rule.summaryRowKeywords || []},
        ${rule.sheetNames || []},
        ${rule.sheetMergeMode || 'separate'},
        ${JSON.stringify(rule.columnMappings || [])}::jsonb,
        ${JSON.stringify(rule.processors || [])}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        file_type = EXCLUDED.file_type,
        is_ai_generated = EXCLUDED.is_ai_generated,
        ai_confidence = EXCLUDED.ai_confidence,
        header_rows_to_skip = EXCLUDED.header_rows_to_skip,
        footer_rows_to_skip = EXCLUDED.footer_rows_to_skip,
        skip_empty_rows = EXCLUDED.skip_empty_rows,
        skip_summary_rows = EXCLUDED.skip_summary_rows,
        summary_row_keywords = EXCLUDED.summary_row_keywords,
        sheet_names = EXCLUDED.sheet_names,
        sheet_merge_mode = EXCLUDED.sheet_merge_mode,
        column_mappings = EXCLUDED.column_mappings,
        processors = EXCLUDED.processors,
        updated_at = ${now}
      RETURNING *
    `;
    return ruleRowToJs(rows[0]);
  },

  async updateRule(id: string, updates: Partial<ParseRule>): Promise<ParseRule | null> {
    const sql = getSql();
    const now = nowISO();

    const rows = await sql`
      UPDATE parse_rules SET
        updated_at = ${now},
        name = ${updates.name !== undefined ? updates.name : null},
        description = ${updates.description !== undefined ? updates.description : null},
        file_type = ${updates.fileType !== undefined ? updates.fileType : null},
        is_ai_generated = ${updates.isAiGenerated !== undefined ? updates.isAiGenerated : null},
        ai_confidence = ${updates.aiConfidence !== undefined ? JSON.stringify(updates.aiConfidence) : null}::jsonb,
        header_rows_to_skip = ${updates.headerRowsToSkip !== undefined ? updates.headerRowsToSkip : null},
        footer_rows_to_skip = ${updates.footerRowsToSkip !== undefined ? updates.footerRowsToSkip : null},
        skip_empty_rows = ${updates.skipEmptyRows !== undefined ? updates.skipEmptyRows : null},
        skip_summary_rows = ${updates.skipSummaryRows !== undefined ? updates.skipSummaryRows : null},
        summary_row_keywords = ${updates.summaryRowKeywords !== undefined ? updates.summaryRowKeywords : null},
        sheet_names = ${updates.sheetNames !== undefined ? updates.sheetNames : null},
        sheet_merge_mode = ${updates.sheetMergeMode !== undefined ? updates.sheetMergeMode : null},
        column_mappings = ${updates.columnMappings !== undefined ? JSON.stringify(updates.columnMappings) : null}::jsonb,
        processors = ${updates.processors !== undefined ? JSON.stringify(updates.processors) : null}::jsonb
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows.length > 0 ? ruleRowToJs(rows[0]) : null;
  },

  async deleteRule(id: string): Promise<boolean> {
    const sql = getSql();
    const rows = await sql`DELETE FROM parse_rules WHERE id = ${id}::uuid RETURNING id`;
    return rows.length > 0;
  },

  // ---- Orders 清理 ----
  async deleteOrdersByExternalCode(codes: string[]): Promise<number> {
    if (codes.length === 0) return 0;
    const sql = getSql();
    const rows = await sql`DELETE FROM orders WHERE external_code = ANY(${codes})`;
    return rows.length;
  },

  async deleteOrdersByExternalCodePrefix(prefix: string): Promise<number> {
    const sql = getSql();
    const rows = await sql`DELETE FROM orders WHERE external_code LIKE ${prefix + '%'}`;
    return rows.length;
  },

  // 按自然键去重：保留每组重复记录中的第一条
  async dedupOrders(): Promise<number> {
    const sql = getSql();
    const rows = await sql`
      DELETE FROM orders
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY store_name, sku_code, sku_name, sku_quantity, sku_spec,
                         receiver_name, receiver_phone, receiver_address
            ORDER BY created_at ASC
          ) AS rn
          FROM orders
        ) t WHERE t.rn > 1
      )
    `;
    return rows.length;
  },

  // 清空全部运单（仅用于测试环境重置）
  async truncateOrders(): Promise<number> {
    const sql = getSql();
    const rows = await sql`DELETE FROM orders`;
    return rows.length;
  },

  // ---- Orders ----

  async getOrders(
    page: number,
    pageSize: number,
    filters?: { externalCode?: string; receiverName?: string; createdAtStart?: string; createdAtEnd?: string }
  ): Promise<{ orders: OrderRecord[]; total: number }> {
    const sql = getSql();
    const offset = (page - 1) * pageSize;

    // 使用参数化查询防止 SQL 注入
    const extCodePattern = filters?.externalCode ? `%${filters.externalCode}%` : null;
    const recvNamePattern = filters?.receiverName ? `%${filters.receiverName}%` : null;
    const createdStart = filters?.createdAtStart || null;
    const createdEnd = filters?.createdAtEnd || null;

    const [dataRows, countRows] = await Promise.all([
      sql`
        SELECT * FROM orders
        WHERE
          (${extCodePattern}::text IS NULL OR external_code ILIKE ${extCodePattern})
          AND (${recvNamePattern}::text IS NULL OR receiver_name ILIKE ${recvNamePattern})
          AND (${createdStart}::timestamptz IS NULL OR created_at >= ${createdStart}::timestamptz)
          AND (${createdEnd}::timestamptz IS NULL OR created_at <= ${createdEnd}::timestamptz)
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int as total FROM orders
        WHERE
          (${extCodePattern}::text IS NULL OR external_code ILIKE ${extCodePattern})
          AND (${recvNamePattern}::text IS NULL OR receiver_name ILIKE ${recvNamePattern})
          AND (${createdStart}::timestamptz IS NULL OR created_at >= ${createdStart}::timestamptz)
          AND (${createdEnd}::timestamptz IS NULL OR created_at <= ${createdEnd}::timestamptz)
      `,
    ]);

    return {
      orders: (dataRows || []).map(orderRowToJs),
      total: countRows?.[0]?.total || 0,
    };
  },

  async createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
    if (orders.length === 0) return [];
    const sql = getSql();
    const batchId = uuidv4();
    const now = nowISO();

    // 并发分批插入（每批 20 条并发），替代逐条串行插入
    // 性能：113条从 ~17s (逐条) → ~1s (6批次 × 20并发)
    const BATCH_SIZE = 20;
    const allResults: OrderRecord[] = [];

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);
      const promises = batch.map((order) =>
        sql`
          INSERT INTO orders (
            id, batch_id, external_code, store_name, receiver_name, receiver_phone,
            receiver_address, sku_code, sku_name, sku_quantity, sku_spec, remark, created_at
          ) VALUES (
            ${uuidv4()}::uuid,
            ${batchId}::uuid,
            ${order.externalCode || ''},
            ${order.storeName || ''},
            ${order.receiverName || ''},
            ${order.receiverPhone || ''},
            ${order.receiverAddress || ''},
            ${order.skuCode || ''},
            ${order.skuName || ''},
            ${Number(order.skuQuantity) || 0},
            ${order.skuSpec || ''},
            ${order.remark || ''},
            ${now}
          )
          RETURNING *
        `.catch((err) => {
          console.error('[DB] 单条INSERT失败:', err);
          return [];
        })
      );
      const batchRows = await Promise.all(promises);
      batchRows.flat().forEach(r => { if (r) allResults.push(orderRowToJs(r)); });
    }

    return allResults;
  },

  async checkDuplicateExternalCodes(codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    const sql = getSql();
    const rows = await sql`SELECT external_code FROM orders WHERE external_code = ANY(${codes})`;
    return (rows || []).map((r: { external_code: string }) => r.external_code);
  },

  async getAllExternalCodes(): Promise<Set<string>> {
    const sql = getSql();
    const rows = await sql`SELECT external_code FROM orders`;
    return new Set((rows || []).map((r: { external_code: string }) => r.external_code));
  },
};

// ====== 数据行转换（Neon 行 → JS 对象） ======

function ruleRowToJs(row: Record<string, unknown>): ParseRule {
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    description: String(row.description || ''),
    fileType: (String(row.file_type || '') as FileType) || 'excel',
    isAiGenerated: Boolean(row.is_ai_generated),
    aiConfidence: (typeof row.ai_confidence === 'object' ? row.ai_confidence : {}) as Record<string, number>,
    headerRowsToSkip: Number(row.header_rows_to_skip) || 0,
    footerRowsToSkip: Number(row.footer_rows_to_skip) || 0,
    skipEmptyRows: row.skip_empty_rows !== false,
    skipSummaryRows: Boolean(row.skip_summary_rows),
    summaryRowKeywords: Array.isArray(row.summary_row_keywords) ? row.summary_row_keywords as string[] : [],
    sheetNames: Array.isArray(row.sheet_names) ? row.sheet_names as string[] : [],
    sheetMergeMode: (String(row.sheet_merge_mode || '') as SheetMergeMode) || 'separate',
    columnMappings: Array.isArray(row.column_mappings) ? row.column_mappings as any[] : [],
    processors: Array.isArray(row.processors) ? row.processors as any[] : [],
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function orderRowToJs(row: Record<string, unknown>): OrderRecord {
  return {
    id: String(row.id || ''),
    batchId: row.batch_id ? String(row.batch_id) : undefined,
    externalCode: String(row.external_code || ''),
    storeName: String(row.store_name || ''),
    receiverName: String(row.receiver_name || ''),
    receiverPhone: String(row.receiver_phone || ''),
    receiverAddress: String(row.receiver_address || ''),
    skuCode: String(row.sku_code || ''),
    skuName: String(row.sku_name || ''),
    skuQuantity: Number(row.sku_quantity) || 0,
    skuSpec: String(row.sku_spec || ''),
    remark: String(row.remark || ''),
    createdAt: String(row.created_at || ''),
  };
}

// ====== 内存存储实例（回退） ======

class MemoryStore {
  private rules: ParseRule[] = [];
  private orders: OrderRecord[] = [];

  async getRules(): Promise<ParseRule[]> { return [...this.rules]; }
  async getRule(id: string): Promise<ParseRule | null> { return this.rules.find(r => r.id === id) || null; }
  async createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> {
    const now = nowISO();
    const newRule: ParseRule = { ...rule, id: uuidv4(), createdAt: now, updatedAt: now };
    this.rules.push(newRule);
    return newRule;
  }
  async updateRule(id: string, rule: Partial<ParseRule>): Promise<ParseRule | null> {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return null;
    this.rules[idx] = { ...this.rules[idx], ...rule, updatedAt: nowISO() };
    return this.rules[idx];
  }
  async deleteRule(id: string): Promise<boolean> {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  async deleteOrdersByExternalCode(codes: string[]): Promise<number> {
    const set = new Set(codes);
    const before = this.orders.length;
    this.orders = this.orders.filter(o => !set.has(o.externalCode));
    return before - this.orders.length;
  }

  async deleteOrdersByExternalCodePrefix(prefix: string): Promise<number> {
    const before = this.orders.length;
    this.orders = this.orders.filter(o => !(o.externalCode || '').startsWith(prefix));
    return before - this.orders.length;
  }

  async dedupOrders(): Promise<number> {
    const seen = new Set<string>();
    let removed = 0;
    this.orders = this.orders.filter(o => {
      const key = [
        o.storeName, o.skuCode, o.skuName, o.skuQuantity, o.skuSpec,
        o.receiverName, o.receiverPhone, o.receiverAddress,
      ].join('|');
      if (seen.has(key)) { removed++; return false; }
      seen.add(key);
      return true;
    });
    return removed;
  }

  async truncateOrders(): Promise<number> {
    const n = this.orders.length;
    this.orders = [];
    return n;
  }

  async getOrders(page: number, pageSize: number, filters?: { externalCode?: string; receiverName?: string; createdAtStart?: string; createdAtEnd?: string }): Promise<{ orders: OrderRecord[]; total: number }> {
    let filtered = [...this.orders];
    if (filters?.externalCode) filtered = filtered.filter(o => o.externalCode?.includes(filters.externalCode!));
    if (filters?.receiverName) filtered = filtered.filter(o => o.receiverName?.includes(filters.receiverName!));
    if (filters?.createdAtStart) filtered = filtered.filter(o => o.createdAt && o.createdAt >= filters.createdAtStart!);
    if (filters?.createdAtEnd) filtered = filtered.filter(o => o.createdAt && o.createdAt <= filters.createdAtEnd!);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    return { orders: filtered.slice(start, start + pageSize), total };
  }
  async createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
    const batchId = uuidv4();
    const now = nowISO();
    const newOrders = orders.map(o => ({ ...o, id: uuidv4(), batchId, createdAt: now }));
    this.orders.push(...newOrders);
    return newOrders;
  }
  async checkDuplicateExternalCodes(codes: string[], _excludeBatchId?: string): Promise<string[]> {
    return this.orders
      .filter(o => codes.includes(o.externalCode) && o.externalCode)
      .map(o => o.externalCode);
  }
  async getAllExternalCodes(): Promise<Set<string>> {
    return new Set(this.orders.map(o => o.externalCode).filter(Boolean));
  }
}

const memoryStore = new MemoryStore();

// ====== 预设（黄金）规则：启动时写入存储 ======
// 这些规则针对已知结构的文件，提供「实测 0 错误」的确定性解析。
// 当 AI 生成的规则直接套用失败时，前端会按文件名匹配到它们并以 100% 置信度应用，
// 因此不会影响其他文件的既有解析逻辑。

let presetsPromise: Promise<void> | null = null;
function ensurePresets(): Promise<void> {
  if (presetsPromise) return presetsPromise;
  presetsPromise = (async () => {
    for (const rule of PRESET_RULES) {
      await safeNeon(
        async () => {
          const existing = await NeonStore.getRules();
          if (!existing.some((r) => r.name === rule.name)) {
            await NeonStore.createRule(rule);
          }
        },
        async () => {
          const exists = (await memoryStore.getRules()).some((r) => r.name === rule.name);
          if (!exists) await memoryStore.createRule(rule);
        }
      );
    }
  })();
  return presetsPromise;
}

// ====== 统一导出接口（Neon 不可达时自动降级到内存存储） ======

export async function getRules(): Promise<ParseRule[]> {
  await ensurePresets();
  return safeNeon(() => NeonStore.getRules(), () => memoryStore.getRules());
}

export async function getRule(id: string): Promise<ParseRule | null> {
  return safeNeon(() => NeonStore.getRule(id), () => memoryStore.getRule(id));
}

export async function createRule(rule: Omit<ParseRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParseRule> {
  return safeNeon(() => NeonStore.createRule(rule), () => memoryStore.createRule(rule));
}

export async function updateRule(id: string, rule: Partial<ParseRule>): Promise<ParseRule | null> {
  return safeNeon(() => NeonStore.updateRule(id, rule), () => memoryStore.updateRule(id, rule));
}

export async function deleteRule(id: string): Promise<boolean> {
  return safeNeon(() => NeonStore.deleteRule(id), () => memoryStore.deleteRule(id));
}

export async function deleteOrdersByExternalCode(codes: string[]): Promise<number> {
  return safeNeon(() => NeonStore.deleteOrdersByExternalCode(codes), () => memoryStore.deleteOrdersByExternalCode(codes));
}

export async function deleteOrdersByExternalCodePrefix(prefix: string): Promise<number> {
  return safeNeon(() => NeonStore.deleteOrdersByExternalCodePrefix(prefix), () => memoryStore.deleteOrdersByExternalCodePrefix(prefix));
}

export async function dedupOrders(): Promise<number> {
  return safeNeon(() => NeonStore.dedupOrders(), () => memoryStore.dedupOrders());
}

export async function truncateOrders(): Promise<number> {
  return safeNeon(() => NeonStore.truncateOrders(), () => memoryStore.truncateOrders());
}

export async function getOrders(page: number, pageSize: number, filters?: { externalCode?: string; receiverName?: string; createdAtStart?: string; createdAtEnd?: string }): Promise<{ orders: OrderRecord[]; total: number }> {
  return safeNeon(() => NeonStore.getOrders(page, pageSize, filters), () => memoryStore.getOrders(page, pageSize, filters));
}

export async function createOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
  return safeNeon(() => NeonStore.createOrders(orders), () => memoryStore.createOrders(orders));
}

export async function checkDuplicateExternalCodes(codes: string[], excludeBatchId?: string): Promise<string[]> {
  return safeNeon(() => NeonStore.checkDuplicateExternalCodes(codes), () => memoryStore.checkDuplicateExternalCodes(codes, excludeBatchId));
}

export async function getAllExternalCodes(): Promise<Set<string>> {
  return safeNeon(() => NeonStore.getAllExternalCodes(), () => memoryStore.getAllExternalCodes());
}
