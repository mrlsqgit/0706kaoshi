const XLSX = require('xlsx');

const filePath = 'D:/ZTO/AI/考试/0706/AI考试附件/demos/12.25海口龙湖天街-配送发货单PS2512220005001(1).xlsx';

const wb = XLSX.readFile(filePath);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  console.log('=== Sheet:', name, '=== 总行数:', json.length);
  console.log('表头:', JSON.stringify(json[0]));
  console.log('第2行:', JSON.stringify(json[1] || '空'));
  console.log('第3行:', JSON.stringify(json[2] || '空'));
  console.log('第4行:', JSON.stringify(json[3] || '空'));
  console.log('第5行:', JSON.stringify(json[4] || '空'));
  console.log('第6行:', JSON.stringify(json[5] || '空'));
}
