import 'dotenv/config'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { completeTask, health, listTasks, startProcess } from '../dist/integrations/flowable.js'

function fail(message) { throw new Error(message) }

async function main() {
  const baseUrl = (process.env.FLOWABLE_BASE_URL ?? '').trim()
  const username = process.env.FLOWABLE_USERNAME
  const password = process.env.FLOWABLE_PASSWORD
  if (!baseUrl || !username || !password) {
    fail('Set FLOWABLE_BASE_URL, FLOWABLE_USERNAME and FLOWABLE_PASSWORD before running the Flowable E2E check.')
  }

  let parsedUrl
  try { parsedUrl = new URL(baseUrl) } catch { fail('FLOWABLE_BASE_URL is invalid.') }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (!loopbackHosts.has(parsedUrl.hostname) && process.env.FLOWABLE_E2E_ALLOW_REMOTE !== 'true') {
    fail('Refusing a non-loopback Flowable target; set FLOWABLE_E2E_ALLOW_REMOTE=true only for an explicitly authorized test environment.')
  }

  const config = { baseUrl, username, password }
  const status = await health(config)
  if (!status.connected) {
    fail('Flowable health check failed. Verify Basic Auth and the complete REST base path; the bundled service uses /flowable-rest/process-api.')
  }

  const tenantId = `e2e-${randomUUID()}`
  const businessKey = `e2e-material-${randomUUID()}`
  const assignee = process.env.FLOWABLE_E2E_ASSIGNEE || username
  const started = await startProcess('materialApproval', [
    { name: 'assignee', value: assignee },
    { name: 'businessId', value: businessKey },
    { name: 'requester', value: 'flowable-e2e' },
  ], { tenantId, businessKey }, config)

  const processInstanceId = String(started?.id ?? '')
  if (!processInstanceId) fail('Flowable did not return a process instance ID.')

  const taskResult = await listTasks({ processInstanceId, tenantId }, config)
  const tasks = Array.isArray(taskResult) ? taskResult : Array.isArray(taskResult?.data) ? taskResult.data : []
  if (!tasks.length || !tasks[0]?.id) fail('The material review task was not created.')

  await completeTask(String(tasks[0].id), {
    actor: 'flowable-e2e',
    decision: 'approved',
    comment: 'Automated Flowable integration verification.',
  }, config)

  const after = await listTasks({ processInstanceId, tenantId }, config)
  const remainingTasks = Array.isArray(after) ? after : Array.isArray(after?.data) ? after.data : []
  if (remainingTasks.length) fail('Flowable still reports an active task after approval.')

  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const definitionUrl = `${baseUrl.replace(/\/$/, '')}/repository/process-definitions?tenantId=${encodeURIComponent(tenantId)}&size=100`
  const definitionResponse = await fetch(definitionUrl, { headers: { Accept: 'application/json', Authorization: authorization } })
  if (!definitionResponse.ok) fail(`Flowable tenant definition verification failed (HTTP ${definitionResponse.status}).`)
  const definitions = await definitionResponse.json()
  const keys = (Array.isArray(definitions?.data) ? definitions.data : []).map((item) => String(item.key ?? ''))
  const requiredKeys = ['materialApproval', 'bomReleaseApproval', 'documentReleaseApproval', 'performanceReviewApproval']
  if (!requiredKeys.every((key) => keys.includes(key))) fail('One or more required PLM BPMN definitions were not deployed for the tenant.')

  const historyUrl = `${baseUrl.replace(/\/$/, '')}/history/historic-process-instances/${encodeURIComponent(processInstanceId)}`
  const historyResponse = await fetch(historyUrl, { headers: { Accept: 'application/json', Authorization: authorization } })
  if (!historyResponse.ok) fail(`Flowable history verification failed (HTTP ${historyResponse.status}).`)
  const historicInstance = await historyResponse.json()
  if (!historicInstance?.endTime) fail('The approval process has no recorded end time.')

  console.log(JSON.stringify({
    health: 'passed',
    tenantDefinitions: keys.length,
    processStarted: true,
    reviewTaskCreated: true,
    approvalCompleted: true,
    activeTasksAfter: remainingTasks.length,
    historyEndTimeConfirmed: true,
  }))
}

main().catch((error) => {
  console.error(`Flowable E2E failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
})
