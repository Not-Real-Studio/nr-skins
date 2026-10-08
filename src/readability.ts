/**
 * Правила читаемости скина (DEV-254, skin-spec §3.1): минимум кегля и контраст
 * статусов. Без IO и без DOM — чистые функции над значениями переменных:
 * их зовут валидатор (кегль), `compileSkin` (контраст — предупреждением) и
 * тест скинов (контраст — строго, по всем скинам студии и встроенным nrchat).
 *
 *   - кегль: ступени `--nr-text-*` в `rem`/`px`, при 100% (корень 16px) —
 *     не мельче `TEXT_MIN_PX` (13px), базовый текст (`sm`, `body`) — не мельче
 *     `TEXT_BASE_MIN_PX` (15px);
 *   - контраст: `--nr-fg`, `--nr-muted`, `--nr-accent`, `--nr-ok`, `--nr-error`
 *     к `--nr-bg` и `--nr-surface` — не ниже `CONTRAST_MIN` (4.5:1, WCAG AA),
 *     в каждом заявленном режиме. Полупрозрачный цвет кладётся на фон.
 */

/** Корень документа при «размере текста» 100%. */
export const ROOT_PX = 16
/** Самая мелкая ступень текста — не мельче (px при 100%). */
export const TEXT_MIN_PX = 13
/** Базовый текст интерфейса и тело реплики — не мельче (px при 100%). */
export const TEXT_BASE_MIN_PX = 15
/** Контраст статусов и текста к фону (WCAG AA для обычного текста). */
export const CONTRAST_MIN = 4.5

/** Ступени кегля и их минимум. */
export const TEXT_MINIMUMS: Readonly<Record<string, number>> = {
  '--nr-text-xs': TEXT_MIN_PX,
  '--nr-text-sm': TEXT_BASE_MIN_PX,
  '--nr-text-md': TEXT_MIN_PX,
  '--nr-text-lg': TEXT_MIN_PX,
  '--nr-text-body': TEXT_BASE_MIN_PX,
}

/** Текст и статусы, которые обязаны читаться… */
export const CONTRAST_FG: readonly string[] = ['--nr-fg', '--nr-muted', '--nr-accent', '--nr-ok', '--nr-error']
/** …на этих фонах. */
export const CONTRAST_BG: readonly string[] = ['--nr-bg', '--nr-surface']

/** Кегль в px при корне 16px: `0.9375rem` → 15, `14px` → 14; иначе `null` (calc, var, em). */
export function textPx(value: string): number | null {
  const m = /^\s*(\d*\.?\d+)\s*(rem|px)\s*$/i.exec(value)
  if (!m) return null
  const n = Number(m[1])
  return m[2]!.toLowerCase() === 'rem' ? n * ROOT_PX : n
}

