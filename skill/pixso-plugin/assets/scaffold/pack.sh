#!/bin/bash
# Собирает пакет плагина для публикации: publish/<id>.zip из release/.
#
# ГЛАВНОЕ, ради чего этот скрипт есть, а архив не жмут мышкой: клиент Pixso
# ищет в пакете запись с именем РОВНО manifest.json, в корне. Finder на macOS
# кладёт внутрь папку-обёртку и мусор __MACOSX, такой архив клиент прочитать
# не может и молча не запускает плагин: карточка есть, нажатие ничего не
# делает, в консоли ни строки. Симптом неотличим от «плагин сломан», а стоил
# трёх кругов публикации (подтверждено 08.09.2026). Поэтому в конце готовый
# архив читается так же, как его читает Pixso.
#
# Раскладка как у официальной команды `plugin-cli pkg`: manifest.json в корне,
# рядом папка dist/ с кодом, в который вшита разметка окна.
set -euo pipefail

cd "$(dirname "$0")"

ID="$(python3 -c "import json;print(json.load(open('manifest.json'))['id'])")"
OUT="publish/${ID}.zip"

node tools/make-local-build.js
node tools/harness.js >/dev/null && node tools/main-harness.js >/dev/null && echo "  Проверки прошли"

mkdir -p publish
rm -f "$OUT"
( cd release && zip -q -X -r "../$OUT" manifest.json dist/main.js dist/ui.html \
    -x '*.DS_Store' '__MACOSX*' )

python3 - "$OUT" <<'PY'
import sys, zipfile, json
names = zipfile.ZipFile(sys.argv[1]).namelist()
if names[0] != 'manifest.json':
    sys.exit('Первой записью в архиве обязан идти manifest.json, а идёт ' + names[0])
junk = [n for n in names if '__MACOSX' in n or n.endswith('.DS_Store')]
if junk:
    sys.exit('В архиве мусор macOS: ' + ', '.join(junk))
man = json.loads(zipfile.ZipFile(sys.argv[1]).read('manifest.json'))
for field in ('main', 'ui'):
    want = man.get(field)
    if not want:
        continue
    # Клиент допускает ведущее ./, сверяемся ровно так же, как он
    if want not in names and want.lstrip('.').lstrip('/') not in names:
        sys.exit('Манифест ссылается на ' + want + ', а в архиве такой записи нет')
print('  Архив читается так же, как его читает Pixso: ' + ', '.join(names))
PY

unzip -tq "$OUT" >/dev/null && echo "  Архив распаковывается"
echo "  Готово: $OUT ($(du -h "$OUT" | cut -f1))"
echo "  Для публикации также понадобятся обложка 1600×900, иконка 128×128 и текст описания"
