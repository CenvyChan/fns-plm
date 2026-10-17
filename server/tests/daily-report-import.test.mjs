import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDailyReportImportFile } from '../dist/daily-report-import.js'
import {
  BoundedPreviewCache,
  estimatePreviewMemoryBytes,
  MAX_PENDING_IMPORT_PREVIEWS,
  MAX_PENDING_IMPORT_PREVIEW_MEMORY_BYTES,
} from '../dist/import-preview-cache.js'

const parseCsv = content => parseDailyReportImportFile('history.csv', Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), 'sales')

test('CSV preserves quoted CRLF newlines and reports physical source line numbers', async () => {
  const csv = [
    '日期,客户名称,原币金额,备注',
    '2024-02-01,客户甲,10,"第一行\r\n第二行"',
    '2024-02-02,客户乙,20,"第三行"',
    '',
  ].join('\r\n')
  const parsed = await parseCsv(csv)
  assert.deepEqual(parsed.rows.map(row => row.line), [2, 4])
  assert.equal(parsed.rows[0].values.note, '第一行\r\n第二行')
  assert.equal(parsed.rows[1].values.note, '第三行')
})

test('CSV retains exact original amount and exchange-rate decimal text', async () => {
  const parsed = await parseCsv('日期,客户名称,原币金额,汇率\n2024-02-01,客户甲,"1,250.500000",7.2000\n')
  assert.equal(parsed.rows[0].values.originalAmount, 1250.5)
  assert.equal(parsed.rows[0].values.originalAmountExact, '1250.500000')
  assert.equal(parsed.rows[0].values.exchangeRate, 7.2)
  assert.equal(parsed.rows[0].values.exchangeRateExact, '7.2000')
})

test('CSV rejects malformed UTF-8 instead of replacing invalid byte sequences', async () => {
  const prefix = Buffer.from('日期,客户名称,原币金额,备注\n2024-02-01,客户甲,10,', 'utf8')
  const suffix = Buffer.from('\n', 'utf8')
  await assert.rejects(parseCsv(Buffer.concat([prefix, Buffer.from([0xff]), suffix])), /不是有效的 UTF-8/)
})

test('CSV rejects empty and whitespace-only header columns', async () => {
  await assert.rejects(parseCsv(',日期,客户名称\n,2024-02-01,客户甲\n'), /表头不能为空/)
  await assert.rejects(parseCsv('   ,日期,客户名称\n,2024-02-01,客户甲\n'), /表头不能为空/)
})

test('CSV rejects duplicate normalized headers and multiple aliases for one field', async () => {
  await assert.rejects(parseCsv('日期, 日 期 ,客户名称\n2024-02-01,2024-02-01,客户甲\n'), /表头重复/)
  await assert.rejects(parseCsv('日期,业务日期,客户名称\n2024-02-01,2024-02-01,客户甲\n'), /映射到重复字段/)
})

test('CSV marks rows with too few or too many fields as preview errors', async () => {
  const parsed = await parseCsv('日期,客户名称,原币金额\n2024-02-01,客户甲\n2024-02-02,客户乙,10,意外字段\n')
  assert.equal(parsed.rows.length, 2)
  assert.match(parsed.rows[0].errors[0], /第 2 行字段数不匹配：表头有 3 列，当前行有 2 列/)
  assert.match(parsed.rows[1].errors[0], /第 3 行字段数不匹配：表头有 3 列，当前行有 4 列/)
})

test('CSV rejects quotes inside unquoted cells and characters after a closing quote', async () => {
  await assert.rejects(parseCsv('日期,客户名称\n2024-02-01,客"户\n'), /引号必须位于字段开头/)
  await assert.rejects(parseCsv('日期,客户名称\n2024-02-01,"客户甲"x\n'), /闭合引号后/)
})

test('preview cache enforces both entry and weighted-byte bounds with FIFO eviction', () => {
  assert.equal(MAX_PENDING_IMPORT_PREVIEWS, 8)
  assert.equal(MAX_PENDING_IMPORT_PREVIEW_MEMORY_BYTES, 32 * 1024 * 1024)
  const cache = new BoundedPreviewCache(2, 10, preview => preview.charge)
  const preview = (token, charge, expiresAt = 100) => ({ token, charge, expiresAt })

  assert.equal(cache.set(preview('first', 6), 0), true)
  assert.equal(cache.set(preview('second', 4), 0), true)
  assert.equal(cache.size, 2)
  assert.equal(cache.memoryBytes, 10)

  assert.equal(cache.set(preview('third', 7), 0), true)
  assert.equal(cache.get('first', 0), undefined)
  assert.equal(cache.get('second', 0), undefined)
  assert.equal(cache.get('third', 0).token, 'third')
  assert.equal(cache.memoryBytes, 7)

  assert.equal(cache.set(preview('too-large', 11), 0), false)
  assert.equal(cache.get('third', 0).token, 'third', 'a rejected oversize preview leaves existing entries intact')

  assert.equal(cache.set(preview('fourth', 2, 5), 0), true)
  assert.equal(cache.get('fourth', 5), undefined)
  assert.equal(cache.memoryBytes, 7)
})

test('production preview byte charge is four times serialized UTF-8 size', () => {
  const sample = { token: 't', rows: [{ note: '历史日报' }] }
  assert.equal(estimatePreviewMemoryBytes(sample), Buffer.byteLength(JSON.stringify(sample), 'utf8') * 4)
})
