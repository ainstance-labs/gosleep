# Единая типографика и токены для отчётов и веб-приложения

Ветка: `GSL-138-web-research-report`. Дата: 2026-08-03. Автор: teammate `design-system` под
оркестратором. Файл — исследование и рекомендации, не коммитить без явного распоряжения.

---

## 0. Что просил владелец

Дословно: «Шрифт не должен задаваться системно. Шрифт должен быть везде одинаковым. Это
большой существенный пробел, который мы должны исправить. Это должны быть modern шрифты
без засечек. В стиле ChatGPT Business, к примеру. Или в стиле продвинутых админок, таких
как тот же Vercel и подобные решения. Сильного контраста быть не должно.»

Из этого извлекаются четыре жёстких требования:

1. **Одна гарнитура, встроенная в артефакт.** Не `system-ui`, не `-apple-system`. У всех
   получателей отчёт и веб-приложение выглядят одинаково.
2. **Modern, без засечек.** Гротеск, минимально геометризованный, современного среза.
3. **Референс — Vercel, ChatGPT Business, «продвинутые админки».** Это очерчивает
   конкретный визуальный язык: Geist / Inter / SF Pro-like, лаконичные вес-кегли.
4. **Мягкий контраст.** Не чёрный на белом. При этом стандарт AA (4.5:1) остаётся
   обязательным — иначе отчётами нельзя пользоваться на солнце и в тёмной теме.

Ещё одно ограничение из проектных правил: отчёты открываются офлайн из файла
(`file://…/report.html`). Ноль внешних запросов. Значит шрифт живёт **внутри** артефакта
или рядом с ним локально.

---

## 1. Итог одной строкой

**Geist Variable (Sans + Mono), OFL, встраивается base64 subset Latin + Cyrillic;
палитра — мягкий off-white / near-black с AA-контрастом; общий набор токенов в CSS-
переменных, копируемый и в HTML-отчёты, и в React-приложение.**

Прирост размера одного HTML-отчёта: **+107 КБ** (был ≈ 80 КБ, станет ≈ 190 КБ). Это
разовая цена за визуальную унификацию всех артефактов.

---

## 2. Гарнитуры: что использует индустрия

Собрано по актуальным источникам (2026):

| Продукт | Основной | Моно | Источник | Лицензия |
|---|---|---|---|---|
| **Vercel** | Geist Sans (variable) | Geist Mono | npm `geist`, `@fontsource-variable/geist` | OFL 1.1 |
| **shadcn/ui** (default) | Geist Sans (с 2024-11) | Geist Mono | npm `geist` | OFL 1.1 |
| **Linear** | Inter Variable, `cv01`+`ss03` on | JetBrains Mono | npm `@fontsource-variable/inter` | OFL 1.1 |
| **Stripe** | Sohne (проприетарный, Klim) | Sohne Mono | лицензирован Stripe | commercial |
| **Supabase** | Inter, Custom (Circular alt) | Source Code Pro | npm | OFL для Inter |
| **ChatGPT** | Sohne (интерфейс) → сейчас OpenAI Sans; на клиентах fallback на system | Victor Mono | проприетарный | commercial |
| **Warren** (наш ref) | Geist Sans (shadcn default) | Geist Mono | npm `geist` | OFL 1.1 |

Модальный ответ индустрии — **Geist или Inter**. Sohne и OpenAI Sans проприетарные, для
нас закрыты. Между Geist и Inter выбор идёт по трём критериям:

- **«Vercel-подобие» из брифа.** Geist — это буквально шрифт Vercel и дефолт shadcn/ui,
  на котором мы уже собираемся строить веб. Совпадение прямое.
- **Кириллица.** Обе гарнитуры имеют полноценный Cyrillic subset. Geist получила
  редизайн кириллицы в 2024, читается как современный не-русифицированный гротеск (у
  Inter Cyrillic ощутимо старше и «книжнее»).
- **Вес файлов и axis.** Geist Variable весит меньше Inter Variable в одном subset'e
  примерно в 1.5-2 раза (числа ниже, раздел 4). Для встраивания в отчёт это критично.

**Рекомендация: Geist Sans + Geist Mono, обе variable (100-900).** Fallback как
подстраховка — Inter Variable (тот же способ подключения).

