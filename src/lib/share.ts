import type { SharePayload } from '../types'

/**
 * 分享链接方案：把整份产物压缩后塞进 URL fragment。
 *
 * 取舍：不做后端、不存服务器，所以链接本身就是数据（可离线、可归档、不会因为
 * 服务下线而失效）；代价是链接长度受浏览器地址栏限制（Chrome 约 2MB 很宽松，
 * 但聊天工具预览会截断很长的一行）。所以超过阈值时主动提示用户改用导出 HTML。
 */
const PREFIX_DEFLATE = '1'
const PREFIX_PLAIN = '0'

/** 超过这个长度就提醒用户：有些聊天软件会把链接截断。 */
export const SHARE_WARN_LENGTH = 8000

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const cs = new CompressionStream('deflate-raw')
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null
  try {
    const ds = new DecompressionStream('deflate-raw')
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const compressed = await deflate(bytes)
  if (compressed && compressed.length < bytes.length) {
    return PREFIX_DEFLATE + bytesToBase64Url(compressed)
  }
  return PREFIX_PLAIN + bytesToBase64Url(bytes)
}

export async function decodeShare(code: string): Promise<SharePayload | null> {
  try {
    if (!code) return null
    const flag = code[0]
    const body = code.slice(1)
    let bytes = base64UrlToBytes(body)
    if (flag === PREFIX_DEFLATE) {
      const out = await inflate(bytes)
      if (!out) return null
      bytes = out
    } else if (flag !== PREFIX_PLAIN) {
      return null
    }
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as SharePayload
    if (!parsed || typeof parsed.html !== 'string' || parsed.html.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

export function buildShareUrl(code: string): string {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#/s/${code}`
}

/** 生成一个可直接下载的单文件 HTML（离线归档用）。 */
export function downloadHtml(name: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'app'}.html`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
