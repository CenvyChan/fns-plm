import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Clipboard, KeyRound, Link2, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { apiJson, jsonRequest } from './api'
import './users.css'

type Role = 'admin' | 'plm_manager' | 'reviewer' | 'member'
type AppUser = {
  id: string; email: string; displayName: string; role: Role; disabled: boolean; createdAt: string
  passwordEnabled?: boolean; isPlatformAdmin?: boolean; dingtalkUserId?: string | null; dingtalkUnionId?: string | null
}
type ActivationLink = { email: string; url: string; expiresAt?: string }
const roleNames: Record<Role, string> = { admin: '系统管理员', plm_manager: 'PLM 管理员', reviewer: '审批人', member: '成员' }

export default function UserAdmin({ currentUser, onToast }: { currentUser: AppUser; onToast: (message: string) => void }) {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activationLink, setActivationLink] = useState<ActivationLink | null>(null)
  const [bindingFor, setBindingFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const body = await apiJson<{ users: AppUser[] }>('/api/auth/users')
      setUsers(body.users ?? [])
    } catch (value) { setError(value instanceof Error ? value.message : '无法读取用户列表') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const showActivationLink = (email: string, token: string, expiresAt?: string) => {
    const url = new URL('/', window.location.origin)
    url.hash = `activate=${encodeURIComponent(token)}`
    setActivationLink({ email, url: url.toString(), expiresAt })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(''); setActivationLink(null)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const payload = { displayName: String(form.get('displayName')).trim(), email: String(form.get('email')).trim(), role: String(form.get('role')) }
    try {
      const result = await apiJson<{ user: AppUser; activationToken?: string; activationExpiresAt?: string }>('/api/auth/users', jsonRequest('POST', payload))
      formElement.reset(); await load()
      if (result.activationToken) {
        showActivationLink(payload.email, result.activationToken, result.activationExpiresAt)
        onToast('成员已创建；请通过单独的安全渠道交付一次性激活链接')
      } else onToast('成员已加入当前账套；其原有登录凭证保持不变')
    } catch (value) { setError(value instanceof Error ? value.message : '创建用户失败') }
    finally { setSaving(false) }
  }

  const update = async (user: AppUser, patch: Record<string, unknown>): Promise<boolean> => {
    setError('')
    try {
      await apiJson(`/api/auth/users/${encodeURIComponent(user.id)}`, jsonRequest('PATCH', patch))
      await load(); onToast('用户资料已更新')
      return true
    } catch (value) { setError(value instanceof Error ? value.message : '更新用户失败'); return false }
  }

  const resetActivation = async (user: AppUser) => {
    setError(''); setActivationLink(null)
    try {
      const result = await apiJson<{ activationToken: string; activationExpiresAt: string }>(`/api/auth/users/${encodeURIComponent(user.id)}/activation`, jsonRequest('POST'))
      showActivationLink(user.email, result.activationToken, result.activationExpiresAt)
      await load(); onToast('已生成新的单次激活链接；旧密码会话已撤销')
    } catch (value) { setError(value instanceof Error ? value.message : '生成激活链接失败') }
  }

  const saveBinding = async (event: FormEvent<HTMLFormElement>, user: AppUser) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const ok = await update(user, { dingtalkUserId: String(form.get('dingtalkUserId') ?? '').trim(), dingtalkUnionId: String(form.get('dingtalkUnionId') ?? '').trim() })
    if (ok) setBindingFor(null)
  }

  const copyActivationLink = async () => {
    if (!activationLink) return
    try { await navigator.clipboard.writeText(activationLink.url); onToast('激活链接已复制') }
    catch { setError('无法自动复制，请手动选择并复制激活链接。') }
  }

  return <div className="users-page">
    <header className="users-heading"><div><span className="users-overline"><ShieldCheck size={14}/> ACCESS CONTROL</span><h1>账号与权限</h1><p>管理本企业工作区的登录账号、角色和访问状态。权限由服务端强制校验。</p></div><button className="users-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>刷新</button></header>
    <div className="users-summary"><div><Users size={18}/><span>账号</span><b>{users.length}</b></div><div><ShieldCheck size={18}/><span>启用</span><b>{users.filter(user => !user.disabled).length}</b></div><div className="current-user-chip"><span className="user-avatar">{currentUser.displayName.slice(0, 1)}</span><span>当前账号</span><b>{currentUser.displayName}</b><small>{roleNames[currentUser.role]}</small></div></div>
    {error && <div className="users-error" role="alert">{error}</div>}
    {activationLink && <section className="activation-link-card" aria-live="polite"><div><b>一次性密码激活链接</b><p>收件人：{activationLink.email}。此链接仅显示一次，请通过企业认可的安全渠道单独交付；不得在群聊中公开发送。</p></div><div className="activation-link-row"><input aria-label="一次性激活链接" readOnly value={activationLink.url} onFocus={event => event.currentTarget.select()}/><button type="button" onClick={() => void copyActivationLink()}><Clipboard size={15}/>复制</button></div><small>48 小时内有效，使用后立即失效{activationLink.expiresAt ? ` · 截止 ${new Date(activationLink.expiresAt).toLocaleString('zh-CN')}` : ''}</small></section>}
    <div className="users-grid">
      <section className="users-card"><header><div><span className="users-overline">ACCOUNT DIRECTORY</span><h2>工作区成员</h2></div><span className="users-count">{users.length} 个账号</span></header>
        {loading ? <div className="users-empty">正在加载账号…</div> : <div className="user-list">{users.map(user => <article className={`user-row ${user.disabled ? 'user-disabled' : ''}`} key={user.id}>
          <div className="user-avatar">{user.displayName.slice(0, 1)}</div>
          <div className="user-main"><b>{user.displayName}{user.id === currentUser.id && <small className="you-label">你</small>}</b><span>{user.email}</span><small>创建于 {new Date(user.createdAt).toLocaleDateString('zh-CN')} · {user.passwordEnabled ? '密码已激活' : '待设置个人密码'}{user.dingtalkUserId || user.dingtalkUnionId ? ' · 已绑定钉钉' : ''}</small></div>
          <div className="user-actions"><select aria-label={`${user.displayName}角色`} value={user.role} disabled={saving} onChange={event => void update(user, { role: event.target.value })}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className={`user-status ${user.disabled ? 'is-disabled' : ''}`} disabled={user.id === currentUser.id} onClick={() => void update(user, { disabled: !user.disabled })}>{user.disabled ? '已停用' : '启用中'}</button>
            {currentUser.isPlatformAdmin && !user.disabled && user.id !== currentUser.id && <button className="reset-password-button" onClick={() => void resetActivation(user)}><KeyRound size={14}/>{user.passwordEnabled ? '重置个人密码' : '重新生成激活'}</button>}
            {currentUser.isPlatformAdmin && <button className="reset-password-button" onClick={() => setBindingFor(bindingFor === user.id ? null : user.id)}><Link2 size={14}/>{user.dingtalkUserId || user.dingtalkUnionId ? '管理钉钉绑定' : '绑定钉钉'}</button>}
          </div>
          {bindingFor === user.id && currentUser.isPlatformAdmin && <form className="dingtalk-binding-form" onSubmit={event => void saveBinding(event, user)}><div><b>钉钉身份绑定</b><small>只绑定管理员从可信钉钉通讯录核验的 ID；登录不会自动创建用户或分配角色。</small></div><label>钉钉 userId<input name="dingtalkUserId" defaultValue={user.dingtalkUserId ?? ''} maxLength={128} autoComplete="off" placeholder="由企业管理员核验后填写"/></label><label>钉钉 unionId<input name="dingtalkUnionId" defaultValue={user.dingtalkUnionId ?? ''} maxLength={128} autoComplete="off" placeholder="可选；需确保属于同一员工"/></label><button type="submit" disabled={saving}>保存身份绑定</button></form>}
        </article>)}</div>}
      </section>
      <section className="users-card users-create-card"><header><div><span className="users-overline">INVITE A TEAMMATE</span><h2>创建账号</h2></div><UserPlus size={20}/></header><p className="users-card-intro">成员通过一次性激活链接自行设密，不使用共享初始密码。</p><form className="users-create-form" onSubmit={submit}><label>姓名<input name="displayName" required maxLength={80} placeholder="例如：林工"/></label><label>企业邮箱<input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="name@company.com"/></label><label>角色<select name="role" defaultValue="member">{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="role-help"><b>角色说明</b><span><strong>系统管理员</strong>：全局配置、用户和报表发送</span><span><strong>PLM 管理员</strong>：物料、BOM、KPI 规则与业务流程</span><span><strong>审批人</strong>：绩效评审和审批待办</span><span><strong>成员</strong>：任务与项目协作、PLM 查询</span><span>激活链接 48 小时有效且只能使用一次；重设链接会撤销现有会话。</span></div><button className="users-create-submit" disabled={saving}><UserPlus size={16}/>{saving ? '创建中…' : '创建并生成激活链接'}</button></form></section>
    </div>
  </div>
}