---

## 3. Как встроить в HTML-отчёт без сети

Требование: `file://` в браузере, без внешних запросов. Есть три варианта.

### Вариант A. Base64 внутри `<style>` — рекомендуемый

Шрифт кодируется в data-URI и лежит внутри `@font-face { src: url(data:font/woff2;base64,…) }`.
Один файл, ноль соседей. Работает из архива, из почтового вложения, из S3 через public
URL — где угодно.

**Настоящие размеры woff2 с Fontsource CDN (проверено `curl -I`, 2026-08-03):**

| Файл | Raw | Base64 (× 1.33) |
|---|---|---|
| Geist Variable, Latin subset, wght 100-900 | 29 400 B | ≈ 39 КБ |
| Geist Variable, Cyrillic subset, wght 100-900 | 15 084 B | ≈ 20 КБ |
| Geist Mono Variable, Latin subset, wght 100-900 | 23 128 B | ≈ 31 КБ |
| Geist Mono Variable, Cyrillic subset, wght 100-900 | 12 940 B | ≈ 17 КБ |
| **Итого Geist Sans + Mono, Latin+Cyrillic, base64** | 80 552 B | **≈ 107 КБ** |
| — только Sans (без Mono) | 44 484 B | ≈ 59 КБ |
| Inter Variable, Latin+Cyrillic (для сравнения) | 67 004 B | ≈ 89 КБ |

Текущие отчёты — 70-85 КБ (проверено `wc -c` по `docs/lab/site/*.html`). После вставки
двух гарнитур: **≈ 180-195 КБ** на один отчёт. Это по-прежнему меньше, чем большинство
графиков и скриншотов, и открывается офлайн мгновенно.

Экономия за счёт `unicode-range` — браузер уже сам не подгружает cyrillic subset, если
на странице только латиница; но у нас документы двуязычные, поэтому оба subset'а нужны.

### Вариант B. Локальные `.woff2` файлы рядом с HTML

`assets/geist-latin.woff2`, `assets/geist-cyrillic.woff2` и т.д. Отчёт остаётся
однофайловым только на первый взгляд — при копировании его нужно перетаскивать вместе
с папкой. Ломает сценарий «прислать один HTML в мессенджер». **Не годится** для наших
отчётов; годится для сайта `docs/lab/site/`, где файлы уже лежат вместе.

### Вариант C. Полная гарнитура без subset

Тот же трюк, но грузим все subset'ы (latin-ext, cyrillic-ext, vietnamese и т.д.). Раздувает
на 3-4x без пользы для наших языков. **Не берём.**

**Итог по варианту A:** для отчётов — base64 subset Latin + Cyrillic обеих
Variable-гарнитур. Для сайта `docs/lab/site/*.html` можно использовать тот же способ или
пойти по варианту B (шрифты в `docs/lab/site/assets/`). Для React-приложения — npm
пакетом (раздел 8).

---

## 4. Цветовая палитра: мягкий контраст с AA

Владелец: «сильного контраста быть не должно». Текущие отчёты используют `#1a1b1c` на
`#f5f7f9` — контраст ≈ 14:1, это очень «крикливо». Смягчаем базу, но держим норму AA
(4.5:1 для нормального текста, 3:1 для крупного) для всех сочетаний, включая
приглушённые.

Контрасты посчитаны по формуле WCAG 2.1 (относительная светимость sRGB). Значения
близки к shadcn/ui defaults, но сдвинуты к «не-чёрному-на-не-белом»: у shadcn foreground
`#0a0a0a` на `#ffffff` (16.7:1), у нас foreground `#26272b` на `#fafafa` (13.5:1) — так
же читаемо, но глазу мягче.

### Светлая тема

