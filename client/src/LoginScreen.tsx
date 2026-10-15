import { useEffect, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Fingerprint, LockKeyhole, Mail, Sparkles, UserRound } from 'lucide-react'
import { apiJson, getApiBaseUrl, isNativeApp, jsonRequest, setApiBaseUrl, setApiToken, type AuthUser, type UserScope } from './api'
import './login.css'

type AuthResult = { user: AuthUser; scopes: UserScope[]; accessToken?: string; expiresIn?: number }
type Props = { setupRequired: boolean; apiError?: string; onAuthenticated: (result: AuthResult) => void; onRetry: () => void }

export default function LoginScreen({ setupRequired, apiError, onAuthenticated, onRetry }: Props) {
  const nativeApp = isNativeApp()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activationToken, setActivationToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('activate') ?? '')
  const [activationPassword, setActivationPassword] = useState('')
  const [confirmActivationPassword, setConfirmActivationPassword] = useState('')
  const [dingtalkConfigured, setDingtalkConfigured] = useState(false)
  const [apiBase, setApiBase] = useState(getApiBaseUrl())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const activationMode = activationToken.length > 0

  useEffect(() => {
    let active = true
    apiJson<{ dingtalkSso?: { configured?: boolean } }>('/api/auth/status').then(status => { if (active) setDingtalkConfigured(Boolean(status.dingtalkSso?.configured)) }).catch(() => {})
    return () => { active = false }
  }, [])

  const activatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('')
    if (activationPassword !== confirmActivationPassword) { setError('两次输入的新密码不一致。'); return }
    setBusy(true)
    try {
      await apiJson('/api/auth/activate', jsonRequest('POST', { token: activationToken, password: activationPassword }))
      setActivationToken(''); setActivationPassword(''); setConfirmActivationPassword('')
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      setNotice('个人密码已设置。请使用企业邮箱和刚设置的密码登录。')
    } catch (value) { setError(value instanceof Error ? value.message : '激活失败，请联系管理员重新生成链接。') }
    finally { setBusy(false) }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('')
    if (nativeApp) {
      try { setApiBaseUrl(apiBase) } catch (value) { setError(value instanceof Error ? value.message : '服务器地址无效。'); return }
      if (!apiBase.trim()) { setError('请先填写已部署 Momentum 服务的 HTTPS 地址。'); return }
    }
    if (setupRequired && password !== confirmPassword) { setError('两次输入的密码不一致。'); return }
    setBusy(true)
    try {
      const endpoint = setupRequired
        ? `/api/auth/${nativeApp ? 'mobile/setup' : 'setup'}`
        : `/api/auth/${nativeApp ? 'mobile/login' : 'login'}`
      const payload = {
        email, password,
        ...(setupRequired ? { displayName } : {}),
      }
      const result = await apiJson<AuthResult>(endpoint, jsonRequest('POST', payload))
      if (nativeApp) setApiToken(result.accessToken ?? '')
      onAuthenticated(result)
    } catch (value) { setError(value instanceof Error ? value.message : '登录失败，请稍后重试。') }
    finally { setBusy(false) }
  }

  return <main className="login-shell">
    <section className="login-panel">
      <a className="login-brand" href="/" aria-label="Momentum 企业工作台首页"><span className="login-mark"><i/><i/><i/></span><span>momentum<span className="login-brand-dot">.</span></span></a>
      <motion.div className="login-content" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
        <div className="login-kicker"><span/> ENTERPRISE WORKSPACE</div>
        <h1>{activationMode ? <>设置个人密码<br/><em>安全激活账号。</em></> : setupRequired ? <>创建平台管理员<br/><em>开启管理工作区。</em></> : <>欢迎回来<span>，</span><br/>继续推进重要的事。</>}</h1>
        <p className="login-subtitle">{activationMode ? '这是一次性激活链接。请设置仅你本人使用的密码；链接使用后即失效。' : setupRequired ? '首次启动只需填写管理员信息。登录后可在后台创建真实企业租户、组织与账套，再邀请成员加入。' : '使用管理员为你创建的企业账号登录工作区。'}</p>
        <div className="login-demo-note"><Fingerprint size={15}/><span><b>{activationMode ? '一次性成员激活' : setupRequired ? '平台管理员首次初始化' : '安全会话登录'}</b><small>{activationMode ? '密码在服务端使用 scrypt 哈希保存；激活链接 48 小时内有效且仅能使用一次。' : nativeApp ? '移动端通过短期 Bearer token 访问受保护 API；服务器地址保存在此设备。' : setupRequired ? '系统会先创建隔离的管理工作区；企业数据范围稍后在后台配置。密码以 scrypt 哈希保存。' : '会话由服务端验证并通过 HttpOnly Cookie 保存；权限以服务端校验为准。'}</small></span></div>
        {apiError && <div className="login-error" role="alert">{apiError}<button type="button" onClick={onRetry}>重试连接</button></div>}
        {error && <div className="login-error" role="alert">{error}</div>}
        {notice && <div className="login-notice" role="status">{notice}</div>}
        <form className="login-form" onSubmit={activationMode ? activatePassword : submit}>
          {activationMode ? <>
            <label>新个人密码<span className="login-input-wrap"><LockKeyhole size={16}/><input type="password" autoComplete="new-password" value={activationPassword} onChange={event => setActivationPassword(event.target.value)} placeholder="至少 12 位" required minLength={12} maxLength={200}/></span></label>
            <label>确认新密码<span className="login-input-wrap"><LockKeyhole size={16}/><input type="password" autoComplete="new-password" value={confirmActivationPassword} onChange={event => setConfirmActivationPassword(event.target.value)} placeholder="再次输入密码" required minLength={12} maxLength={200}/></span></label>
            <button type="submit" className="login-submit" disabled={busy}>{busy ? '正在激活…' : '设置个人密码'} <ArrowRight size={16}/></button>
          </> : <>
            {nativeApp && <label>服务器 HTTPS 地址<span className="login-input-wrap"><span className="login-url-mark">↗</span><input type="url" inputMode="url" autoComplete="url" value={apiBase} onChange={event => setApiBase(event.target.value)} placeholder="https://plm.company.com" required/></span></label>}
            {setupRequired && <label>管理员姓名<span className="login-input-wrap"><UserRound size={16}/><input type="text" autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="例如：陈工" required maxLength={80}/></span></label>}
            <label>企业邮箱<span className="login-input-wrap"><Mail size={16}/><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" required maxLength={254}/></span></label>
            <label>{setupRequired ? '设置密码' : '密码'}<span className="login-input-wrap"><LockKeyhole size={16}/><input type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={setupRequired ? '至少 12 位' : '请输入密码'} required minLength={setupRequired ? 12 : 1} maxLength={200}/></span></label>
            {setupRequired && <label>确认密码<span className="login-input-wrap"><LockKeyhole size={16}/><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required minLength={12} maxLength={200}/></span></label>}
            {!setupRequired && <div className="login-options"><span className="login-remember"><Check size={13}/> 仅限已创建账号</span><button type="button" className="login-text-button" onClick={() => setNotice('请联系平台管理员生成一次性密码激活链接；目前未配置外部邮件找回服务。')}>忘记密码？</button></div>}
            <button type="submit" className="login-submit" disabled={busy}>{busy ? '请稍候…' : setupRequired ? '创建平台管理员并进入' : '安全登录'} <ArrowRight size={16}/></button>
          </>}
        </form>
        {!nativeApp && !activationMode && <div className="login-sso" title="钉钉免登仅支持在钉钉小程序客户端中完成"><span className="dingtalk-mark">钉</span><span>钉钉免登仅支持钉钉小程序</span><small>{dingtalkConfigured ? '服务端已配置' : '服务端未配置'}</small></div>}
        <p className="login-footnote">工作区数据保存在服务端；成员密码由本人设置，请勿共享密码或在公共设备保存。</p>
      </motion.div>
      <div className="login-legal"><span>© Momentum Workspace</span><span>安全 · 协作 · 可追溯</span></div>
    </section>
    <aside className="login-visual">
      <div className="login-orbit orbit-one"/><div className="login-orbit orbit-two"/><div className="login-orbit orbit-three"/>
      <div className="login-visual-top"><span><Sparkles size={14}/> 产品研发，一目了然</span><span className="login-secure-mark"><Check size={12}/> 服务端认证</span></div>
      <div className="login-hero-copy"><span className="login-eyebrow">ONE SPACE FOR PRODUCT TEAMS</span><h2>让复杂协作，<br/><em>轻盈而有序。</em></h2><p>从个人待办到企业 PLM，连接目标、物料、BOM 与文档，让每一步都有迹可循。</p></div>
      <motion.div className="login-preview-card" initial={{ opacity: 0, y: 18, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: .12, duration: .5 }}>
        <div className="login-preview-head"><div><span className="preview-eyebrow">PRODUCT TEAM WORKSPACE</span><b>受保护的工作区</b></div><span className="preview-live"><i/>身份已验证</span></div>
        <div className="preview-metrics"><div><small>项目与任务</small><b>协作</b><span>共享记录，服务端持久化</span></div><div><small>PLM 主数据</small><b>受控</b><span><Check size={12}/> 角色权限校验</span></div></div>
        <div className="preview-project"><div className="preview-project-head"><span>业务数据安全</span><small>所有请求需登录</small></div><div className="preview-project-row"><i className="project-icon p-purple">M</i><span><b>组织工作区</b><small>账号、角色与业务数据分离</small></span><strong>01</strong></div><div className="preview-bar"><i style={{ width: '72%' }}/></div><div className="preview-project-row"><i className="project-icon p-green">P</i><span><b>产品生命周期</b><small>物料 · BOM · 图文档 · 审批</small></span><strong>PLM</strong></div><div className="preview-bar green"><i style={{ width: '48%' }}/></div></div>
      </motion.div>
      <div className="login-visual-bottom"><span>DESIGNED FOR FOCUSED TEAMS</span><span>01 — 04</span></div>
    </aside>
  </main>
}
