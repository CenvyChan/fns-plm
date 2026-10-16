import { getAuthStatus, getCurrentUser, isApiBaseConfigured, mobileDingTalkLogin, mobileLogin, switchScope } from '../../utils/api';

Page({
  data: { email: '', password: '', busy: false, error: '', scopes: [], selectedScopeIndex: 0, selectedAccountId: '', selectedAccountName: '', pendingUser: null, apiBaseConfigured: false, statusLoaded: false, statusUnavailable: false, ssoConfigured: false, setupRequired: false, usePassword: false },
  onLoad() {
    const apiBaseConfigured = isApiBaseConfigured();
    this.setData({ apiBaseConfigured, statusLoaded: !apiBaseConfigured });
    if (!apiBaseConfigured) return;
    getCurrentUser().then((user) => {
      getApp().globalData.user = user;
      dd.redirectTo({ url: '/pages/home/index' });
    }).catch(() => {});
    getAuthStatus().then((status) => {
      const ssoConfigured = Boolean(status && status.dingtalkSso && status.dingtalkSso.configured);
      this.setData({ statusLoaded: true, ssoConfigured, setupRequired: Boolean(status && status.setupRequired) });
    }).catch((err) => this.setData({ statusLoaded: true, statusUnavailable: true, error: err.message || '无法连接工作区服务' }));
  },
  onEmailInput(e) { this.setData({ email: e.detail.value || '' }); },
  onPasswordInput(e) { this.setData({ password: e.detail.value || '' }); },
  showPasswordLogin() { this.setData({ usePassword: true, error: '' }); },
  hidePasswordLogin() { this.setData({ usePassword: false, password: '', error: '' }); },
  onScopeChange(e) {
    const index = Number(e.detail.value || 0), scope = this.data.scopes[index];
    if (scope) this.setData({ selectedScopeIndex: index, selectedAccountId: scope.accountId, selectedAccountName: scope.accountName });
  },
  onDingTalkLogin() {
    if (this.data.busy || !this.data.ssoConfigured) return;
    this.setData({ busy: true, error: '' });
    dd.getAuthCode({
      success: (result) => {
        const authCode = result && (result.authCode || result.code);
        if (!authCode) { this.setData({ error: '钉钉未返回一次性授权码，请重试', busy: false }); return; }
        mobileDingTalkLogin(authCode).then((loginResult) => this.acceptLogin(loginResult))
          .catch((err) => this.setData({ error: err.message || '钉钉身份验证失败', busy: false }));
      },
      fail: (err) => this.setData({ error: (err && (err.errorMessage || err.message)) || '无法获取钉钉免登授权码，请确认已在钉钉客户端打开', busy: false })
    });
  },
  acceptLogin(result) {
    const scopes = result.scopes || [], selectedScopeIndex = Math.max(0, scopes.findIndex(scope => scope.accountId === result.user.accountId));
    const scope = scopes[selectedScopeIndex];
    this.setData({ password: '', pendingUser: result.user, scopes, selectedScopeIndex, selectedAccountId: scope && scope.accountId || result.user.accountId, selectedAccountName: scope && scope.accountName || result.user.accountName, busy: false });
    if (scopes.length <= 1) this.finishLogin(result.user);
  },
  submit() {
    if (!this.data.email.trim() || !this.data.password) {
      this.setData({ error: '请输入企业邮箱和个人密码' }); return;
    }
    this.setData({ busy: true, error: '' });
    mobileLogin(this.data.email, this.data.password).then((result) => this.acceptLogin(result))
      .catch((err) => this.setData({ error: err.message || '登录失败；新成员请先完成个人密码激活', busy: false }));
  },
  finishLogin(value) {
    const user = value && typeof value.accountId === 'string' ? value : this.data.pendingUser;
    if (!user) return;
    const target = this.data.selectedAccountId;
    this.setData({ busy: true, error: '' });
    const operation = target && user.accountId !== target ? switchScope(target) : Promise.resolve(user);
    operation.then((activeUser) => {
      getApp().globalData.user = activeUser;
      dd.redirectTo({ url: '/pages/home/index' });
    }).catch((err) => this.setData({ error: err.message || '切换账套失败', busy: false }));
  }
});
