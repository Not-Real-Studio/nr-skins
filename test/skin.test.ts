import { describe, expect, it } from 'vitest'
import { compileSkin, formatIssue, parseHeader, validateSkin, withHeader } from '../src/index.js'

const PALETTE = (mode: string) => `[data-skin="x"][data-mode="${mode}"] {
  --nr-bg: #000; --nr-surface: #111; --nr-raised: #222; --nr-line: #333; --nr-fg: #eee; --nr-muted: #999;
  --nr-accent: #f80; --nr-ok: #0f0; --nr-error: #f00; --nr-accent-fg: #000; --nr-line-soft: #222; --nr-shadow-pop: none;
}`
const HEAD = (extra = '') => `/* @skin\n * name: x\n * description: тест\n * mode: both\n${extra} */\n`

describe('шапка', () => {
  it('разбирает ключи и ругается на мусор', () => {
    const { header, errors } = parseHeader(`/* @skin\n * name: scene\n * mode: dark\n * base: parchment\n * colour: red\n */\n`)
    expect(header).toEqual({ name: 'scene', mode: 'dark', base: 'parchment' })
    expect(errors.map(formatIssue)[0]).toMatch(/неизвестный ключ шапки "colour"/)
  })
  it('withHeader заменяет шапку', () => {
    const t = withHeader(HEAD() + 'a{}', { name: 'y', base: 'x' })
    expect(parseHeader(t).header).toEqual({ name: 'y', mode: 'both', base: 'x' })
    expect(t.match(/@skin/g)).toHaveLength(1)
  })
})

describe('валидатор', () => {
  it('скин по контракту — ok, переменные по режимам', () => {
    const r = validateSkin(HEAD() + PALETTE('light') + PALETTE('dark') + `
[data-skin="x"] { --nr-font-body: Lora, serif; --nr-avatar-size: 38px; }
[data-skin="x"] .nr-message[data-role=user] .nr-author { color: var(--nr-muted); }
[data-skin='x'][data-mode='dark'] .nr-text em { color: #c9a; font-style: italic; }
`, { name: 'x' })
    expect(r.errors.map(formatIssue)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.vars.dark['--nr-bg']).toBe('#000')
    expect(r.vars.common['--nr-avatar-size']).toBe('38px')
  })

  it('чужой селектор → ошибка с подсказкой', () => {
    const r = validateSkin(HEAD() + `[data-skin="x"] .sidebar { color: red }\n.panel { --nr-bg: red }`, { name: 'x' })
    expect(r.ok).toBe(false)
    const msgs = r.errors.map(formatIssue)
    expect(msgs[0]).toMatch(/строка 6: селектор «\.sidebar» вне контракта — разрешены: \.nr-feed/)
    expect(msgs[1]).toMatch(/«\.panel»: в корне только \[data-skin\] и \[data-mode\] — правило начинается с \[data-skin="x"\]/)
  })

  it('только --nr-* в корне, свойства элемента — из списка', () => {
    const r = validateSkin(HEAD() + `[data-skin="x"] { --my-color: red; color: red; --nr-z-modal: 1 }
[data-skin="x"] .nr-message { display: none; position: absolute }
[data-skin="x"] .nr-text em { color: red !important }`, { name: 'x' })
    const msgs = r.errors.map((e) => e.message)
    expect(msgs).toContain('переменная --my-color вне пространства --nr-*')
    expect(msgs).toContain('свойство color в корневом правиле')
    expect(msgs).toContain('--nr-z-modal — служебная переменная')
    expect(msgs).toContain('свойство display не разрешено')
    expect(msgs).toContain('свойство position не разрешено')
    expect(msgs).toContain('color: !important')
  })

  it('неизвестный --nr-* — предупреждение, плагинный --nr-tv-* — молча', () => {
    const r = validateSkin(HEAD() + `[data-skin="x"] { --nr-accnet: red; --nr-tv-gold: #fc0 }`, { name: 'x' })
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.message)).toEqual(['неизвестный токен --nr-accnet'])
  })

  it('@media, псевдо, комбинаторы, теги вне .nr-text — нельзя', () => {
    const r = validateSkin(HEAD() + `@media (min-width: 1px) { [data-skin="x"] { --nr-bg: red } }
[data-skin="x"] .nr-message:hover { color: red }
[data-skin="x"] > .nr-message { color: red }
[data-skin="x"] .nr-message em { color: red }`, { name: 'x' })
    const msgs = r.errors.map((e) => e.message)
    expect(msgs[0]).toBe('@media не разрешён')
    expect(msgs).toContain('псевдо-селектор :hover не разрешён')
    expect(msgs).toContain('комбинатор «>» не разрешён')
    expect(msgs).toContain('тег em вне .nr-text')
  })

  it('шрифты: Google/Bunny и local — да, чужой хост — нет', () => {
    const ok = validateSkin(HEAD() + `@import url("https://fonts.googleapis.com/css2?family=Lora&display=swap");
@import url(https://fonts.bunny.net/css?family=lora:400);
@font-face { font-family: L; src: local("Lora"), url(https://fonts.gstatic.com/s/lora.woff2) format("woff2"); }
[data-skin="x"] { --nr-font-body: L, serif }`, { name: 'x' })
    expect(ok.errors).toEqual([])
    const bad = validateSkin(HEAD() + `@import url("https://evil.example/x.css");
@font-face { font-family: L; src: url(https://evil.example/l.woff2) }`, { name: 'x' })
    expect(bad.errors.map((e) => e.message)).toEqual(['@import https://evil.example/x.css', '@font-face src: https://evil.example/l.woff2'])
  })

  it('чужой скин в селекторе и имя в шапке ≠ файл', () => {
    const r = validateSkin(`/* @skin\n * name: y\n */\n[data-skin="parchment"] { --nr-bg: red }`, { name: 'x' })
    const msgs = r.errors.map((e) => e.message)
    expect(msgs).toContain('name: y в шапке, а файл — x.skin.css')
    expect(msgs).toContain('селектор для чужого скина [data-skin="parchment"]')
  })
})

