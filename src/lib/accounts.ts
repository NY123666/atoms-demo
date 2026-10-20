import { ACCOUNTS_KEY, SESSION_KEY, readEnvelope, writeEnvelope } from './storage'
import { uid } from './id'

/**
 * 本机账号（local accounts）。
 *
 * 先说清楚这套东西**是什么、不是什么**，因为界面上也要如实写出来：
 *   - 是：把应用、聊天、版本和自己的 API Key 按账号**分区**。同一个浏览器上换个人登录，
 *     看到的是自己那一份，退出再登录还能找回来。
 *   - 不是：安全边界。账号表、密码哈希、项目数据全都躺在这个浏览器的 localStorage 里，
 *     谁拿到这台机器，打开开发者工具都能看到。没有服务器，也就没有"跨设备登录""找回密码"
 *     这些需要服务端才成立的东西。
 *
 * 既然如此，为什么还要密码哈希而不是明文？因为明文密码是最不该留下的东西：人会跨站复用密码，
 * 而这一层的价值只有"分区"。用 PBKDF2 存哈希是零成本的（浏览器原生 crypto.subtle），
 * 顺手避免"打开开发者工具就看到我常用的那个密码"。
 */

/** 访客分区的 ownerId 在 storage.ts（key 的归属由那边决定），这里只是转出去给界面用。 */
export { GUEST_OWNER_ID } from './storage'

/** PBKDF2 迭代次数。存在账号记录里，将来调高不会让老账号登不进来。 */
export const PBKDF2_ITERATIONS = 120_000

export interface Account {
  id: string
  /** 归一化后的登录名（小写、去首尾空格），用来做唯一性判断 */
  username: string
  /** 用户输入的原样，界面上显示这个 */
  displayName: string
  createdAt: number
  salt: string
  iterations: number
  hash: string
}

export interface Session {
  ownerId: string
  username: string
  loginAt: number
}

export const USERNAME_RULE = '用户名 2–24 个字符，可用中英文、数字、下划线、点、短横线'
export const PASSWORD_MIN = 6

/** 浏览器有没有能用的加密接口。没有时**不降级**成明文，而是直接拒绝建账号并解释原因。 */
export function cryptoReady(): boolean {
  try {
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.deriveBits === 'function'
  } catch {
    return false
  }
}

export const CRYPTO_UNAVAILABLE =
  '当前环境不支持浏览器加密接口（crypto.subtle），没法安全地保存密码。常见原因是页面通过 http 的非本机地址打开 —— 请改用 https 或 localhost 访问。'

/* -------------------------------- 账号表读写 ------------------------------- */

export function listAccounts(): Account[] {
  const data = readEnvelope<Account[]>(ACCOUNTS_KEY)
  if (!Array.isArray(data)) return []
  return data.filter(
    (a) =>
      a &&
      typeof a.id === 'string' &&
      typeof a.username === 'string' &&
      typeof a.salt === 'string' &&
      typeof a.hash === 'string',
  )
}

function saveAccounts(accounts: Account[]): boolean {
  return writeEnvelope(ACCOUNTS_KEY, accounts)
}

export function findAccountById(id: string): Account | null {
  return listAccounts().find((a) => a.id === id) ?? null
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function findByUsername(raw: string): Account | null {
  const username = normalizeUsername(raw)
  return listAccounts().find((a) => a.username === username) ?? null
}

export function validateUsername(raw: string): string | null {
  const name = raw.trim()
  if (name.length < 2 || name.length > 24) return USERNAME_RULE
  // \p{L} 涵盖中日韩，\p{N} 涵盖全角数字：中文用户起个「小明」是正常需求。
  if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) return USERNAME_RULE
  return null
}

export function validatePassword(password: string): string | null {
  if (password.trim().length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  // 上限只为挡住"粘一整篇文章进去"这种误操作（PBKDF2 对超长输入没有意义，只会让人等）。
  if (password.length > 128) return '密码太长了，请控制在 128 个字符以内'
  return null
}

/* --------------------------------- 哈希计算 -------------------------------- */

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// salt 写成 Uint8Array<ArrayBuffer>（而不是裸 Uint8Array）：crypto 的类型不接受
// 泛型里带 SharedArrayBuffer 的那种，而裸写默认就是它。
async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return new Uint8Array(bits)
}

