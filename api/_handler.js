/**
 * Vercel Edge 的两个入口共用这一份：把 handler 做成"每个实例只建一次"的单例。
 *
 * 为什么必须缓存：限流计数存在 handler 的 store 里（进程内存）。
 * 每个请求都 createHostedHandler 一次的话，计数器每次都被清零，配额就形同虚设。
 * 模块作用域在同一个 isolate 里是会被复用的，所以在这里记忆化正好落在"每个实例一份计数"上。
 */
import { createHostedHandler } from '../server/hosted-core.mjs'

let cached = null
let cachedEnvKey = ''

export function handlerFor(env) {
  // 环境键只用无关紧要的几个字段（不含 Key 本身），避免把密钥留在模块变量里被意外打印。
  const key = `${env.UPSTREAM_BASE_URL || ''}|${env.UPSTREAM_MODEL || ''}`
  if (!cached || cachedEnvKey !== key) {
    cached = createHostedHandler({ env })
    cachedEnvKey = key
  }
  return cached
}
