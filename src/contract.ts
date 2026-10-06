/**
 * Контракт скина (skin-spec §2–§4): какие переменные скин задаёт, какие
 * элементы ленты он вправе трогать и какими свойствами. Это же — «контракт для
 * агента»: редактор тем и профиль модели читают описания отсюда.
 *
 * Правило: скин — токены. Элементные правила — узкий допуск для облика ленты
 * (РП: имя и линия реплики, курсив действий, крупный аватар), не для вёрстки:
 * `display`, `position`, размеры, `content` и прочее, что ломает панель, —
 * запрещены валидатором.
 */

export type TokenKind = 'color' | 'font' | 'length' | 'number' | 'shadow' | 'duration' | 'background'

export type TokenGroup = 'bg' | 'text' | 'accent' | 'fonts' | 'type' | 'radius' | 'space' | 'avatar' | 'code'

export interface TokenSpec {
  name: `--nr-${string}`
  group: TokenGroup
  kind: TokenKind
  /** Что красит/меняет переменная — для человека и модели. */
  description: string
  /** Уровень контракта (ui-kit-spec §3): A — палитра, обязательна; B — облик; C — декор. */
  level: 'A' | 'B' | 'C'
}

/** Группы редактора тем — в этом порядке. */
export const TOKEN_GROUPS: ReadonlyArray<{ id: TokenGroup; title: string }> = [
  { id: 'bg', title: 'Фон и линии' },
  { id: 'text', title: 'Текст' },
  { id: 'accent', title: 'Акцент и статусы' },
  { id: 'fonts', title: 'Шрифты' },
  { id: 'type', title: 'Кегль и интерлиньяж' },
  { id: 'radius', title: 'Радиусы и тени' },
  { id: 'space', title: 'Отступы и мера' },
  { id: 'avatar', title: 'Аватар и отбивка' },
  { id: 'code', title: 'Подсветка кода' },
]

const t = (name: `--nr-${string}`, group: TokenGroup, kind: TokenKind, level: TokenSpec['level'], description: string): TokenSpec => ({
  name,
  group,
  kind,
  level,
  description,
})

