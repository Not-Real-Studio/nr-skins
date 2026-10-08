/**
 * @notrealstudio/nr-skins — скины nrchat как данные (nrchat.dev/specs/skin-spec.md).
 *
 * Без IO: контракт (токены, селекторы, свойства), шапка `@skin`, валидатор,
 * сборка с `base`, правила читаемости (кегль, контраст — `readability`). Файлы на диске, источник `SkinsOps` и выжимка агенту —
 * `@notrealstudio/nr-skins/node`.
 */

export * from './contract.js'
export * from './skin.js'
export * from './readability.js'
