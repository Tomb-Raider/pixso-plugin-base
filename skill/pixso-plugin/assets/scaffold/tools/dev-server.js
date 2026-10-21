/**
 * Локальный dev-сервер для отладки плагина прямо в приложении Pixso.
 *
 * Запуск:  node tools/dev-server.js
 * Дальше:  в Pixso открыть панель плагинов → включить режим разработки.
 *
 * Pixso ждёт на порту 5201 ровно две вещи:
 *   1. HTTP — по адресу «/» отдаётся ui.html, который загрузится в iframe;
 *   2. WebSocket на пути /plugin — туда сервер шлёт JSON вида {name, content},
 *      где name это 'manifest' | 'main' | 'ui', а content — исходный текст файла.
 *      Обёртку 'ui' Pixso показывает как окно плагина; внутри неё iframe
 *      с нашим ui.html и ретранслятор postMessage между Pixso и этим iframe.
 *
 * Зависимостей нет: рукопожатие и кадры WebSocket собираются вручную,
 * чтобы плагин оставался тремя файлами без npm.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 5201;                       // порт зашит в самом Pixso, менять нельзя
const ROOT = path.join(__dirname, '..');
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const WATCHED = ['manifest.json', 'main.js', 'ui.html'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

let uiVersion = 0;   // меняется при правке ui.html, чтобы Pixso перезагрузил iframe
const sockets = new Set();
const lastSent = new Map();

/* ------------------------------------------------------------------ */
/* Содержимое, которое уходит в Pixso                                  */
/* ------------------------------------------------------------------ */

function read(name) {
  try {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
  } catch (e) {
    console.error('  ! не читается ' + name + ': ' + e.message);
    return '';
  }
}

/**
 * Обёртка-ретранслятор между Pixso и окном плагина.
 *
 * Официальный plugin-cli определяет направление сравнением источника сообщения
 * с contentWindow вложенного iframe. В приложении Pixso это сравнение не
 * срабатывает — ни одно окно не опознаётся, и сообщения уходят не туда.
 * Поэтому направление здесь определяется не сравнением окон, а ярлыком:
 * окно плагина заворачивает свои сообщения в конверт __fromPluginUi,
 * всё остальное считается пришедшим сверху.
 */
function wrapperHtml() {
  return `<html>
<head>
    <title>pixso plugin debug</title>
    <style>
      body { margin: 0; }
      iframe { height: 100%; width: 100%; border: none; }
    </style>
    <script>
    (function () {
      var LOG = 'http://localhost:${PORT}/log';
      var reported = 0;

      function report(text) {
        try { fetch(LOG, { method: 'POST', body: '[обёртка] ' + text }); } catch (e) {}
      }
      function inner() {
        var frame = document.getElementById('devIframe');
        return frame && frame.contentWindow;
      }
      function describe(source, target) {
        try {
          if (source === target) { return 'вложенный iframe'; }
          if (source === window) { return 'само окно'; }
          if (source === window.parent) { return 'parent'; }
          if (source === window.top) { return 'top'; }
          if (source === null) { return 'null'; }
        } catch (e) { return 'сравнение упало'; }
        return 'неопознанное окно';
      }

      report('загрузилась: адрес ' + location.href
        + ', parent===window ' + (window.parent === window)
        + ', top===window ' + (window.top === window));

      window.addEventListener('message', function (event) {
        var target = inner();
        var data = event.data;
        var tagged = !!(data && data.__fromPluginUi);

        if (reported < 14) {
          reported++;
          report('сообщение от «' + describe(event.source, target) + '»'
            + ', конверт окна плагина: ' + tagged
            + ', есть pluginMessage: ' + !!(data && data.pluginMessage));
        }

        if (tagged) {
          var sent = [];
          try {
            if (window.parent !== window) { window.parent.postMessage(data.payload, '*'); sent.push('parent'); }
          } catch (e) {}
          try {
            if (window.top !== window && window.top !== window.parent) {
              window.top.postMessage(data.payload, '*'); sent.push('top');
            }
          } catch (e) {}
          if (reported < 14) { report('передано наверх в: ' + (sent.join(', ') || '(некуда)')); }
          return;
        }

        if (target) { target.postMessage(data, '*'); }
      });
    })();
    </script>
</head>
<body><iframe id="devIframe" src="http://localhost:${PORT}/?v=${uiVersion}"></iframe></body>
</html>`;
}

