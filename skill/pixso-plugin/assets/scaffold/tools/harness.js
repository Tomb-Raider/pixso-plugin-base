/**
 * Прогон кода из ui.html в Node: заглушки DOM вместо браузера.
 *
 * Ловит ошибки в логике окна за секунду и без Pixso. Заглушка знает только
 * getElementById — если код окна возьмёт querySelector, прогон упадёт, и это
 * полезно: окно останется в одном стиле обращения к элементам.
 *
 * Запуск: node tools/harness.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'ui.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) { throw new Error('в ui.html нет блока <script>'); }

function stubEl() {
  return {
    value: '', checked: false, indeterminate: false, textContent: '', style: {},
    className: '', title: '', disabled: false, src: '', type: '',
    children: [], childNodes: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, remove() {}, click() {},
    addEventListener() {}, scrollIntoView() {},
    onclick: null, onchange: null
  };
}

const els = {};
const listeners = {};
const sent = [];

const document = {
  getElementById(id) { if (!els[id]) { els[id] = stubEl(); } return els[id]; },
  createElement() { return stubEl(); },
  body: stubEl()
};

const windowStub = {
  location: { origin: 'null', href: 'about:blank' },
  addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  postMessage() {}
};
windowStub.parent = { postMessage: (msg) => sent.push(msg) };
windowStub.top = windowStub.parent;

const sandbox = {
  document, window: windowStub, parent: windowStub.parent, console,
  Blob, Response, URL, TextEncoder, Uint8Array, DataView, ArrayBuffer,
  Promise, Math, JSON, Object, Array, String, Number, isFinite,
  setTimeout, clearTimeout, RegExp
};
if (typeof CompressionStream !== 'undefined') { sandbox.CompressionStream = CompressionStream; }

const ctx = vm.createContext(sandbox);
vm.runInContext(match[1], ctx, { filename: 'ui.html' });

/** Доставить окну сообщение так, как это делает Pixso. */
function deliver(msg) {
  (listeners.message || []).forEach((fn) => fn({ data: { pluginMessage: msg } }));
}

/* --- сценарий: пришёл список кадров, окно должно поздороваться и посчитать --- */
deliver({ type: 'hello', channel: 'test', via: 'parent', pluginId: 'test', command: 'open' });
deliver({ type: 'settings', settings: { deep: true } });
deliver({ type: 'frames', pageName: 'Тест', fromSelection: true, frames: [
  { id: 'a', name: 'Кадр А', width: 1920, height: 1080 },
  { id: 'b', name: 'Кадр Б', width: 1920, height: 1080 }
] });

const handshakes = sent.filter((m) => m.pluginMessage && m.pluginMessage.type === 'ui-ready');
console.log('рукопожатий отправлено:', handshakes.length);
console.log('счётчик в шапке:', els.count && els.count.textContent);
console.log('надпись на кнопке:', els.go && els.go.textContent);

const ok = handshakes.length > 0 && /2/.test(String(els.count && els.count.textContent));
console.log(ok ? 'ОК' : 'ПРОВАЛ: окно не собрало список');
process.exit(ok ? 0 : 1);
