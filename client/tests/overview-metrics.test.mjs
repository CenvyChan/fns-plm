import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/overview-metrics.css', import.meta.url), 'utf8')

test('overview removes requested copy without empty explanatory elements', () => {
  for (const text of ['把注意力留给真正重要的事。今天也会是稳稳向前的一天。', '保持轻盈，一次专注一件', '当前账套中的项目记录', '完成一项，就向前一步', '按本周截止日期统计', '专注当下，按自己的节奏来。']) {
    assert.ok(!app.includes(text), `Removed overview copy remains: ${text}`)
  }
  assert.ok(app.includes("{page === 'projects' && <p>"))
  assert.ok(app.includes('{detail && <div className="stat-detail">'))
  assert.ok(app.includes("{completion >= 100 && <span>今天的任务已经全部完成。</span>}"))
  for (const label of ['待完成任务', '项目总数', '今日完成', '本周完成']) assert.ok(app.includes(`label="${label}"`))
})

test('metrics use one responsive surface without replacing existing colors', () => {
  assert.ok(app.includes('className="stats-grid overview-metrics" aria-label="工作指标"'))
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /border-left: 1px solid var\(--line\)/)
  assert.match(css, /background: var\(--surface\)/)
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i)
  assert.doesNotMatch(app, /className="stat-card" whileHover/)
})
