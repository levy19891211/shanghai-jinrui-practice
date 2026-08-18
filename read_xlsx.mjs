import * as XLSX from 'xlsx';
const wb = XLSX.readFile('/Users/levi/Downloads/TMUA_题库_导入格式.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
console.log('总行数(含表头):', rows.length);
console.log('表头:', JSON.stringify(rows[0]));
for (const excelRow of [333, 334, 336, 480]) { // 数据行号+1(表头)
  const idx = excelRow - 1;
  console.log(`\n=== Excel 第 ${excelRow} 行 (数据行 ${excelRow - 1}) ===`);
  console.log(JSON.stringify(rows[idx], null, 0));
  // 逐列打印便于阅读
  rows[0].forEach((h, ci) => {
    console.log(`  [${ci}] ${h} = ${JSON.stringify(rows[idx][ci])}`);
  });
}
