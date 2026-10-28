import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { parseDailyReportImportFile } from '../dist/daily-report-import.js';
const csv = (text) => parseDailyReportImportFile('history.csv', Buffer.isBuffer(text) ? text : Buffer.from(text), 'sales');

test('historical parser preserves physical source lines and escaped quoted CRLF', async () => {
  const parsed = await csv('日期,客户名称,原币金额,备注\r\n2024-02-01,客户甲,10,"第一行\r\n第二行"\r\n2024-02-02,客户乙,20,"带""引号"\r\n');
  assert.deepEqual(parsed.rows.map(row => row.line), [2, 4]);
  assert.equal(parsed.rows[0].values.note, '第一行\r\n第二行');
  assert.equal(parsed.rows[1].values.note, '带"引号');
});
test('historical parser rejects malformed quotation, UTF-8 and ambiguous headers', async () => {
  for (const [text, pattern] of [
    ['日期,客户名称\n2024-02-01,客"户\n', /引号必须/],
    ['日期,客户名称\n2024-02-01,"客户"x\n', /闭合引号后/],
    ['日期,客户名称\n2024-02-01,"客户', /未闭合/],
    [',日期\n,2024-02-01\n', /表头不能为空/],
    ['日期,日 期\n2024-02-01,2024-02-01\n', /表头重复/],
    ['日期,业务日期\n2024-02-01,2024-02-01\n', /重复字段/],
  ]) await assert.rejects(csv(text), pattern);
  await assert.rejects(csv(Buffer.from([0xff])), /UTF-8/);
});
test('historical parser marks short/long rows and rejects hexadecimal or nonfinite numbers', async () => {
  const parsed = await csv('日期,客户名称,原币金额\n2024-02-01,客户\n2024-02-01,客户,10,多余\n2024-02-01,客户,0x10\n2024-02-01,客户,Infinity\n');
  assert.equal(parsed.rows.length, 4);
  assert.match(parsed.rows[0].errors.join(), /第 2 行字段数不匹配/);
  assert.match(parsed.rows[1].errors.join(), /第 3 行字段数不匹配/);
  assert.match(parsed.rows[2].errors.join(), /十进制/);
  assert.match(parsed.rows[3].errors.join(), /十进制/);
});
test('historical aliases support English normalized headers, Chinese types and formatted values', async () => {
  const parsed = await csv('Report_Date,Party_Name,Bill_No,Amount,业务类型,汇率\n2024/2/1,客户甲,B-1,"¥1,234.50",销售,1\n');
  assert.deepEqual(parsed.mappedFields, ['type', 'date', 'partyName', 'documentNo', 'originalAmount', 'exchangeRate']);
  assert.equal(parsed.rows[0].values.type, 'sales');
  assert.equal(parsed.rows[0].values.date, '2024-02-01');
  assert.equal(parsed.rows[0].values.originalAmount, 1234.5);
  assert.deepEqual(parsed.rows[0].errors, []);
});
test('historical XLSX preserves serial dates, accepts blank trailing note and rejects formulas/extra data', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('日报');
  sheet.addRow(['日期', '客户名称', '金额', '备注']);
  sheet.addRow([46056, '客户甲', 125]);
  sheet.addRow(['2026-02-03', '客户甲', { formula: '1+1', result: 2 }]);
  sheet.addRow(['2026-02-03', '客户甲', 25, '', '意外列']);
  const parsed = await parseDailyReportImportFile('history.xlsx', Buffer.from(await book.xlsx.writeBuffer()), 'sales');
  assert.match(parsed.rows[0].values.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(parsed.rows[0].errors, []);
  assert.equal(parsed.rows[0].values.originalAmount, 125);
  assert.match(parsed.rows[1].errors.join(), /公式/);
  assert.match(parsed.rows[2].errors.join(), /字段数不匹配/);
});
