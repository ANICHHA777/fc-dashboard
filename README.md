# FC Dashboard

Локальный веб-дашборд для управления проектами — ссылки, заметки, генерация картинок, интеграция с Claude AI.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/license-MIT-orange)

## Возможности

- 🗂 **Проекты** — автоматически подхватывает папки с рабочего стола
- 🔗 **Ссылки** — сохраняй и открывай URL по каждому проекту
- 🎨 **Генерация картинок** — бесплатно через Pollinations AI, без API ключей
- 📝 **Заметки** — заметки по каждому проекту
- ⎇ **Git** — статус ветки и последний коммит
- 🤖 **Claude AI** — запуск FreeClaude прямо в папке проекта *(опционально)*

## Быстрый старт

### Требования
- Node.js 18+

### Установка

```bash
git clone https://github.com/ANICHHA777/fc-dashboard.git
cd fc-dashboard
bash install.sh
```

После этого команда `dashboard` доступна в терминале.

### Запуск вручную

```bash
npm start
# или
node server.js
```

Открой браузер: **http://localhost:19999**

## Конфигурация

Переменные окружения (опционально):

| Переменная | Описание | По умолчанию |
|---|---|---|
| `PORT` | Порт сервера | `19999` |
| `PROJECTS_DIR` | Папка с проектами | `~/Desktop` |
| `DATA_DIR` | Папка для хранения данных | `~/.config/fc-dashboard` |

Пример:
```bash
PORT=8080 PROJECTS_DIR=~/Projects node server.js
```

## Интеграция с FreeClaude + Kiro

Если установлен `freeclaude`, кнопка **"✦ Открыть в Claude"** откроет Terminal  
с FreeClaude прямо в папке проекта.

Подробнее о FreeClaude: [FC Dashboard Wiki](#)

## Структура

```
fc-dashboard/
├── server.js       # Node.js сервер (без зависимостей)
├── public/
│   └── index.html  # SPA фронтенд
├── install.sh      # Установщик
└── package.json
```

## Генерация картинок

Используется [Pollinations.ai](https://pollinations.ai) — полностью бесплатно,  
без регистрации и API ключей.

## Лицензия

MIT