function currentMessages() {
  return [
    { name: 'manifest', content: read('manifest.json') },
    { name: 'main', content: read('main.js') },
    { name: 'ui', content: wrapperHtml() }
  ];
}

function broadcast(message) {
  if (lastSent.get(message.name) === message.content) { return; }
  lastSent.set(message.name, message.content);
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    try { socket.write(encodeFrame(payload)); } catch (e) { sockets.delete(socket); }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  /* Окно плагина шлёт сюда отчёты о себе: в режиме разработки оно живёт
     на этом же origin, поэтому может достучаться обычным fetch. Так видно,
     что происходит с транспортом, без чтения консоли внутри Pixso. */
  if (req.method === 'POST' && url.pathname === '/log') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20000) { req.destroy(); }
    });
    req.on('end', () => {
      console.log('  [окно плагина] ' + body);
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
    });
    return;
  }

  let file = url.pathname === '/' ? 'ui.html' : decodeURIComponent(url.pathname.slice(1));

  /* наружу отдаём только файлы плагина, без прогулок по диску */
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Нет файла: ' + file);
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(full).pipe(res);
});

/* ------------------------------------------------------------------ */
/* WebSocket на /plugin — рукопожатие и кадры вручную                  */
/* ------------------------------------------------------------------ */

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { return socket.destroy(); }

  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  sockets.add(socket);
  console.log('  Pixso подключился (' + sockets.size + ')');

  /* Новому клиенту сразу отдаём всё текущее состояние. */
  for (const message of currentMessages()) {
    lastSent.set(message.name, message.content);
    socket.write(encodeFrame(JSON.stringify(message)));
  }

  socket.on('data', (chunk) => handleIncoming(socket, chunk));
  socket.on('close', () => { sockets.delete(socket); console.log('  Pixso отключился'); });
  socket.on('error', () => { sockets.delete(socket); });
});

/** Кадр от сервера: без маски, opcode 0x1 (текст). */
function encodeFrame(text) {
  const body = Buffer.from(text, 'utf8');
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, body]);
}

/** От клиента нам важны только ping и close. */
function handleIncoming(socket, chunk) {
  if (chunk.length < 2) { return; }
  const opcode = chunk[0] & 0x0f;
  if (opcode === 0x8) {                       // close
    sockets.delete(socket);
    return socket.end();
  }
  if (opcode === 0x9) {                       // ping → pong
    const pong = Buffer.from(chunk);
    pong[0] = (chunk[0] & 0xf0) | 0x0a;
    try { socket.write(pong); } catch (e) {}
  }
}

/* ------------------------------------------------------------------ */
/* Слежение за файлами                                                 */
/* ------------------------------------------------------------------ */

function watch() {
  let timer = null;
  for (const name of WATCHED) {
    const full = path.join(ROOT, name);
    if (!fs.existsSync(full)) { continue; }
    fs.watch(full, () => {
      clearTimeout(timer);                    // редакторы пишут файл в несколько заходов
      timer = setTimeout(() => {
        if (name === 'ui.html') { uiVersion++; }
        console.log('  изменился ' + name + ' — перезагружаю');
        for (const message of currentMessages()) { broadcast(message); }
      }, 120);
    });
  }
}

/* ------------------------------------------------------------------ */

server.listen(PORT, '127.0.0.1', () => {
  watch();
  console.log('');
  console.log('  Dev-сервер плагина запущен: http://localhost:' + PORT);
  console.log('  Файлы: ' + ROOT);
  console.log('');
  console.log('  Теперь в Pixso откройте панель плагинов и включите режим разработки.');
  console.log('  Правки в main.js и ui.html подхватываются сами.');
  console.log('  Остановить — Ctrl+C.');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n  Порт ' + PORT + ' занят. Скорее всего dev-сервер уже запущен в другом окне.\n');
    process.exit(1);
  }
  throw err;
});
