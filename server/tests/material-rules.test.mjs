import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMaterialRule, nextMaterialCode, MATERIAL_RULE_VERSION, MaterialRuleError } from '../dist/material-rules.js'

const resolve = (kind, prefix, group) => resolveMaterialRule(kind, prefix, group)
const rejects = (fn, text) => assert.throws(fn, error => error instanceof MaterialRuleError && error.message.includes(text))

// This fixture exercises only the generic next-code algorithm. It is deliberately
// not obtained from resolveMaterialRule and does not represent a confirmed business rule.
const threeDigitAlgorithmFixture = {
  kind: 'algorithm-fixture', prefix: 'FIXTURE.', width: 3,
  version: MATERIAL_RULE_VERSION, basis: 'local test fixture only; not a business rule',
}

test('原材料仅接受3开头完整K3分组，点号后为五位流水', () => {
  const rule = resolve('raw', '3.01.02.', '3.01.02')
  assert.equal(rule.width, 5)
  assert.equal(rule.version, MATERIAL_RULE_VERSION)
  assert.equal(rule.prefix, '3.01.02.')
  rejects(() => resolve('raw', '3.01.02', '3.01.02'), 'K3Cloud 的 3 开头完整分组')
  rejects(() => resolve('raw', '3.01.02.', '2.01.02'), 'K3Cloud 的 3 开头完整分组')
})

test('finished、mould、injection、metal-blank、metal-treated 均待本地目录绑定确认', () => {
  const apparentlyMatching = [
    ['finished', '1.01.02.', '1.01.02'],
    ['mould', '1.09.08.', '1.09.08'],
    ['injection', '2.01.02.0317', '2.01.02'],
    ['metal-blank', '2.02.03.05', '2.02.03'],
    ['metal-treated', '2.03.02.0117', '2.03.02'],
  ]
  for (const [kind, prefix, group] of apparentlyMatching) {
    rejects(() => resolve(kind, prefix, group), '待确认')
  }
})

test('未知类别和非法原材料前缀明确阻断', () => {
  rejects(() => resolve('unknown', '1.01.', '1.01'), '未知或未录入类别')
  rejects(() => resolve('mystery', '3.01.02.', '3.01.02'), '未知或未录入类别')
  rejects(() => resolve('raw', 'x.01.', '3.01'), '编码前缀必须')
  rejects(() => resolve('raw', `3.${'1'.repeat(101)}`, '3.01'), '编码前缀必须')
})

test('最大号按数值计算，仅匹配完整前缀，取最大值加一且不补洞', () => {
  const rule = resolve('raw', '3.01.02.', '3.01.02')
  assert.deepEqual(nextMaterialCode(rule, ['3.01.02.00009', '3.01.02.00010']), {
    code: '3.01.02.00011', serial: 11, maximum: 10,
  })
  assert.deepEqual(nextMaterialCode(rule, ['3.01.02.00001', '3.01.02.00003', '3.01.03.99999', '13.01.02.99999']), {
    code: '3.01.02.00004', serial: 4, maximum: 3,
  })
  assert.deepEqual(nextMaterialCode(rule, ['3.01.02.00001', '3.01.02.00004']), {
    code: '3.01.02.00005', serial: 5, maximum: 4,
  })
})

test('空池、非数字后缀、同池异位数冲突和五位耗尽均阻断', () => {
  const raw = resolve('raw', '3.01.02.', '3.01.02')
  rejects(() => nextMaterialCode(raw, []), '尚无可核验最大流水号')
  rejects(() => nextMaterialCode(raw, ['3.01.02.ABCDE']), '尚无可核验最大流水号')
  rejects(() => nextMaterialCode(raw, ['3.01.02.00007', '3.01.02.008']), '不同流水位数')
  rejects(() => nextMaterialCode(raw, ['3.01.02.99999']), '已耗尽')
})

test('显式局部算法fixture验证三位流水耗尽（不代表业务规则可解析）', () => {
  assert.deepEqual(nextMaterialCode(threeDigitAlgorithmFixture, ['FIXTURE.001', 'FIXTURE.009']), {
    code: 'FIXTURE.010', serial: 10, maximum: 9,
  })
  rejects(() => nextMaterialCode(threeDigitAlgorithmFixture, ['FIXTURE.999']), '已耗尽')
})
