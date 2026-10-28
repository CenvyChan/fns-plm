import { getReportPreview } from '../../utils/api';

const labels = {
  taskTotal: '任务总数', taskOpen: '待完成', taskDone: '已完成', taskOverdue: '逾期',
  projectTotal: '项目数', kpiRuleTotal: 'KPI 规则', reviewPending: '待评审',
  materialTotal: '物料', materialReleased: '已发布物料', bomTotal: 'BOM', bomReleased: '已发布 BOM',
  documentTotal: '图文档', documentReleased: '已发布文档', salesBomSnapshots: '订单 BOM 快照',
  approvalPending: '流程待办', approvalApproved: '已同意', approvalRejected: '已驳回'
};

Page({
  data: { report: null, loading: false, error: '' },
  onLoad(query) { this.loadReport(query || {}); },
  onPullDownRefresh() { this.loadReport({}, true); },
  loadReport(params = {}, fromRefresh = false) {
    this.setData({ loading: true, error: '' });
    getReportPreview(params).then((result) => {
      const summary = result && result.summary || {};
      const metrics = Object.keys(labels).filter(key => summary[key] !== undefined).map(key => ({ name: key, label: labels[key], value: summary[key] }));
      const taskSummary = `任务 ${summary.taskTotal || 0} 项，待完成 ${summary.taskOpen || 0} 项，已完成 ${summary.taskDone || 0} 项，逾期 ${summary.taskOverdue || 0} 项；项目 ${summary.projectTotal || 0} 个；流程待办 ${summary.approvalPending || 0} 项。`;
      this.setData({ report: { title: 'PLM 工作区报告', period: summary.generatedAt || '', metrics, summary: taskSummary, markdown: result && result.markdown || '' }, loading: false });
    }).catch((err) => {
      const message = err.message || '';
      if (message.includes('尚未登录') || message.includes('请登录') || message.includes('authentication_required')) {
        dd.redirectTo({ url: '/pages/login/index' }); this.setData({ loading: false }); return;
      }
      this.setData({ error: err.message || '无法加载报表预览', loading: false });
    }).then(() => { if (fromRefresh) dd.stopPullDownRefresh(); });
  }
});