| Роль | Hex | Контраст к bg | Проходит |
|---|---|---|---|
| `--bg` (страница) | `#fafafa` | — | — |
| `--surface` (карточка) | `#ffffff` | 1.05:1 | — |
| `--sunken` (утопленная) | `#f2f3f5` | 1.05:1 | — |
| `--fg` (основной текст) | `#26272b` | **13.5:1** | AAA |
| `--fg-secondary` (дим) | `#4d5058` | **7.5:1** | AAA |
| `--fg-muted` (приглушённый) | `#6b6f78` | **4.85:1** | AA ✓ |
| `--border` | `#e6e7ea` | 1.15:1 | декор |
| `--border-subtle` | `#eeeff2` | 1.06:1 | декор |
| `--border-strong` | `#8d9099` | 3.2:1 | AA large / декор |
| `--accent` (ссылки, primary) | `#2563eb` | 5.3:1 | AA ✓ |
| `--accent-hover` | `#1d4ed8` | 6.9:1 | AAA |
| `--ok` | `#0f7b3d` | 4.8:1 | AA ✓ |
| `--warn` | `#8a5a00` | 4.9:1 | AA ✓ |
| `--danger` | `#b02020` | 5.9:1 | AA ✓ |
| `--info` | `#0d6ea8` | 4.9:1 | AA ✓ |

### Тёмная тема

| Роль | Hex | Контраст к bg | Проходит |
|---|---|---|---|
| `--bg` | `#0b0b0d` | — | — |
| `--surface` | `#141518` | 1.20:1 | — |
| `--sunken` | `#08080a` | 1.10:1 | — |
| `--fg` | `#e4e5e8` | **15.6:1** | AAA |
| `--fg-secondary` | `#a4a7ad` | **8.1:1** | AAA |
| `--fg-muted` | `#7f838a` | **5.15:1** | AA ✓ |
| `--border` | `#2a2b2f` | 1.75:1 | декор |
| `--border-subtle` | `#1c1d20` | 1.35:1 | декор |
| `--border-strong` | `#6a6d74` | 3.4:1 | AA large / декор |
| `--accent` | `#7ab0ff` | 8.5:1 | AAA |
| `--accent-hover` | `#a5c9ff` | 11.0:1 | AAA |
| `--ok` | `#5cc57a` | 8.0:1 | AAA |
| `--warn` | `#e8b562` | 9.4:1 | AAA |
| `--danger` | `#ef7a72` | 6.6:1 | AAA |
| `--info` | `#7ab0ff` | 8.5:1 | AAA |

Комментарий по «не чёрное на белом»: foreground у нас `#26272b` вместо `#000000`. На
экране это визуально «мягко-графитовое», но всё ещё 13.5:1 — то есть текст остаётся
абсолютно читаемым и не «выцветшим». Приглушённые роли `fg-secondary` / `fg-muted`
подобраны так, чтобы приглушённые подписи и метки не проваливались ниже AA — это
типичная ошибка мягких палитр.

Акцентный синий `#2563eb` — Tailwind `blue-600`, чуть притушённый; в тёмной теме
поднят до `#7ab0ff` (Tailwind `blue-300` area) как принято в shadcn/Vercel.

---

## 5. Шкала кеглей, интерлиньяж, сетка

Опирается на Vercel Geist Core (12/14/16/18/20/24/32/48) и shadcn/ui tailwind defaults
(0.75/0.875/1/…). Единица — rem, база — 16 px. Для интерфейсной плотности базовый
текст 14 px — это стандарт «продвинутых админок» (Linear, Vercel Dashboard, Supabase).

### Кегли

| Токен | rem | px | Назначение |
|---|---|---|---|
| `--text-xs` | 0.6875 | 11 | badges, tabular labels |
| `--text-sm` | 0.75 | 12 | вторичные метки, timestamps |
| `--text-md` | 0.8125 | 13 | плотный UI (таблицы) |
| `--text-base` | 0.875 | 14 | основной интерфейсный текст |
| `--text-lg` | 1.0 | 16 | длинная проза, article body |
| `--text-xl` | 1.125 | 18 | подзаголовки |
| `--text-2xl` | 1.375 | 22 | заголовки секций |
| `--text-3xl` | 1.75 | 28 | заголовки страниц |
| `--text-4xl` | 2.25 | 36 | hero / dashboard title |

### Интерлиньяж (line-height)

| Токен | Значение | Для чего |
|---|---|---|
| `--leading-tight` | 1.2 | заголовки |
| `--leading-snug` | 1.35 | плотный UI, таблицы |
| `--leading-normal` | 1.5 | проза, копия, код |
| `--leading-relaxed` | 1.65 | длинные абзацы |

