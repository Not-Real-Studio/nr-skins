/**
 * Скины на диске (skin-spec §5): источник `SkinsOps` протокола для
 * `serveBackend({skins})` и для хоста артефактов.
 *
 *   <root>/skins/*.skin.css            общие (envs/skins)        source: shared
 *   <cwd>/.nr/skins/*.skin.css         рабочая область сессии    source: workspace
 *
 * `cwd` — каталог сессии (мета `workspace.cwd`), нет — корень бэкенда.
 * Скин рабочей области с тем же именем перекрывает общий. Текущий выбор
 * пользователя (для выжимки агенту) — `<root>/.nr/skin-current.json`.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REQUIRED_TOKENS, SKIN_NAME_RE, TOKENS, type SkinMode } from './contract.js'
import { compileSkin, formatIssue, modeVars, validateSkin, withHeader, type CompiledSkin, type SkinIssue, type SkinVars } from './skin.js'

export const SKIN_EXT = '.skin.css'

export type SkinSourceKind = 'shared' | 'workspace'

/** Строка списка — форма `SkinInfo` протокола. */
export interface SkinInfo {
  name: string
  description?: string
  mode: SkinMode
  base?: string
  source: SkinSourceKind
  /** Хэш собранного CSS: сменился — фронт перегружает стиль. */
  hash: string
  /** Скин не прошёл валидатор: в списке есть (видно, что сломан), CSS не отдаётся. */
  error?: string
  errors?: string[]
  warnings?: string[]
}

export interface SkinsListOpts {
  sessionId?: string
  /** Каталог рабочей области напрямую (хост артефактов знает его сам). */
  cwd?: string
}

export interface SkinSaveOpts extends SkinsListOpts {
  description?: string
  mode?: SkinMode
  base?: string
}

export interface SkinSaveResult {
  ok: boolean
  skin?: SkinInfo
  path?: string
  errors?: string[]
  warnings?: string[]
}

export interface SkinCheckResult extends SkinSaveResult {
  /** Собранный CSS (с базой) — только при `ok`. */
  css?: string
  vars?: SkinVars
}

export interface SkinSelection {
  name: string
  mode: 'light' | 'dark'
}

/** Ошибка с кодом провода (`serveBackend` переводит в статус). */
export class SkinError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'bad_request',
  ) {
    super(message)
    this.name = 'SkinError'
  }
}

export interface FsSkinsOptions {
  /** Корень бэкенда (`$cwd` окружения): общие — `<root>/skins`. */
  root: string
  /** Каталог общих скинов, если не `<root>/skins`. */
  sharedDir?: string
  /** Каталог сессии по id (мета `workspace.cwd`). Нет / пусто — корень. */
  cwdOf?: (sessionId: string) => Promise<string | undefined> | string | undefined
  /** Файл текущего выбора; по умолчанию `<root>/.nr/skin-current.json`. */
  currentFile?: string
}

export const sharedSkinsDir = (root: string): string => join(root, 'skins')
export const workspaceSkinsDir = (cwd: string): string => join(cwd, '.nr', 'skins')
export const currentSkinFile = (root: string): string => join(root, '.nr', 'skin-current.json')

interface FileEntry {
  name: string
  path: string
  source: SkinSourceKind
  text: string
}

const cache = new Map<string, { mtimeMs: number; size: number; text: string }>()

function readCached(path: string): string | undefined {
  try {
    const st = statSync(path)
    const c = cache.get(path)
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.text
    const text = readFileSync(path, 'utf8')
    cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, text })
    return text
  } catch {
    return undefined
  }
}

function scan(dir: string, source: SkinSourceKind): FileEntry[] {
  if (!existsSync(dir)) return []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: FileEntry[] = []
  for (const f of names.sort()) {
    if (!f.endsWith(SKIN_EXT) || f.startsWith('.')) continue
    const path = join(dir, f)
    const text = readCached(path)
    if (text !== undefined) out.push({ name: f.slice(0, -SKIN_EXT.length), path, source, text })
  }
  return out
}

const hashOf = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12)

/** Набор скинов на момент вызова: имя → файл (рабочая область перекрывает общие). */
export interface SkinSet {
  files: Map<string, FileEntry>
  compile(name: string): CompiledSkin
  info(name: string): SkinInfo | undefined
  list(): SkinInfo[]
  workspaceDir: string
}

