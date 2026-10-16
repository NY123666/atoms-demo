import { useRef } from 'react'
import type { ReactNode } from 'react'
import { IconSpark, IconStop } from './Icons'

interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled?: boolean
  running?: boolean
  onStop?: () => void
  placeholder?: string
  size?: 'lg' | 'sm'
  submitLabel?: string
  under?: ReactNode
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  running = false,
  onStop,
  placeholder = '用一句话描述你想要的网页应用…',
  size = 'lg',
  submitLabel = '生成',
  under,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const canSubmit = value.trim().length > 0 && !disabled && !running

  function submit() {
    if (!canSubmit) return
    onSubmit()
  }

  return (
    <div className={`composer composer-${size}`}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={placeholder}
        rows={size === 'lg' ? 3 : 2}
        spellCheck={false}
      />
      <div className="composer-bar">
        <span className="composer-tip">Enter 发送 · Shift + Enter 换行</span>
        {running && onStop ? (
          <button className="btn btn-ghost" onClick={onStop} type="button">
            <IconStop size={14} />
            停止
          </button>
        ) : (
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit} type="button">
            <IconSpark size={14} />
            {submitLabel}
          </button>
        )}
      </div>
      {under ? <div className="composer-under">{under}</div> : null}
    </div>
  )
}
