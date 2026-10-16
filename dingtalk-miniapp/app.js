App({
  // 部署时仅填写 API 的 HTTPS origin；不得加入账号、token 或服务端 Secret。
  globalData: { user: null, apiBaseUrl: 'https://YOUR-APP-DOMAIN' },
  onLaunch() {
    // 登录凭证由 utils/api.js 保存在小程序本地安全存储中；服务端会话是身份权威来源。
  }
});
