# Каркас плагина Pixso

Рабочий скелет: окно показывает выделенные кадры с миниатюрами, по кнопке
считает в них слои. Демонстрационную задачу заменяй своей. Обвязка вокруг
(каналы сообщений, рукопожатие, настройки, честные состояния, журнал)
переносится как есть.

## Файлы

| Файл | Что делает |
|---|---|
| `manifest.json` | проверенный набор из шести полей, `editorType` и `permissions` обязательны |
| `main.js` | песочница: собирает данные из документа |
| `ui.html` | окно: интерфейс и всё, что требует браузерных возможностей |
| `tools/mock-ui.html` | окно без Pixso, состояния через адрес |
| `tools/harness.js` | логика окна в Node, с заглушками DOM |
| `tools/main-harness.js` | логика `main.js` в Node, с подставным документом Pixso |
| `tools/make-local-build.js` | сборка `local-build/` и `release/`: окно вшивается в код, пути манифеста на `dist/` |
| `tools/dev-server.js` | отладка в Pixso без переустановки плагина (порт 5201) |
| `pack.sh` | архив для публикации `publish/<id>.zip` с проверкой раскладки |

## Первые шаги

```bash
# 1. переименовать плагин
#    manifest.json: name, id;  main.js: SETTINGS_KEY, PLUGIN_ID

# 2. посмотреть окно без Pixso
python3 -m http.server 8765
open http://localhost:8765/tools/mock-ui.html

# 3. пустые и крайние состояния
open "http://localhost:8765/tools/mock-ui.html?frames=0"
open "http://localhost:8765/tools/mock-ui.html?unpick=2"
open "http://localhost:8765/tools/mock-ui.html?run=1"

# 4. логика окна и песочницы
node tools/harness.js
node tools/main-harness.js

# 5. отладка в приложении
node tools/dev-server.js     # затем в Pixso: панель плагинов, режим разработки

# 6. сборка
node tools/make-local-build.js   # local-build/ для своей машины, release/ для репозитория
./pack.sh                        # publish/<id>.zip для публикации
```

Локально в Pixso Desktop загружать `local-build/manifest.json`. На стенд, где нет
терминала, плагин берут готовым из репозитория, поэтому `release/` пересобирают
перед каждым коммитом и коммитят вместе с кодом. `local-build/` в git не кладут.

## Где что менять

- **своя работа с документом**: функция `run()` в `main.js`, сценарий проверки
  в `tools/main-harness.js`;
- **свои данные в окно**: сообщения из `main.js` через `send()`;
- **свой интерфейс**: разметка и обработчики в `ui.html`;
- **свои настройки**: `DEFAULTS` в `main.js` и `readOptions()` в `ui.html`.

## Тема окна

По умолчанию окно в цветах DAIS, UI kit дизайн-системы FinAI на токенах
SDDS FinAI. Все цвета и скругления собраны переменными в начале `ui.html`.
Если у вас своя дизайн-система, подставьте её значения туда же, разметку
трогать не придётся. Подробно в `references/ui-dais.md` скилла.

Перед сборкой для рабочего пространства выключи дев-зонд, если добавлял его
(`DEV_PROBE = false`), иначе окно будет стучаться на локальный сервер.
