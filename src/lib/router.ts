import { useEffect, useState } from 'react'

/**
 * 极简 hash 路由。
 * 取舍：只有 4 个页面，手写比引 react-router 更省体积，也不会在静态托管上
 * 因为缺少 SPA 重写规则而 404（所有状态都在 `#` 后面）。
 */
export type Route =
  | { name: 'home' }
  | { name: 'project'; id: string }
  | { name: 'share'; code: string }
  | { name: 'settings' }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const parts = raw.split('/').filter(Boolean)
  const head = parts[0]
  if (head === 'p' && parts[1]) return { name: 'project', id: decodeURIComponent(parts[1]) }
  if (head === 's' && parts[1]) return { name: 'share', code: parts[1] }
  if (head === 'settings') return { name: 'settings' }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function go(path: string): void {
  const next = path.startsWith('#') ? path : `#${path}`
  if (window.location.hash === next) return
  window.location.hash = next
}

export function currentPath(): string {
  return `#${window.location.hash.replace(/^#/, '') || '/'}`
}
