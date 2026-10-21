# Проверка плагина без Pixso

Проверять плагин только в Pixso дорого: каждая правка это перезагрузка
приложения, выделение фреймов руками и клик по кнопке. Поэтому основную часть
работы стоит перенести в три инструмента, которые запускаются из терминала за
секунду. Все три есть в каркасе (`assets/scaffold/tools/`).

Содержание:

- [Что чем проверяется](#что-чем-проверяется)
- [Мок окна: интерфейс без Pixso](#мок-окна-интерфейс-без-pixso)
- [Харнесс окна: логика в Node](#харнесс-окна-логика-в-node)
- [Харнесс main.js: фальшивый документ](#харнесс-mainjs-фальшивый-документ)
- [Дев-сервер: живая отладка в Pixso](#дев-сервер-живая-отладка-в-pixso)
- [Снимки экрана без рук](#снимки-экрана-без-рук)
- [Что остаётся проверять только на стенде](#что-остаётся-проверять-только-на-стенде)

## Что чем проверяется

| Инструмент | Что проверяет | Чего не увидит |
|---|---|---|
| `tools/mock-ui.html` | весь интерфейс и его состояния, вживую в браузере | реальный API Pixso |
| `tools/harness.js` | логику окна в Node (сборка файлов, разбор данных) | вёрстку |
| `tools/main-harness.js` | логику `main.js` на подставном документе | настоящие узлы Pixso |
| дев-сервер | связку с настоящим Pixso | ничего, но медленно |

## Мок окна: интерфейс без Pixso

Страница открывает `ui.html` в iframe и притворяется песочницей: отдаёт список
узлов, миниатюры, прогресс, готовые данные. Интерфейс не знает, что с ним
говорит не Pixso: он общается ровно теми же сообщениями.

```html
<iframe id="f" src="../ui.html" style="width:940px;height:600px;border:0"></iframe>
<script>
const f = document.getElementById('f');
function send(msg) { f.contentWindow.postMessage({ pluginMessage: msg }, '*'); }

window.addEventListener('message', async (e) => {
  const m = e.data && e.data.pluginMessage;
  if (!m) { return; }
  if (m.type === 'ui-ready') {
    send({ type: 'hello', channel: 'mock', via: m.via, pluginId: 'mock', command: '' });
    send({ type: 'frames', frames: FRAMES, fromSelection: true });
  }
  /* … остальные команды окна … */
});
</script>
```

Что важно сделать сразу:

- **Переключатели состояний в адресе.** `?frames=0` (пусто), `?picked=0` (ничего
  не отмечено), `?run=1` (сразу запустить работу). Без них пустые и крайние
  состояния проверяются вручную, а значит не проверяются.
- **Не по таймеру, а по событию.** Если моку нужно что-то нажать в окне после
  отрисовки, ждать `setTimeout(…, 0)` нельзя: доставка `postMessage` не обязана
  опередить свой такт. Ориентируйся на сообщение от окна (например запрос
  превью): это надёжный признак, что интерфейс уже собрал список.
- **Мок должен повторять поведение плагина, а не удобное.** Если `main.js` по
  команде «перечитать» сбрасывает кэш миниатюр и снимает их заново, мок обязан
  делать то же, иначе кнопка в моке выглядит сломанной, хотя в бою работает.

Открывать мок нужно **по HTTP**, а не двойным щелчком: с `file://` браузер
считает iframe чужим origin, и часть проверок не работает.

```bash
python3 -m http.server 8765
# → http://localhost:8765/tools/mock-ui.html
```

## Харнесс окна: логика в Node

Код из `ui.html` можно выполнить в Node, подсунув заглушки DOM. Это ловит ошибки
в логике за секунду и без браузера.

```js
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('ui.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function stubEl() {
  return { value: '', checked: false, textContent: '', style: {}, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, scrollIntoView() {}, onclick: null };
}
const els = {};
const document = {
  getElementById(id) { if (!els[id]) { els[id] = stubEl(); } return els[id]; },
  createElement() { return stubEl(); }, body: stubEl()
};
const sent = [];
const sandbox = { document, parent: { postMessage: (m) => sent.push(m) },
  window: { location: { origin: 'null' } }, console, Blob, Response, URL,
  Uint8Array, TextEncoder, Promise, setTimeout, clearTimeout, JSON, Math };
vm.runInContext(code, vm.createContext(sandbox), { filename: 'ui.html' });
```

Полезное следствие: **заглушка знает только `getElementById`.** Если код окна
вдруг возьмёт `document.querySelector`, харнесс упадёт, и это хороший сигнал
писать в одном стиле. Заглушку лучше не расширять «чтобы прошло»: она держит код
окна в понятных рамках.

## Харнесс main.js: фальшивый документ

Так же в `vm` запускается `main.js` (`tools/main-harness.js` в каркасе), только заглушки другие. Вместо DOM
фальшивый Pixso: `currentPage.selection`, узлы с `absoluteTransform` и
`exportAsync`, `clientStorage`, `ui.postMessage`. Тогда можно прогонять сценарии
разбора макета:

```js
const pixso = {
  showUI() {}, notify() {}, closePlugin() {}, on() {}, command: '',
  ui: { onmessage: null, postMessage: (m) => sent.push(m), on() {} },
  currentPage: { selection: [frame], children: [frame], name: 'Тест' },
  clientStorage: { getAsync: async () => null, setAsync: async () => {} },
  mixed: Symbol('mixed')
};
```

Что стоит уметь такому харнессу:

- **Следить за видимостью.** Подмени `visible` через `Object.defineProperty` и
  записывай, что скрывалось: половина ошибок это «спрятали не то» или «не вернули
  обратно».
- **Различать вызовы `exportAsync` по `constraint.type`.** Снимок подложки
  (`SCALE`) и миниатюра (`WIDTH`) это разные вещи, и путать их в замерах нельзя.
- **Хранить сценарии рядом с ожиданиями.** Один сценарий это один блок: как
  выглядит макет и что должно получиться. Когда правило меняется (например
  «больше ничего не обрезаем»), сценарий переписывается вместе с кодом, и
  красный тест сразу показывает, что правило поменялось не везде.

## Дев-сервер: живая отладка в Pixso

Pixso ждёт на **порту 5201** (зашит в приложении) ровно две вещи: HTTP-отдачу
`ui.html` по `/` и WebSocket на `/plugin`, куда сервер шлёт JSON
`{name, content}`, где `name` это `manifest` | `main` | `ui`. Обёртку `ui` Pixso
показывает как окно плагина: внутри неё iframe с вашим `ui.html` и ретранслятор
`postMessage`.

Сервер в каркасе без зависимостей, рукопожатие и кадры WebSocket собраны
руками. Запуск:

```bash
node tools/dev-server.js
```

Важное следствие дев-режима: окно живёт внутри промежуточного iframe и на
origin `http://localhost:5201`. Значит `localStorage` там **работает**, а в
собранном плагине нет. Не проверяй хранение файлов и скачивание только в
дев-режиме: повтори на упакованном плагине.

## Снимки экрана без рук

Состояния интерфейса удобно сохранять картинками и показывать их человеку.
Headless Chrome умеет это без библиотек:

```bash
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
perl -e 'alarm 40; exec @ARGV' "$CH" --headless=new --disable-gpu --no-sandbox \
  --no-first-run --force-device-scale-factor=2 --window-size=1000,650 \
  --user-data-dir=/tmp/chrome-shot --virtual-time-budget=6000 \
  --screenshot=/tmp/state.png "http://localhost:8765/tools/mock-ui.html?frames=0"
```

Тонкости, на которые уходит время, если их не знать:

- **Chrome пишет файл, но сам не выходит**: оборачивай в таймер. В macOS нет
  `timeout`, поэтому `perl -e 'alarm N; exec @ARGV'`.
- **`--virtual-time-budget` торопит таймеры**, но не ждёт настоящую асинхронную
  работу (`canvas.toBlob`, blob-адреса). Для длинных сценариев снимок получится
  «замороженным на середине». Лучше форсировать нужное состояние прямо в
  харнессе, а не гонять весь сценарий.
- **`--hide-scrollbars` скрывает и то, что вы проверяете.** Полосы прокрутки без
  него видны.
- **Одинаковый профиль кэширует страницу**: правка есть, картинка старая. Свежий
  `--user-data-dir` или новый адрес.

## Что остаётся проверять только на стенде

Ни мок, ни харнесс не увидят: поднялся ли канал наверх, доехало ли поле `ui` из
манифеста, разрешено ли скачивание, как ведёт себя `clientStorage`, поддержан ли
`JPG`, есть ли нужный шрифт. Это короткий список,
но именно он и решает, работает плагин или нет, поэтому финальная проверка всегда
на упакованном плагине в приложении.