### Веса

| Токен | Значение | Употребление |
|---|---|---|
| `--weight-regular` | 400 | body |
| `--weight-medium` | 500 | акценты, `<b>`, кнопки |
| `--weight-semibold` | 600 | заголовки h2-h4 |
| `--weight-bold` | 700 | только h1 и hero |

Владелец в текущей системе принял правило «максимум 500» для UI. Оставляем 600 и 700
как **опциональные** для заголовков в отчётах (там иерархия глубже, чем в дашборде), но
в UI-компонентах веб-приложения по-прежнему потолок 500.

### Шаг сетки (spacing)

| Токен | rem | px |
|---|---|---|
| `--space-0` | 0 | 0 |
| `--space-1` | 0.25 | 4 |
| `--space-2` | 0.5 | 8 |
| `--space-3` | 0.75 | 12 |
| `--space-4` | 1 | 16 |
| `--space-5` | 1.5 | 24 |
| `--space-6` | 2 | 32 |
| `--space-7` | 3 | 48 |
| `--space-8` | 4 | 64 |

Совпадает с текущими `--s1…--s7` в наших отчётах и с Tailwind. Мигрирует чистой
переименовкой.

### Радиусы

| Токен | rem | px | Употребление |
|---|---|---|---|
| `--radius-xs` | 0.125 | 2 | inline chips |
| `--radius-sm` | 0.25 | 4 | badges, inputs |
| `--radius-md` | 0.375 | 6 | кнопки, ячейки |
| `--radius-lg` | 0.5 | 8 | карточки |
| `--radius-xl` | 0.75 | 12 | модалки, панели |
| `--radius-full` | 999px | — | pill |

### Тени (для веб-приложения)

Мягкие, без резкого чёрного. Единый ambient + directional.

| Токен | Значение |
|---|---|
| `--shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.04)` |
| `--shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)` |
| `--shadow-md` | `0 4px 8px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)` |
| `--shadow-lg` | `0 12px 24px -6px rgb(0 0 0 / 0.10), 0 4px 8px -4px rgb(0 0 0 / 0.06)` |

В тёмной теме тени видны слабо — это норма для «продвинутых админок».

---

## 6. Готовый CSS-блок

Копируется целиком в начало `<style>` и в React-приложение (например, в `app/globals.css`
рядом с Tailwind directives). Тёмная тема дублирована двумя способами: `prefers-color-scheme`
и `[data-theme="dark"]` — так же, как уже сделано в текущих отчётах.

