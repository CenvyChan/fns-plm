import { getCurrentUser, logout } from '../../utils/api';

Page({
  data: { user: null },
  onShow() {
    getCurrentUser().then((user) => {
      getApp().globalData.user = user;
      this.setData({ user });
    }).catch(() => {
      this.setData({ user: null });
      dd.redirectTo({ url: '/pages/login/index' });
    });
  },
  goApprovals() { dd.navigateTo({ url: '/pages/approvals/index' }); },
  goReport() { dd.navigateTo({ url: '/pages/report-preview/index' }); },
  signOut() { logout().finally(() => { getApp().globalData.user = null; dd.redirectTo({ url: '/pages/login/index' }); }); }
});
