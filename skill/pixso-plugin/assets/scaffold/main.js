/**
 * Каркас плагина Pixso — сторона песочницы.
 *
 * Здесь есть доступ к документу, но нет DOM, сети и Web API. Поэтому этот файл
 * только СОБИРАЕТ данные и отправляет их в ui.html, который уже делает из них
 * что нужно (файлы, картинки, скачивание).
 *
 * Демонстрационная задача каркаса: показать выделенные кадры с миниатюрами и по
 * кнопке посчитать в них слои. Замени её на свою — обвязка вокруг (каналы,
 * рукопожатие, настройки, ошибки) переносится как есть.
 */

'use strict';

/* Pixso совместим с Figma Plugin API: берём тот глобальный объект, который есть.
   typeof-проверки нужны, чтобы не поймать ReferenceError на отсутствующем имени. */
var API = (function () {
  try { if (typeof pixso !== 'undefined' && pixso) { return pixso; } } catch (e) {}
  try { if (typeof figma !== 'undefined' && figma) { return figma; } } catch (e) {}
  return null;
})();

var SETTINGS_KEY = 'scaffold-settings';
var DEFAULTS = { deep: true };            /* пример настройки: считать вложенные слои */

var EXPORTABLE = { FRAME: 1, COMPONENT: 1, COMPONENT_SET: 1, INSTANCE: 1, SECTION: 1 };

var COMMAND = (function () {
  try { return String(API.command || ''); } catch (e) { return ''; }
})();

var PLUGIN_ID = (function () {
  try { if (API.pluginId) { return String(API.pluginId); } } catch (e) {}
  return 'scaffold-plugin';
})();

/* ------------------------------------------------------------------ */
/* Обмен сообщениями                                                   */
/* ------------------------------------------------------------------ */

function handleMessage(msg) {
  try {
    if (!msg || !msg.type) { return; }
    if (alreadyHandled(msg)) { return; }
    if (msg.type === 'ui-ready') { announced = true; onReady(msg.via); }
    else if (msg.type === 'refresh') { sentThumbs = {}; postFrameList(); }
    else if (msg.type === 'run') { run(withDefaults(msg.options)); }
    else if (msg.type === 'save-settings') { saveSettings(msg.settings); }
    else if (msg.type === 'close') { API.closePlugin(); }
  } catch (e) {
    /* Молча упасть здесь нельзя: окно останется ждать ответа вечно. */
    send({ type: 'error', message: 'Сбой в main.js на «' + msg.type + '»: ' + errText(e) });
  }
}

/* Обработчик вешаем всеми способами сразу: присваивание ui.onmessage может
   «прижиться», но ничего не доставлять, если рассылка идёт по подписке. */
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

var UI_HTML = (typeof INLINE_UI === 'string' && INLINE_UI.length)
  ? INLINE_UI
  : ((typeof __html__ === 'string') ? __html__ : '');

try {
  API.showUI(UI_HTML, { width: 720, height: 520 });
} catch (e) {
  API.showUI(UI_HTML);
}

registerHandler('после');

/* Одно и то же сообщение может прийти по нескольким каналам — обрабатываем
   только первое. */
var seenIds = {};
var seenOrder = [];

function alreadyHandled(msg) {
  var id = msg && msg.__id;
  if (id === undefined || id === null) { return false; }
  if (seenIds[id]) { return true; }
  seenIds[id] = 1;
  seenOrder.push(id);
  if (seenOrder.length > 200) { delete seenIds[seenOrder.shift()]; }
  return false;
}

function send(msg) {
  API.ui.postMessage(msg);
}

/* Окно может не суметь ответить, поэтому стартовые данные отправляем сами —
   несколько раз, пока не услышим подтверждение. */
var announced = false;

function onReady(via) {
  send({ type: 'hello', channel: messageChannels.join('+') || 'нет',
         via: via || 'ui-ready', pluginId: PLUGIN_ID, command: COMMAND });
  loadSettings().then(function (settings) { send({ type: 'settings', settings: settings }); });
  postFrameList();
}