export function skinSet(sharedDir: string, workspaceDir: string): SkinSet {
  const files = new Map<string, FileEntry>()
  for (const e of scan(sharedDir, 'shared')) files.set(e.name, e)
  for (const e of scan(workspaceDir, 'workspace')) files.set(e.name, e)
  const known = [...files.keys()]
  const lookup = (n: string): string | undefined => files.get(n)?.text
  const compiled = new Map<string, CompiledSkin>()
  const compile = (name: string): CompiledSkin => {
    let c = compiled.get(name)
    if (!c) {
      c = compileSkin(name, lookup, known)
      compiled.set(name, c)
    }
    return c
  }
  const info = (name: string): SkinInfo | undefined => {
    const f = files.get(name)
    if (!f) return undefined
    const c = compile(name)
    const errors = c.errors.map(formatIssue)
    return {
      name,
      ...(c.header.description ? { description: c.header.description } : {}),
      mode: c.header.mode ?? 'both',
      ...(c.header.base ? { base: c.header.base } : {}),
      source: f.source,
      hash: hashOf(errors.length ? f.text : c.css),
      ...(errors.length ? { error: errors[0], errors } : {}),
      ...(c.warnings.length ? { warnings: c.warnings.map(formatIssue) } : {}),
    }
  }
  return {
    files,
    compile,
    info,
    list: () => known.map((n) => info(n)!).filter(Boolean),
    workspaceDir,
  }
}

export interface FsSkins {
  list(opts?: SkinsListOpts): Promise<SkinInfo[]>
  css(name: string, opts?: SkinsListOpts): Promise<string>
  save(name: string, css: string, opts?: SkinSaveOpts): Promise<SkinSaveResult>
  select(sel: SkinSelection): Promise<void>
  /** Полный разбор одного скина: исходник, переменные, ошибки — для редактора и агента. */
  get(name: string, opts?: SkinsListOpts): Promise<SkinDetail>
  /** Проверить текст без записи (агентский `skin_check`, превью редактора): при успехе — собранный CSS и переменные. */
  check(name: string, css: string, opts?: SkinSaveOpts): Promise<SkinCheckResult>
  current(): SkinSelection | null
}

export interface SkinDetail {
  info: SkinInfo
  /** Исходник файла (как на диске, с шапкой). */
  source: string
  /** Собранный CSS (с базой); пусто при ошибках. */
  css: string
  vars: SkinVars
  chain: string[]
  path: string
}

/** Источник скинов на диске. */
export function createFsSkins(opts: FsSkinsOptions): FsSkins {
  const sharedDir = opts.sharedDir ?? sharedSkinsDir(opts.root)
  const currentFile = opts.currentFile ?? currentSkinFile(opts.root)

  const cwdFor = async (o?: SkinsListOpts): Promise<string> => {
    if (o?.cwd) return o.cwd
    if (o?.sessionId && opts.cwdOf) {
      try {
        const c = await opts.cwdOf(o.sessionId)
        if (c) return c
      } catch {
        /* сессии нет — корень */
      }
    }
    return opts.root
  }
  const setFor = async (o?: SkinsListOpts): Promise<SkinSet> => skinSet(sharedDir, workspaceSkinsDir(await cwdFor(o)))

  const check = async (name: string, css: string, o?: SkinSaveOpts): Promise<SkinCheckResult & { text?: string }> => {
    if (!SKIN_NAME_RE.test(name)) return { ok: false, errors: [`имя "${name}" — латиница в нижнем регистре, цифры, дефис; с буквы; до 40`] }
    const set = await setFor(o)
    // Шапка из опций сильнее своей (редактор «сохранить как» меняет имя и базу).
    const parsed = validateSkin(css, {}).header
    const text = withHeader(css, {
      name,
      ...((o?.description ?? parsed.description) ? { description: o?.description ?? parsed.description } : {}),
      mode: o?.mode ?? parsed.mode ?? 'both',
      ...((o?.base ?? parsed.base) ? { base: o?.base ?? parsed.base } : {}),
    })
    // Скин под своим именем в наборе — проверка цепочки баз как у живого.
    const files = new Map(set.files)
    files.set(name, { name, path: '', source: 'workspace', text })
    const known = [...files.keys()]
    const c = compileSkin(name, (n) => files.get(n)?.text, known)
    const errors = c.errors.map(formatIssue)
    const warnings = c.warnings.map(formatIssue)
    return {
      ok: errors.length === 0,
      ...(errors.length ? { errors } : { css: c.css, vars: c.vars }),
      ...(warnings.length ? { warnings } : {}),
      text,
    }
  }

  return {
    async list(o) {
      return (await setFor(o)).list()
    },
    async css(name, o) {
      const set = await setFor(o)
      if (!set.files.has(name)) throw new SkinError(`скина ${name} нет`, 'not_found')
      const c = set.compile(name)
      if (c.errors.length) throw new SkinError(`скин ${name} не прошёл проверку: ${c.errors.map(formatIssue).join('; ')}`, 'bad_request')
      return c.css
    },
    async get(name, o) {
      const set = await setFor(o)
      const f = set.files.get(name)
      if (!f) throw new SkinError(`скина ${name} нет`, 'not_found')
      const c = set.compile(name)
      return { info: set.info(name)!, source: f.text, css: c.css, vars: c.vars, chain: c.chain, path: f.path }
    },
    check: (name, css, o) => check(name, css, o).then(({ text: _t, ...r }) => r),
    async save(name, css, o) {
      const r = await check(name, css, o)
      if (!r.ok || r.text === undefined) return { ok: false, ...(r.errors ? { errors: r.errors } : {}), ...(r.warnings ? { warnings: r.warnings } : {}) }
      const dir = workspaceSkinsDir(await cwdFor(o))
      mkdirSync(dir, { recursive: true })
      const path = join(dir, name + SKIN_EXT)
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, r.text)
      renameSync(tmp, path)
      const skin = (await setFor(o)).info(name)
      return { ok: true, path, ...(skin ? { skin } : {}), ...(r.warnings ? { warnings: r.warnings } : {}) }
    },
    async select(sel) {
      if (!sel || typeof sel.name !== 'string' || (sel.mode !== 'light' && sel.mode !== 'dark')) throw new SkinError('select: нужен {name, mode: light|dark}', 'bad_request')
      mkdirSync(join(currentFile, '..'), { recursive: true })
      writeFileSync(currentFile, JSON.stringify({ name: sel.name, mode: sel.mode, at: new Date().toISOString() }) + '\n')
    },
    current: () => readCurrent(currentFile),
  }
}

