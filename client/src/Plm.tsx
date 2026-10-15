import './plm.css'
import MaterialWorkbench from './MaterialWorkbench'
import BomWorkbench from './BomWorkbench'
import KpiWorkbench from './KpiWorkbench'
import DocumentWorkbench from './DocumentWorkbench'
import type { WorkspaceData } from './types'
import type { AuthUser } from './api'

export default function Plm({ page, workspace, onChange, onToast, currentUser }: { page: string; workspace: WorkspaceData; onChange: (data: WorkspaceData) => void; onToast: (message: string) => void; currentUser: AuthUser }) {
  if (page === 'materials') return <MaterialWorkbench workspace={workspace} onChange={onChange} onToast={onToast}/>
  if (page === 'boms') return <BomWorkbench workspace={workspace} onChange={onChange} onToast={onToast}/>
  if (page === 'kpi') return <KpiWorkbench workspace={workspace} onChange={onChange} onToast={onToast} currentUser={currentUser}/>
  return <DocumentWorkbench workspace={workspace} onChange={onChange} onToast={onToast}/>
}