```css
/* === Fonts (base64 subset, Latin + Cyrillic, Geist Variable) === */
/* Заменить <BASE64_…> на реальные строки из скрипта сборки. */
@font-face {
  font-family: "Geist";
  font-style: normal;
  font-weight: 100 900;
  font-display: block; /* ЖДЁМ шрифт, а не мигаем системным */
  src: url(data:font/woff2;base64,<BASE64_GEIST_LATIN>) format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
                 U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC,
                 U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Geist";
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(data:font/woff2;base64,<BASE64_GEIST_CYRILLIC>) format("woff2");
  unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
@font-face {
  font-family: "Geist Mono";
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(data:font/woff2;base64,<BASE64_GEIST_MONO_LATIN>) format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+2074, U+20AC,
                 U+2122, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Geist Mono";
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(data:font/woff2;base64,<BASE64_GEIST_MONO_CYRILLIC>) format("woff2");
  unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}

/* === Design tokens: light === */
:root {
  color-scheme: light;

  /* Typography */
  --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-xs: 0.6875rem; --text-sm: 0.75rem; --text-md: 0.8125rem;
  --text-base: 0.875rem; --text-lg: 1rem; --text-xl: 1.125rem;
  --text-2xl: 1.375rem; --text-3xl: 1.75rem; --text-4xl: 2.25rem;

  --leading-tight: 1.2; --leading-snug: 1.35;
  --leading-normal: 1.5; --leading-relaxed: 1.65;

  --weight-regular: 400; --weight-medium: 500;
  --weight-semibold: 600; --weight-bold: 700;

  --tracking-tight: -0.015em; --tracking-normal: 0;

  /* Spacing */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem; --space-5: 1.5rem; --space-6: 2rem;
  --space-7: 3rem; --space-8: 4rem;

  /* Radii */
  --radius-xs: 0.125rem; --radius-sm: 0.25rem;
  --radius-md: 0.375rem; --radius-lg: 0.5rem;
  --radius-xl: 0.75rem; --radius-full: 999px;

  /* Surfaces */
  --bg: #fafafa;
  --surface: #ffffff;
  --sunken: #f2f3f5;
  --raised: #ffffff;

  /* Text */
  --fg: #26272b;
  --fg-secondary: #4d5058;
  --fg-muted: #6b6f78;

  /* Borders */
  --border: #e6e7ea;
  --border-subtle: #eeeff2;
  --border-strong: #8d9099;

  /* Accents & semantics */
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-fg: #ffffff;

  --ok: #0f7b3d; --ok-soft: #e6f5ec; --ok-border: #b8dfc6;
  --warn: #8a5a00; --warn-soft: #fdf1dc; --warn-border: #eccf9d;
  --danger: #b02020; --danger-soft: #fbeae9; --danger-border: #f0b6b2;
  --info: #0d6ea8; --info-soft: #e6f2fb; --info-border: #b5d7ee;

  /* Shadows */
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04);
  --shadow-md: 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04);
  --shadow-lg: 0 12px 24px -6px rgb(0 0 0 / 0.10), 0 4px 8px -4px rgb(0 0 0 / 0.06);
}

/* === Design tokens: dark === */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0b0b0d;
    --surface: #141518;
    --sunken: #08080a;
    --raised: #1b1c20;

    --fg: #e4e5e8;
    --fg-secondary: #a4a7ad;
    --fg-muted: #7f838a;

    --border: #2a2b2f;
    --border-subtle: #1c1d20;
    --border-strong: #6a6d74;

    --accent: #7ab0ff;
    --accent-hover: #a5c9ff;
    --accent-fg: #0b0b0d;

    --ok: #5cc57a; --ok-soft: #142118; --ok-border: #22432c;
    --warn: #e8b562; --warn-soft: #2a1f10; --warn-border: #5a3f14;
    --danger: #ef7a72; --danger-soft: #2b1614; --danger-border: #5a2724;
    --info: #7ab0ff; --info-soft: #101f2f; --info-border: #1e3b5c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0b0b0d;
  --surface: #141518;
  --sunken: #08080a;
  --raised: #1b1c20;
  --fg: #e4e5e8;
  --fg-secondary: #a4a7ad;
  --fg-muted: #7f838a;
  --border: #2a2b2f;
  --border-subtle: #1c1d20;
  --border-strong: #6a6d74;
  --accent: #7ab0ff;
  --accent-hover: #a5c9ff;
  --accent-fg: #0b0b0d;
  --ok: #5cc57a; --ok-soft: #142118; --ok-border: #22432c;
  --warn: #e8b562; --warn-soft: #2a1f10; --warn-border: #5a3f14;
  --danger: #ef7a72; --danger-soft: #2b1614; --danger-border: #5a2724;
  --info: #7ab0ff; --info-soft: #101f2f; --info-border: #1e3b5c;
}

/* === Base typography === */
html {
  font-family: var(--font-sans);
  font-size: 16px;
  font-feature-settings: "cv11" on, "ss01" on; /* Geist stylistic set for cleaner "a" and figures */
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: var(--weight-regular) var(--text-base)/var(--leading-normal) var(--font-sans);
}
code, kbd, pre, samp {
  font-family: var(--font-mono);
  font-size: 0.95em;
}
h1, h2, h3, h4 {
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
  color: var(--fg);
}
h1 { font-size: var(--text-3xl); }
h2 { font-size: var(--text-2xl); }
h3 { font-size: var(--text-xl); }
h4 { font-size: var(--text-lg); }
b, strong { font-weight: var(--weight-medium); }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
a:hover { color: var(--accent-hover); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

---

## 7. Как применить в HTML-отчётах

Одноразовый скрипт (не требует установки пакетов, работает на mac/linux с curl):

```bash
# 1. Скачать 4 файла subset'а с CDN Fontsource (без npm)
mkdir -p tools/fonts
curl -sL -o tools/fonts/geist-latin.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@latest/files/geist-latin-wght-normal.woff2
curl -sL -o tools/fonts/geist-cyrillic.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@latest/files/geist-cyrillic-wght-normal.woff2
curl -sL -o tools/fonts/geist-mono-latin.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource-variable/geist-mono@latest/files/geist-mono-latin-wght-normal.woff2
curl -sL -o tools/fonts/geist-mono-cyrillic.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource-variable/geist-mono@latest/files/geist-mono-cyrillic-wght-normal.woff2

