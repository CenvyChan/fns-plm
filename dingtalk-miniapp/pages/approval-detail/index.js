import { getTask, completeTask } from '../../utils/api';

function shouldLogin(error) {
  const message = error && error.message || '';
  return message.includes('尚未登录') || message.includes('请登录') || message.includes('authentication_required');
}

Page({
  data: { id: '', task: null, previewText: '', mode: '', loading: false, error: '', comment: '', submitting: false },
  onLoad(query) {
    const id = query && query.id;
    this.setData({ id: id || '' });
    if (id) this.loadTask(); else this.setData({ error: '缺少任务编号' });
  },
  loadTask() {
    this.setData({ loading: true, error: '' });
    getTask(this.data.id).then((result) => {
      const task = result && (result.task || result);
      const preview = task && task.preview;
      this.setData({ task, mode: result && result.mode || '', previewText: preview ? (typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2)) : '', loading: false });
    }).catch((err) => {
      if (shouldLogin(err)) { dd.redirectTo({ url: '/pages/login/index' }); return this.setData({ loading: false }); }
      this.setData({ error: err.message || '无法加载任务详情', loading: false });
    });
  },
  onCommentInput(e) { this.setData({ comment: e.detail.value || '' }); },
  decide(e) {
    const decision = e.currentTarget.dataset.decision;
    const comment = this.data.comment.trim();
    if (!comment) { dd.alert({ title: '请填写审批意见', buttonText: '知道了' }); return; }
    if (!this.data.id || this.data.submitting) return;
    this.setData({ submitting: true, error: '' });
    // 操作者身份由服务端从已认证会话、账套角色和 Flowable 映射推导。
    completeTask(this.data.id, decision, comment)
      .then(() => dd.alert({ title: decision === 'approve' ? '已提交同意' : '已提交驳回', buttonText: '完成', success: () => dd.navigateBack() }))
      .catch((err) => {
        if (shouldLogin(err)) { dd.redirectTo({ url: '/pages/login/index' }); return this.setData({ submitting: false }); }
        this.setData({ error: err.message || '提交失败，请稍后重试', submitting: false });
      });
  }
});
