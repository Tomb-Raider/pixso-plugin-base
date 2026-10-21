'use strict';
/**
 * Чтение файла .pix без Pixso: даёт плоский список узлов документа.
 *
 * Формат: .pix — это zip. Внутри «<имя>.pix» (документ) и «pixso.binary» (схема kiwi).
 * Документ: заголовок «pixso-kw» + «compress:zstd» + zstd-поток, внутри — kiwi-сообщение
 * PixsoMsg с массивом pixsoNodes. Узлы плоские, связь через parentIndex.{guid,position}.
 *
 *   node read-pix.js «/путь/макет.pix»            # дерево страниц
 *   node read-pix.js «файл.pix» "Table S"               # поддерево узла по имени
 *   node read-pix.js «файл.pix» --keys                  # componentKey всех мастеров
 *
 * Полезные поля мастера (SYMBOL): componentKey (40 hex — ключ компонента),
 * publishFile (22 симв. — ключ файла-библиотеки), sharedSymbolVersion.
 * У инстанса (INSTANCE): symbolData.symbolID → guid мастера в этом же файле
 * (библиотечные мастера лежат на скрытом канвасе «Internal Only Canvas»).
 *
 * Нужен Node 22.15+ (zlib.zstdDecompressSync). zstd в системе не требуется.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var zlib = require('zlib');
var execFileSync = require('child_process').execFileSync;
var kiwi = require('./kiwi.js');

function unzip(pixPath) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pix-'));
  execFileSync('unzip', ['-o', '-q', pixPath, '-d', dir]);
  var files = fs.readdirSync(dir);
  var doc = files.filter(function (f) { return /\.pix$/.test(f); })[0];
  if (!doc) { throw new Error('внутри архива нет файла документа .pix'); }
  return { dir: dir, doc: path.join(dir, doc), schema: path.join(dir, 'pixso.binary') };
}

function decompress(docPath) {
  var raw = fs.readFileSync(docPath);
  var off = raw.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));   /* магия zstd */
  if (off < 0) { return raw; }                                     /* несжатый вариант */
  return zlib.zstdDecompressSync(raw.subarray(off));
}

function read(pixPath) {
  var parts = unzip(pixPath);
  var defs = kiwi.parseSchema(fs.readFileSync(parts.schema));
  var root = null;
  for (var i = 0; i < defs.length; i++) {
    if (defs[i].kind === 'MESSAGE' && defs[i].fields.some(function (f) { return f.name === 'pixsoNodes'; })) { root = defs[i]; break; }
  }
  if (!root) { throw new Error('в схеме нет сообщения с полем pixsoNodes'); }
  var msg = kiwi.makeDecoder(defs).decode(new kiwi.Reader(decompress(parts.doc)), root);
  var nodes = msg.pixsoNodes || [];
  var gid = function (g) { return g ? g.sessionID + ':' + g.localID : ''; };
  var byId = new Map(), kids = new Map();
  nodes.forEach(function (n) { byId.set(gid(n.guid), n); });
  nodes.forEach(function (n) {
    var p = n.parentIndex && gid(n.parentIndex.guid);
    if (!p) { return; }
    if (!kids.has(p)) { kids.set(p, []); }
    kids.get(p).push(n);
  });
  kids.forEach(function (arr) {
    arr.sort(function (a, b) { return String(a.parentIndex.position) < String(b.parentIndex.position) ? -1 : 1; });
  });
  return { nodes: nodes, byId: byId, kids: kids, gid: gid, defs: defs, tmpDir: parts.dir };
}

function describe(n) {
  var num = function (v) { return v === undefined ? '' : Math.round(v * 10) / 10; };
  var s = n.type + ' «' + n.name + '»';
  if (n.size) { s += ' ' + num(n.size.x) + '×' + num(n.size.y); }
  if (n.stackMode && n.stackMode !== 'NONE') {
    s += ' AL=' + n.stackMode + ' gap=' + num(n.stackSpacing) +
      ' pad=' + [n.stackPaddingTop, n.stackPaddingRight, n.stackPaddingBottom, n.stackPaddingLeft].map(num).join('/');
  }
  if (n.stackPrimarySizing) { s += ' prim=' + n.stackPrimarySizing; }
  if (n.stackCounterSizing) { s += ' cnt=' + n.stackCounterSizing; }
  if (n.componentKey) { s += ' key=' + n.componentKey; }
  if (n.visible === false) { s += ' СКРЫТ'; }
  return s;
}

if (require.main === module) {
  var file = process.argv[2];
  var arg = process.argv[3];
  if (!file) { console.error('укажите путь к .pix'); process.exit(1); }
  var doc = read(file);
  if (arg === '--keys') {
    doc.nodes.filter(function (n) { return n.componentKey; }).forEach(function (n) {
      var p = doc.byId.get(doc.gid(n.parentIndex.guid));
      console.log([n.publishFile || '-', (p ? p.name : '-'), n.name, n.componentKey].join('\t'));
    });
    return;
  }
  var start = arg
    ? doc.nodes.filter(function (n) { return n.name === arg; })
    : doc.nodes.filter(function (n) { return n.type === 'CANVAS'; });
  var walk = function (n, d) {
    console.log('  '.repeat(d) + describe(n));
    if (d > 6 || n.type === 'INSTANCE') { return; }
    (doc.kids.get(doc.gid(n.guid)) || []).forEach(function (c) { walk(c, d + 1); });
  };
  start.forEach(function (n) { walk(n, 0); });
}

module.exports = { read: read, describe: describe };