/** Все токены, которые скин вправе задавать. */
export const TOKENS: readonly TokenSpec[] = [
  // ── палитра (уровень A): обязательна для каждого заявленного режима ──
  t('--nr-bg', 'bg', 'color', 'A', 'фон окна и ленты'),
  t('--nr-surface', 'bg', 'color', 'A', 'подложка панелей, сайдбара, шапок карточек (тул, thinking)'),
  t('--nr-raised', 'bg', 'color', 'A', 'приподнятые поверхности: композер, поповеры, поля ввода'),
  t('--nr-line', 'bg', 'color', 'A', 'рамки и разделители'),
  t('--nr-fg', 'text', 'color', 'A', 'основной текст'),
  t('--nr-muted', 'text', 'color', 'A', 'вторичный текст: мета, подписи, имя игрока, thinking'),
  t('--nr-accent', 'accent', 'color', 'A', 'акцент: имя ассистента, ссылки, активные кнопки, фокус'),
  t('--nr-ok', 'accent', 'color', 'A', 'успех: готово, зелёные статусы'),
  t('--nr-error', 'accent', 'color', 'A', 'ошибка: красные статусы, расхождение модели'),
  t('--nr-accent-fg', 'accent', 'color', 'A', 'текст поверх заливки акцентом (кнопка «отправить»)'),
  t('--nr-line-soft', 'bg', 'color', 'A', 'тонкие разделители внутри панелей'),
  t('--nr-shadow-pop', 'radius', 'shadow', 'A', 'тень поповеров и меню'),
  // ── облик (уровень B) ──
  t('--nr-focus', 'accent', 'color', 'B', 'кольцо фокуса (по умолчанию = акцент)'),
  t('--nr-font-ui', 'fonts', 'font', 'B', 'шрифт интерфейса: панели, кнопки, сайдбар'),
  t('--nr-font-body', 'fonts', 'font', 'B', 'шрифт текста реплик (тело сообщения, thinking)'),
  t('--nr-font-mono', 'fonts', 'font', 'B', 'моноширинный: код, мета, чипы'),
  t('--nr-text-xs', 'type', 'length', 'B', 'кегль меты, чипов, счётчиков (rem)'),
  t('--nr-text-sm', 'type', 'length', 'B', 'кегль списков и полей интерфейса (rem)'),
  t('--nr-text-md', 'type', 'length', 'B', 'кегль заголовков панелей, редактора сообщения (rem)'),
  t('--nr-text-lg', 'type', 'length', 'B', 'кегль крупного: пустое состояние (rem)'),
  t('--nr-text-body', 'type', 'length', 'B', 'кегль текста реплики (rem)'),
  t('--nr-leading-tight', 'type', 'number', 'B', 'интерлиньяж заголовков'),
  t('--nr-leading-ui', 'type', 'number', 'B', 'интерлиньяж интерфейса'),
  t('--nr-leading-body', 'type', 'number', 'B', 'интерлиньяж текста реплик'),
  t('--nr-radius', 'radius', 'length', 'B', 'радиус кнопок, чипов, карточек'),
  t('--nr-radius-lg', 'radius', 'length', 'B', 'радиус композера и крупных блоков'),
  t('--nr-space-1', 'space', 'length', 'B', 'шаг отступа 1 (2px)'),
  t('--nr-space-2', 'space', 'length', 'B', 'шаг отступа 2 (4px)'),
  t('--nr-space-3', 'space', 'length', 'B', 'шаг отступа 3 (6px)'),
  t('--nr-space-4', 'space', 'length', 'B', 'шаг отступа 4 (10px)'),
  t('--nr-space-5', 'space', 'length', 'B', 'шаг отступа 5 (16px)'),
  t('--nr-space-6', 'space', 'length', 'B', 'шаг отступа 6 (24px)'),
  t('--nr-density', 'space', 'number', 'B', 'множитель шкалы отступов: 0.85 плотно, 1.2 просторно'),
  t('--nr-code-comment', 'code', 'color', 'B', 'подсветка кода: комментарий'),
  t('--nr-code-keyword', 'code', 'color', 'B', 'подсветка кода: ключевое слово'),
  t('--nr-code-string', 'code', 'color', 'B', 'подсветка кода: строка'),
  t('--nr-code-number', 'code', 'color', 'B', 'подсветка кода: число'),
  t('--nr-code-title', 'code', 'color', 'B', 'подсветка кода: имя функции/класса'),
  t('--nr-code-type', 'code', 'color', 'B', 'подсветка кода: тип'),
  t('--nr-code-attr', 'code', 'color', 'B', 'подсветка кода: атрибут'),
  // ── декор ленты (уровень C) ──
  t('--nr-measure', 'space', 'length', 'C', 'мера строки: ширина колонки текста реплики (ch)'),
  t('--nr-rule', 'avatar', 'color', 'C', 'отбивка между сообщениями'),
  t('--nr-avatar-size', 'avatar', 'length', 'C', 'размер аватара персоны в ленте'),
  t('--nr-avatar-radius', 'avatar', 'length', 'C', 'скругление аватара (9999px — круг)'),
  t('--nr-message-gap', 'space', 'length', 'C', 'отступ под сообщением (по умолчанию 18px)'),
  t('--nr-gutter-w', 'avatar', 'length', 'C', 'ширина колонки автора слева (аватар, имя; по умолчанию 76px)'),
  t('--nr-author-user', 'text', 'color', 'C', 'цвет имени игрока/пользователя (по умолчанию --nr-muted)'),
  t('--nr-author-assistant', 'text', 'color', 'C', 'цвет имени ассистента/персонажа (по умолчанию --nr-accent)'),
  t('--nr-em', 'text', 'color', 'C', 'цвет курсива в реплике — РП-действия *…* (по умолчанию наследует)'),
  t('--nr-bg-app', 'bg', 'background', 'C', 'фон окна целиком (любое background: градиент, текстура)'),
  t('--nr-bg-chat', 'bg', 'background', 'C', 'фон колонки ленты (любое background)'),
]

export const TOKEN_BY_NAME: ReadonlyMap<string, TokenSpec> = new Map(TOKENS.map((x) => [x.name, x]))

/** Палитра, без которой режим скина не рисуется (уровень A). */
export const REQUIRED_TOKENS: readonly string[] = TOKENS.filter((x) => x.level === 'A').map((x) => x.name)

/**
 * Пространства имён плагинов: `--nr-<ns>-*` задаёт скин для экрана плагина
 * (`--nr-tv-*` — экран NR Tavern). Ядро их не читает, валидатор пропускает.
 */
export const PLUGIN_TOKEN_PREFIXES: readonly string[] = ['--nr-tv-']

