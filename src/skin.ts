/**
 * Файл скина (skin-spec §1): `<имя>.skin.css` — шапка-комментарий `@skin` и
 * CSS по контракту. Здесь — разбор шапки, валидатор и сборка с наследованием
 * `base`. Без IO: файлы читает источник (`./node`), здесь только текст.
 *
 *   /* @skin
 *    * name: scene
 *    * description: РП — длинные реплики, засечки, крупные аватары
 *    * mode: both
 *    * base: parchment
 *    *\/
 *   [data-skin="scene"][data-mode="dark"] { --nr-bg: #14110f; … }
 *   [data-skin="scene"] .nr-message[data-role=user] { border-left: 2px solid var(--nr-line); }
 */

import * as csstree from 'css-tree'
import {
  ELEMENT_PROPERTIES,
  ELEMENT_SELECTORS,
  ELEMENT_SELECTOR_SET,
  FONT_HOSTS,
  FORBIDDEN_TOKEN_PREFIXES,
  MAX_ELEMENT_DEPTH,
  PLUGIN_TOKEN_PREFIXES,
  REQUIRED_TOKENS,
  SKIN_MODES,
  SKIN_NAME_RE,
  TEXT_TAGS,
  TOKEN_BY_NAME,
  URL_TOKENS,
  type SkinMode,
} from './contract.js'
import { checkContrast, checkTextSize } from './readability.js'

export interface SkinHeader {
  name?: string
  description?: string
  mode?: SkinMode
  base?: string
}

/** Замечание валидатора: строка файла, что не так и что делать. */
export interface SkinIssue {
  line?: number
  message: string
  hint?: string
}

/** Переменные корневых правил: общие для режимов и по режимам. */
export interface SkinVars {
  common: Record<string, string>
  light: Record<string, string>
  dark: Record<string, string>
}

export interface ValidateResult {
  ok: boolean
  header: SkinHeader
  errors: SkinIssue[]
  warnings: SkinIssue[]
  vars: SkinVars
}

export interface ValidateOptions {
  /** Имя скина (из имени файла). Нет — берётся из шапки; нет и там — ошибка. */
  name?: string
  /** Известные скины — проверка `base`. Не задано — `base` не проверяется на существование. */
  known?: ReadonlySet<string> | readonly string[]
}

/** Текст замечания одной строкой: «строка 12: … — подсказка». */
export function formatIssue(i: SkinIssue): string {
  return `${i.line ? `строка ${i.line}: ` : ''}${i.message}${i.hint ? ` — ${i.hint}` : ''}`
}

// ────────────────────────────────────────────────────────────────────────────
// Шапка
// ────────────────────────────────────────────────────────────────────────────

const HEADER_RE = /^\s*\/\*\s*@skin\b([\s\S]*?)\*\//

/** Шапка `/* @skin … *\/` в начале файла; нет — пустая. */
export function parseHeader(text: string): { header: SkinHeader; errors: SkinIssue[] } {
  const m = HEADER_RE.exec(text)
  const header: SkinHeader = {}
  const errors: SkinIssue[] = []
  if (!m) return { header, errors }
  const body = m[1] ?? ''
  const startLine = text.slice(0, m.index).split('\n').length
  body.split('\n').forEach((raw, i) => {
    const line = raw.replace(/^\s*\*?\s?/, '').trim()
    if (!line) return
    const kv = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!kv) return
    const key = kv[1]!.toLowerCase()
    const value = kv[2]!.trim()
    const at = startLine + i
    if (key === 'name') header.name = value
    else if (key === 'description') header.description = value
    else if (key === 'base') header.base = value
    else if (key === 'mode') {
      if ((SKIN_MODES as readonly string[]).includes(value)) header.mode = value as SkinMode
      else errors.push({ line: at, message: `mode: "${value}"`, hint: `допустимо ${SKIN_MODES.join(' | ')}` })
    } else errors.push({ line: at, message: `неизвестный ключ шапки "${key}"`, hint: 'в шапке: name, description, mode, base' })
  })
  return { header, errors }
}

/** Шапка текстом — для `save` без своей шапки и для редактора. */
export function formatHeader(h: SkinHeader & { name: string }): string {
  const lines = [`name: ${h.name}`]
  if (h.description) lines.push(`description: ${h.description.replace(/\*\//g, '* /')}`)
  lines.push(`mode: ${h.mode ?? 'both'}`)
  if (h.base) lines.push(`base: ${h.base}`)
  return `/* @skin\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`
}

/** Текст скина с заменённой (или добавленной) шапкой. */
export function withHeader(text: string, h: SkinHeader & { name: string }): string {
  return formatHeader(h) + text.replace(HEADER_RE, '').replace(/^\s*\n/, '')
}

