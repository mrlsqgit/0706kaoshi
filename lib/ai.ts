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
      "type": "tailInfoExtraction" | "crossRowAggregation" | "matrixTranspose" | "cardDetection",
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
2. crossRowAggregation - 跨行聚合: 同一配送单号下多行共享收货人信息
   options: { "groupByField": "externalCode" }
3. matrixTranspose - 矩阵转置: 列头是门店/日期，需要转置
   options: { "rowIdentifierFields": ["skuName"], "columnHeaderStartIndex": 2, "columnValueField": "storeName", "cellSplitSeparator": "\\n", "cellSplitItemFormat": "[xX×]" }
4. cardDetection - 卡片式: 每条记录是一个独立卡片
   options: { "cardStartKeyword": "▶|调拨记录", "internalFieldPatterns": [{ "targetField": "storeName", "keyword": "门店|收货门店" }] }

重要规则：
- 不要硬编码特定文件名或列名的判断逻辑
- 返回的规则应该是一般化的配置
- 所有字段映射都要有 confidence 评分
- 对于不确定的映射，confidence 设为 50 以下
- 只返回 JSON，不要有其他内容`;

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
      max_tokens: 4096,
      timeout: 30_000, // 30 秒超时
    });

    const content = response.choices[0]?.message?.content || '';
    
    if (!content.trim()) {
      return {
        rule: {},
        analysis: '',
        confidence: {},
        error: 'AI 返回内容为空，请检查模型名称和 API Key 是否有效',
      };
    }

    console.log('AI raw response:', content.slice(0, 500));
    
    // 提取 JSON
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // 尝试找到第一个 { 到最后一个 }
    const startIdx = jsonStr.indexOf('{');
    const endIdx = jsonStr.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      jsonStr = jsonStr.slice(startIdx, endIdx + 1);
    }

    const parsed = JSON.parse(jsonStr);

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
      max_tokens: 4096,
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