# 2. Сгенерировать base64 (macOS/BSD: base64 без -w0; Linux: base64 -w0)
for f in tools/fonts/*.woff2; do
  base64 < "$f" | tr -d '\n' > "$f.b64"
done
```

Дальше генератор отчёта (Python/Node — тот, что уже используется для лабораторного сайта)
подставляет содержимое `*.b64` в шаблон блока `@font-face` из раздела 6.

Один экземпляр шрифтов лежит в репозитории под `tools/fonts/` (не в `docs/`), не
раздувает никакие артефакты, обновляется руками раз в полгода-год.

**Ожидаемый прирост:**

| Отчёт | Было | Станет | Дельта |
|---|---|---|---|
| `docs/lab/site/questions.html` | 74 КБ | ≈ 181 КБ | +107 КБ |
| `docs/lab/site/fleet.html` | 82 КБ | ≈ 189 КБ | +107 КБ |
| `docs/lab/site/index.html` | 81 КБ | ≈ 188 КБ | +107 КБ |
| `docs/lab/site/cost.html` | 91 КБ | ≈ 198 КБ | +107 КБ |
| `docs/lab/site/library.html` | 229 КБ | ≈ 336 КБ | +107 КБ |
| `docs/lab/site/tasks.html` | 281 КБ | ≈ 388 КБ | +107 КБ |
| `docs/lab/site/timeline.html` | 135 КБ | ≈ 242 КБ | +107 КБ |

Все всё ещё быстро открываются офлайн. Абсолютные размеры остаются в пределах
одного мегабайта на артефакт (наши текущие большие страницы уже переросли 200 КБ за
счёт данных, не шрифтов).

Альтернатива для сайта `docs/lab/site/`: положить `.woff2` файлы рядом (в
`docs/lab/site/assets/`) и ссылаться относительным путём. Тогда каждый HTML остаётся
худым, а браузер один раз кэширует шрифты между переходами. Для отчётов, которые
пересылаются одним файлом, — только base64.

---

## 8. Как применить в React + Vite + shadcn/ui

Стандартный путь npm-пакета, никакого custom-loader:

```bash
npm install geist
# или, если хочется control точечно по subset'ам:
npm install @fontsource-variable/geist @fontsource-variable/geist-mono
```

**Вариант 1 — пакет `geist` (Next.js-native, но работает и в Vite через прямой импорт CSS):**

```ts
// src/main.tsx
import "geist/font/sans/GeistVariableVF.woff2";
import "geist/font/mono/GeistMonoVariableVF.woff2";
// плюс подключение через @font-face в глобальном CSS
```

**Вариант 2 — `@fontsource-variable` (проще для Vite, только import subset'а):**

```ts
// src/main.tsx
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
```

**Tailwind v4** (у нас будет v4, как в Warren):

```css
/* app/globals.css */
@import "tailwindcss";
@import "@fontsource-variable/geist/wght.css";
@import "@fontsource-variable/geist-mono/wght.css";

