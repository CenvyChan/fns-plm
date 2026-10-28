import React from 'react'
import { createRoot } from 'react-dom/client'
import CustomProcessStartPanel from '../../src/CustomProcessStartPanel'
const root = createRoot(document.getElementById('root')!)
const user = { id: 'local-user', email: 'local@example.test', displayName: 'Local Test', role: 'admin' as const, disabled: false, createdAt: '', isPlatformAdmin: false, tenantId: 'local-tenant', tenantName: 'Local', organizationId: 'local-org', organizationName: 'Local', accountId: 'local-account', accountName: 'Local', membershipId: 'local-membership' }
;(window as any).__test = { get calls() { return calls }, get submissions() { return submissions } }
let calls: string[] = [], submissions: unknown[] = [], contextCount = 0
const refreshFails = new URLSearchParams(location.search).has('refresh-fails')
const delayedSwitch = new URLSearchParams(location.search).has('delayed-switch')
let selectedModel = 'local-model', renderPanel = () => {}
function render() { root.render(<><button onClick={() => { selectedModel = selectedModel === 'local-model' ? 'other-model' : 'local-model'; renderPanel() }}>切换测试模型</button><CustomProcessStartPanel modelId={selectedModel} currentUser={user} refreshKey={0} /></>) }
renderPanel = render
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input)
  if (path.endsWith('/start-context')) {
    calls.push('GET start-context'); contextCount++
    if (refreshFails && contextCount > 1) return new Response('{}', { status: 503 })
    const v = contextCount === 1 ? 7 : 8, form = v === 7 ? 2 : 3
    return new Response(JSON.stringify({ canStart: true, engineMode: 'mock-test', publishedVersion: v, versionId: `immutable-v${v}`, formBindings: [{ nodeId: 'Review', formKey: 'pinnedForm', formVersion: form }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/start')) {
    const body = JSON.parse(String(init?.body)); submissions.push(body)
    if (delayedSwitch && path.includes('/local-model/')) await new Promise(resolve => setTimeout(resolve, 350))
    if (submissions.length === 1) return new Response(JSON.stringify({ error: 'published_version_changed', message: 'published version changed' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ processInstanceId: 'local-instance-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}
render()