function announce(attempt) {
  if (announced || attempt > 4) { return; }
  onReady('auto');
  try { setTimeout(function () { announce(attempt + 1); }, 400 + attempt * 400); } catch (e) {}
}

try { setTimeout(function () { announce(0); }, 200); } catch (e) { announce(0); }

/* Список обновляется сам при смене выделения — кнопка «перечитать» в окне
   нужна для правок внутри макета, о которых события нет. */
try {
  API.on('selectionchange', function () { postFrameList(); });
} catch (e) { /* событие поддерживается не всеми сборками */ }

/* ------------------------------------------------------------------ */
/* Сбор данных                                                         */
/* ------------------------------------------------------------------ */

function prop(node, name) {
  try { return node[name]; } catch (e) { return undefined; }
}

function safeNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }

function isExportable(node) {
  return !!(node && EXPORTABLE[prop(node, 'type')]);
}

function nearestFrame(node) {
  var cur = node, guard = 0;
  while (cur && guard < 64) {
    if (isExportable(cur)) { return cur; }
    cur = prop(cur, 'parent');
    guard++;
  }
  return null;
}

/** Кадры: сначала выделение, иначе вся страница. Порядок — как на холсте. */
function collectFrames() {
  var selection = [];
  try { selection = API.currentPage.selection || []; } catch (e) { selection = []; }

  var frames = [], i;
  for (i = 0; i < selection.length; i++) {
    if (isExportable(selection[i])) { frames.push(selection[i]); }
  }
  /* Выделили слой внутри кадра — берём сам кадр, а не отказываем. */
  if (!frames.length && selection.length) {
    for (i = 0; i < selection.length; i++) {
      var owner = nearestFrame(selection[i]);
      if (owner && frames.indexOf(owner) === -1) { frames.push(owner); }
    }
  }
  var fromSelection = frames.length > 0;
  if (!frames.length) {
    var children = [];
    try { children = API.currentPage.children || []; } catch (e) { children = []; }
    for (i = 0; i < children.length; i++) {
      if (isExportable(children[i])) { frames.push(children[i]); }
    }
  }
  return { frames: canvasOrder(frames), fromSelection: fromSelection };
}

/** Порядок «как на холсте»: ряды сверху вниз, в ряду слева направо.
    Простая сортировка по y ломается, если кадр в ряду сдвинут на пиксель:
    он вылетает из своего ряда. Поэтому сначала собираем ряды по вертикальному
    перекрытию (порог треть меньшей высоты), потом сортируем внутри ряда. */
function canvasOrder(frames) {
  var sorted = frames.slice().sort(function (a, b) {
    return safeNum(prop(a, 'y')) - safeNum(prop(b, 'y'));
  });
  var rows = [];
  sorted.forEach(function (frame) {
    var top = safeNum(prop(frame, 'y')), height = safeNum(prop(frame, 'height'));
    var row = rows.length ? rows[rows.length - 1] : null;
    if (row) {
      var overlap = Math.min(row.bottom, top + height) - Math.max(row.top, top);
      if (overlap > Math.min(row.minHeight, height) / 3) {
        row.items.push(frame);
        row.bottom = Math.max(row.bottom, top + height);
        row.minHeight = Math.min(row.minHeight, height);
        return;
      }
    }
    rows.push({ top: top, bottom: top + height, minHeight: height, items: [frame] });
  });
  var out = [];
  rows.forEach(function (row) {
    row.items.sort(function (a, b) { return safeNum(prop(a, 'x')) - safeNum(prop(b, 'x')); });
    out = out.concat(row.items);
  });
  return out;
}

var sentThumbs = {};

