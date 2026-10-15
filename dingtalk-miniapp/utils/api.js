// 仅替换为已部署、启用 HTTPS 且已登记在钉钉小程序安全域名中的服务端地址。
const API_BASE_URL = 'https://YOUR-APP-DOMAIN';
const TOKEN_KEY = 'momentum.mobile-token';
const SCOPE_KEY = 'momentum.verified-scope';

function readToken() {
  try {
    const value = dd.getStorageSync({ key: TOKEN_KEY });
    if (typeof value === 'string') return value;
    if (value && typeof value.data === 'string') return value.data;
    return '';
  } catch (_) { return ''; }
}

function writeToken(token) {
  if (!token) throw new Error('服务端未返回移动端访问凭证');
  dd.setStorageSync({ key: TOKEN_KEY, data: token });
}

function readScope() {
  try {
    const value = dd.getStorageSync({ key: SCOPE_KEY });
    const raw = value && typeof value.data === 'string' ? value.data : value;
    const scope = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return scope && scope.tenantId && scope.organizationId && scope.accountId ? scope : null;
  } catch (_) { return null; }
}

function writeScope(user) {
  if (!user || !user.tenantId || !user.organizationId || !user.accountId) throw new Error('服务端未返回完整的租户/组织/账套范围');
  dd.setStorageSync({ key: SCOPE_KEY, data: JSON.stringify({ tenantId: user.tenantId, organizationId: user.organizationId, accountId: user.accountId }) });
}

export function clearSession() {
  try { dd.removeStorageSync({ key: TOKEN_KEY }); } catch (_) { /* ignore local storage failure */ }
  try { dd.removeStorageSync({ key: SCOPE_KEY }); } catch (_) { /* ignore local storage failure */ }
}

function request(path, method = 'GET', data, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    const token = options.auth === false ? '' : readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const scope = token ? readScope() : null;
    if (scope) {
      headers['X-Tenant-ID'] = scope.tenantId;
      headers['X-Organization-ID'] = scope.organizationId;
      headers['X-Account-ID'] = scope.accountId;
    }
    dd.httpRequest({
      url: `${API_BASE_URL}${path}`,
      method,
      headers,
      ...(data === undefined ? {} : { data }),
      dataType: 'json',
      success: (res) => {
        const status = Number(res.status || res.statusCode || 0);
        const body = res.data;
        if (status >= 200 && status < 300) return resolve(body);
        if (status === 401 && options.auth !== false) clearSession();
        const message = body && (body.message || body.error);
        reject(new Error(message || `请求失败（${status || '未知状态'}）`));
      },
      fail: (err) => reject(new Error((err && (err.errorMessage || err.message)) || '无法连接工作区服务'))
    });
  });
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tasks)) return data.tasks;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export function mobileLogin(email, password, accountId) {
  return request('/api/auth/mobile/login', 'POST', {
    email: String(email || '').trim(), password,
    ...(accountId ? { accountId } : {})
  }, { auth: false }).then((result) => {
    if (!result || !result.accessToken || !result.user) throw new Error('登录响应缺少移动端会话信息');
    writeToken(result.accessToken);
    writeScope(result.user);
    return result;
  });
}

export function getAuthStatus() {
  return request('/api/auth/status', 'GET', undefined, { auth: false });
}

export function mobileDingTalkLogin(authCode, accountId) {
  return request('/api/auth/dingtalk/mobile-login', 'POST', {
    authCode: String(authCode || ''),
    ...(accountId ? { accountId } : {})
  }, { auth: false }).then((result) => {
    if (!result || !result.accessToken || !result.user) throw new Error('钉钉登录响应缺少移动端会话信息');
    writeToken(result.accessToken);
    writeScope(result.user);
    return result;
  });
}

export function getCurrentUser() {
  if (!readToken()) return Promise.reject(new Error('尚未登录'));
  return request('/api/auth/me').then((result) => {
    if (result && result.user) writeScope(result.user);
    return result && result.user;
  });
}

export function switchScope(accountId) {
  return request('/api/auth/switch-scope', 'POST', { accountId }).then((result) => {
    if (result && result.user) writeScope(result.user);
    return result && result.user;
  });
}

export function logout() {
  return request('/api/auth/logout', 'POST', {}).catch(() => null).then(() => clearSession());
}

export function getTasks() {
  return request('/api/workflow/tasks').then(normalizeList);
}

export function getTask(id) {
  return request(`/api/workflow/tasks/${encodeURIComponent(id)}`);
}

// 操作者身份由服务端会话与账套内的 Flowable 用户映射推导，客户端不得指定 actor。
export function completeTask(id, decision, comment) {
  return request(`/api/workflow/tasks/${encodeURIComponent(id)}/complete`, 'POST', {
    decision, comment: String(comment || '').trim()
  });
}

export function getReportPreview(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return request(`/api/reports/preview${query ? `?${query}` : ''}`);
}
