import { useToasts, dismissToast } from '../lib/toast'
import { IconCheck, IconClose, IconInfo } from './Icons'

export default function Toaster() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            {t.kind === 'success' ? <IconCheck size={14} /> : t.kind === 'error' ? <IconClose size={14} /> : <IconInfo size={14} />}
          </span>
          <div className="toast-msg">{t.message}</div>
          {t.actionLabel && t.onAction ? (
            <button
              className="toast-action"
              onClick={() => {
                t.onAction?.()
                dismissToast(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          ) : null}
          <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="关闭">
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
