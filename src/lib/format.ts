export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function formatTokens(n?: number): string {
  if (!n) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const UNITS: [number, string][] = [
  [60, '秒'],
  [3600, '分钟'],
  [86400, '小时'],
  [2592000, '天'],
]

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts) / 1000
  if (diff < 10) return '刚刚'
  for (let i = 0; i < UNITS.length; i++) {
    const [limit, label] = UNITS[i]!
    if (diff < limit) {
      const value = i === 0 ? Math.floor(diff) : Math.floor(diff / UNITS[i - 1]![0])
      return `${value} ${label}前`
    }
  }
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 非安全上下文（http）下 clipboard 不可用，退到 execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
