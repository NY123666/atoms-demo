/**
 * 生成物的处理：从模型输出里抠出 HTML，再往里面注入一层"运行期探针"。
 *
 * 探针做三件事：
 * 1. 给沙箱 iframe 里的 localStorage 提供内存降级（沙箱不给 allow-same-origin，真实存储会抛错）；
 * 2. 捕获运行时错误并回抛给宿主，用于「自动修复」；
 * 3. 上报 ready，宿主据此结束 loading。
 *
 * 安全取舍：iframe 用 sandbox="allow-scripts ..." 但不给 allow-same-origin，
 * 于是产物拿到的是不透明源，碰不到宿主的 DOM / localStorage / cookie。
 */

const PROBE = `<script>
(function () {
  try {
    window.localStorage.setItem('__forge_probe__', '1');
    window.localStorage.removeItem('__forge_probe__');
  } catch (e) {
    var mem = {};
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
          setItem: function (k, v) { mem[k] = String(v); },
          removeItem: function (k) { delete mem[k]; },
          clear: function () { mem = {}; },
          key: function (i) { var ks = Object.keys(mem); return i < ks.length ? ks[i] : null; },
          get length() { return Object.keys(mem).length; }
        }
      });
    } catch (e2) { /* 拿不到就算了，产物自身的 try/catch 会兜住 */ }
  }

  function report(message) {
    try { parent.postMessage({ __forge: 'runtime-error', message: String(message).slice(0, 500) }, '*'); } catch (e) { }
  }

  window.addEventListener('error', function (e) {
    var msg = (e && (e.message || (e.error && e.error.message))) || 'unknown error';
    report(msg);
  });
  window.addEventListener('unhandledrejection', function (e) {
    report('Unhandled promise rejection: ' + String(e && e.reason));
  });
  window.addEventListener('DOMContentLoaded', function () {
    try { parent.postMessage({ __forge: 'ready' }, '*'); } catch (e) { }
    setTimeout(function () { try { parent.postMessage({ __forge: 'ready' }, '*'); } catch (e) { } }, 220);
  });
})();
</script>`

export interface ExtractResult {
  html: string | null
  /** 怎么抠出来的，用于把不确定性如实告诉用户 */
  strategy: 'fenced' | 'document' | 'fragment' | 'raw' | 'none'
}

export function extractHtml(raw: string): ExtractResult {
  const text = raw.trim()
  if (!text) return { html: null, strategy: 'none' }

  const fenced = text.match(/```(?:html|HTML|htm)?\s*\n([\s\S]*?)```/)
  if (fenced?.[1] && fenced[1].includes('<')) {
    return { html: fenced[1].trim(), strategy: 'fenced' }
  }

  const docStart = text.search(/<!doctype\s+html|<html[\s>]/i)
  if (docStart >= 0) {
    const docEnd = text.toLowerCase().lastIndexOf('</html>')
    const end = docEnd >= 0 ? docEnd + '</html>'.length : text.length
    return { html: text.slice(docStart, end).trim(), strategy: 'document' }
  }

  const bodyStart = text.search(/<(body|div|main|section|canvas|form)[\s>]/i)
  if (bodyStart >= 0) {
    const fragment = text.slice(bodyStart).trim()
    return {
      html: `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>生成结果</title>\n</head>\n<body style="margin:0">\n${fragment}\n</body>\n</html>`,
      strategy: 'fragment',
    }
  }

  return { html: null, strategy: 'none' }
}

export interface RunnableCheck {
  ok: boolean
  reasons: string[]
}

/** 轻量静态自检：抓最常见的几类"生成物跑不起来"。 */
export function checkRunnable(html: string): RunnableCheck {
  const reasons: string[] = []
  const lower = html.toLowerCase()

  if (!lower.includes('<body')) reasons.push('缺少 <body> 标签')
  if (!lower.includes('<script') && !lower.includes('<style')) reasons.push('没有任何样式或脚本，可能是静态展示页')
  if (!lower.includes('</html>')) reasons.push('HTML 没有正常闭合')

  const externalSrc = html.match(/<script[^>]+src=["'](https?:)?\/\//gi)
  if (externalSrc && externalSrc.length > 0) reasons.push(`引用了 ${externalSrc.length} 个外部脚本（离线沙箱里可能加载失败）`)

  const externalLink = html.match(/<link[^>]+href=["'](https?:)?\/\//gi)
  if (externalLink && externalLink.length > 0) reasons.push(`引用了 ${externalLink.length} 个外部样式表`)

  return { ok: reasons.length === 0, reasons }
}

/** 注入探针。优先放在 <head> 最前面，让它在产物自己的脚本之前执行。 */
export function instrument(html: string): string {
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch && headMatch.index !== undefined) {
    const at = headMatch.index + headMatch[0].length
    return html.slice(0, at) + '\n' + PROBE + '\n' + html.slice(at)
  }
  const htmlMatch = html.match(/<html[^>]*>/i)
  if (htmlMatch && htmlMatch.index !== undefined) {
    const at = htmlMatch.index + htmlMatch[0].length
    return html.slice(0, at) + '\n<head>' + PROBE + '</head>\n' + html.slice(at)
  }
  return PROBE + '\n' + html
}

export const SANDBOX_ATTRS = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock'
