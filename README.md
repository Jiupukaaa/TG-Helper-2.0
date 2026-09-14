# TG Helper 2.0

Личный Telegram-ассистент без ИИ. Основной интерфейс — Telegram-бот; веб-приложение на Vercel используется как backend и имеет простую статус-страницу.

TG Helper 2.0 предназначен для хранения личных заметок и создания напоминаний с учётом часового пояса пользователя.

## Возможности

### 📝 Заметки

- создание заметок;
- просмотр списка заметок;
- постраничная навигация по большому списку заметок;
- открытие конкретной заметки по номеру;
- постраничный просмотр длинных заметок;
- редактирование заметок;
- удаление заметок с подтверждением;
- защита данных: пользователь работает только со своими заметками.

Для списка заметок используется разбиение по размеру сообщения Telegram. Заметка длиной **300 символов и более** выводится отдельной страницей. Длинные заметки также разбиваются на страницы, если они не помещаются в одно сообщение Telegram.

### ⏰ Напоминания

- создание напоминания;
- просмотр активных напоминаний;
- удаление напоминания;
- ввод даты и времени в формате `DD.MM.YYYY HH:mm`;
- проверка даты и времени перед сохранением;
- напоминания хранятся в базе в UTC;
- отображение и ввод времени выполняются в часовом поясе пользователя;
- часовой пояс задаётся вручную через IANA-название, например `Europe/Amsterdam`;
- автоматическая отправка наступивших напоминаний через GitHub Actions.

### 🔐 Ограничение доступа

Доступ к боту разрешён только Telegram ID, указанным в `ALLOWED_TELEGRAM_IDS`. Это позволяет использовать TG Helper как личного бота даже при наличии публичного webhook.

### 🕐 Часовой пояс

Часовой пояс задаётся командой:

```text
/settimezone Europe/Amsterdam
```

Поддерживаются стандартные IANA-названия часовых поясов, например `Europe/Amsterdam`, `Asia/Yerevan`, `Europe/Moscow`, `America/New_York`.

Если часовой пояс ещё не установлен, создание напоминания блокируется до его настройки.

---

## Стек

- **TypeScript**
- **Next.js / App Router**
- **grammY** — Telegram Bot API
- **Prisma** — ORM
- **PostgreSQL / Neon** — база данных
- **Vercel** — деплой и запуск API
- **GitHub Actions** — регулярная проверка напоминаний

Проект не использует ИИ или LLM.

---

# Развёртывание

Для полноценной работы TG Helper 2.0 нужны четыре компонента:

1. GitHub — исходный код и GitHub Actions;
2. Neon — PostgreSQL база данных;
3. Vercel — запуск Next.js и Telegram webhook;
4. Telegram — бот и webhook.

Ниже описана установка с нуля.

## 1. Требования

Для локальной работы:

- Node.js 18.18+;
- npm;
- Git;
- GitHub-репозиторий;
- аккаунт Vercel;
- аккаунт Neon;
- Telegram-бот, созданный через `@BotFather`.

## 2. Создание Telegram-бота

1. Откройте Telegram и найдите `@BotFather`.
2. Выполните `/newbot`.
3. Создайте бота.
4. Сохраните выданный Bot Token.

Токен используется только в переменной окружения `TELEGRAM_BOT_TOKEN`.

Не публикуйте его в GitHub или README.

## 3. Клонирование и установка

```bash
git clone https://github.com/<username>/<repository>.git
cd <repository>
npm install
```

`postinstall` автоматически выполняет `prisma generate`.

Для локальной конфигурации:

```bash
cp .env.example .env
```

На Windows PowerShell можно создать `.env` на основе `.env.example` вручную.

---

# Neon — база данных

## 4. Создание проекта в Neon

