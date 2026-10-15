import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, CheckCircle2, Layers3, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiJson, jsonRequest, type AuthUser, type UserScope } from './api'
import './tenants.css'

type Props = {
  currentUser: AuthUser
  scopes: UserScope[]
  onScopesChange: (scopes: UserScope[]) => void
  onSwitchScope: (accountId: string) => void
  onToast: (message: string) => void
}

export default function TenantAdmin({ currentUser, scopes, onScopesChange, onSwitchScope, onToast }: Props) {
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const loadScopes = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await apiJson<{ scopes: UserScope[] }>('/api/auth/scopes')
      onScopesChange(result.scopes ?? [])
    } catch (value) { setError(value instanceof Error ? value.message : '无法读取当前账号的组织与账套范围。') }
    finally { setLoading(false) }
  }, [onScopesChange])
  useEffect(() => { void loadScopes() }, [loadScopes])

  const submit = async (event: FormEvent<HTMLFormElement>, kind: 'tenant' | 'organization' | 'account') => {
    event.preventDefault(); setBusy(kind); setError('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const payload = kind === 'tenant'
      ? { tenantName: String(form.get('tenantName')).trim(), organizationName: String(form.get('organizationName')).trim(), accountName: String(form.get('accountName')).trim() }
      : kind === 'organization'
        ? { organizationName: String(form.get('organizationName')).trim(), accountName: String(form.get('accountName')).trim() }
        : { accountName: String(form.get('accountName')).trim() }
    const endpoint = kind === 'tenant' ? '/api/auth/tenants' : kind === 'organization' ? '/api/auth/organizations' : '/api/auth/accounts'
    try {
      await apiJson(endpoint, jsonRequest('POST', payload))
      formElement.reset()
      await loadScopes()
      onToast(kind === 'tenant' ? '租户、组织与首个账套已创建，平台管理员已获得访问范围。' : kind === 'organization' ? '组织与首个账套已创建。' : '新账套已创建。')
    } catch (value) { setError(value instanceof Error ? value.message : '配置创建失败，请检查名称与权限。') }
    finally { setBusy('') }
  }

  return <div className="tenant-admin-page">
    <header className="tenant-admin-heading"><div><span className="tenant-admin-overline"><ShieldCheck size={14}/> TENANCY CONTROL PLANE</span><h1>租户、组织与账套</h1><p>首次启动可先创建平台管理员；真实企业资料在此补充。每个业务请求都将绑定当前会话中的已验证范围。</p></div><button className="tenant-refresh" type="button" onClick={() => void loadScopes()} disabled={loading}><RefreshCw size={15}/>刷新范围</button></header>
    <div className="tenant-scope-banner"><span className="tenant-banner-icon"><ShieldCheck size={18}/></span><div><b>平台管理员已验证</b><span>当前管理账号：{currentUser.displayName} · {currentUser.email}。初始“平台管理”范围仅用于登录和配置，不要求预先知道真实企业名称。</span></div><span className="tenant-banner-count">{scopes.length} 个可访问范围</span></div>
    {error && <div className="tenant-error" role="alert">{error}</div>}
    <div className="tenant-admin-grid">
      <section className="tenant-card tenant-form-card"><header><span className="tenant-icon tenant-icon-blue"><Building2 size={17}/></span><div><span className="tenant-admin-overline">NEW TENANT</span><h2>创建企业租户</h2></div></header><p>为新企业一次建立租户、首个组织和首个账套。平台管理员将自动获得该账套管理员权限，之后可切换并管理成员。</p><form onSubmit={event => void submit(event, 'tenant')}><label>企业 / 租户名称<input name="tenantName" required maxLength={100} placeholder="例如：星河科技"/></label><label>首个组织名称<input name="organizationName" required maxLength={100} placeholder="例如：研发中心"/></label><label>首个账套名称<input name="accountName" required maxLength={100} placeholder="例如：主账套"/></label><button disabled={busy !== ''}><Plus size={15}/>{busy === 'tenant' ? '创建中…' : '创建租户与首个账套'}</button></form></section>
      <div className="tenant-side-stack">
        <section className="tenant-card tenant-form-card"><header><span className="tenant-icon tenant-icon-mint"><Layers3 size={17}/></span><div><span className="tenant-admin-overline">CURRENT TENANT</span><h2>新增组织与账套</h2></div></header><p>在当前已选租户下新增组织，并同时创建该组织的第一个账套。</p><div className="tenant-context">当前租户 <b>{currentUser.tenantName}</b></div><form className="tenant-inline-form" onSubmit={event => void submit(event, 'organization')}><label>组织名称<input name="organizationName" required maxLength={100} placeholder="例如：制造工程部"/></label><label>首个账套名称<input name="accountName" required maxLength={100} placeholder="例如：制造账套"/></label><button disabled={busy !== ''}><Plus size={14}/>{busy === 'organization' ? '创建中…' : '新增组织'}</button></form></section>
        <section className="tenant-card tenant-form-card"><header><span className="tenant-icon tenant-icon-violet"><Layers3 size={17}/></span><div><span className="tenant-admin-overline">CURRENT ORGANIZATION</span><h2>新增账套</h2></div></header><p>在当前组织下新增账套，平台管理员自动加入该账套。</p><div className="tenant-context">当前组织 <b>{currentUser.organizationName}</b></div><form className="tenant-inline-form" onSubmit={event => void submit(event, 'account')}><label>账套名称<input name="accountName" required maxLength={100} placeholder="例如：研发主账套"/></label><button disabled={busy !== ''}><Plus size={14}/>{busy === 'account' ? '创建中…' : '新增账套'}</button></form></section></div>
    </div>
    <section className="tenant-card tenant-scope-list"><header><div><span className="tenant-admin-overline">AUTHORIZED WORKSPACES</span><h2>已授权的租户 / 组织 / 账套</h2></div><span className="tenant-scope-total">{scopes.length} 个范围</span></header>{loading ? <div className="tenant-empty">正在读取服务端授权范围…</div> : scopes.length ? <div className="tenant-scope-table"><div className="tenant-scope-row tenant-scope-table-head"><span>租户</span><span>组织</span><span>账套</span><span>当前身份</span><span>操作</span></div>{scopes.map(scope => <div className="tenant-scope-row" key={scope.membershipId}><span className="tenant-name-cell"><i>{scope.tenantName.slice(0, 1)}</i><b>{scope.tenantName}</b></span><span>{scope.organizationName}</span><span>{scope.accountName}</span><span className="tenant-role-cell">{scope.role === 'admin' ? '管理员' : scope.role === 'plm_manager' ? 'PLM 管理员' : scope.role === 'reviewer' ? '审批人' : '成员'}</span><span>{scope.accountId === currentUser.accountId ? <i className="tenant-current"><CheckCircle2 size={13}/> 当前范围</i> : <button className="tenant-switch" type="button" onClick={() => onSwitchScope(scope.accountId)}>切换至此账套</button>}</span></div>)}</div> : <div className="tenant-empty">当前账号尚无可访问的业务账套。</div>}</section>
    <p className="tenant-security-note"><ShieldCheck size={14}/>范围 ID 由服务端会话和成员关系验证。客户端提交的 `X-Tenant-ID`、`X-Organization-ID`、`X-Account-ID` 只用于一致性校验，不能通过修改请求头越权切换数据。</p>
  </div>
}