/** Служебные переменные ядра — скин их не трогает (числа слоёв, размеры колонок, рантайм). */
export const FORBIDDEN_TOKEN_PREFIXES: ReadonlyArray<{ prefix: string; why: string }> = [
  { prefix: '--nr-z-', why: 'слои (z-index) — не облик, скин их не двигает' },
  { prefix: '--nr-dock-', why: 'размер дока задаёт приложение' },
  { prefix: '--nr-root-size', why: 'размер текста — настройка пользователя (⌘=), не скин' },
]

/** Токены, в значении которых допустим `url(…)` (фон-картинка). */
export const URL_TOKENS: readonly string[] = ['--nr-bg-app', '--nr-bg-chat']

// ────────────────────────────────────────────────────────────────────────────
// Элементы ленты
// ────────────────────────────────────────────────────────────────────────────

export interface SelectorSpec {
  /** Каноническая запись звена селектора (без кавычек в атрибутах). */
  selector: string
  description: string
}

const ROLES = ['user', 'assistant', 'system'] as const

/**
 * Звенья селектора после корня `[data-skin="<имя>"]` (+ `[data-mode=…]`).
 * Цепочка — до трёх звеньев через пробел (потомок): `.nr-message[data-role=user] .nr-author`.
 */
export const ELEMENT_SELECTORS: readonly SelectorSpec[] = [
  { selector: '.nr-feed', description: 'лента: прокручиваемая колонка сообщений' },
  { selector: '.nr-message', description: 'сообщение: строка ленты (колонка автора + тело)' },
  ...ROLES.map((r) => ({ selector: `.nr-message[data-role=${r}]`, description: `сообщение роли ${r}` })),
  ...ROLES.map((r) => ({ selector: `[data-role=${r}]`, description: `то же, что .nr-message[data-role=${r}] (короткая запись)` })),
  { selector: '.nr-gutter', description: 'колонка автора слева: аватар, имя, модель' },
  { selector: '.nr-avatar', description: 'аватар персоны (размер — токен --nr-avatar-size)' },
  { selector: '.nr-author', description: 'имя автора реплики' },
  { selector: '.nr-body', description: 'тело сообщения: части и тулбар' },
  { selector: '.nr-text', description: 'текстовая часть реплики (markdown)' },
  { selector: '.nr-thinking', description: 'блок рассуждений модели (thinking)' },
  { selector: '.nr-tool', description: 'карточка вызова тула' },
  { selector: '.nr-composer', description: 'поле ввода реплики' },
]

/** Теги, допустимые только внутри `.nr-text` — разметка реплики. */
export const TEXT_TAGS: readonly string[] = ['p', 'em', 'strong', 'a', 'blockquote', 'code', 'li', 'h1', 'h2', 'h3', 'hr']

export const ELEMENT_SELECTOR_SET: ReadonlySet<string> = new Set(ELEMENT_SELECTORS.map((s) => s.selector))

/** Максимум звеньев после корня. */
export const MAX_ELEMENT_DEPTH = 3

/**
 * Свойства в элементных правилах (кроме `--nr-*`): цвет, рамка, шрифт,
 * прозрачность, внутренний отступ. Вёрстку (`display`, `position`, `margin`,
 * размеры, `transform`, `content`, `visibility`, `z-index`) скин не трогает.
 */
export const ELEMENT_PROPERTIES: readonly string[] = [
  'color',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-color',
  'border-width',
  'border-style',
  'border-left',
  'border-left-color',
  'border-left-width',
  'border-left-style',
  'border-right',
  'border-top',
  'border-bottom',
  'border-inline-start',
  'border-radius',
  'box-shadow',
  'outline-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'font-feature-settings',
  'letter-spacing',
  'line-height',
  'text-transform',
  'text-decoration',
  'text-decoration-color',
  'text-shadow',
  'opacity',
  'padding',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'padding-inline-start',
  'padding-block',
]

/** Откуда скин вправе брать веб-шрифты (`@import`, `@font-face src`). */
export const FONT_HOSTS: readonly string[] = ['fonts.googleapis.com', 'fonts.gstatic.com', 'fonts.bunny.net']

export type SkinMode = 'light' | 'dark' | 'both'
export const SKIN_MODES: readonly SkinMode[] = ['light', 'dark', 'both']

/** Имя скина: латиница/цифры/дефис, с буквы — оно же id в `data-skin` и имя файла. */
export const SKIN_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/
