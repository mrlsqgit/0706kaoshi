'use server';

// AI 大模型集成 —— 调用 DeepSeek / OpenAI 等大模型分析文件并生成解析规则

import OpenAI from 'openai';
import { ParseRule, FileType, ProcessorConfig } from './types';

interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getAiConfig(): AiConfig {
  return {
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || 'https://api.deepseek.com',
    model: process.env.AI_MODEL || 'deepseek-chat',
  };
}

const SYSTEM_PROMPT = `你是一个文件解析规则专家。你的任务是分析上传的出库单文件结构，并生成一套解析规则配置。

你需要返回 JSON 格式的规则配置。规则必须符合以下 JSON Schema：

{
  "name": "规则名称",
  "description": "规则描述",
  "fileType": "excel" | "word" | "pdf",
  "headerRowsToSkip": number,
  "footerRowsToSkip": number,
  "skipEmptyRows": true,
  "skipSummaryRows": true,
  "summaryRowKeywords": ["合计", "总计"],
  "sheetNames": [],
  "sheetMergeMode": "separate" | "concatenate",
  "columnMappings": [
    {
      "targetField": "externalCode|storeName|receiverName|receiverPhone|receiverAddress|skuCode|skuName|skuQuantity|skuSpec|remark",
      "sourceType": "column" | "static" | "cellPattern",
      "sourceColumn": "列名或列索引",
      "sourcePattern": "正则表达式(用于cellPattern)",
      "staticValue": "静态值(用于static)"
    }
  ],
  "processors": [
    {
      "type": "tailInfoExtraction" | "headerInfoExtraction" | "crossRowAggregation" | "matrixTranspose" | "cardDetection" | "multiSheet",
      "enabled": true,
      "options": {}
    }
  ],
  "analysis": "文件结构分析说明",
  "confidence": {
    "overall": 0-100,
    "fieldName": 0-100
  }
}

处理器（processors）说明：
1. tailInfoExtraction - 尾部信息提取: 收货人信息在数据区之外的尾部行
   options: { "tailRowsCount": 3, "fieldMappings": [{ "targetField": "receiverName", "keywordPattern": "收货人|收件人|联系人", "extractPattern": "提取正则" }] }
2. headerInfoExtraction - 顶部信息提取: 收货门店等字段出现在被 headerRowsToSkip 跳过的顶部标题/表头行中（如第一行"收货机构/调入门店/收货门店: xxx"）
   options: { "headerRowsCount": 3, "fieldMappings": [{ "targetField": "storeName", "keywordPattern": "收货机构|调入门店|收货门店|门店", "extractPattern": "[:：]\\s*(.+)" }] }
3. crossRowAggregation - 跨行聚合: 同一配送单号下多行共享收货人信息
   options: { "groupByField": "externalCode" }
4. matrixTranspose - 矩阵转置: 列头是门店/日期，需要转置
   options: { "rowIdentifierFields": ["skuName"], "columnHeaderStartIndex": 2, "columnValueField": "storeName", "cellSplitSeparator": "\\n", "cellSplitItemFormat": "[xX×]" }
5. cardDetection - 卡片式: 每条记录是一个独立卡片
   options: { "cardStartKeyword": "▶|调拨记录", "internalFieldPatterns": [{ "targetField": "storeName", "keyword": "门店|收货门店" }] }
6. multiSheet - 多Sheet处理: 文件含多个 Sheet，每个 Sheet 是一个独立门店/收货方/订单（如 Sheet 名"银泰店""金桥店""金银潭店"）。启用后从 Sheet 名称提取字段值（典型为 storeName）。
   options: { "sheetNameFieldMappings": [{ "targetField": "storeName" }] } —— Sheet 名本身就是门店名则【不填 extractPattern】，直接使用完整 Sheet 名；需用正则从 Sheet 名截取时再填 extractPattern（如 "门店(.+)"）。
   注意：多门店分 Sheet 出库单里，数据列通常【没有】门店名列，门店名只存在于 Sheet 名（或顶部/底部尾注），因此必须用 multiSheet 提取，绝不能用低置信度列映射去猜 storeName。

重要规则：
- 不要硬编码特定文件名或列名的判断逻辑
- 返回的规则应该是一般化的配置
- 所有字段映射都要有 confidence 评分
- 对于不确定的映射，confidence 设为 50 以下
- 只返回纯 JSON 对象，不要使用代码块（markdown 围栏）包裹，不要加 // 或 /* */ 注释，不要使用尾随逗号（trailing comma）
- 确保 JSON 完整闭合（所有 { } 和 [ ] 成对），不要中途截断

必填与结构约束（务必遵守，否则解析会校验报错）：
1. storeName(收货门店) 与 收件人信息(receiverName/receiverPhone/receiverAddress) 至少要有其一。
   - 若 storeName 在被跳过的顶部表头行里（如"收货机构/调入门店/收货门店: xxx"），必须启用 headerInfoExtraction 处理器（headerRowsCount 覆盖到该标题行），用 fieldMappings 按关键词提取，绝不能用低置信度"推测"列映射去填它。
   - 若收件人信息在底部页脚区，必须启用 tailInfoExtraction 提取。
   - 绝不允许 storeName 与收件人信息同时为空。
2. receiverPhone / receiverAddress 只有在文件里确实出现"收货电话/联系电话/收货地址"等对应信息时才映射，并通过 tailInfoExtraction / headerInfoExtraction 提取；若文件根本没有这些字段，不要臆造，留空即可（不要给 20% 的瞎猜映射）。
3. 只要文件存在 SKU 明细列（物品编码/物品名称/规格/数量等），就必须映射 skuCode、skuName、skuQuantity、skuSpec 四个字段；skuQuantity 对应"数量/发货数量/出库数量"列，必须为正数。
4. sourceColumn 只能使用预览 headers 中真实存在的列名，不得臆造；preview 里提供了 headers、sampleRows、sampleRowsTail，请据此判断表头位置。
5. headerRowsToSkip：数清"真正的列标题行"之前有几行（大标题、空行、说明文字）就填几；footerRowsToSkip 同理（底部收货信息、合计行）。不要漏填也不要多填。
6. summaryRowKeywords 必须包含 ["合计","总计","小计"] 以跳过汇总行。
7. 不确定字段不要强行映射，宁可留空并给出低 confidence，也不要映射到错误列。
8. 多 Sheet 门店文件（每个 Sheet 名就是门店，如"银泰店""金桥店"）：必须启用 multiSheet 处理器，用 sheetNameFieldMappings 把 storeName 映射到 Sheet 名（不填 extractPattern）。数据列里通常没有门店名，切勿用低置信度列映射去猜 storeName，否则每条记录都缺 storeName 而全部校验失败。
9. 顶部/底部行计数必须"数全"：
   - headerRowsToSkip = 从文件第 1 行（预览里的 headers 行）到"真正列标题行"之间的【总】行数（含被当作表头的大标题行本身、出库日期/仓库等信息行、空行）。例如第1行大标题、第2行出库日期信息、第3行空、第4行才是列标题，则 headerRowsToSkip=3。数错会导致表头错位、SKU 字段全部丢失。
   - footerRowsToSkip = 数据块之后到文件末尾的【总】行数（含合计行、收货门店/联系人/联系电话/收货地址等键值尾注行、制单人/审核人行、空行）。即便数不准，引擎也会兜底跳过首单元格为"合计/制单/收货门店/联系人/联系电话/收货地址"等的尾注行；但请尽量数准。
   - 底部若存在"收货门店：xxx / 联系人：xxx / 联系电话：xxx / 收货地址：xxx"键值行，应同时启用 tailInfoExtraction 提取（keywordPattern 用 "联系人|收货人"、"联系电话|收货电话"、"收货地址"，extractPattern 用 "[:：]\\s*(.+)"），引擎会把它们注入到每条记录。
10. 「配送发货单 / 出库单」单据型结构（顶部是【宽表 KV 信息块】、底部是【单据尾注】）的解析要点：
   - 这类文件顶部通常有两行横向铺开的键值对（如 收货机构 / 供货机构 / 订货机构 / 发货日期 等挤在同一行多列），真正的【列标题行】（序号/物品编码/物品名称/规格型号/发货数量…）在其下方。headerRowsToSkip = 从预览第1行到真正列标题行之间的【总】行数（含大标题行 + 全部 KV 信息块行）。例如本类文件：第1行大标题、第2~3行 KV 信息块、第4行才是列标题 → headerRowsToSkip=3。
   - 门店名(storeName) 几乎都在被跳过的顶部 KV 信息块里（关键词"收货机构 / 收货门店 / 订货机构"），【必须用 headerInfoExtraction 提取】，且 headerRowsCount 必须 ≥ headerRowsToSkip 以覆盖到该 KV 行；keywordPattern 用 "收货机构|收货门店|订货机构|门店"，extractPattern 用 "[:：]\\s*(.+)"。绝不要用低置信度列映射去猜 storeName（数据列里通常没有门店名）。
   - SKU 字段：物品编码→skuCode、物品名称→skuName、规格型号→skuSpec、【发货数量→skuQuantity】（注意是"发货数量/发货数量*"，不是"订货数量/应发数量"）。
   - 底部单据尾注行（合计 / 单据号 / 上游单据 / 创建日期 / 创建人 / 收货人 / 收货电话 / 收货地址 / 备注）不是数据行：其中 合计/收货人/收货电话/收货地址/单据号/备注 等引擎会【自动兜底跳过】，但请仍尽量用 footerRowsToSkip 数准（=数据块之后到文件末尾的总行数）；收货人/收货电话/收货地址 同时用 tailInfoExtraction 提取（keywordPattern "收货人"、"收货电话|联系电话"、"收货地址"）。`;

