import type { GenRun, GenSource, GenStepState } from '../types'

export type RunOutcome = 'done' | 'error' | 'stopped'

/**
 * 把"生成当场还在动"的步骤收尾成可以存档的终态。
 * 成功路径上 generate.ts 已经把所有步骤标成 done，这里原样保留；
 * 失败/停止时，正在跑的步骤没跑完，如实标回 pending（未执行），不编造成 done。
 */
export function finalizeSteps(steps: GenStepState[], outcome: RunOutcome): GenStepState[] {
  if (outcome === 'done') return steps
  return steps.map((s) =>
    s.status === 'running'
      ? { ...s, status: 'pending' as const, startedAt: undefined, finishedAt: undefined }
      : s,
  )
}

export interface BuildRunOptions {
  source: GenSource
  status: RunOutcome
  prompt: string
  startedAt: number
  finishedAt?: number
  steps: GenStepState[]
  error?: string
  autoFixed?: boolean
}

/** 组装一条可存档的执行记录；耗时按起止时间算，不依赖调用方再传一遍。 */
export function buildRun(opts: BuildRunOptions): GenRun {
  const finishedAt = opts.finishedAt ?? Date.now()
  return {
    source: opts.source,
    status: opts.status,
    prompt: opts.prompt,
    startedAt: opts.startedAt,
    finishedAt,
    durationMs: finishedAt - opts.startedAt,
    steps: finalizeSteps(opts.steps, opts.status),
    error: opts.error,
    autoFixed: opts.autoFixed,
  }
}

/** 一条记录里真正执行到了多少步（done/error 都算"走到了"）。 */
export function ranStepCount(steps: GenStepState[]): number {
  return steps.filter((s) => s.status === 'done' || s.status === 'error').length
}
