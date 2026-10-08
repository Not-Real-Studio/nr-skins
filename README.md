# @notrealstudio/nr-skins

Скины nrchat как данные: файл `<имя>.skin.css` с шапкой `/* @skin … */` и CSS по контракту.
Спека — `nrchat.dev/specs/skin-spec.md`.

- `.` — без IO: контракт (`TOKENS`, `ELEMENT_SELECTORS`, `ELEMENT_PROPERTIES`, `FONT_HOSTS`),
  `parseHeader`, `validateSkin(text, {name, known})`, `compileSkin(name, lookup)` (наследование `base`).
- `.` — читаемость (DEV-254): `checkTextSize` (кегль `--nr-text-*` при 100%: `sm`/`body` ≥ 15px,
  остальные ≥ 13px — ошибка валидатора), `checkContrast(vars, mode)` (`--nr-fg/muted/accent/ok/error`
  к `--nr-bg` и `--nr-surface` ≥ 4.5:1 — предупреждение `compileSkin`, строго — в тесте скинов nrchat
  `tests/skinReadability.test.ts`), `parseColor`, `contrastRatio`, `READABILITY_RULES` — правила словами
  для агента и редактора тем (моноширинный — только код, пути, id и время).
- `./node` — диск: `createFsSkins({root, cwdOf})` — `list/css/get/check/save/select`
  (общие `<root>/skins`, рабочая область `<cwd>/.nr/skins`), `skinContext(root, cwd)` — блок system
  «текущий скин» для агента.

Потребители: `serveBackend({skins})` (appz/pi, оба стенда), хост артефактов (`__host.skins`,
finalize, тул `skin_check`).
