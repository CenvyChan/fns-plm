import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CustomProcessStartPanel from '../../src/CustomProcessStartPanel'
const user = { id: 'local-user', email: 'local@example.test', displayName: 'Local Test', role: 'admin' as const, disabled: false, createdAt: '', isPlatformAdmin: false, tenantId: 'local-tenant', tenantName: 'Local', organizationId: 'local-org', organizationName: 'Local', accountId: 'local-account', accountName: 'Local', membershipId: 'local-membership' }
const mode = new URLSearchParams(location.search).get('mode') || 'success'
const calls: string[] = [], submissions: Record<string, unknown>[] = []
let releaseOld: (outcome: string) => void = () => { throw Error('old request not pending') }
let contextCount = 0, oldCompleted = false
const response = (version: number) => new Response(JSON.stringify({ canStart: true, engineMode: 'mock-test', publishedVersion: version, versionId: `immutable-v${version}`, formBindings: [{ nodeId: 'Review', formKey: 'pinnedForm', formVersion: version - 5 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
;(window as any).__test = { calls, submissions, releaseOld: (outcome: string) => releaseOld(outcome), get oldCompleted() { return oldCompleted } }
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input)
  // No network fallback: every API request is an in-memory fixture response.
  if (path.endsWith('/start-context')) {
    calls.push(path); const ordinal = ++contextCount
    if (ordinal === 2 && mode !== 'late-post') {
      const outcome = await new Promise<string>(resolve => { releaseOld = resolve })
      oldCompleted = true
      if (outcome === 'network-error') throw Error('stale transport failure')
      if (outcome === 'http-error') return new Response('{}', { status: 503 })
      if (outcome === 'json-error') return new Response('not-json', { status: 200 })
      return response(8)
    }
    return response(ordinal === 1 ? 7 : 9)
  }
  if (path.endsWith('/start')) {
    submissions.push(JSON.parse(String(init?.body)))
    if (submissions.length === 1) {
      if (mode === 'late-post') {
        await new Promise<string>(resolve => { releaseOld = resolve })
        oldCompleted = true
      }
      return new Response(JSON.stringify({ error: 'published_version_changed' }), { status: 409 })
    }
    return new Response(JSON.stringify({ processInstanceId: 'local-latest-v9' }), { status: 201 })
  }
  throw Error(`Unexpected fixture request: ${path}`)
}
function Fixture() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [accountId, setAccountId] = useState(user.accountId)
  const [modelId, setModelId] = useState('local-model')
  return <><button onClick={() => setRefreshKey(value => value + 1)}>刷新测试上下文</button><button onClick={() => setAccountId(value => value === user.accountId ? 'other-account' : user.accountId)}>切换测试账套</button><button onClick={() => setModelId(value => value === 'local-model' ? 'other-model' : 'local-model')}>切换测试模型</button><CustomProcessStartPanel modelId={modelId} currentUser={{ ...user, accountId }} refreshKey={refreshKey} /></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
