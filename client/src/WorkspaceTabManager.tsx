import { useEffect, useRef, useState } from 'react'
import type { WorkspaceTab } from './workspace-tabs'

export default function WorkspaceTabManager({ tabs, activeId, dirty, label, onClose, onCloseTabs }: {
  tabs: WorkspaceTab[]; activeId: string; dirty: Record<string, boolean>; label: (tab: WorkspaceTab) => string
  onClose: () => void; onCloseTabs: (ids: string[]) => boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    const node = dialog.current
    const focused = document.activeElement as HTMLElement | null
    const previous = focused && focused !== document.body ? focused : node?.closest('.workspace-frame')?.querySelector<HTMLButtonElement>('.workspace-manage-button')
    node?.showModal()
    return () => { node?.close(); previous?.focus() }
  }, [])
  const chosen = selected.filter(id => tabs.some(tab => tab.id === id))
  const unsaved = chosen.filter(id => dirty[id]).length
  return <dialog ref={dialog} className="workspace-manager" aria-labelledby="workspace-manager-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="workspace-manager-heading"><h2 id="workspace-manager-title">管理已打开页签（{tabs.length}）</h2><button type="button" className="outline-button" onClick={onClose} aria-label="关闭页签管理">返回</button></div>
    <div className="workspace-manager-tools"><button type="button" className="outline-button" onClick={() => setSelected(tabs.filter(tab => tab.id !== activeId && !dirty[tab.id]).map(tab => tab.id))}>选择其他已保存页签</button><button type="button" className="outline-button" onClick={() => setSelected(tabs.map(tab => tab.id))}>全选</button><button type="button" className="outline-button" onClick={() => setSelected([])}>清空选择</button></div>
    <div className="workspace-manager-list">{tabs.map(tab => <label key={tab.id} className="workspace-manager-row"><input type="checkbox" checked={chosen.includes(tab.id)} onChange={event => setSelected(old => event.target.checked ? [...old, tab.id] : old.filter(id => id !== tab.id))}/><span>{label(tab)}<small>{tab.id === activeId ? '当前页签' : '后台页签'}{dirty[tab.id] ? ' · 未保存内容' : ' · 无未保存标记'}</small></span></label>)}</div>
    <div className="workspace-manager-footer"><span role="status">已选 {chosen.length} 项{unsaved > 0 ? `，其中 ${unsaved} 项有未保存内容` : ''}</span><button type="button" className="primary-button" disabled={!chosen.length} onClick={() => { if (onCloseTabs(chosen)) onClose() }}>关闭所选（{chosen.length}）</button></div>
  </dialog>
}
