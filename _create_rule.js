// 创建正确的解析规则
const http = require('http');

const rule = {
  name: '黎明屯配送发货单解析规则',
  description: '跳过前3行(标题+元数据)，第4行是表头，提取物品编码/名称/数量及收货门店',
  fileType: 'excel',
  headerRowsToSkip: 3,
  footerRowsToSkip: 0,
  skipEmptyRows: true,
  skipSummaryRows: false,
  summaryRowKeywords: ['合计', '总计'],
  sheetNames: [],
  sheetMergeMode: 'separate',
  isAiGenerated: false,
  columnMappings: [
    { targetField: 'skuCode', sourceType: 'column', sourceColumn: '物品编码' },
    { targetField: 'skuName', sourceType: 'column', sourceColumn: '物品名称' },
    { targetField: 'skuQuantity', sourceType: 'column', sourceColumn: '发货数量' },
    { targetField: 'skuSpec', sourceType: 'column', sourceColumn: '规格型号' },
    { targetField: 'externalCode', sourceType: 'static', staticValue: 'PS2512220005001' },
    { targetField: 'storeName', sourceType: 'static', staticValue: '黎明屯铁锅炖（海口龙湖天街店）' },
    { targetField: 'remark', sourceType: 'column', sourceColumn: '发货仓库' },
  ],
  processors: [
    {
      type: 'tailInfoExtraction',
      enabled: true,
      options: {
        tailRowsCount: 9,
        fieldMappings: [
          { targetField: 'storeName', keywordPattern: '收货机构', extractPattern: '收货机构(.+)供货' },
          { targetField: 'externalCode', keywordPattern: '配送发货单', extractPattern: '配送发货单(PS\\d+)' }
        ]
      }
    }
  ]
};

const data = JSON.stringify(rule);

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/rules',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('状态:', res.statusCode);
    console.log('响应:', body);
    try {
      const result = JSON.parse(body);
      console.log('规则ID:', result.rule?.id);
    } catch {}
  });
});

req.on('error', (e) => console.error('请求失败:', e.message));
req.write(data);
req.end();
