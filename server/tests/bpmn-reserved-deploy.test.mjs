import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { deployModelDefinition } from '../dist/integrations/flowable.js';

const builtInKeys = ['materialApproval', 'bomReleaseApproval', 'documentReleaseApproval', 'performanceReviewApproval'];

test('custom deploy adapter rejects each reserved built-in key before any HTTP engine call', async (t) => {
  let calls = 0;
  const mock = createServer((_req, res) => { calls++; res.end('{}'); });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mock.close(resolve)));
  const { port } = mock.address();
  for (const key of builtInKeys) {
    await assert.rejects(
      deployModelDefinition({ key, name: 'collision', xml: '<definitions/>', tenantId: 'isolated-test' }, { baseUrl: `http://127.0.0.1:${port}`, username: 'u', password: 'p' }),
      new RegExp(key),
    );
  }
  assert.equal(calls, 0, 'reserved-key rejection must happen before HTTP');
});

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const serverDir = resolve(import.meta.dirname, '..');
test('legacy frozen reserved-key collision is rejected on preview and publish without engine deployment', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'plm-legacy-key-test-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const dbFile = join(temp, 'isolated.sqlite');
  let deployments = 0;
  const engine = createServer((req, res) => { if (req.url === '/repository/deployments') deployments++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'should-not-deploy', data: [] })); });
  await new Promise(resolve => engine.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => engine.close(resolve)));
  const port = engine.address().port;
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const appPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${appPort}`;
  const env = { PATH: process.env.PATH, HOME: temp, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(appPort), DATABASE_FILE: dbFile,
    APP_ENCRYPTION_KEY: 'b4'.repeat(32), APP_ENCRYPTION_KEY_FILE: join(temp, 'key'), DATA_FILE: join(temp, 'missing.json'), LEGACY_DATA_FILE: join(temp, 'missing.json'), DOCUMENT_STORAGE_DIR: join(temp, 'docs'), INTEGRATION_DATA_DIR: temp,
    DOTENV_CONFIG_PATH: join(temp, 'missing.env'), REDIS_URL: '', FLOWABLE_BASE_URL: '', FLOWABLE_USERNAME: '', FLOWABLE_PASSWORD: '', CONNECTOR_DEFAULT_TENANT_ID: '', CONNECTOR_DEFAULT_ORGANIZATION_ID: '', CONNECTOR_DEFAULT_ACCOUNT_ID: '', DINGTALK_WEBHOOK_URL: '', DINGTALK_ROBOT_WEBHOOK: '', K3CLOUD_BASE_URL: '', BPMN_MODELER_ALLOW_TEST_MOCK: 'true' };
  let child;
  const stop = async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } };
  const boot = async () => {
    child = spawn(process.execPath, ['dist/index.js'], { cwd: serverDir, env, stdio: 'ignore' });
    for (let i = 0; i < 120; i++) {
      assert.equal(child.exitCode, null, 'isolated API exited');
      try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('isolated API health timeout');
  };
  t.after(stop);
  await boot();
  const request = async (path, method = 'GET', body, auth = {}) => {
    const headers = { 'Content-Type': 'application/json', ...auth.headers };
    if (auth.token) Object.assign(headers, { Authorization: `Bearer ${auth.token}`, 'X-Tenant-ID': auth.scope.tenantId, 'X-Organization-ID': auth.scope.organizationId, 'X-Account-ID': auth.scope.accountId });
    const response = await fetch(base + '/api' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const setup = await request('/auth/mobile/setup', 'POST', { displayName: 'Legacy fixture', email: 'legacy-key@example.test', password: 'isolated-test-password-123' });
  assert.equal(setup.status, 201, JSON.stringify(setup.data));
  const auth = { token: setup.data.accessToken, scope: setup.data.user };
  await stop();
  Object.assign(env, { FLOWABLE_BASE_URL: `http://127.0.0.1:${port}`, FLOWABLE_USERNAME: 'u', FLOWABLE_PASSWORD: 'p', CONNECTOR_DEFAULT_TENANT_ID: auth.scope.tenantId, CONNECTOR_DEFAULT_ORGANIZATION_ID: auth.scope.organizationId, CONNECTOR_DEFAULT_ACCOUNT_ID: auth.scope.accountId });
  await boot();
  const graph = { key: 'legacyCustom', name: 'Legacy custom', nodes: [{ id: 'S', type: 'startEvent', name: 'Start' }, { id: 'T', type: 'userTask', name: 'Review', assignment: { kind: 'assignee', userIds: [auth.scope.id] } }, { id: 'E', type: 'endEvent', name: 'End' }], flows: [{ id: 'f1', source: 'S', target: 'T' }, { id: 'f2', source: 'T', target: 'E' }] };
  const model = await request('/bpmn-models', 'POST', { graph }, auth); assert.equal(model.status, 201, JSON.stringify(model.data));
  const frozen = await request(`/bpmn-models/${model.data.id}/versions`, 'POST', { expectedRevision: 1 }, auth); assert.equal(frozen.status, 201, JSON.stringify(frozen.data));
  const validPreview = await request(`/bpmn-models/${model.data.id}/preview`, 'POST', { version: 1 }, auth); assert.equal(validPreview.status, 200, JSON.stringify(validPreview.data));
  const db = new Database(dbFile);
  const version = db.prepare('SELECT graph FROM bpmn_versions WHERE model_id=? AND version=1').get(model.data.id);
  const legacyGraph = JSON.parse(version.graph); legacyGraph.key = 'materialApproval';
  for (const trigger of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='bpmn_versions'").all()) db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
  assert.equal(db.prepare('SELECT count(*) AS n FROM connector_configs').get().n, 0, 'test must never write connector settings');
  db.prepare('UPDATE bpmn_versions SET graph=? WHERE model_id=? AND version=1').run(JSON.stringify(legacyGraph), model.data.id); db.close();
  const preview = await request(`/bpmn-models/${model.data.id}/preview`, 'POST', { version: 1 }, auth);
  assert.equal(preview.status, 400); assert.equal(preview.data.error, 'reserved_process_key');
  const publish = await request(`/bpmn-models/${model.data.id}/publish`, 'POST', { version: 1, confirm: true, confirmationToken: validPreview.data.confirmationToken }, auth);
  assert.equal(publish.status, 400); assert.equal(publish.data.error, 'reserved_process_key');
  assert.equal(deployments, 0, 'legacy collision must never reach engine deployment');
});
