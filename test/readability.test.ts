import { describe, expect, it } from 'vitest'
import {
  checkContrast,
  checkTextSize,
  compileSkin,
  contrastRatio,
  formatIssue,
  parseColor,
  READABILITY_RULES,
  textPx,
  TOKEN_BY_NAME,
  validateSkin,
} from '../src/index.js'

const HEAD = `/* @skin\n * name: x\n * mode: light\n */\n`
const PALETTE = (over: Record<string, string> = {}) => {
  const v: Record<string, string> = {
    '--nr-bg': '#f6efe3',
    '--nr-surface': '#efe6d8',
    '--nr-raised': '#fffaf0',
    '--nr-line': '#ddd0bb',
    '--nr-fg': '#1f1a14',
    '--nr-muted': 'rgb(31 26 20 / 0.7)',
    '--nr-accent': '#985518',
    '--nr-ok': '#5f6c33',
    '--nr-error': '#a8452c',
    '--nr-accent-fg': '#fffaf0',
    '--nr-line-soft': '#e3d7c4',
    '--nr-shadow-pop': 'none',
    ...over,
  }
  return `[data-skin="x"][data-mode="light"] { ${Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(' ')} }`
}

describe('кегль', () => {
  it('rem и px при корне 16px; calc/var не проверяются', () => {
    expect(textPx('0.9375rem')).toBe(15)
    expect(textPx('14px')).toBe(14)
    expect(textPx('calc(1rem - 2px)')).toBeNull()
    expect(checkTextSize('--nr-text-sm', '0.9375rem')).toBeNull()
    expect(checkTextSize('--nr-text-xs', '0.8125rem')).toBeNull()
    expect(checkTextSize('--nr-text-sm', '0.875rem')?.message).toMatch(/14px при 100%, мельче 15px/)
    expect(checkTextSize('--nr-text-xs', '12px')?.message).toMatch(/мельче 13px/)
    expect(checkTextSize('--nr-radius', '2px')).toBeNull()
  })

  it('валидатор ругается на мелкий кегль строкой файла', () => {
    const r = validateSkin(HEAD + PALETTE() + `\n[data-skin="x"] { --nr-text-body: 0.875rem; --nr-text-xs: 0.65625rem; --nr-text-lg: 1.2rem }`, { name: 'x' })
    expect(r.ok).toBe(false)
    const msgs = r.errors.map(formatIssue)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatch(/^строка 6: --nr-text-body: 0.875rem — 14px при 100%, мельче 15px — базовый текст/)
    expect(msgs[1]).toMatch(/--nr-text-xs: 0.65625rem — 10.5px при 100%, мельче 13px/)
  })
})

describe('цвет и контраст', () => {
  it('разбирает hex, rgb через пробел и запятые, hsl, var', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2)
    expect(parseColor('rgb(31 26 20 / 0.7)')).toEqual({ r: 31, g: 26, b: 20, a: 0.7 })
    expect(parseColor('rgba(31, 26, 20, 0.5)')).toEqual({ r: 31, g: 26, b: 20, a: 0.5 })
    const red = parseColor('hsl(0 100% 50%)')!
    expect([Math.round(red.r), Math.round(red.g), Math.round(red.b)]).toEqual([255, 0, 0])
    expect(parseColor('var(--nr-fg)', { '--nr-fg': '#123456' })).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 })
    expect(parseColor('color-mix(in srgb, red 50%, blue)')).toBeNull()
  })

  it('контраст WCAG: чёрный на белом 21, полупрозрачный — поверх фона', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 5)
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 2)
    // 50% чёрного на белом = #808080
    expect(contrastRatio(parseColor('rgb(0 0 0 / 0.5)')!, parseColor('#fff')!)).toBeCloseTo(contrastRatio(parseColor('#808080')!, parseColor('#fff')!), 1)
  })

  it('checkContrast: статус к фону и к подложке, режим в сообщении', () => {
    const vars = { '--nr-bg': '#f6efe3', '--nr-surface': '#efe6d8', '--nr-fg': '#1f1a14', '--nr-error': '#c2603f', '--nr-ok': '#5f6c33' }
    const issues = checkContrast(vars, 'light')
    expect(issues.map((i) => `${i.fg}/${i.bg}`)).toEqual(['--nr-error/--nr-bg', '--nr-error/--nr-surface'])
    expect(issues[0]!.message).toMatch(/контраст --nr-error к --nr-bg \(light\) \d\.\d+:1 — меньше 4.5:1/)
    expect(issues[0]!.hint).toMatch(/темнее/)
    expect(checkContrast({ ...vars, '--nr-error': 'color-mix(in srgb, red, blue)' }, 'light')[0]!.ratio).toBeNull()
  })

  it('compileSkin: плохой контраст — предупреждение, скин собирается', () => {
    const texts: Record<string, string> = { x: HEAD + PALETTE({ '--nr-accent': '#d08a40' }) }
    const c = compileSkin('x', (n) => texts[n])
    expect(c.errors).toEqual([])
    expect(c.css).not.toBe('')
    expect(c.warnings.map((w) => w.message)).toEqual([
      expect.stringMatching(/^контраст --nr-accent к --nr-bg \(light\)/),
      expect.stringMatching(/^контраст --nr-accent к --nr-surface \(light\)/),
    ])
  })
})

describe('контракт для агента', () => {
  it('правила читаемости словами и в описаниях токенов', () => {
    expect(READABILITY_RULES.join('\n')).toMatch(/15px[\s\S]*13px[\s\S]*моноширинный[\s\S]*4\.5:1/)
    expect(TOKEN_BY_NAME.get('--nr-font-mono')!.description).toMatch(/только код, пути, id/)
    expect(TOKEN_BY_NAME.get('--nr-text-sm')!.description).toMatch(/не мельче 15px/)
    expect(TOKEN_BY_NAME.get('--nr-error')!.description).toMatch(/4\.5:1/)
  })
})
