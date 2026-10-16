import { useSyncExternalStore } from 'react'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  message: string
  /** 可选的操作按钮，比如「查看」「复制」 */
  actionLabel?: string
  onAction?: () => void
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeToasts(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getToasts(): Toast[] {
  return toasts
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts)
}

let seq = 0

export function toast(
  message: string,
  kind: Toast['kind'] = 'info',
  options: { actionLabel?: string; onAction?: () => void; duration?: number } = {},
): string {
  const id = `t${++seq}`
  const item: Toast = { id, kind, message, actionLabel: options.actionLabel, onAction: options.onAction }
  toasts = [...toasts, item]
  emit()
  const duration = options.duration ?? (kind === 'error' ? 7000 : 3600)
  window.setTimeout(() => dismissToast(id), duration)
  return id
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}
