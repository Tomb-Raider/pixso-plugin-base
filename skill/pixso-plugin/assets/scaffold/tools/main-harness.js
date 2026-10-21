/**
 * Прогон main.js в Node: подставной объект pixso вместо приложения.
 *
 * Проверяет обвязку, которую на стенде проверять дорого: плагин сам шлёт
 * стартовые данные, не дожидаясь окна; одно нажатие, доставленное по двум
 * каналам, выполняется один раз; хранилище, которое не отвечает, не вешает
 * запуск; кадры идут в порядке холста, рядами. Свою работу (run) дописывай
 * сюда же сценарием: подставной документ ниже, его легко расширить.
 *
 * Запуск: node tools/main-harness.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/* --- подставные часы: таймеры идут по команде --- */

let now = 0;
const timers = [];
function fakeSetTimeout(fn, ms) { timers.push({ at: now + (ms || 0), fn }); return timers.length; }
async function advance(ms) {
  const until = now + ms;
  for (;;) {
    await new Promise((r) => setImmediate(r));
    timers.sort((a, b) => a.at - b.at);
    if (!timers.length || timers[0].at > until) { break; }
    const t = timers.shift();
    now = t.at;
    t.fn();
  }
  now = until;
  await new Promise((r) => setImmediate(r));
}

/* --- подставной документ --- */

let seq = 0;
function node(type, name, props, children) {
  const n = Object.assign({ id: String(++seq), type, name, x: 0, y: 0, width: 100, height: 100, children: children || [] }, props);
  n.children.forEach((c) => { c.parent = n; });
  n.exportAsync = () => Promise.resolve(new Uint8Array([137, 80, 78, 71]));
  return n;
}

/* Два кадра в одном ряду, второй сдвинут вверх на пиксель, и кадр ниже.
   Простая сортировка по y поставила бы правый кадр первым. */
const left = node('FRAME', 'Слева', { x: 0, y: 10, height: 400 }, [node('TEXT', 'Заголовок'), node('RECTANGLE', 'Фон')]);
const right = node('FRAME', 'Справа', { x: 500, y: 9, height: 400 }, [node('GROUP', 'Группа', {}, [node('TEXT', 'а'), node('TEXT', 'б')])]);
const below = node('FRAME', 'Ниже', { x: 0, y: 900 }, []);
const page = { name: 'Тестовая страница', selection: [], children: [right, below, left] };

const toUi = [];
let onmessage = null;
const subscribers = [];

const pixso = {
  command: '',
  pluginId: 'test',
  currentPage: page,
  ui: {
    postMessage(msg) { toUi.push(msg); },
    on(name, fn) { if (name === 'message') { subscribers.push(fn); } },
    set onmessage(fn) { onmessage = fn; },
    get onmessage() { return onmessage; }
  },
  showUI() {},
  on() {},
  closePlugin() {},
  /* Хранилище, которое не отвечает никогда: так бывает на части сборок. */
  clientStorage: { getAsync: () => new Promise(() => {}), setAsync: () => Promise.resolve() }
};

/** Доставить сообщение из окна так, как это бывает в Pixso: по всем каналам сразу. */
function fromUi(msg) {
  if (onmessage) { onmessage(msg); }
  subscribers.forEach((fn) => fn(msg));
}

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log((ok ? '  ок   ' : '  НЕТ  ') + name + (ok || !detail ? '' : ': ' + detail));
}
const ofType = (type) => toUi.filter((m) => m.type === type);

(async () => {
  const ctx = vm.createContext({ pixso, setTimeout: fakeSetTimeout, clearTimeout() {}, Promise, console, Object, Array, String, Number, isFinite, Math, JSON });
  vm.runInContext(code, ctx, { filename: 'main.js' });

  await advance(300);
  check('стартовые данные уходят сами, без сигнала окна', ofType('hello').length > 0 && ofType('frames').length > 0);

  const frames = ofType('frames').pop();
  const order = frames ? frames.frames.map((f) => f.name).join(', ') : '';
  check('кадры в порядке холста, рядами', order === 'Слева, Справа, Ниже', order);

  await advance(2000);
  check('настройки приходят, даже если хранилище молчит', ofType('settings').length > 0);

  toUi.length = 0;
  fromUi({ type: 'run', __id: 'click-1', options: { deep: true } });
  check('одно нажатие по двум каналам выполняется один раз', ofType('run-start').length === 1,
    'запусков ' + ofType('run-start').length);

  const counted = ofType('frame-data').map((m) => m.name + ' ' + m.layers).join(', ');
  check('слои посчитаны вместе с вложенными', counted === 'Слева 2, Справа 3, Ниже 0', counted);

  toUi.length = 0;
  page.children = [];
  fromUi({ type: 'run', __id: 'click-2', options: {} });
  check('пустая страница даёт понятную ошибку, а не тишину', ofType('error').length === 1);

  const failed = results.filter((ok) => !ok).length;
  console.log('\n  проверок ' + results.length + ', не прошло ' + failed);
  process.exit(failed ? 1 : 0);
})();