/** 定长比较，别用 `===`：虽然本机场景听不出时间差，但没理由留一个可以顺手改坏的坑。 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/* --------------------------------- 注册登录 -------------------------------- */

export type AuthResult = { ok: true; account: Account } | { ok: false; error: string }

export async function register(rawUsername: string, password: string): Promise<AuthResult> {
  const invalid = validateUsername(rawUsername) ?? validatePassword(password)
  if (invalid) return { ok: false, error: invalid }
  if (!cryptoReady()) return { ok: false, error: CRYPTO_UNAVAILABLE }

  const username = normalizeUsername(rawUsername)
  if (listAccounts().some((a) => a.username === username)) {
    return { ok: false, error: '这个用户名已经注册过了，直接登录就行' }
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  let hash: Uint8Array
  try {
    hash = await derive(password, salt, PBKDF2_ITERATIONS)
  } catch (e) {
    return { ok: false, error: `加密失败：${e instanceof Error ? e.message : String(e)}` }
  }

  const account: Account = {
    id: uid('a'),
    username,
    displayName: rawUsername.trim(),
    createdAt: Date.now(),
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    hash: toBase64(hash),
  }

  // 先写盘再返回：写失败（隐私模式、容量满）时不能假装注册成功，
  // 否则用户切到"已登录"，刷新一下账号却没了。
  if (!saveAccounts([...listAccounts(), account])) {
    return { ok: false, error: '本地存储写入失败（可能是隐私模式或容量已满），账号没建成。' }
  }
  return { ok: true, account }
}

export async function login(rawUsername: string, password: string): Promise<AuthResult> {
  if (!cryptoReady()) return { ok: false, error: CRYPTO_UNAVAILABLE }

  const account = findByUsername(rawUsername)
  /*
   * 用户名不存在时**故意不做**一次假的哈希计算。
   * 教科书上说那样能防"用户名枚举"，但这里账号表就在同一个 localStorage 里 —— 想枚举的人
   * 直接读 `forge:accounts` 就全知道了，多算一次哈希只是让登录慢 40ms 的自欺欺人。
   */
  if (!account) return { ok: false, error: '用户名或密码不对' }

  const salt = fromBase64(account.salt)
  let hash: Uint8Array
  try {
    hash = await derive(password, salt, account.iterations || PBKDF2_ITERATIONS)
  } catch (e) {
    return { ok: false, error: `加密失败：${e instanceof Error ? e.message : String(e)}` }
  }
  if (!sameBytes(hash, fromBase64(account.hash))) return { ok: false, error: '用户名或密码不对' }

  /*
   * 老账号的迭代次数低于当前标准时顺手升一次：登录是唯一能拿到明文的时刻，错过就得等下次。
   * 升级失败不影响本次登录（已经验过密码了），下次再试。
   */
  if ((account.iterations || 0) < PBKDF2_ITERATIONS) {
    try {
      const freshSalt = crypto.getRandomValues(new Uint8Array(16))
      const freshHash = await derive(password, freshSalt, PBKDF2_ITERATIONS)
      const upgraded: Account = {
        ...account,
        salt: toBase64(freshSalt),
        iterations: PBKDF2_ITERATIONS,
        hash: toBase64(freshHash),
      }
      saveAccounts(listAccounts().map((a) => (a.id === account.id ? upgraded : a)))
      return { ok: true, account: upgraded }
    } catch {
      /* 忽略：登录本身已经成功 */
    }
  }

  return { ok: true, account }
}

/** 只删账号记录；账号名下的应用/设置由 store 层的 removeAccount 一并清掉。 */
export function deleteAccount(id: string): void {
  saveAccounts(listAccounts().filter((a) => a.id !== id))
}

/* ---------------------------------- 会话 ---------------------------------- */

export function readSession(): Session | null {
  const s = readEnvelope<Session>(SESSION_KEY)
  if (!s || typeof s.ownerId !== 'string' || !s.ownerId) return null
  return s
}

export function writeSession(account: Account): void {
  writeEnvelope(SESSION_KEY, { ownerId: account.id, username: account.displayName, loginAt: Date.now() })
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* 忽略：隐私模式下会抛错 */
  }
}
