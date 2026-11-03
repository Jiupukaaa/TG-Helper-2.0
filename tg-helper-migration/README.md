# TG-Helper 2.0 — Neon → Cloudflare D1 migration tools

Эта папка содержит одноразовые инструменты экспорта Neon PostgreSQL,
преобразования данных в SQLite/D1 SQL и локальные тесты. Они не входят в
runtime Worker.

## Требования

- Node.js 22+
- Строка подключения Neon только на чтение для экспорта
- Wrangler, авторизованный в нужном Cloudflare аккаунте для импорта

## 1. Установка и экспорт

Из корня репозитория:

```powershell
cd tg-helper-migration
npm ci
$env:DATABASE_URL = "postgresql://... (получить в Neon Console; не отправлять в чат и не коммитить)"
node .\export-neon.mjs .\neon-export
```

Экспортёр читает шесть таблиц: users, shifts, notes, saved_items, reminders,
sessions. Он создаёт snapshot.json, отдельные JSON по таблицам и manifest.json
с row counts и SHA-256. Строка подключения остаётся только в локальной
PowerShell-сессии.

## 2. Преобразование

```powershell
node .\to-d1.mjs .\neon-export\snapshot.json .\d1-export
```

Генерируются schema.sql, data.sql, d1.sql, verify.sql и summary.json.
Для рабочего D1 используйте **только data.sql**: схему приложения сначала
создаёт Wrangler migration из cloudflare/migrations. d1.sql предназначен для
изолированного тестирования полного преобразования в SQLite.

## 3. Импорт в D1

Сначала создайте D1 и укажите настоящий database_id в wrangler.jsonc. Затем
из корня репозитория примените миграции:

```powershell
cd ..
npm run db:migrate:remote
```

Вернитесь в эту папку и импортируйте данные в пустую, уже подготовленную базу:

```powershell
cd tg-helper-migration
npx wrangler d1 execute tg-helper --remote --file=.\d1-export\data.sql
npx wrangler d1 execute tg-helper --remote --file=.\d1-export\verify.sql
```

Сверьте все шесть row counts с manifest.json. Убедитесь, что
PRAGMA foreign_key_check возвращает пустой результат, а quick_check — ok.
Не импортируйте повторно поверх заполненной базы: INSERT'ы не идемпотентны.
Перед повторным импортом используйте новую/очищенную целевую БД.

## 4. Локальные тесты

Из этой папки:

```powershell
$env:TZ = "UTC"
npm run test:local
npm run test:export
```

Оба теста используют синтетические данные из test/seed.sql и реальные Prisma
migrations из ../prisma/migrations. test:export дополнительно запускает
export-neon.mjs через локальный PGlite PostgreSQL wire server.

## Безопасность

Не коммитьте neon-export/, d1-export/, test/out/, test/out-export/, .env,
DATABASE_URL, реальные snapshot.json или SQL с данными. Экспорт содержит
пользовательские заметки, напоминания и Telegram ID.
