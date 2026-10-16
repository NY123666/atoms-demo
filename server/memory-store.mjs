/**
 * 限流计数的最小实现：进程内存里的一个 Map。
 *
 * 为什么就敢用内存：这是个笔试 demo 的免费代理，额度上限（默认每天 200 次）本身就是
 * 账单的天花板，不需要精确到"一次都不多"。
 *
 * **必须知道它的局限**：Vercel Edge / Workers 都是多实例的，每个实例一份内存，
 * 所以真实上限会在 dailyGlobal 的若干倍之间浮动（冷启动多的时候更松）。
 * hosted-core 在 /api/health 里用 `sharedLimits: false` 把这件事如实告诉前端。
 *
 * 想要硬保证就把 createHostedHandler({ store }) 换成 Redis/KV 实现 ——
 * 接口只有下面这两个方法 + peek，替换成本很低：
 *   hit(day, key)  -> 先 +1，返回加完之后的值
 *   peek(day, key) -> 只读当前值，不存在返回 0
 *   reset()        -> 测试用
 */

export function createMemoryStore({ keepDays = 2 } = {}) {
  /** @type {Map<string, Map<string, number>>} day -> key -> count */
  const days = new Map()

  function bucket(day, create) {
    let b = days.get(day)
    if (!b) {
      if (!create) return null
      b = new Map()
      days.set(day, b)
      // 顺手清掉过期的那几天，避免长跑进程内存无限增长（只管最旧的那几天的数量，不做定时任务）
      if (days.size > keepDays) {
        const firstKey = days.keys().next().value
        if (firstKey !== day) days.delete(firstKey)
      }
    }
    return b
  }

  return {
    hit(day, key) {
      const b = bucket(day, true)
      const next = (b.get(key) || 0) + 1
      b.set(key, next)
      return next
    },
    peek(day, key) {
      const b = bucket(day, false)
      return b ? b.get(key) || 0 : 0
    },
    /** 全局计数：把所有 key 加起来（健康检查用，量级很小无所谓性能）。 */
    total(day) {
      const b = bucket(day, false)
      if (!b) return 0
      let sum = 0
      for (const [key, n] of b) if (key !== 'global') sum += n
      return sum
    },
    reset() {
      days.clear()
    },
  }
}