// 从模型返回中尽量稳健地解析出 JSON 对象：
// 1) 去掉 ``` 代码块包裹 2) 截取最外层 {} 3) 去除尾随逗号
// 4) 若仍失败（被截断），按括号配对补全缺失的 } / ]
function tolerantJsonParse(raw: string): unknown {
  // 1) 去 markdown 代码块
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  // 2) 截取最外层 { }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }

  // 3) 去尾随逗号（JSON.parse 不支持），注意避开字符串内的逗号
  s = s.replace(/,(\s*[}\]])/g, '$1');

  const tryParse = (str: string): unknown | null => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  const first = tryParse(s);
  if (first !== null) return first;

  // 4) 括号配对补全（处理被 max_tokens 截断的情况）
  const stack: string[] = [];
  const pairs: Record<string, string> = { '{': '}', '[': ']' };
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(pairs[ch]);
      else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] === ch) stack.pop();
        else break; // 出现多余闭合，说明已损坏，停止
      }
    }
  }
  // 若截断处正好在一个未完成的键/值上（如末尾是 "abc":），先补一个 null 占位
  const trimmed = s.replace(/,\s*$/, '').replace(/:\s*$/, ':null');
  let repaired = trimmed;
  while (stack.length) repaired += stack.pop();
  const second = tryParse(repaired);
  if (second !== null) return second;

  throw new Error('无法解析模型返回的 JSON');
}

