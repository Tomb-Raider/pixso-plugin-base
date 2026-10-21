/**
 * Сборка комплектов для Pixso.
 *
 * Раскладка повторяет официальный сборщик (@pixso/plugin-cli pkg):
 * manifest.json в корне пакета, рядом папка dist/ с кодом и разметкой.
 *
 *   release/manifest.json
 *   release/dist/main.js     код с вшитой разметкой окна
 *   release/dist/ui.html     та же разметка отдельным файлом
 *
 * local-build/ собирается так же, это копия для локальной загрузки в Pixso
 * Desktop, её в git не кладут. release/ кладут: на внутренний стенд плагин
 * берут готовым из репозитория.
 *
 * Разметка вшивается в скрипт, потому что на части сборок файл из manifest.ui
 * до плагина не доезжает: код запускается, окно остаётся пустым. Поле `ui`
 * при этом остаётся в манифесте, а файл в пакете: набор полей манифеста
 * должен совпадать с проверенным образцом, а лишний файл ничему не мешает.
 *
 * Запуск: node tools/make-local-build.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* Набор полей, проверенный запуском на внутреннем стенде (2026-09-01).
   Сверяется на точное совпадение: и нехватка, и любое добавление считаются
   ошибкой. Каждое новое поле стоит отдельного круга публикации, а он идёт
   по запросу и занимает дни, поэтому расхождение должно всплыть здесь. */
const VERIFIED_FIELDS = ['id', 'name', 'main', 'ui', 'permissions', 'editorType'];

function checkManifest(manifest) {
  const have = Object.keys(manifest).sort();
  const want = VERIFIED_FIELDS.slice().sort();
  const missing = want.filter((field) => have.indexOf(field) === -1);
  const extra = have.filter((field) => want.indexOf(field) === -1);
  if (missing.length || extra.length) {
    console.error('  Манифест разошёлся с проверенным образцом.');
    if (missing.length) { console.error('  Не хватает: ' + missing.join(', ')); }
    if (extra.length) { console.error('  Лишние: ' + extra.join(', ')); }
    console.error('  Образец в скилле pixso-plugin, references/publishing.md');
    process.exit(1);
  }
}

/* Проверенный набор полей касается набора, а не путей. В корне плагина
   dist/ нет, и корневой манифест ссылается на файлы рядом с собой. Иначе
   Pixso при локальной загрузке не находит код и молча не запускает плагин.
   Пути на dist/ проставляет сборка, каждому пакету свои. */
function checkPaths(manifest, dir) {
  ['main', 'ui'].forEach(function (field) {
    var file = path.join(dir, manifest[field]);
    if (!fs.existsSync(file)) {
      console.error('  Манифест ссылается на ' + manifest[field] + ', а файла нет: ' + file);
      process.exit(1);
    }
  });
}

function checkSyntax(code, label) {
  try { new vm.Script(code, { filename: label }); } catch (error) {
    console.error('  Синтаксическая ошибка в ' + label + ': ' + error.message);
    process.exit(1);
  }
}

function build(outDir) {
  const uiHtml = fs.readFileSync(path.join(ROOT, 'ui.html'), 'utf8');
  const mainCode = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  checkManifest(manifest);
  /* Исходный манифест обязан работать сам по себе: его тоже загружают
     локально, выбрав manifest.json в корне плагина. */
  checkPaths(manifest, ROOT);
  checkSyntax(mainCode, 'main.js');

  const bundled =
    '/* Разметка окна вшита сборкой: на части сборок Pixso файл из manifest.ui\n'
    + '   до плагина не доезжает, и окно остаётся пустым. */\n'
    + 'var INLINE_UI = ' + JSON.stringify(uiHtml) + ';\n\n'
    + mainCode;

  checkSyntax(bundled, 'dist/main.js');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'dist', 'main.js'), bundled);
  fs.writeFileSync(path.join(outDir, 'dist', 'ui.html'), uiHtml);

  /* В пакете код лежит в dist/, как у официального сборщика.
     Набор полей при этом ровно тот же, что в исходном манифесте. */
  var packed = JSON.parse(JSON.stringify(manifest));
  packed.main = 'dist/main.js';
  packed.ui = 'dist/ui.html';
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(packed, null, 2) + '\n');
  checkPaths(packed, outDir);

  const size = fs.statSync(path.join(outDir, 'dist', 'main.js')).size;
  console.log('  ' + path.basename(outDir) + '/ код на ' + Math.round(size / 1024) + ' КБ');
}

build(path.join(ROOT, 'local-build'));
build(path.join(ROOT, 'release'));

console.log('\n  Манифест: ' + VERIFIED_FIELDS.join(', ') + ', ровно эти поля.');
console.log('  Блока menu нет намеренно: с проверенным набором полей плагин'
  + ' открывается нажатием на карточку.');