/** Текущий выбор пользователя (фронт сообщает `skins.select`). */
export function readCurrent(file: string): SkinSelection | null {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; mode?: unknown }
    if (typeof j.name === 'string' && (j.mode === 'light' || j.mode === 'dark')) return { name: j.name, mode: j.mode }
  } catch {
    /* нет выбора */
  }
  return null
}

const SUMMARY_TOKENS = ['--nr-bg', '--nr-fg', '--nr-accent', '--nr-muted', '--nr-line', '--nr-font-body', '--nr-font-ui', '--nr-text-body', '--nr-measure', '--nr-avatar-size', '--nr-radius']

/** Переменные одного режима — короткой строкой для system (без шрифтовых хвостов). */
export function summarizeVars(vars: SkinVars, mode: 'light' | 'dark'): string {
  const all = modeVars(vars, mode)
  return SUMMARY_TOKENS.filter((k) => all[k] !== undefined)
    .map((k) => {
      const v = all[k]!
      return `${k.slice(5)} ${k.startsWith('--nr-font') ? v.split(',')[0]!.trim() : v}`
    })
    .join('; ')
}

/**
 * Блок system «текущий скин» (skin-spec §7): имя, режим, выжимка палитры и
 * шрифтов, где лежат скины и как править — чтобы агент правил осмысленно, а не
 * наугад. Нет выбора — по умолчанию parchment.
 */
export function skinContext(root: string, cwd?: string): string {
  const cur = readCurrent(currentSkinFile(root)) ?? { name: 'parchment', mode: 'light' as const }
  const set = skinSet(sharedSkinsDir(root), workspaceSkinsDir(cwd ?? root))
  const info = set.info(cur.name)
  const names = set.list().map((s) => `${s.name}${s.source === 'workspace' ? '*' : ''}${s.error ? ' (сломан)' : ''}`)
  const lines = [
    '## Тема интерфейса nrchat',
    `Сейчас: скин \`${cur.name}\`, режим ${cur.mode === 'dark' ? 'тёмный' : 'светлый'}${info?.base ? `, base: ${info.base}` : ''}${info ? '' : ' (встроенный)'}.`,
  ]
  if (info && !info.error) lines.push(`Значения: ${summarizeVars(set.compile(cur.name).vars, cur.mode)}.`)
  lines.push(
    `Скины: ${names.join(', ') || '—'} (* — рабочей области). Файлы скинов не читай, чтобы узнать, что есть и какие значения: список и выжимка — здесь, детали — skin_check(<имя>).`,
    'Редактор тем вкладкой — artifact_init(template: "jsx+skins"): готовый редактор на __host.skins ($uses: skins), его и правь.',
    'Новый или правленый скин — файл `.nr/skins/<имя>.skin.css` в рабочем каталоге: шапка `/* @skin name/description/mode: light|dark|both/base */`, ' +
      'тело — только `--nr-*` в `[data-skin="<имя>"]` / `[data-skin="<имя>"][data-mode="light|dark"]` и элементы ленты по контракту (`.nr-message[data-role=user|assistant]`, `.nr-author`, `.nr-avatar`, `.nr-text em`, `.nr-thinking`, `.nr-tool`, `.nr-composer`). ' +
      '«На основе X» — `base: X` и только отличия. После записи — `skin_check(<имя>)`; править чужой скин — сохранить под новым именем. Контракт — skin-spec (профиль артефактов, раздел «редактор тем»).',
  )
  return lines.join('\n')
}

export { REQUIRED_TOKENS, TOKENS }