1. Откройте [Neon](https://neon.tech/).
2. Создайте новый PostgreSQL project.
3. Выберите нужный регион.
4. Откройте раздел подключения к базе данных.
5. Скопируйте connection string.

Строка должна иметь примерно такой вид:

```text
postgresql://user:password@host/dbname?sslmode=require
```

Сохраните её как `DATABASE_URL`.

Локально:

```env
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
```

В Vercel ту же переменную `DATABASE_URL` добавьте в **Project → Settings → Environment Variables**. Для Production значение должно указывать на рабочую базу Neon.

## 5. Применение Prisma migration

После подключения `DATABASE_URL` выполните:

```bash
npx prisma migrate deploy
```

Эта команда применит существующие миграции к базе Neon.

Для проверки структуры базы можно использовать:

```bash
npx prisma studio
```

Для рабочей базы используйте `npx prisma migrate deploy`, а не `prisma migrate dev`.

---

# Vercel — деплой приложения

## 6. Импорт проекта в Vercel

1. Откройте [Vercel](https://vercel.com/).
2. Нажмите **Add New → Project**.
3. Импортируйте GitHub-репозиторий TG Helper 2.0.
4. Vercel автоматически определит Next.js.
5. Проверьте Build Settings.
6. Добавьте Environment Variables.
7. Нажмите **Deploy**.

Обычно отдельный Build Command менять не требуется.

После деплоя Vercel выдаст URL вида:

```text
https://your-project.vercel.app
```

## 7. Переменные окружения Vercel

В Vercel должны быть настроены:

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен Telegram-бота |
| `TELEGRAM_WEBHOOK_SECRET` | секрет проверки Telegram webhook |
| `ALLOWED_TELEGRAM_IDS` | разрешённые Telegram ID через запятую |
| `DATABASE_URL` | connection string базы Neon |
| `CRON_SECRET` | секрет защиты endpoint проверки напоминаний |

Пример:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=some-random-secret
ALLOWED_TELEGRAM_IDS=123456789
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
CRON_SECRET=another-random-secret
```

Не храните секреты в исходном коде или GitHub.

---

# Telegram Webhook

## 8. Подключение webhook

После успешного деплоя на Vercel необходимо сообщить Telegram публичный адрес webhook:

```text
https://<ваш-домен>/api/telegram/webhook
```

Выполните:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<ваш-домен>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Telegram будет передавать секрет в заголовке `X-Telegram-Bot-Api-Secret-Token`. TG Helper проверяет его перед обработкой update.

Проверка:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Удаление:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"
```

---

# GitHub Actions — автоматические напоминания

## 9. Почему используется GitHub Actions

Проверка напоминаний выполняется не через Vercel Cron.

GitHub Actions запускает workflow каждые **5 минут** и вызывает:

```text
POST /api/cron/reminders
```

Endpoint защищён `CRON_SECRET`.

## 10. Настройка GitHub Actions

Workflow находится в:

```text
.github/workflows/trigger-reminders.yml
```

В GitHub откройте **Settings → Secrets and variables → Actions**.

Создайте Repository secret:

```text
CRON_SECRET
```

Его значение должно быть **точно таким же**, как `CRON_SECRET` в Vercel.

Создайте Repository variable:

```text
TG_HELPER_URL
```

Значение — URL продакшен-деплоя Vercel, например:

```text
https://your-project.vercel.app
```

Без `/api/...` в конце.

Проверить workflow вручную можно через **GitHub → Actions → Trigger reminders check → Run workflow**.

Scheduled-запуски GitHub Actions могут выполняться с небольшой задержкой из-за нагрузки на инфраструктуру GitHub.

---

# Функционал Telegram-бота

## `/start`

Запускает бота и показывает главное меню:

- 📝 Заметки
- ⏰ Напоминания

При первом запуске бот также сообщает, что необходимо установить часовой пояс.

## `/notes`

Открывает раздел заметок. Доступны создание, просмотр, редактирование и удаление.

Список заметок автоматически разбивается на страницы. Размер обычной страницы — до примерно 3500 символов.

Заметка размером **300+ символов** выводится отдельной страницей.

## `/note <номер>`

Открывает конкретную заметку.

Пример:

```text
/note 3
```

Длинная заметка автоматически разбивается на несколько страниц с кнопками навигации.

## `/reminders`

Открывает раздел напоминаний. Доступны создание, просмотр активных напоминаний и удаление.

## `/settimezone <зона>`

Устанавливает часовой пояс пользователя:

```text
/settimezone Europe/Amsterdam
```

## `/cancelreminder <номер>`

Удаляет напоминание по номеру:

```text
/cancelreminder 12
```

Основной интерфейс удаления также доступен через кнопки меню.

---

# Как работает напоминание

1. Пользователь открывает **⏰ Напоминания**.
2. Нажимает **➕ Новое напоминание**.
3. Вводит текст.
4. Вводит дату и время в формате `DD.MM.YYYY HH:mm`.
5. TG Helper интерпретирует время в часовом поясе пользователя.
6. В базе дата хранится в UTC.
7. GitHub Actions каждые 5 минут вызывает `/api/cron/reminders`.
8. Endpoint находит наступившие напоминания.
9. Бот отправляет их пользователю в Telegram.

---

# Архитектура

```text
Telegram
   │
   │ HTTPS webhook
   ▼
Vercel / Next.js
   │
   ├── /api/telegram/webhook
   │       │
   │       ▼
   │     grammY
   │       ├── Notes
   │       └── Reminders
   │
   ├── /api/cron/reminders
   │
   ▼
Neon PostgreSQL
   │
   ├── User
   ├── Note
   ├── Reminder
   └── Session

GitHub Actions
   │
   │ каждые 5 минут
   ▼
POST /api/cron/reminders
```

---

# Безопасность

1. `ALLOWED_TELEGRAM_IDS` разрешает работу только указанным Telegram-пользователям.
2. `TELEGRAM_WEBHOOK_SECRET` проверяет webhook-запросы.
3. `CRON_SECRET` защищает endpoint проверки напоминаний.
4. Операции с заметками и напоминаниями выполняются только в рамках пользователя-владельца.
5. Секреты хранятся в Environment Variables / GitHub Secrets и не должны попадать в Git.

---

# Хранение времени

В базе время напоминаний хранится в UTC. Часовой пояс пользователя хранится отдельно.

При создании напоминания локальное время пользователя преобразуется в UTC. При отображении и отправке оно преобразуется обратно в выбранный часовой пояс.

---

# Локальная разработка

Установить зависимости:

```bash
npm install
```

Создать `.env` и заполнить переменные.

Запустить приложение:

```bash
npm run dev
```

Статус-страница будет доступна по адресу:

```text
http://localhost:3000
```

Для локального тестирования Telegram webhook нужен публичный HTTPS-туннель, например ngrok.

---

# Prisma

Схема базы:

```text
prisma/schema.prisma
```

Миграции:

```text
prisma/migrations/
```

Для применения существующих миграций на production-базе Neon:

```bash
npx prisma migrate deploy
```

---

# Структура проекта

```text
TG-Helper-2.0/
├── .github/
│   └── workflows/
│       └── trigger-reminders.yml
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── src/
│   ├── app/api/
│   │   ├── cron/reminders/
│   │   └── telegram/webhook/
│   ├── bot/
│   │   ├── commands/
│   │   │   ├── index.ts
│   │   │   ├── notes.ts
│   │   │   └── reminders.ts
│   │   ├── middleware/
│   │   ├── keyboards.ts
│   │   └── session.ts
│   ├── lib/
│   │   ├── env.ts
│   │   ├── notePagination.ts
│   │   ├── prisma.ts
│   │   └── time.ts
│   └── services/
│       ├── notesService.ts
│       └── remindersService.ts
├── .env.example
├── next.config.js
├── package.json
└── README.md
```

---

# Важные ограничения

- TG Helper 2.0 не использует ИИ.
- Telegram webhook требует публичный HTTPS endpoint.
- Для автоматической доставки напоминаний должен работать GitHub Actions workflow.
- Scheduled GitHub Actions могут запускаться с небольшой задержкой.
- Между отправкой сообщения Telegram и записью статуса в базе нет общей транзакции. В редком случае сбоя ровно между этими операциями одно напоминание теоретически может быть отправлено повторно.

---

# Быстрый чек-лист деплоя

- [ ] Создан Telegram-бот через `@BotFather`.
- [ ] Создан GitHub-репозиторий.
- [ ] Создан проект Neon.
- [ ] Получен `DATABASE_URL`.
- [ ] Выполнен `npx prisma migrate deploy`.
- [ ] Создан Vercel Project из GitHub.
- [ ] Добавлены `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_TELEGRAM_IDS`, `DATABASE_URL`, `CRON_SECRET`.
- [ ] Выполнен Vercel Deploy.
- [ ] Установлен Telegram webhook на `/api/telegram/webhook`.
- [ ] В GitHub Actions добавлен `CRON_SECRET`.
- [ ] В GitHub Actions добавлен `TG_HELPER_URL`.
- [ ] Workflow `Trigger reminders check` успешно запускается.
- [ ] В Telegram выполнен `/start`.
- [ ] Установлен часовой пояс через `/settimezone`.
- [ ] Создана тестовая заметка.
- [ ] Создано тестовое напоминание.
- [ ] Тестовое напоминание успешно пришло в Telegram.

---

## Лицензия

См. файл `LICENSE` в репозитории.