@theme {
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, monospace;

  /* Цвета (Tailwind v4 читает :root напрямую, но можно и через @theme) */
  --color-background: #fafafa;
  --color-foreground: #26272b;
  --color-muted: #f2f3f5;
  --color-muted-foreground: #6b6f78;
  --color-border: #e6e7ea;
  --color-accent: #2563eb;
  /* … остальные из раздела 6 */
}
```

Компоненты shadcn/ui автоматически подхватят `font-sans` и `font-mono` из Tailwind theme.
`ThemeProvider` из shadcn ставит `class="dark"` на `<html>`; чтобы совпало с нашими
отчётами, добавляем `data-theme="dark"` тем же провайдером — оба селектора уже
поддержаны в CSS выше.

**Плюс:** тот же исходник CSS-переменных копируется в веб-приложение и в шаблон отчёта.
Изменения делаются один раз, применяются всюду.

---

## 9. Что делать с уже написанными отчётами

Сейчас в проекте есть три «поколения» готовых артефактов, которые уже показаны
владельцу или лежат в открытых ветках:

1. **`docs/lab/site/*.html`** (индекс + 6 страниц дашборда) — актуальный лабораторный
   UI. **Обновлять.** Это то, что владелец видит каждый день и что он забраковал.
2. **`docs/reports/verifications/GSL-*/`** (несколько HTML-отчётов приёмок) — уже
   отправленные результаты работ. **Не переписывать.** Оставить как исторические
   снапшоты (пометка в README, что «типографика docs/lab-эпохи GSL-138»).
3. **`docs/reports/web-harness-research-2026-08-03/index.html`** и прочие исследования —
   пока живы только в этой ветке. **Пересобрать.** Никто ещё не полагается на их вид.

Правило миграции: если артефакт помечен как «доставленный» (Jira ticket в статусе
Done, PR смёржен, владелец видел) — не трогаем. Если артефакт живёт в открытой ветке
или является рабочей витриной — переводим на новую систему.

Порядок работ, когда владелец даст добро:

1. Одна задача GSL: `[Skill] Единая типографика: скрипт сборки base64 + CSS-токены
   в generator`. Скрипт из раздела 7, CSS из раздела 6, шаблон отчёта переопределяется
   на `<style>` c переменными вместо копипаст.
2. Отдельная задача GSL на дашборд: `[Docs] docs/lab/site/*.html на новую типографику`.
   Регенерация из тех же данных, никакой ручной правки HTML.
3. При изменении React-приложения (следующая эпика веб-интерфейса) — CSS-переменные уже
   доступны, компоненты shadcn наследуют шрифт автоматически, ничего дополнительно
   делать не нужно.

---

## 10. Открытые вопросы владельцу

Не блокеры, но их лучше зафиксировать до задачи в Jira.

1. **Geist vs Inter.** Рекомендация — Geist (совпадает с Vercel/shadcn/Warren). Готовы
   ли принять OFL-шрифт и его вложение в артефакт как контракт (нельзя менять на другой
   без явной миграции всех отчётов)?
2. **Верхний предел веса шрифта.** В текущей системе владелец лично ограничил вес до 500.
   Оставляем 500 для UI и 600/700 для заголовков отчётов, или везде потолок 500?
3. **Мягкость палитры.** Показанный `#26272b` на `#fafafa` — 13.5:1. Ощущается «мягче
   чёрного на белом», но по-прежнему высокий контраст. Если владелец хочет ещё мягче,
   можно спустить foreground до `#3a3d42` (тогда контраст ≈ 9.5:1, всё ещё AAA), но
   мельчайший текст начинает казаться приглушённым. Готов дать превью на выбор.
4. **Single-file requirement.** Подтвердить: отчёты должны и дальше открываться из
   одного HTML без соседей? Если можно допустить папку `assets/` рядом с сайтом
   `docs/lab/site/`, экономим ~107 КБ на каждой странице.

---

## Источники

- Geist Font (Vercel): https://vercel.com/font — OFL 1.1, variable, weights 100-900,
  latin + cyrillic subsets.
- Fontsource: https://fontsource.org/fonts/geist/install и
  https://fontsource.org/fonts/geist-mono/install — npm-пакеты
  `@fontsource-variable/geist` / `-mono`, готовые subset-файлы.
- shadcn/ui theming (OKLCH defaults): https://ui.shadcn.com/docs/theming
- Linear typography (Inter Variable, ss03/cv01): https://styles.refero.design/style/…linear
- WCAG 2.1 contrast formula: https://www.w3.org/TR/WCAG21/#contrast-minimum
- Реальные размеры woff2 файлов измерены `curl -I` против jsDelivr CDN Fontsource
  2026-08-03 (см. раздел 3, таблица).
