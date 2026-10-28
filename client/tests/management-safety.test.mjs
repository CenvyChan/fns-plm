import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
const source = readFileSync(resolve(import.meta.dirname, '../src/DailyReportingManagement.tsx'), 'utf8');
test('assignment selection preloads existing users and clearly warns replacement semantics', () => {
  assert.match(source, /setAssignmentUserIds\(\(data\?\.assignments/);
  assert.match(source, /整体替换现有成员列表/);
  assert.match(source, /已自动预选现有成员/);
  assert.match(source, /已停用或不可用成员/);
  assert.match(source, /expectedUserIds: assignmentExpectedUserIds/);
  assert.match(source, /setAssignmentExpectedUserIds\(currentIds\)/);
});
test('migration batch list is paged without a fixed first-20 truncation', () => {
  assert.match(source, /batchPageSize = 20/);
  assert.match(source, /data\.importBatches\.slice\(\(batchPage - 1\) \* batchPageSize, batchPage \* batchPageSize\)/);
  assert.match(source, /迁移批次分页/);
  assert.doesNotMatch(source, /importBatches\.slice\(0,\s*20\)/);
});
test('K3 verification boundary and operational next steps are explicit', () => {
  assert.match(source, /核验仅查询镜像，不代表人工确认/);
  assert.match(source, /本次会话记录，刷新后需重新核验/);
  assert.match(source, /运维下一步：由管理员确认 K3 镜像同步新鲜度/);
});