function postFrameList() {
  var found = collectFrames();
  var list = [];
  for (var i = 0; i < found.frames.length; i++) {
    var f = found.frames[i];
    list.push({ id: prop(f, 'id'), name: String(prop(f, 'name') || 'Кадр'),
                width: safeNum(prop(f, 'width')), height: safeNum(prop(f, 'height')) });
  }
  var pageName = '';
  try { pageName = String(API.currentPage.name || ''); } catch (e) {}
  send({ type: 'frames', frames: list, fromSelection: found.fromSelection, pageName: pageName });
  postThumbs(found.frames);
}

/** Миниатюры — по одной на кадр; кэш сбрасывает команда «перечитать». */
function postThumbs(frames) {
  frames.forEach(function (frame) {
    var id = prop(frame, 'id');
    if (!id || sentThumbs[id]) { return; }
    sentThumbs[id] = 1;
    var attempt;
    try {
      attempt = frame.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 320 } });
    } catch (e) { return; }
    if (!attempt || typeof attempt.then !== 'function') { return; }
    attempt.then(function (bytes) {
      send({ type: 'thumb', id: id, png: bytes });
    })['catch'](function () { /* миниатюра не обязательна */ });
  });
}

/* ------------------------------------------------------------------ */
/* Работа плагина: замени на свою                                      */
/* ------------------------------------------------------------------ */

function countLayers(node, deep) {
  var kids = prop(node, 'children') || [];
  var n = kids.length;
  if (deep) {
    for (var i = 0; i < kids.length; i++) { n += countLayers(kids[i], true); }
  }
  return n;
}

function run(options) {
  var found = collectFrames();
  if (!found.frames.length) {
    send({ type: 'error', message: 'Не найдено ни одного кадра. Выделите кадр на холсте.' });
    return;
  }
  /* Подтверждение уходит первым: по нему окно понимает, что канал наверх жив. */
  send({ type: 'run-start', total: found.frames.length });

  var ids = options.frameIds || [];
  var chosen = found.frames.filter(function (f) {
    return !ids.length || ids.indexOf(prop(f, 'id')) !== -1;
  });

  chosen.forEach(function (frame, index) {
    send({ type: 'progress', done: index, total: chosen.length, name: String(prop(frame, 'name') || '') });
    send({ type: 'frame-data', index: index, name: String(prop(frame, 'name') || 'Кадр'),
           layers: countLayers(frame, options.deep !== false) });
  });

  send({ type: 'run-done', total: chosen.length });
}

/* ------------------------------------------------------------------ */
/* Настройки                                                           */
/* ------------------------------------------------------------------ */

function withDefaults(options) {
  var o = {};
  for (var k in DEFAULTS) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) { o[k] = DEFAULTS[k]; }
  }
  if (options) {
    for (var j in options) {
      if (Object.prototype.hasOwnProperty.call(options, j)) { o[j] = options[j]; }
    }
  }
  return o;
}

/** localStorage в окне недоступен (origin null), поэтому храним здесь. */
function loadSettings() {
  var fallback = withDefaults(null), attempt;
  try { attempt = API.clientStorage.getAsync(SETTINGS_KEY); } catch (e) { return Promise.resolve(fallback); }
  if (!attempt || typeof attempt.then !== 'function') { return Promise.resolve(fallback); }
  return new Promise(function (resolve) {
    var settled = false;
    var finish = function (v) { if (!settled) { settled = true; resolve(v || fallback); } };
    attempt.then(function (v) { finish(withDefaults(v)); })['catch'](function () { finish(fallback); });
    /* Хранилище может не ответить вовсе — не ждём его дольше секунды с половиной. */
    try { setTimeout(function () { finish(fallback); }, 1500); } catch (e) {}
  });
}

function saveSettings(settings) {
  try { API.clientStorage.setAsync(SETTINGS_KEY, withDefaults(settings)); } catch (e) {}
}

function errText(e) {
  if (!e) { return 'неизвестная ошибка'; }
  return String(e.message || e);
}
