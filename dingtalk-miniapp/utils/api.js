const TOKEN_KEY = 'momentum.mobile-token';
const SCOPE_KEY = 'momentum.verified-scope';

export function getApiBaseUrl() {
  let raw = '';
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    raw = String((app && app.globalData && app.globalData.apiBaseUrl) || '').trim();
  } catch (_) { /* app bootstrap may not be available yet */ }
  if (!raw || raw.toUpperCase().includes('YOUR-APP-DOMAIN')) {
    throw new Error('工作区 API 地址尚未配置；请在 app.js 的 globalData.apiBaseUrl 中设置已部署服务的 HTTPS origin。');
  }
  let parsed;
  try { parsed = new URL(raw); }
  catch (_) { throw new Error('工作区 API 地址无效；请配置 HTTPS origin，例如 https://plm.example.com。'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('工作区 API 地址必须是无路径、无凭据的 HTTPS origin。');
  }
  return parsed.origin;
}

export function isApiBaseConfigured() {
  try { getApiBaseUrl(); return true; } catch (_) { return false; }
}

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
    let baseUrl;
    try { baseUrl = getApiBaseUrl(); } catch (error) { reject(error); return; }
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
      url: `${baseUrl}${path}`,
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
    if (!result || !result.accessToken || !result.user) {
      clearSession();
      throw new Error('登录响应缺少移动端会话信息');
    }
    try {
      writeScope(result.user);
      writeToken(result.accessToken);
    } catch (error) {
      clearSession();
      throw error;
    }
    return result;
  });
}

export function getAuthStatus() {
  return request('/api/auth/status', 'GET', undefined, { auth: false });
}

export function mobileDingTalkLogin(authCode, accountId) {
  const normalizedAuthCode = String(authCode || '').trim();
  if (!normalizedAuthCode) return Promise.reject(new Error('未取得有效的钉钉免登授权码，请重试。'));
  return request('/api/auth/dingtalk/mobile-login', 'POST', {
    authCode: normalizedAuthCode,
    ...(accountId ? { accountId } : {})
  }, { auth: false }).then((result) => {
    if (!result || !result.accessToken || !result.user) {
      clearSession();
      throw new Error('钉钉登录响应缺少移动端会话信息');
    }
    try {
      writeScope(result.user);
      writeToken(result.accessToken);
    } catch (error) {
      clearSession();
      throw error;
    }
    return result;
  });
}

export function getCurrentUser() {
  if (!readToken()) return Promise.reject(new Error('尚未登录'));
  return request('/api/auth/me').then((result) => {
    if (!result || !result.user) {
      clearSession();
      throw new Error('工作区会话响应缺少用户信息');
    }
    try { writeScope(result.user); }
    catch (error) { clearSession(); throw error; }
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
  return request('/api/workflow/tasks').then((result) => ({
    mode: result && (result.mode === 'flowable' || result.mode === 'demo') ? result.mode : 'unknown',
    tasks: normalizeList(result)
  }));
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
