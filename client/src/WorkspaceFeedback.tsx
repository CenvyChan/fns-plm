import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, X } from 'lucide-react'
import { feedbackDuration, persistentFeedbackSelector, transientFeedbackSelector } from './workspace-feedback'
import './workspace-feedback.css'

type Message = { id: number; text: string }
const actionableContent = 'a, input, select, textarea, button:not([aria-label="关闭"])'
function FeedbackToast({ message, onDismiss }: { message: Message; onDismiss: () => void }) {
  const [paused, setPaused] = useState(() => document.hidden)
  const remaining = useRef(feedbackDuration(message.text))
  useEffect(() => {
    if (paused) return
    const start = Date.now()
    const timer = window.setTimeout(onDismiss, remaining.current)
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - start)) }
  }, [paused, onDismiss])
  useEffect(() => {
    const visibility = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])
  return <div className="workspace-feedback-toast" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    <CheckCircle2 size={17} aria-hidden="true"/><span>{message.text}</span>
    <button type="button" aria-label="关闭操作提示" onClick={onDismiss}><X size={15}/></button>
  </div>
}

// Presentation adapter keeps business components (including the parallel daily-report work) unchanged.
// Only audited success nodes are suppressed; errors, sources, progress and actionable content stay inline.
export default function WorkspaceFeedback({ root, host, active }: { root: RefObject<HTMLDivElement | null>; host: HTMLElement | null; active: boolean }) {
  const [messages, setMessages] = useState<Message[]>([])
  const seen = useRef(new WeakMap<Element, string>())
  const sequence = useRef(0)
  useEffect(() => {
    if (!active || !root.current || !host) { setMessages([]); return }
    const owners = [root.current, host]
    const scan = () => {
      for (const owner of owners) {
        for (const node of owner.querySelectorAll<HTMLElement>('[data-feedback-suppressed]')) {
          if (!node.matches(transientFeedbackSelector) || node.closest(persistentFeedbackSelector) || node.querySelector(actionableContent)) node.removeAttribute('data-feedback-suppressed')
        }
        for (const node of owner.querySelectorAll<HTMLElement>(transientFeedbackSelector)) {
          if (node.closest(persistentFeedbackSelector) || node.closest('[hidden], [inert]') || node.querySelector(actionableContent)) continue
          const text = node.textContent?.trim()
          if (!text) continue
          if (seen.current.get(node) !== text) {
            seen.current.set(node, text)
            const message = { id: ++sequence.current, text }
            setMessages(old => [...old, message])
          }
          // CSS hides only the original success node, removing the duplicate live announcement too.
          node.setAttribute('data-feedback-suppressed', '')
        }
      }
    }
    const observer = new MutationObserver(scan)
    for (const owner of owners) observer.observe(owner, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'role', 'data-feedback'] })
    scan()
    return () => observer.disconnect()
  }, [root, host, active])
  if (!host || !active) return null
  return createPortal(<div className="workspace-feedback-stack" role="status" aria-live="polite" aria-relevant="additions" aria-label="操作反馈">{messages.map(message => <FeedbackToast key={message.id} message={message} onDismiss={() => setMessages(old => old.filter(item => item.id !== message.id))}/>)}</div>, host)
}
