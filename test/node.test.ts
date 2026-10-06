import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFsSkins, skinContext } from '../src/node.js'

const palette = (name: string, mode: string, bg: string) => `[data-skin="${name}"][data-mode="${mode}"] {
  --nr-bg: ${bg}; --nr-surface: #111; --nr-raised: #222; --nr-line: #333; --nr-fg: #eee; --nr-muted: #999;
  --nr-accent: #f80; --nr-ok: #0f0; --nr-error: #f00; --nr-accent-fg: #000; --nr-line-soft: #222; --nr-shadow-pop: none;
}\n`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nr-skins-'))
  mkdirSync(join(root, 'skins'))
  writeFileSync(join(root, 'skins', 'base.skin.css'), `/* @skin\n * description: база\n */\n` + palette('base', 'light', '#fff') + palette('base', 'dark', '#000') + `[data-skin="base"] { --nr-font-body: 'Lora', serif }\n`)
  writeFileSync(join(root, 'skins', 'broken.skin.css'), `/* @skin\n * base: base\n */\n[data-skin="broken"] .sidebar { display: none }\n`)
  const ws = join(root, 'proj')
  mkdirSync(join(ws, '.nr', 'skins'), { recursive: true })
  writeFileSync(join(ws, '.nr', 'skins', 'warm.skin.css'), `/* @skin\n * base: base\n */\n[data-skin="warm"][data-mode="dark"] { --nr-accent: #fa4 }\n`)
  return { root, ws }
}

describe('createFsSkins', () => {
  it('список: общие + рабочая область сессии, сломанный — с ошибкой', async () => {
    const { root, ws } = fixture()
    const skins = createFsSkins({ root, cwdOf: (sid) => (sid === 's1' ? ws : undefined) })
    const plain = await skins.list()
    expect(plain.map((s) => s.name)).toEqual(['base', 'broken'])
    const list = await skins.list({ sessionId: 's1' })
    expect(list.map((s) => [s.name, s.source])).toEqual([['base', 'shared'], ['broken', 'shared'], ['warm', 'workspace']])
    const broken = list.find((s) => s.name === 'broken')!
    expect(broken.error).toMatch(/селектор «\.sidebar» вне контракта/)
    await expect(skins.css('broken')).rejects.toMatchObject({ code: 'bad_request' })
    await expect(skins.css('nope')).rejects.toMatchObject({ code: 'not_found' })
    const css = await skins.css('warm', { sessionId: 's1' })
    expect(css).toMatch(/\[data-skin="warm"\]\[data-mode="dark"\]\{--nr-bg: ?#000/)
    expect(css).toMatch(/--nr-accent: ?#fa4/)
  })

  it('save: проверка до записи, файл — в .nr/skins рабочей области', async () => {
    const { root, ws } = fixture()
    const skins = createFsSkins({ root })
    const bad = await skins.save('my', `[data-skin="my"] .panel { color: red }`, { cwd: ws, base: 'base' })
    expect(bad.ok).toBe(false)
    expect(bad.errors![0]).toMatch(/вне контракта/)
    const ok = await skins.save('my', `[data-skin="my"][data-mode="light"] { --nr-accent: #c50 }`, { cwd: ws, base: 'warm', description: 'моя' })
    expect(ok.errors).toBeUndefined()
    expect(ok.ok).toBe(true)
    expect(ok.path).toBe(join(ws, '.nr', 'skins', 'my.skin.css'))
    expect(readFileSync(ok.path!, 'utf8')).toMatch(/^\/\* @skin\n \* name: my\n \* description: моя\n \* mode: both\n \* base: warm\n \*\//)
    expect(ok.skin).toMatchObject({ name: 'my', base: 'warm', source: 'workspace' })
    expect((await skins.get('my', { cwd: ws })).chain).toEqual(['my', 'warm', 'base'])
  })

  it('select → выжимка текущего скина агенту', async () => {
    const { root, ws } = fixture()
    const skins = createFsSkins({ root })
    await skins.select({ name: 'warm', mode: 'dark' })
    expect(skins.current()).toEqual({ name: 'warm', mode: 'dark' })
    const text = skinContext(root, ws)
    expect(text).toMatch(/скин `warm`, режим тёмный, base: base/)
    expect(text).toMatch(/accent #fa4/)
    expect(text).toMatch(/font-body 'Lora'/)
    expect(text).toMatch(/broken \(сломан\)/)
    expect(text).toMatch(/warm\*/)
  })
})
