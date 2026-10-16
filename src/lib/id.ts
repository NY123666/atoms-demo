export function uid(prefix = ''): string {
  const body =
    Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3)
  return prefix ? `${prefix}_${body}` : body
}
