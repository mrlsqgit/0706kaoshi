-- ============================================
-- 智能多格式批量下单系统 V2 - 数据库建表脚本
-- 适用于 Supabase (PostgreSQL)
-- ============================================

-- 1. 解析规则表
CREATE TABLE IF NOT EXISTS parse_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  file_type       TEXT NOT NULL CHECK (file_type IN ('excel', 'word', 'pdf')),
  is_ai_generated BOOLEAN DEFAULT FALSE,
  ai_confidence   JSONB DEFAULT '{}'::jsonb,

  -- 通用设置
  header_rows_to_skip INTEGER DEFAULT 0,
  footer_rows_to_skip INTEGER DEFAULT 0,
  skip_empty_rows     BOOLEAN DEFAULT TRUE,
  skip_summary_rows   BOOLEAN DEFAULT TRUE,
  summary_row_keywords TEXT[] DEFAULT '{}'::text[],

  -- Excel 特有
  sheet_names      TEXT[] DEFAULT '{}'::text[],
  sheet_merge_mode TEXT DEFAULT 'separate' CHECK (sheet_merge_mode IN ('separate', 'concatenate')),

  -- 列映射 (JSON)
  column_mappings JSONB DEFAULT '[]'::jsonb,
  /*
    column_mappings 结构示例:
    [
      {
        "targetField": "externalCode",
        "sourceType": "column",
        "sourceColumn": 0
      },
      {
        "targetField": "receiverName",
        "sourceType": "cellPattern",
        "sourcePattern": "收件人[:：]\\s*(.+)"
      }
    ]
  */

  -- 后处理器配置 (JSON)
  processors JSONB DEFAULT '[]'::jsonb,
  /*
    processors 结构示例:
    [
      { "type": "skipRows",      "enabled": true, "options": {} },
      { "type": "tailInfoExtraction", "enabled": true, "options": {
          "tailRowsCount": 5,
          "fieldMappings": [{ "targetField": "remark", "keywordPattern": "备注", "extractPattern": "备注[:：]\\s*(.+)" }]
        }
      },
      { "type": "cardDetection", "enabled": false, "options": {} }
    ]
  */

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 规则名称唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_parse_rules_name ON parse_rules(name);
-- 文件类型索引
CREATE INDEX IF NOT EXISTS idx_parse_rules_file_type ON parse_rules(file_type);


-- 2. 运单记录表
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID,          -- 批量下单分组 ID
  external_code   TEXT NOT NULL,  -- 外部编码
  store_name      TEXT DEFAULT '',-- 收货门店 (A组)
  receiver_name   TEXT DEFAULT '',-- 收件人姓名 (B组)
  receiver_phone  TEXT DEFAULT '',-- 收件人电话 (B组)
  receiver_address TEXT DEFAULT '',-- 收件人地址 (B组)
  sku_code        TEXT DEFAULT '',-- SKU 物品编码
  sku_name        TEXT DEFAULT '',-- SKU 物品名称
  sku_quantity    INTEGER DEFAULT 1,-- SKU 发货数量
  sku_spec        TEXT DEFAULT '',-- SKU 规格型号
  remark          TEXT DEFAULT '',-- 备注

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 外部编码索引（用于去重检测）
CREATE INDEX IF NOT EXISTS idx_orders_external_code ON orders(external_code);
-- 批量 ID 索引
CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON orders(batch_id);
-- 收件人姓名索引（用于搜索）
CREATE INDEX IF NOT EXISTS idx_orders_receiver_name ON orders(receiver_name);
-- 创建时间索引（用于排序）
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);


-- 3. 自动更新 updated_at 触发器（仅 parse_rules 需要）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_parse_rules_updated_at ON parse_rules;
CREATE TRIGGER trg_parse_rules_updated_at
  BEFORE UPDATE ON parse_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 4. 启用行级安全 (RLS)
ALTER TABLE parse_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 允许匿名访问（开发阶段；生产环境请使用 Supabase Auth 限制）
CREATE POLICY "Allow all on parse_rules" ON parse_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on orders"       ON orders       FOR ALL USING (true) WITH CHECK (true);