// ────────────────────────────────────────────────────────────────────────────
// Валидатор
// ────────────────────────────────────────────────────────────────────────────

const ALLOWED_LIST = ELEMENT_SELECTORS.map((s) => s.selector).join(', ')
const ROOT_HINT = (name: string) => `правило начинается с [data-skin="${name}"] (+ [data-mode="light|dark"])`

type Mode = 'common' | 'light' | 'dark'

/** Значение атрибута селектора без кавычек. */
function attrValue(node: csstree.AttributeSelector): string | null {
  const v = node.value
  if (!v) return null
  return v.type === 'String' ? v.value : v.type === 'Identifier' ? v.name : null
}

/** Звено селектора каноническим текстом: `.nr-message[data-role=user]`. */
function compoundText(nodes: csstree.CssNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'AttributeSelector') {
        const v = attrValue(n)
        return `[${n.name.name}${n.matcher ?? ''}${v ?? ''}]`
      }
      return csstree.generate(n)
    })
    .join('')
}

interface SelectorCheck {
  ok: boolean
  mode: Mode
  /** Корневое правило (только переменные) или элементное. */
  element: boolean
  issue?: SkinIssue
}

function checkSelector(sel: csstree.Selector, name: string, line: number | undefined): SelectorCheck {
  const nodes = sel.children.toArray()
  // Корень: первое звено до комбинатора — только [data-skin] и [data-mode].
  const first: csstree.CssNode[] = []
  let i = 0
  for (; i < nodes.length && nodes[i]!.type !== 'Combinator'; i++) first.push(nodes[i]!)
  let skin: string | null = null
  let mode: Mode = 'common'
  for (const n of first) {
    if (n.type === 'AttributeSelector' && n.name.name === 'data-skin' && n.matcher === '=') skin = attrValue(n)
    else if (n.type === 'AttributeSelector' && n.name.name === 'data-mode' && n.matcher === '=') {
      const v = attrValue(n)
      if (v !== 'light' && v !== 'dark') {
        return { ok: false, mode, element: false, issue: { line, message: `[data-mode="${v}"]`, hint: 'режим — light или dark' } }
      }
      mode = v
    } else {
      return {
        ok: false,
        mode,
        element: false,
        issue: { line, message: `селектор «${csstree.generate(sel)}»: в корне только [data-skin] и [data-mode]`, hint: ROOT_HINT(name) },
      }
    }
  }
  if (skin === null) {
    return { ok: false, mode, element: false, issue: { line, message: `селектор «${csstree.generate(sel)}» без [data-skin="${name}"]`, hint: ROOT_HINT(name) } }
  }
  if (skin !== name) {
    return {
      ok: false,
      mode,
      element: false,
      issue: { line, message: `селектор для чужого скина [data-skin="${skin}"]`, hint: `этот файл — скин "${name}"; наследование — base: ${skin} в шапке` },
    }
  }
  if (i >= nodes.length) return { ok: true, mode, element: false }

  // Звенья ленты: только потомок (пробел), каждое — из контракта; теги — внутри .nr-text.
  const chain: string[] = []
  let compound: csstree.CssNode[] = []
  const flush = (): SkinIssue | null => {
    if (!compound.length) return { line, message: `селектор «${csstree.generate(sel)}»: пустое звено`, hint: 'звенья — через пробел' }
    const text = compoundText(compound)
    const isTag = compound.length === 1 && compound[0]!.type === 'TypeSelector'
    if (isTag) {
      if (!TEXT_TAGS.includes(text)) return { line, message: `тег ${text} вне контракта`, hint: `внутри .nr-text разрешены: ${TEXT_TAGS.join(', ')}` }
      if (!chain.includes('.nr-text')) return { line, message: `тег ${text} вне .nr-text`, hint: `теги разметки — только как «.nr-text ${text}»` }
    } else if (!ELEMENT_SELECTOR_SET.has(text)) {
      return { line, message: `селектор «${text}» вне контракта`, hint: `разрешены: ${ALLOWED_LIST}; теги внутри .nr-text: ${TEXT_TAGS.join(', ')}` }
    }
    chain.push(text)
    compound = []
    return null
  }
  for (; i < nodes.length; i++) {
    const n = nodes[i]!
    if (n.type === 'Combinator') {
      if (n.name !== ' ') {
        return { ok: false, mode, element: true, issue: { line, message: `комбинатор «${n.name}» не разрешён`, hint: 'звенья — только через пробел (потомок)' } }
      }
      if (compound.length) {
        const issue = flush()
        if (issue) return { ok: false, mode, element: true, issue }
      }
      continue
    }
    if (n.type === 'PseudoClassSelector' || n.type === 'PseudoElementSelector') {
      return {
        ok: false,
        mode,
        element: true,
        issue: { line, message: `псевдо-селектор ${csstree.generate(n)} не разрешён`, hint: 'скин не меняет состояния и не добавляет контент' },
      }
    }
    compound.push(n)
  }
  const issue = flush()
  if (issue) return { ok: false, mode, element: true, issue }
  if (chain.length > MAX_ELEMENT_DEPTH) {
    return { ok: false, mode, element: true, issue: { line, message: `селектор «${csstree.generate(sel)}» длиннее ${MAX_ELEMENT_DEPTH} звеньев`, hint: 'упрости цепочку' } }
  }
  return { ok: true, mode, element: true }
}

