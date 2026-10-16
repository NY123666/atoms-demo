export interface BuildCtx {
  /** 用户原始需求 */
  prompt: string
  title: string
  accent: string
  theme: 'dark' | 'light'
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/**
 * 生成物跑在 sandbox iframe 里（不给 allow-same-origin），
 * 所以真实 localStorage 会抛 SecurityError。这个 prelude 提供一层
 * 自动降级的存储：能写就写真实 localStorage，不能写就退回内存，
 * 保证生成的 app 在任何环境下都不会因为存储而崩。
 */
export const STORE_PRELUDE = [
  'var Store = (function () {',
  '  var mem = {}; var real = null;',
  '  try { window.localStorage.setItem("__p__", "1"); window.localStorage.removeItem("__p__"); real = window.localStorage; } catch (e) { real = null; }',
  '  return {',
  '    get: function (k) { try { return real ? real.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return null; } },',
  '    set: function (k, v) { try { if (real) real.setItem(k, v); else mem[k] = String(v); } catch (e) { mem[k] = String(v); } },',
  '    del: function (k) { try { if (real) real.removeItem(k); else delete mem[k]; } catch (e) { delete mem[k]; } }',
  '  };',
  '})();',
].join('\n')

const DARK = {
  bg: '#0d1020',
  bg2: '#0a0c18',
  panel: '#161b2e',
  panel2: '#1d2440',
  line: '#28304f',
  text: '#e9ecff',
  muted: '#8b93b8',
}

const LIGHT = {
  bg: '#f5f6fb',
  bg2: '#ffffff',
  panel: '#ffffff',
  panel2: '#f1f3fa',
  line: '#e2e6f2',
  text: '#151a2e',
  muted: '#6b7391',
}

export function baseCss(ctx: BuildCtx): string {
  const c = ctx.theme === 'light' ? LIGHT : DARK
  return [
    '*{box-sizing:border-box}',
    `:root{--bg:${c.bg};--bg2:${c.bg2};--panel:${c.panel};--panel2:${c.panel2};--line:${c.line};--text:${c.text};--muted:${c.muted};--accent:${ctx.accent};}`,
    'html,body{margin:0;padding:0}',
    `body{background:linear-gradient(180deg,var(--bg),var(--bg2));color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}`,
    '.wrap{max-width:840px;margin:0 auto;padding:32px 20px 56px}',
    '.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}',
    '.h1{font-size:22px;font-weight:700;margin:0 0 4px}',
    '.sub{color:var(--muted);font-size:13px;margin:0 0 20px}',
    '.row{display:flex;gap:10px;align-items:center}',
    'input,select,textarea{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none;width:100%}',
    'input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}',
    'button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;transition:filter .15s,transform .06s}',
    'button:hover{filter:brightness(1.1)}',
    'button:active{transform:translateY(1px)}',
    'button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}',
    'button.ghost:hover{color:var(--text)}',
    'button.ghost.on{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--text);border-color:var(--accent)}',
    '.muted{color:var(--muted);font-size:13px}',
  ].join('\n')
}

/** 组装成一个完整、可直接塞进 iframe srcDoc 的单文件应用。 */
export function page(ctx: BuildCtx, body: string, script: string, extraCss = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ctx.title)}</title>
<style>
${baseCss(ctx)}
${extraCss}
</style>
</head>
<body>
${body}
<script>
${STORE_PRELUDE}
${script}
</script>
</body>
</html>`
}