export async function generateRuleFromAI(
  filePreview: unknown,
  fileName: string,
  fileType: FileType
): Promise<{
  rule: Partial<ParseRule>;
  analysis: string;
  confidence: Record<string, number>;
  error?: string;
}> {
  const config = getAiConfig();

  if (!config.apiKey) {
    return {
      rule: {},
      analysis: '',
      confidence: {},
      error: 'AI API Key 未配置，请在环境变量中设置 AI_API_KEY',
    };
  }

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });

    const previewStr = JSON.stringify(filePreview, null, 2);

    const userMessage = `请分析以下文件并生成解析规则：

文件名: ${fileName}
文件类型: ${fileType}

文件结构预览:
\`\`\`json
${previewStr.slice(0, 8000)}
\`\`\`

请分析文件结构并生成适用的解析规则 JSON。`;

    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 8192,
      timeout: 120_000, // 思考模型更慢，放宽到 120 秒
    });

    let content = response.choices[0]?.message?.content || '';

    // 兜底：若 content 为空但模型带有 reasoning_content（思考模型 token 预算被思考过程吃光），
    // 再请求一次，给更大的 max_tokens，避免最终答案为空。
    if (!content.trim()) {
      const finishReason = response.choices[0]?.finish_reason;
      console.warn('[AI] 首次返回 content 为空, finish_reason=', finishReason, '，尝试加大 max_tokens 重试');
      try {
        const retry = await client.chat.completions.create({
          model: config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
          max_tokens: 16384,
          timeout: 180_000,
        });
        content = retry.choices[0]?.message?.content || '';
      } catch (retryErr) {
        console.error('[AI] 兜底重试失败:', retryErr);
      }
    }

    if (!content.trim()) {
      return {
        rule: {},
        analysis: '',
        confidence: {},
        error: 'AI 返回内容为空，请检查模型名称和 API Key 是否有效',
      };
    }

    console.log('AI raw response:', content.slice(0, 500));

    // 容错解析 JSON（自动处理尾随逗号、代码块包裹、截断补全）
    const parsed = tolerantJsonParse(content);

    // 构建规则
    const rule: Partial<ParseRule> = {
      name: parsed.name || `AI: ${fileName}`,
      description: parsed.description || '',
      fileType: fileType,
      isAiGenerated: true,
      aiConfidence: parsed.confidence || {},
      headerRowsToSkip: parsed.headerRowsToSkip ?? 0,
      footerRowsToSkip: parsed.footerRowsToSkip ?? 0,
      skipEmptyRows: parsed.skipEmptyRows ?? true,
      skipSummaryRows: parsed.skipSummaryRows ?? false,
      summaryRowKeywords: parsed.summaryRowKeywords || ['合计', '总计', '小计'],
      sheetNames: parsed.sheetNames || [],
      sheetMergeMode: parsed.sheetMergeMode || 'separate',
      columnMappings: (parsed.columnMappings || []).map((m: Record<string, unknown>) => ({
        targetField: m.targetField,
        sourceType: m.sourceType || 'column',
        sourceColumn: m.sourceColumn,
        sourcePattern: m.sourcePattern,
        staticValue: m.staticValue,
      })),
      processors: (parsed.processors || []).map((p: Record<string, unknown>) => ({
        type: p.type,
        enabled: p.enabled !== false,
        options: p.options || {},
      })) as ProcessorConfig[],
    };

    return {
      rule,
      analysis: parsed.analysis || 'AI 已完成文件结构分析',
      confidence: parsed.confidence || { overall: 50 },
    };
  } catch (err) {
    console.error('AI 生成规则失败:', err);
    return {
      rule: {},
      analysis: '',
      confidence: {},
      error: `AI 分析失败: ${err instanceof Error ? err.message : '未知错误'}`,
    };
  }
}

/** 直接使用 AI 解析数据（备选方案） */
export async function parseWithAI(
  rawText: string,
  fileType: FileType
): Promise<{ records: Record<string, unknown>[]; error?: string }> {
  const config = getAiConfig();

  if (!config.apiKey) {
    return { records: [], error: 'AI API Key 未配置' };
  }

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });

    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `你是一个物流出库单解析专家。请从文本中提取运单数据，返回 JSON 数组。
每条记录包含: externalCode(外部编码), storeName(收货门店), receiverName(收件人姓名), receiverPhone(收件人电话), receiverAddress(收件人地址), skuCode(SKU编码), skuName(SKU名称), skuQuantity(SKU数量), skuSpec(SKU规格), remark(备注)。
只返回 JSON 数组，不要其他内容。`,
        },
        {
          role: 'user',
          content: `请解析以下${fileType === 'pdf' ? 'PDF' : 'Word'}文档内容:\n\n${rawText.slice(0, 6000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 8192,
      timeout: 120_000,
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return { records: JSON.parse(jsonMatch[0]) };
    }
    return { records: [], error: 'AI 返回格式无效' };
  } catch (err) {
    return { records: [], error: `AI 解析失败: ${err}` };
  }
}
