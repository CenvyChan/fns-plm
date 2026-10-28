import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import WorkspaceTabs from '../../src/WorkspaceTabs'
import '../../src/styles.css'
import '../../src/workspace-tabs.css'

// This harness exercises the real state owner and close planner, not a second implementation.
function Harness() {
  const [page, setPage] = useState('overview')
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return <><header><div ref={setTarget}/><button onClick={() => setPage('overview')}>进入总览</button><button onClick={() => setPage('tasks')}>进入任务</button><button onClick={() => setPage('materials')}>进入物料</button></header><WorkspaceTabs page={page} storageKey="tab-manager-browser-fixture" managerTarget={target} allowed={() => true} onNavigate={next => setPage(next)}>{id => <form aria-label={`${id}草稿`}><label>草稿内容<input name="draft" aria-label={`${id}草稿内容`}/></label></form>}</WorkspaceTabs></>
}
createRoot(document.getElementById('root')!).render(<Harness/> )