describe('наследование base', () => {
  const files: Record<string, string> = {
    x: HEAD() + `@import url("https://fonts.bunny.net/css?family=lora");\n` + PALETTE('light') + PALETTE('dark') + `\n[data-skin="x"] .nr-author { color: var(--nr-accent) }`,
    y: `/* @skin\n * name: y\n * base: x\n */\n@import url("https://fonts.googleapis.com/css2?family=Inter");\n[data-skin="y"][data-mode="dark"] { --nr-accent: #fc0 }`,
    loop1: `/* @skin\n * base: loop2\n */\n`,
    loop2: `/* @skin\n * base: loop1\n */\n`,
    half: `/* @skin\n * mode: both\n */\n` + PALETTE('light').replace(/"x"/, '"half"'),
  }
  const lookup = (n: string) => files[n]

  it('база переименована в наследника и стоит раньше, @import — наверху', () => {
    const c = compileSkin('y', lookup, Object.keys(files))
    expect(c.errors).toEqual([])
    expect(c.chain).toEqual(['y', 'x'])
    expect(c.css).not.toMatch(/data-skin="x"/)
    expect(c.css.indexOf('[data-skin="y"] .nr-author')).toBeGreaterThan(0)
    expect(c.css.indexOf('base: x')).toBeLessThan(c.css.indexOf('/* y */'))
    expect(c.css.trimStart().startsWith('@import')).toBe(true)
    expect(c.css.match(/@import/g)).toHaveLength(2)
    expect(c.vars.dark['--nr-accent']).toBe('#fc0')
    expect(c.vars.light['--nr-accent']).toBe('#f80')
  })

  it('нет базы, цикл, неполная палитра — ошибки', () => {
    expect(compileSkin('z', () => `/* @skin\n * base: nope\n */`, ['z']).errors.map((e) => e.message)).toContain('base: nope — такого скина нет')
    expect(compileSkin('loop1', lookup, Object.keys(files)).errors[0]!.message).toMatch(/цикл наследования: loop1 → loop2 → loop1/)
    const half = compileSkin('half', lookup)
    expect(half.errors[0]!.message).toMatch(/палитра режима dark неполная: нет --nr-bg/)
    expect(half.css).toBe('')
  })
})