function fontHostOk(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && FONT_HOSTS.includes(u.hostname)
  } catch {
    return false
  }
}

/** Url-узлы значения. */
function urlsOf(node: csstree.CssNode | null | undefined): string[] {
  const out: string[] = []
  if (!node) return out
  csstree.walk(node, (x) => {
    if (x.type === 'Url') out.push(x.value)
  })
  return out
}

function checkDeclaration(d: csstree.Declaration, element: boolean, line: number | undefined, errors: SkinIssue[], warnings: SkinIssue[]): boolean {
  const prop = d.property
  if (d.important) errors.push({ line, message: `${prop}: !important`, hint: 'скину !important не нужен — правила скина и так сильнее дефолтов' })
  const value = csstree.generate(d.value).trim()
  if (prop.startsWith('--')) {
    if (!prop.startsWith('--nr-')) {
      errors.push({ line, message: `переменная ${prop} вне пространства --nr-*`, hint: 'скин задаёт только --nr-* (список — skin-spec §3)' })
      return false
    }
    const forbidden = FORBIDDEN_TOKEN_PREFIXES.find((f) => prop.startsWith(f.prefix))
    if (forbidden) {
      errors.push({ line, message: `${prop} — служебная переменная`, hint: forbidden.why })
      return false
    }
    if (/url\(/i.test(value) && !URL_TOKENS.includes(prop)) {
      errors.push({ line, message: `${prop}: url() в значении`, hint: `картинка — только в ${URL_TOKENS.join(', ')}` })
      return false
    }
    if (!TOKEN_BY_NAME.has(prop) && !PLUGIN_TOKEN_PREFIXES.some((p) => prop.startsWith(p))) {
      warnings.push({ line, message: `неизвестный токен ${prop}`, hint: 'опечатка? Ядро его не читает (список — skin-spec §3)' })
    }
    if (value === '') errors.push({ line, message: `${prop}: пустое значение` })
    // Читаемость (DEV-254): кегль ступеней текста — не мельче минимума.
    const small = checkTextSize(prop, value)
    if (small) errors.push({ line, ...small })
    return true
  }
  if (!element) {
    errors.push({ line, message: `свойство ${prop} в корневом правиле`, hint: 'в [data-skin]/[data-mode] — только --nr-* переменные; оформление элемента — правилом .nr-…' })
    return false
  }
  if (!ELEMENT_PROPERTIES.includes(prop)) {
    errors.push({ line, message: `свойство ${prop} не разрешено`, hint: `элементу можно: цвет, фон, рамку, шрифт, прозрачность, padding (${ELEMENT_PROPERTIES.slice(0, 8).join(', ')}, …)` })
    return false
  }
  const urls = urlsOf(d.value)
  if (urls.length && !urls.every((u) => u.startsWith('data:'))) {
    errors.push({ line, message: `${prop}: внешний url()`, hint: 'картинка элемента — только data:-URL; фон окна — токены --nr-bg-app/--nr-bg-chat' })
    return false
  }
  return true
}

/**
 * Проверка текста скина по контракту. `ok` — нет ошибок; предупреждения не
 * мешают. `vars` — переменные корневых правил (для редактора и выжимки агенту).
 */
export function validateSkin(text: string, opts: ValidateOptions = {}): ValidateResult {
  const { header, errors } = parseHeader(text)
  const warnings: SkinIssue[] = []
  const vars: SkinVars = { common: {}, light: {}, dark: {} }
  const name = opts.name ?? header.name
  const done = (): ValidateResult => ({ ok: errors.length === 0, header, errors, warnings, vars })

  if (!name) {
    errors.push({ message: 'у скина нет имени', hint: 'файл <имя>.skin.css или name: в шапке /* @skin */' })
    return done()
  }
  if (!SKIN_NAME_RE.test(name)) errors.push({ message: `имя "${name}"`, hint: 'латиница в нижнем регистре, цифры, дефис; с буквы; до 40' })
  if (header.name && opts.name && header.name !== opts.name) {
    errors.push({ message: `name: ${header.name} в шапке, а файл — ${opts.name}.skin.css`, hint: 'имя скина = имя файла' })
  }
  if (header.base !== undefined) {
    const known = opts.known ? new Set(opts.known) : null
    if (header.base === name) errors.push({ message: `base: ${name} — скин наследует сам себя` })
    else if (!SKIN_NAME_RE.test(header.base)) errors.push({ message: `base: "${header.base}" — не имя скина` })
    else if (known && !known.has(header.base)) {
      errors.push({ message: `base: ${header.base} — такого скина нет`, hint: `есть: ${[...known].sort().join(', ') || '—'}` })
    }
  }

  let ast: csstree.CssNode
  try {
    ast = csstree.parse(text, {
      positions: true,
      parseCustomProperty: false,
      onParseError: (e: { message: string; line?: number }) => errors.push({ line: e.line, message: `CSS не разбирается: ${e.message}` }),
    })
  } catch (e) {
    errors.push({ message: `CSS не разбирается: ${e instanceof Error ? e.message : String(e)}` })
    return done()
  }
  if (ast.type !== 'StyleSheet') return done()

  let sawRule = false
  ast.children.forEach((node) => {
    const line = node.loc?.start.line
    if (node.type === 'Atrule') {
      const at = node.name.toLowerCase()
      if (at === 'import') {
        const urls = urlsOf(node.prelude)
        csstree.walk(node.prelude ?? node, (x) => {
          if (x.type === 'String') urls.push(x.value)
        })
        if (sawRule) errors.push({ line, message: '@import после правил', hint: '@import — в начале файла, сразу после шапки' })
        if (!urls.length || !urls.every(fontHostOk)) {
          errors.push({ line, message: `@import ${urls[0] ?? ''}`, hint: `импорт — только таблицы шрифтов https://${FONT_HOSTS.join(' | https://')}` })
        }
        return
      }
      if (at === 'font-face') {
        node.block?.children.forEach((d) => {
          if (d.type !== 'Declaration') return
          if (d.property === 'src') {
            const bad = urlsOf(d.value).filter((u) => !fontHostOk(u))
            if (bad.length) errors.push({ line: d.loc?.start.line, message: `@font-face src: ${bad[0]}`, hint: `шрифт — local(…) или https://${FONT_HOSTS.join(' | https://')}` })
          }
        })
        return
      }
      errors.push({
        line,
        message: `@${node.name} не разрешён`,
        hint: at === 'media' ? 'режимы — через [data-mode="light|dark"], не @media' : 'в скине: правила по контракту, @import и @font-face шрифтов',
      })
      return
    }
    if (node.type !== 'Rule') return
    sawRule = true
    if (node.prelude.type !== 'SelectorList') {
      errors.push({ line, message: 'селектор не разбирается' })
      return
    }
    const checks: SelectorCheck[] = []
    node.prelude.children.forEach((sel) => {
      if (sel.type !== 'Selector') return
      const c = checkSelector(sel, name, line)
      if (!c.ok && c.issue) errors.push(c.issue)
      checks.push(c)
    })
    if (!checks.length || checks.some((c) => !c.ok)) return
    const element = checks.some((c) => c.element)
    if (element && checks.some((c) => !c.element)) {
      errors.push({ line, message: 'корневой и элементный селекторы в одном правиле', hint: 'раздели на два правила' })
      return
    }
    node.block.children.forEach((d) => {
      const dl = d.loc?.start.line ?? line
      if (d.type === 'Rule' || d.type === 'Atrule') {
        errors.push({ line: dl, message: 'вложенные правила не разрешены', hint: 'каждое правило — со своим полным селектором' })
        return
      }
      if (d.type !== 'Declaration') return
      if (!checkDeclaration(d, element, dl, errors, warnings)) return
      if (!element && d.property.startsWith('--')) {
        const value = csstree.generate(d.value).trim()
        for (const c of checks) vars[c.mode][d.property] = value
      }
    })
  })
  return done()
}

// ────────────────────────────────────────────────────────────────────────────
// Сборка с наследованием
// ────────────────────────────────────────────────────────────────────────────

export interface CompiledSkin {
  name: string
  header: SkinHeader
  /** Итоговый CSS: база (переименованная в этот скин) + свой, `@import` — наверху. */
  css: string
  /** Переменные с учётом базы. */
  vars: SkinVars
  /** Цепочка наследования: [имя, база, база базы…]. */
  chain: string[]
  errors: SkinIssue[]
  warnings: SkinIssue[]
}

/** Текст скина по имени — у источника (файлы, память). */
export type SkinLookup = (name: string) => string | undefined

/** Режимы, в которых скин обязан нести палитру. */
export function modesOf(mode: SkinMode | undefined): Array<'light' | 'dark'> {
  return mode === 'light' ? ['light'] : mode === 'dark' ? ['dark'] : ['light', 'dark']
}

/** Итоговые значения режима: общие + режимные. */
export function modeVars(vars: SkinVars, mode: 'light' | 'dark'): Record<string, string> {
  return { ...vars.common, ...vars[mode] }
}

/** Переименовать `[data-skin=from]` → `[data-skin="to"]` в AST и сгенерировать; `@import` — отдельно. */
function renamed(text: string, from: string, to: string): { imports: string[]; body: string } {
  const ast = csstree.parse(text, { parseCustomProperty: false })
  const imports: string[] = []
  const body: string[] = []
  if (ast.type !== 'StyleSheet') return { imports, body: '' }
  csstree.walk(ast, (node) => {
    if (node.type === 'AttributeSelector' && node.name.name === 'data-skin' && attrValue(node) === from) {
      node.value = { type: 'String', value: to }
    }
  })
  ast.children.forEach((node) => {
    const css = csstree.generate(node)
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') imports.push(css)
    else body.push(css)
  })
  return { imports, body: body.join('\n') }
}

/**
 * Собрать скин: проверить его и цепочку баз, CSS базы переименовать в этот
 * скин и поставить перед своим (своё правило сильнее — оно позже). Ошибка базы
 * — ошибка скина (с именем базы).
 */
export function compileSkin(name: string, lookup: SkinLookup, known?: ReadonlySet<string> | readonly string[]): CompiledSkin {
  const chain: string[] = []
  const errors: SkinIssue[] = []
  const warnings: SkinIssue[] = []
  const layers: Array<{ name: string; text: string; vars: SkinVars }> = []
  let header: SkinHeader = {}
  let cur: string | undefined = name
  while (cur !== undefined) {
    if (chain.includes(cur)) {
      errors.push({ message: `цикл наследования: ${[...chain, cur].join(' → ')}`, hint: 'убери base у одного из скинов' })
      break
    }
    chain.push(cur)
    const text = lookup(cur)
    if (text === undefined) {
      errors.push({ message: cur === name ? `скина ${name} нет` : `base: ${cur} — такого скина нет`, ...(known ? { hint: `есть: ${[...known].sort().join(', ')}` } : {}) })
      break
    }
    const v = validateSkin(text, { name: cur, ...(known ? { known } : {}) })
    const prefix = cur === name ? '' : `база ${cur}: `
    errors.push(...v.errors.map((e) => ({ ...e, message: prefix + e.message })))
    if (cur === name) {
      header = v.header
      warnings.push(...v.warnings)
    }
    layers.unshift({ name: cur, text, vars: v.vars })
    cur = v.header.base
  }
  const vars: SkinVars = { common: {}, light: {}, dark: {} }
  let css = ''
  if (!errors.length) {
    const imports: string[] = []
    const bodies: string[] = []
    for (const layer of layers) {
      const r = renamed(layer.text, layer.name, name)
      imports.push(...r.imports)
      bodies.push(`/* ${layer.name === name ? name : `base: ${layer.name}`} */\n${r.body}`)
      for (const m of ['common', 'light', 'dark'] as const) Object.assign(vars[m], layer.vars[m])
    }
    css = [...new Set(imports)].join('\n') + (imports.length ? '\n' : '') + bodies.join('\n')
    for (const mode of modesOf(header.mode)) {
      const have = modeVars(vars, mode)
      const missing = REQUIRED_TOKENS.filter((tok) => !(tok in have))
      if (missing.length) {
        errors.push({
          message: `палитра режима ${mode} неполная: нет ${missing.join(', ')}`,
          hint: `задай их в [data-skin="${name}"][data-mode="${mode}"], укажи base: <скин> или mode: ${mode === 'dark' ? 'light' : 'dark'} в шапке`,
        })
      }
      // Контраст текста и статусов (DEV-254) — предупреждение: скин рисуется,
      // редактор тем и агент видят, что поправить; строго — тест скинов.
      for (const c of checkContrast(have, mode)) warnings.push({ message: c.message, ...(c.hint ? { hint: c.hint } : {}) })
    }
  }
  return { name, header, css: errors.length ? '' : css, vars, chain, errors, warnings }
}
