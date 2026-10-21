# Окно плагина по DAIS

Рекомендуем верстать окно по **DAIS**, UI kit дизайн-системы FinAI. Атомы
в нём из **SDDS FinAI**, шаблонные компоненты свои. Если окна плагинов разных
авторов сделаны по одной системе, дизайнер не переучивается от плагина
к плагину. Своя дизайн-система тоже подойдёт: вся тема окна собрана
переменными, подставьте свои значения, разметка не меняется.

Содержание:

- [Где смотреть компоненты](#где-смотреть-компоненты)
- [Что из этого нужно окну плагина](#что-из-этого-нужно-окну-плагина)
- [Токены](#токены)
- [Контролы](#контролы)
- [Полосы прокрутки](#полосы-прокрутки)
- [Иконки](#иконки)
- [Тексты](#тексты)
- [Композиция окна](#композиция-окна)

## Где смотреть компоненты

| Что | Где |
|---|---|
| DAIS, шаблонные компоненты и композиции | [daisforge.github.io/dais-ui](https://daisforge.github.io/dais-ui/) |
| SDDS FinAI, атомы | [сторибук](https://plasma.sberdevices.ru/sdds-finai-storybook/), [документация](https://plasma.sberdevices.ru/sdds-finai/) |
| Значения токенов | `@salutejs/sdds-themes`, файл `css/sdds_finai__light.css` (и `__dark`) |
| Настройки компонентов (размеры, радиусы) | `@salutejs/sdds-finai`, `dist/styled-components/es/components/<Имя>/<Имя>.config.js` |

Компоненты DAIS и SDDS написаны на React, а окно плагина работает без npm.
Поэтому сами компоненты в окно не подключаются: из системы берутся цвета,
размеры, радиусы и вид, а вёрстка своя, на обычном HTML и CSS. Файлы пакетов
читаются без установки, через unpkg:

```bash
curl -sL "https://unpkg.com/@salutejs/sdds-themes/css/sdds_finai__light.css" | grep -- "--surface-accent:"
curl -sL "https://unpkg.com/@salutejs/sdds-finai/dist/styled-components/es/components/Button/Button.config.js"
```

## Что из этого нужно окну плагина

Всё, что обычно бывает в окне плагина, в системе есть:

- **кнопки**: Button, IconButton, LinkButton;
- **выбор**: Checkbox, Radiobox, Switch, Segment, Chip и ChipGroup;
- **ввод**: TextField, TextArea, NumberInput, Select и Dropdown, Slider и Range;
- **навигация и состояния**: Tabs, Tooltip, Toast, Notification, Spinner,
  Progress, Counter, Badge, EmptyState;
- **загрузка файла**: Dropzone и Attach.

Чего нет: выбора цвета и полосы прокрутки, их делаем сами (ниже).

## Токены

Значения из `sdds_finai__light.css`. В каркасе они уже стоят переменными
в начале `ui.html`:

```css
:root {
  --accent: #199AF0;          /* surface-accent */
  --accent-hover: #36A7F2;    /* surface-accent-hover */
  --accent-deep: #0B7ECB;     /* text-accent, акцентный текст на светлом */
  --accent-soft: #ECF6FC;     /* surface-accent-minor, светлая подложка */
  --text-primary: #13181BF5; --text-secondary: #485056B0; --text-tertiary: #707C847A;
  --surface: #FFFFFF;         /* surface-solid-card */
  --background: #F2F5F8;      /* background-primary */
  --fill: #ADB9C238;          /* surface-transparent-secondary, заливка контролов */
  --fill-hover: #ADB9C247;    /* surface-transparent-secondary-hover */
  --fill-soft: #D5DFE642;     /* surface-transparent-primary */
  --outline: #D5DFE6;         /* outline-solid-primary */
  --success: #108E26; --warning: #FA5F05; --error: #E31227;
  --radius-control: 10px;     /* кнопка S, 40 px */
  --radius-small: 8px;        /* кнопка XS, 32 px */
  --disabled-opacity: .4;     /* выключенный контрол */
}

html, body {
  font: 12px/1.5 "SB Sans Text", "SB Sans Display", -apple-system, "Segoe UI",
        Roboto, Arial, sans-serif;
  color: var(--text-primary); background: var(--surface);
  -webkit-font-smoothing: antialiased;
  margin: 0; height: 100%; overflow: hidden;
}
```

Основной текст 12 px (body XS), подписи 11 px, заголовки `SB Sans Display`
16-17 px. Больше кеглей не нужно: окно маленькое. Шрифтов SB Sans может не быть
на машине, поэтому запасные гарнитуры в списке обязательны.

## Контролы

Сверяйте размеры со сторибуком SDDS FinAI, ниже то, что уже проверено в окнах
плагинов.

**Кнопки.** Основная залита акцентом, вторичная заливкой `--fill`, размер и радиус
у них общие, разница только в заливке. Высота 40 px и радиус 10 (Button S),
мелкие кнопки 32 px и радиус 8 (Button XS). Выключенная кнопка это та же кнопка
с прозрачностью 0,4, а не серая. Держи размер общим правилом на обе кнопки,
иначе они разъезжаются по высоте при правках:

```css
.actions a, .actions button {
  font: inherit; font-weight: 600; border: 0; cursor: pointer;
  border-radius: var(--radius-control); height: 40px; padding: 0 18px;
  text-decoration: none;
  display: inline-flex; align-items: center; justify-content: center;
}
.actions .primary { background: var(--accent); color: #fff; }
.actions .primary:hover { background: var(--accent-hover); }
.actions .secondary { background: var(--fill); color: var(--text-primary); }
.actions button:disabled { opacity: var(--disabled-opacity); cursor: default; }
```

**Чекбокс** со скруглёнными углами, белая галка на акценте. Держи один общий
стиль на весь файл, тогда чекбоксы не разъедутся по размеру. Промежуточное
состояние (отмечена часть) рисуется горизонтальной чертой, `:indeterminate`
ставится из кода:

```css
input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  width: 18px; height: 18px; margin: 0; flex: 0 0 auto;
  border-radius: 6px; border: 1.5px solid var(--text-tertiary);
  background: var(--surface); cursor: pointer;
  display: inline-grid; place-content: center;
}
input[type="checkbox"]::before {
  content: ''; width: 12px; height: 12px; transform: scale(0);
  background: no-repeat center / contain url("…галка svg…");
}
input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
input[type="checkbox"]:checked::before { transform: scale(1); }
input[type="checkbox"]:indeterminate { background: var(--accent); border-color: var(--accent); }
input[type="checkbox"]:indeterminate::before { transform: scale(1); background-image: url("…черта svg…"); }
```

**Сегменты** (1×, 2×, 3×): контейнер с заливкой `--fill`, выбранный сегмент
белая пилюля с мягкой тенью. **Поле ввода**: заливка без рамки, в фокусе
акцентное кольцо (`box-shadow: 0 0 0 2px var(--accent)`), не `outline`.
**Чипы** по ChipGroup: заливка `--fill`, выбранное состояние как в сторибуке
SDDS FinAI, крестик не нужен, выбор снимается повторным нажатием.

**Цвет.** Готового выбора цвета в системе нет. Простейший вариант это
`<input type="color">` в обёртке с образцом цвета и полем для HEX рядом.

## Полосы прокрутки

Системные не годятся: на macOS оверлейная полоса в покое исчезает совсем,
и пользователь не понимает, что содержимое прокручивается, а на Windows висит
всегда. Своя каретка: прозрачная дорожка, серая каретка, появляется на время
прокрутки и под курсором, гаснет через 0,8 с покоя.

```css
.scroller::-webkit-scrollbar { width: 8px; height: 8px; }
.scroller::-webkit-scrollbar-track { background: transparent; }
.scroller::-webkit-scrollbar-thumb {
  background: transparent; border-radius: 4px;
  border: 2px solid transparent; background-clip: content-box;
  transition: background .2s ease;
}
.scroller.is-scrolling::-webkit-scrollbar-thumb { background: var(--text-tertiary); background-clip: content-box; }
.scroller::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); background-clip: content-box; }
```

Класс ставит код:

```js
function autoHideScroll(el) {
  if (!el) { return; }
  var timer = null;
  el.addEventListener('scroll', function () {
    el.className += el.className.indexOf('is-scrolling') === -1 ? ' is-scrolling' : '';
    clearTimeout(timer);
    timer = setTimeout(function () {
      el.className = el.className.replace(/\s*is-scrolling/g, '');
    }, 800);
  }, { passive: true });
}
```

Не задавай при этом `scrollbar-width` и `scrollbar-color`: в новых Chromium
стандартные свойства выигрывают у `::-webkit-scrollbar`, и вся настройка пропадает.

## Иконки

Эмодзи в интерфейсе не место: система рисует их своим цветным шрифтом, и они
выбиваются из всего остального. Иконки есть в DAIS (раздел Images, Icons)
и в открытом пакете `@salutejs/plasma-icons`. Путь к исходнику в нём
предсказуемый, доступ через unpkg:

```bash
curl -sL "https://unpkg.com/@salutejs/plasma-icons/es/scalable/Icon.assets.24/PictureOutline.js"
curl -sL "https://unpkg.com/@salutejs/plasma-icons/?meta"   # список файлов пакета
```

Внутри React-обёртка над `<svg>` с одним-двумя `<path>`. Вставляй путь в свой
`<svg viewBox="0 0 24 24">` с `fill="currentColor"`, тогда иконка наследует цвет
и наведение кнопки. Набор 16 для маленьких кнопок, 24 для пустых состояний.

## Тексты

- **По-русски и обезличенно.** «Собирается 26 слайдов», «Формируется файл», а не
  «Собираю». Первое лицо в машинных сообщениях звучит как чужой голос.
- **Без точки в конце абзаца** в подписях и сообщениях окна.
- **Со склонениями.** «1 слайд», «2 слайда», «26 слайдов»: числительные
  склоняются везде, включая журнал. Заглушки вида «слайд(ов)» выглядят
  неаккуратно и сразу заметны:

```js
function plural(n, one, few, many) {
  var mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) { return one; }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) { return few; }
  return many;
}
function count(n, one, few, many) { return n + ' ' + plural(n, one, few, many); }
```

  Проверяй на 11-14 (одиннадцать слайдов), 21 (двадцать один слайд), 26 и 111,
  именно там ошибаются.
- **Имя файла впечатано, а не подсказкой.** Если у плагина есть поле имени,
  подставь готовое значение (например имя страницы) прямо в поле: подсказка
  выглядит как «ничего не введено». Плейсхолдер оставь для случая, когда
  пользователь стёр всё сам.

## Композиция окна

Окно плагина это панель, а не сайт. Что работает:

- **Одна колонка настроек, один список, один центр.** Боковые колонки одной
  ширины: разная ширина слева и справа читается как ошибка вёрстки.
- **Своей шапки лучше не делать.** Имя плагина Pixso и так подписывает сверху,
  вторая строка с тем же названием съедает 44 px.
- **Серые подложки вместо рамок**, акцент только у главного действия.
- **Техническое за кнопкой.** Журнал, отладка, подробности прячутся
  и открываются по нажатию, ошибка раскрывает журнал сама.
- **То, что составляет суть плагина, в настройки не выводится.** Если плагин
  существует ради редактируемого текста, галочки «переносить текст» быть
  не должно.
- **Пустое состояние не пустой экран.** Короткая подсказка, что сделать,
  в центре иконка и одна строка, основная кнопка выключена. Не повторяй одну
  и ту же фразу в двух местах.
