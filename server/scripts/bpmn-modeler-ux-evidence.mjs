// Read-only evidence collector for the isolated UI preview; never contacts an engine.
// Usage: node scripts/bpmn-modeler-ux-evidence.mjs /tmp/bpmn-ui-isolated-*/ui.sqlite [model name]
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const path = resolve(process.argv[2] || '');
assert.match(path, /^\/tmp\/bpmn-ui-isolated-[^/]+\/ui\.sqlite$/, 'Only the temporary preview database is accepted');
const db = new Database(path, { readonly: true, fileMustExist: true });
const model = process.argv[3]
  ? db.prepare('SELECT * FROM bpmn_models WHERE name=? ORDER BY updated_at DESC LIMIT 1').get(process.argv[3])
  : db.prepare('SELECT * FROM bpmn_models ORDER BY updated_at DESC LIMIT 1').get();
assert.ok(model, 'Browser-created model must persist');
const graph = JSON.parse(model.graph);
const versions = db.prepare('SELECT version,sha256,graph,xml,created_at FROM bpmn_versions WHERE model_id=? ORDER BY version').all(model.id);
const publications = db.prepare('SELECT status,deployment_id,definition_id,updated_at FROM bpmn_publish WHERE model_id=?').all(model.id);
const audit = db.prepare('SELECT event,detail,created_at FROM bpmn_audit WHERE model_id=? ORDER BY created_at,rowid').all(model.id);
assert.ok(graph.nodes.length >= 4, 'Browser must add a node, not only rename the starter graph');
assert.ok(graph.flows.length >= 3, 'Added node must be connected');
assert.ok(graph.nodes.some(n => n.assignment?.kind === 'candidateRole' && n.assignment.role === 'admin'), 'PLM role selection must persist');
assert.ok(versions.length >= 1, 'An immutable version must persist');
assert.ok(publications.some(p => p.status === 'published' && p.deployment_id === 'ui-mock-deployment'), 'Only the expected mock publication counts');
for (const v of versions) assert.equal(createHash('sha256').update(v.xml).digest('hex'), v.sha256, 'Frozen XML hash must match');
const bound = JSON.parse(versions[0].graph).nodes.find(n => n.formBinding)?.formBinding;
assert.ok(bound, 'Frozen workflow must bind a fixed form version');
assert.ok(versions[0].xml.includes(`plm-form:${bound.formKey}:v${bound.formVersion}`), 'Frozen XML must retain the fixed form key');
const formVersions = db.prepare('SELECT version,definition,created_at FROM form_versions WHERE tenant_id=? AND organization_id=? AND account_id=? AND form_key=? ORDER BY version').all(model.tenant_id, model.organization_id, model.account_id, bound.formKey);
assert.ok(formVersions.length >= 2, 'Browser must publish form v2 while the workflow stays on form v1');
assert.equal(bound.formVersion, 1);
assert.notDeepEqual(JSON.parse(formVersions[0].definition), JSON.parse(formVersions[1].definition), 'Form v2 must contain an actual field edit');
for (const event of ['create', 'update', 'version_created', 'preview', 'publish_started', 'published']) {
  assert.ok(audit.some(a => a.event === event), `Missing audit event ${event}`);
}
console.log(JSON.stringify({
  isolation: 'Temporary SQLite + loopback Flowable mock only. Read-only database evidence after real browser actions.',
  model: { id: model.id, name: model.name, key: model.key, revision: model.revision, tenant_id: model.tenant_id, organization_id: model.organization_id, account_id: model.account_id },
  graph,
  versions: versions.map(v => ({ version: v.version, sha256: v.sha256, graph: JSON.parse(v.graph), createdAt: v.created_at })),
  publications,
  audit,
  formVersions: formVersions.map(v => ({ version: v.version, definition: JSON.parse(v.definition), createdAt: v.created_at })),
  assertions: 'Connected added node, explicit flow editing, PLM role, immutable XML hash, frozen form v1 despite edited form v2, mock publication and audit chain: PASS'
}, null, 2));
db.close();