/** Замечание о кегле: `null` — в порядке (или значение не проверить — см. `textPx`). */
export function checkTextSize(name: string, value: string): { message: string; hint: string } | null {
  const min = TEXT_MINIMUMS[name]
  if (min === undefined) return null
  const px = textPx(value)
  if (px === null || px + 1e-6 >= min) return null
  return {
    message: `${name}: ${value} — ${round(px)}px при 100%, мельче ${min}px`,
    hint:
      min === TEXT_BASE_MIN_PX
        ? `базовый текст (--nr-text-sm, --nr-text-body) — не мельче ${TEXT_BASE_MIN_PX}px (${TEXT_BASE_MIN_PX / ROOT_PX}rem); мельче хочет пользователь — «размер текста» 85–90%`
        : `ступени текста — не мельче ${TEXT_MIN_PX}px (${TEXT_MIN_PX / ROOT_PX}rem)`,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Цвет
// ────────────────────────────────────────────────────────────────────────────

/** sRGB 0…255 и альфа 0…1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const round = (n: number): number => Math.round(n * 100) / 100

function channel(raw: string, max = 255): number {
  const s = raw.trim()
  if (s.endsWith('%')) return (Number(s.slice(0, -1)) / 100) * max
  return Number(s)
}

function alpha(raw: string | undefined): number {
  if (raw === undefined) return 1
  const s = raw.trim()
  return s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const NAMED: Readonly<Record<string, Rgba>> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
}

/**
 * Цвет из значения переменной: `#rgb[a]`, `#rrggbb[aa]`, `rgb()/rgba()` (через
 * запятые и через пробел с `/ альфа`), `hsl()/hsla()`, `var(--nr-…)` из `vars`.
 * Остальное (`color-mix`, `oklch`, имена кроме black/white) — `null`: проверка
 * его пропускает и говорит об этом.
 */
export function parseColor(value: string, vars: Readonly<Record<string, string>> = {}, depth = 0): Rgba | null {
  const v = value.trim().toLowerCase()
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/.exec(v)
  if (ref) {
    if (depth > 8) return null
    const target = vars[ref[1]!] ?? ref[2]
    return target === undefined ? null : parseColor(target, vars, depth + 1)
  }
  if (NAMED[v]) return NAMED[v]!
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)
  if (hex) {
    const h = hex[1]!
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16))
      return { r: r!, g: g!, b: b!, a: a === undefined ? 1 : a / 255 }
    }
    if (h.length === 6 || h.length === 8) {
      const n = (i: number): number => parseInt(h.slice(i, i + 2), 16)
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
    }
    return null
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(v)
  if (!fn) return null
  const body = fn[2]!.trim()
  let parts: string[]
  let a: string | undefined
  if (body.includes(',')) {
    parts = body.split(',').map((x) => x.trim())
    if (parts.length === 4) a = parts.pop()
  } else {
    const [main, al] = body.split('/')
    parts = main!.trim().split(/\s+/)
    a = al?.trim()
  }
  if (parts.length !== 3) return null
  let rgb: [number, number, number]
  if (fn[1]!.startsWith('rgb')) rgb = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)]
  else {
    const h = Number(parts[0]!.replace(/deg$/, ''))
    rgb = hslToRgb(h, channel(parts[1]!, 1), channel(parts[2]!, 1))
  }
  const out = { r: rgb[0], g: rgb[1], b: rgb[2], a: alpha(a) }
  return [out.r, out.g, out.b, out.a].every(Number.isFinite) ? out : null
}

/** Положить цвет на непрозрачный фон. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}

function luminance(c: Rgba): number {
  const lin = (x: number): number => {
    const s = x / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** Контраст WCAG 2.x двух цветов; полупрозрачный передний — поверх заднего. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const back = bg.a < 1 ? over(bg, NAMED.white!) : bg
  const front = fg.a < 1 ? over(fg, back) : fg
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Пара «текст на фоне», которая не читается (или не проверена). */
export interface ContrastIssue {
  mode?: 'light' | 'dark'
  fg: string
  bg: string
  /** Контраст; `null` — цвет не разобран (color-mix, oklch…). */
  ratio: number | null
  message: string
  hint?: string
}

/**
 * Контраст текста и статусов к фонам одного режима (`vars` — итоговые
 * переменные режима, как `modeVars`). Нет пары переменных — пропуск (полноту
 * палитры проверяет `compileSkin`).
 */
export function checkContrast(vars: Readonly<Record<string, string>>, mode?: 'light' | 'dark'): ContrastIssue[] {
  const issues: ContrastIssue[] = []
  const where = mode ? ` (${mode})` : ''
  for (const bgName of CONTRAST_BG) {
    const bgRaw = vars[bgName]
    if (bgRaw === undefined) continue
    const bg = parseColor(bgRaw, vars)
    for (const fgName of CONTRAST_FG) {
      const fgRaw = vars[fgName]
      if (fgRaw === undefined) continue
      const fg = parseColor(fgRaw, vars)
      if (!fg || !bg) {
        issues.push({
          ...(mode ? { mode } : {}),
          fg: fgName,
          bg: bgName,
          ratio: null,
          message: `контраст ${fgName} к ${bgName}${where} не проверить: «${!fg ? fgRaw : bgRaw}»`,
          hint: 'палитра — #hex, rgb() или hsl(); color-mix и oklch проверка не считает',
        })
        continue
      }
      const ratio = contrastRatio(fg, bg)
      if (ratio + 1e-9 < CONTRAST_MIN) {
        issues.push({
          ...(mode ? { mode } : {}),
          fg: fgName,
          bg: bgName,
          ratio: round(ratio),
          message: `контраст ${fgName} к ${bgName}${where} ${round(ratio)}:1 — меньше ${CONTRAST_MIN}:1`,
          hint: `тот же оттенок ${luminance(bg.a < 1 ? over(bg, NAMED.white!) : bg) > 0.18 ? 'темнее' : 'светлее'}: статус и текст читаются на фоне и на подложке панелей`,
        })
      }
    }
  }
  return issues
}
