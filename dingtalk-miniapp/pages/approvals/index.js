import { getTasks } from '../../utils/api';

function redirectToLogin(error) {
  const message = error && error.message || '';
  if (message.includes('尚未登录') || message.includes('请登录') || message.includes('authentication_required')) {
    dd.redirectTo({ url: '/pages/login/index' }); return true;
  }
  return false;
}

Page({
  data: { tasks: [], loading: false, error: '', mode: 'demo' },
  onShow() { this.loadTasks(); },
  onPullDownRefresh() { this.loadTasks(true); },
  loadTasks(fromRefresh = false) {
    this.setData({ loading: true, error: '' });
    getTasks().then((tasks) => this.setData({ tasks, loading: false }))
      .catch((err) => {
        if (redirectToLogin(err)) return this.setData({ error: '', loading: false });
        this.setData({ error: err.message || '暂时无法加载任务', loading: false });
      })
      .then(() => { if (fromRefresh) dd.stopPullDownRefresh(); });
  },
  openTask(e) {
    const id = e.currentTarget.dataset.id;
    if (id !== undefined && id !== null) dd.navigateTo({ url: `/pages/approval-detail/index?id=${encodeURIComponent(id)}` });
  }
});
