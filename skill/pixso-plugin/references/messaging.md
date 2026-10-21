# Канал main ↔ окно

Это самое хрупкое место плагина Pixso. В облачной Figma канал работает
предсказуемо. В части сборок Pixso он ломается тремя разными способами,
и ни один из них не сообщает о себе ошибкой, плагин просто «висит». Сильнее
всего это видно в Pixso Desktop 2.2.7 для macOS, а на стенде с клиентом 2.3.0
тот же плагин работает полностью. Обходы ниже безвредны для исправной сборки.

Содержание:

- [Что именно ломается](#что-именно-ломается)
- [Сторона main.js: подписка всеми способами](#сторона-mainjs-подписка-всеми-способами)
- [Дедупликация](#дедупликация)
- [Сторона окна: несколько адресатов](#сторона-окна-несколько-адресатов)
- [Конверт входящих сообщений](#конверт-входящих-сообщений)
- [Рукопожатие с повторами](#рукопожатие-с-повторами)
- [Сторож: как честно сказать, что канал молчит](#сторож-как-честно-сказать-что-канал-молчит)
- [Дев-зонд](#дев-зонд)

## Что именно ломается

1. **`ui.onmessage` присваивается, но ничего не доставляет.** Свойство
   записывается, читается обратно, а настоящая рассылка идёт по подписке
   `ui.on('message')`. Изнутри отличить нельзя.
2. **Канал «окно → плагин» вообще не поднимается.** Зависит от сборки клиента
   (так было в Pixso Desktop 2.2.7). Сообщения вниз доходят, наверх ни одного.
3. **Сообщение наверх отбрасывается без служебных полей конверта.** Pixso кладёт
   рядом с `pluginMessage` свои поля (например идентификатор плагина); если их
   не вернуть, сообщение теряется молча.

Отсюда вывод, который определяет всю архитектуру: **окно не может быть
инициатором.** `main.js` должен работать так, будто наверх никто не ответит:
сам прислать стартовые данные, не дожидаясь окна, а всё, что можно сделать
без команды из окна, делать без неё.

## Сторона main.js: подписка всеми способами

Подписывайся и так, и так, и до `showUI`, и после. Стоит это три строки, а
экономит день:

```js
var messageChannels = [];

function registerHandler(stage) {
  try {
    API.ui.onmessage = handleMessage;
    if (API.ui.onmessage === handleMessage) { messageChannels.push('onmessage/' + stage); }
  } catch (e) { /* свойство только для чтения */ }
  try {
    if (typeof API.ui.on === 'function') {
      API.ui.on('message', handleMessage);
      messageChannels.push('ui.on/' + stage);
    }
  } catch (e) { /* события с таким именем нет */ }
}

registerHandler('до');
API.showUI(UI_HTML, { width: 940, height: 600 });
registerHandler('после');
```

`messageChannels` потом стоит отдать в окно первым же сообщением: когда что-то
не работает, список сработавших каналов это первое, что хочется увидеть.

Сам обработчик оборачивай в `try/catch` целиком. Необработанное исключение в
`main.js` не всплывёт нигде: окно останется ждать ответа вечно.

```js
function handleMessage(msg) {
  try {
    if (!msg || !msg.type) { return; }
    if (alreadyHandled(msg)) { return; }
    if (msg.type === 'export') { runExport(msg.options); }
    /* … */
  } catch (e) {
    send({ type: 'error', message: 'Сбой в main.js на «' + msg.type + '»: ' + errText(e) });
  }
}
```

## Дедупликация

Раз подписок несколько, одно сообщение придёт несколько раз. Окно нумерует свои
сообщения, `main.js` считает обработанным первое:

```js
var seenIds = {}, seenOrder = [];

function alreadyHandled(msg) {
  var id = msg && msg.__id;
  if (id === undefined || id === null) { return false; }
  if (seenIds[id]) { return true; }
  seenIds[id] = 1;
  seenOrder.push(id);
  if (seenOrder.length > 200) { delete seenIds[seenOrder.shift()]; }
  return false;
}
```

Ограничение на 200 записей нужно, чтобы карта не росла бесконечно в долгой сессии.

## Сторона окна: несколько адресатов

В собранном плагине окно шлёт наверх через `parent`. В режиме разработки между
окном и Pixso стоит промежуточный iframe-ретранслятор, и адресат другой.
Сравнивать окна там бесполезно: сравнения не срабатывают. Поэтому собери список
всех возможных адресатов и шли во все сразу, каждому со своей меткой; тот, кто
ответит, и есть рабочий канал.

```js
var transports = (function () {
  var list = [];
  try { if (window.parent && window.parent !== window) { list.push({ name: 'parent', win: window.parent }); } } catch (e) {}
  try { if (window.top && window.top !== window && window.top !== window.parent) { list.push({ name: 'top', win: window.top }); } } catch (e) {}
  return list;
})();

var activeTransport = null;

function send(msg) {
  if (activeTransport) { post(activeTransport.win, msg); return; }
  if (transports.length) { post(transports[0].win, msg); }
}
```

Как только `main.js` в ответном сообщении назовёт метку (`via`), окно
запоминает канал и дальше шлёт только в него.

## Конверт входящих сообщений

Сообщение наверх должно повторять служебные поля, которые Pixso присылает вниз,
и нести идентификатор плагина: у окна origin пустой, и по адресу отправителя
Pixso не может понять, какому из открытых плагинов адресована команда.

```js
function post(win, msg) {
  if (msg && msg.__id === undefined) { msg.__id = ++msgCounter; }
  var plain = { pluginMessage: msg };
  if (pluginId) { plain.pluginId = pluginId; }
  if (upstreamEnvelope) {          /* запомнили с первого входящего сообщения */
    for (var key in upstreamEnvelope) {
      if (Object.prototype.hasOwnProperty.call(upstreamEnvelope, key)) { plain[key] = upstreamEnvelope[key]; }
    }
  }
  var data = plain;
  if (inDevWrapper && win === window.parent) { data = { __fromPluginUi: true, payload: plain }; }
  try { win.postMessage(data, '*'); return true; } catch (e) { return false; }
}
```

Приём это обычный `message`, полезное лежит в `pluginMessage`:

```js
window.addEventListener('message', function (e) {
  var raw = e.data;
  var msg = raw && raw.pluginMessage;
  if (!msg) { return; }
  if (!upstreamEnvelope) {          /* запоминаем конверт целиком, кроме полезной части */
    upstreamEnvelope = {};
    for (var k in raw) { if (k !== 'pluginMessage') { upstreamEnvelope[k] = raw[k]; } }
  }
  /* … разбор msg.type … */
});
```

## Рукопожатие с повторами

Окно объявляет о готовности, но подтверждения может не быть, поэтому:

- окно повторяет рукопожатие через 700 и 1800 мс, пока канал не подтверждён;
- `main.js` не ждёт рукопожатия: присылает стартовые данные сам, несколько раз
  с задержкой, пока не услышит ответ.

```js
/* окно */
function handshake() {
  for (var i = 0; i < transports.length; i++) {
    post(transports[i].win, { type: 'ui-ready', via: transports[i].name });
  }
}
handshake();
setTimeout(function () { if (!activeTransport) { handshake(); } }, 700);
setTimeout(function () { if (!activeTransport) { handshake(); } }, 1800);
```

Обратная сторона: отсутствие подтверждения ещё не значит, что канал мёртв.
`main.js` присылает стартовые данные сам и может ответить раньше, чем окно
успеет поздороваться, и подтверждать ему тогда нечего. Поэтому «канал мёртв» решает не таймер на старте, а
сторож по факту нажатия.

## Сторож: как честно сказать, что канал молчит

У кнопки, которая шлёт команду наверх, должен быть таймер: если подтверждение не
пришло за пару-три секунды, снимай состояние «работаю» и объясняй, что
произошло. Иначе кнопка остаётся нажатой навсегда, и пользователь ждёт впустую.

```js
state.acked = false;
send({ type: 'export', options: options });
setTimeout(function () {
  if (state.acked || !state.busy) { return; }
  state.busy = false;
  setBusy(false);
  log('Команда из окна не дошла до кода плагина. Так бывает в некоторых сборках '
    + 'Pixso: перезапустите плагин.', 'err');
}, 3000);
```

`main.js` в ответ на команду первым делом присылает подтверждение (например
`export-start`), а окно ставит `state.acked = true`.

## Дев-зонд

В режиме разработки окно живёт на origin дев-сервера, поэтому может отправлять
отчёты обычным `fetch`: это единственный способ увидеть, что происходит внутри
окна, когда канал наверх молчит. В собранном плагине origin пустой, сервера нет,
зонд выключается сам.

```js
var DEV_PROBE = true;                    /* перед сборкой false */
var DEV_LOG_URL = 'http://localhost:5201/log';
var inDevWrapper = false;
try { inDevWrapper = window.location.origin === 'http://localhost:5201'; } catch (e) {}
```

Полезнее всего писать зондом три вещи: какие каналы сработали, какие поля лежали
в конверте первого входящего сообщения и какие типы сообщений вообще пришли.
Эти три строки почти всегда объясняют, что сломалось.
