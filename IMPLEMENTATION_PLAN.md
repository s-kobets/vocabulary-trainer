# Vocabulary Trainer — Implementation Plan

## 1. Цель

Реализовать MVP приложения для изучения иностранных слов.

Основной сценарий:

```text
Telegram → добавить слово → сохранить → повторить позже
```

Дополнительный интерфейс:

```text
Web → управлять словарём → проходить повторения → настройки
```

Стек:

```text
Node.js
TypeScript
Fastify
HTMX
SQLite
better-sqlite3
Telegraf
Docker
```

Архитектура:

```text
1 repository
1 Node.js application
1 Docker container
1 SQLite database
```

Приложение сразу поддерживает:

```text
N users
N language pairs
N vocabulary items
```

---

# 2. Принципы разработки

При реализации соблюдать следующие правила.

## 2.1 Простота

Не добавлять без необходимости:

```text
Redis
PostgreSQL
React
Next.js
queues
microservices
ORM
Kubernetes
```

---

## 2.2 Business logic отдельно от transport layer

Telegram handlers и HTTP routes не должны содержать основную бизнес-логику.

Правильно:

```text
Telegram Handler
        ↓
VocabularyService
        ↓
VocabularyRepository
        ↓
SQLite
```

и:

```text
HTTP Route
        ↓
VocabularyService
        ↓
VocabularyRepository
```

---

## 2.3 SQL только в repository layer

Запрещено писать SQL непосредственно в:

```text
routes
telegram handlers
templates
services
```

---

## 2.4 Все пользовательские данные scoped by user

Нельзя получать VocabularyItem только по:

```text
id
```

Нужно учитывать владельца:

```text
id + userId
```

Это касается:

```text
language pairs
vocabulary
reviews
settings
```

---

## 2.5 Не переусложнять заранее

Если функция не входит в MVP — не реализовывать её "на будущее".

Допускается оставить интерфейс/абстракцию, если это существенно упрощает будущую замену реализации.

---

# 3. Phase 0 — Bootstrap проекта

## Задача

Создать минимальный TypeScript проект.

Структура:

```text
vocabulary/
├── src/
├── public/
├── data/
├── Dockerfile
├── compose.yml
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

Установить основные зависимости:

```text
fastify
better-sqlite3
telegraf
```

Development dependencies:

```text
typescript
tsx
@types/node
@types/better-sqlite3
```

Добавить scripts:

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```

---

## Acceptance criteria

Команда:

```bash
npm run dev
```

запускает Fastify server.

Endpoint:

```text
GET /health
```

возвращает:

```json
{
  "status": "ok"
}
```

---

# 4. Phase 1 — Configuration

Создать:

```text
src/config.ts
```

Конфигурация читается только через этот модуль.

Поддержать:

```text
NODE_ENV
PORT
DATABASE_PATH

TELEGRAM_BOT_TOKEN

APP_URL

SESSION_SECRET
```

Позже:

```text
TELEGRAM_CLIENT_ID
TELEGRAM_CLIENT_SECRET

DICTIONARY_PROVIDER
DICTIONARY_API_KEY
```

---

## Validation

При старте приложения проверять обязательные environment variables.

Если обязательного значения нет — приложение должно завершиться с понятной ошибкой.

---

# 5. Phase 2 — SQLite

Создать:

```text
src/db/database.ts
```

Использовать:

```text
better-sqlite3
```

При подключении выполнить:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

Database path берётся из:

```text
DATABASE_PATH
```

Development default:

```text
./data/vocabulary.db
```

---

## Acceptance criteria

При запуске:

- database file создаётся автоматически;
- SQLite открывается успешно;
- `/health` проверяет доступность базы.

---

# 6. Phase 3 — Migrations

Создать:

```text
src/db/migrations/
```

Первая migration:

```text
001_initial.sql
```

Также таблицу:

```text
schema_migrations
```

Migration runner должен:

1. прочитать список migration files;
2. определить уже выполненные;
3. выполнить отсутствующие в правильном порядке;
4. записать номер migration;
5. не запускать migration повторно.

---

## Acceptance criteria

На пустой базе:

```text
npm start
```

создаёт schema автоматически.

При повторном запуске migrations повторно не выполняются.

---

# 7. Phase 4 — Initial database schema

Создать таблицы:

```text
users
telegram_accounts
language_pairs
vocabulary_items
review_states
reviews
user_settings
sessions
schema_migrations
```

---

# 8. Phase 5 — User repository

Создать:

```text
src/users/user.repository.ts
src/users/user.service.ts
```

Методы repository:

```ts
createUser()
findUserById()
```

IDs:

```text
UUID
```

Использовать:

```ts
crypto.randomUUID()
```

Не добавлять стороннюю UUID library.

---

# 9. Phase 6 — Telegram account repository

Создать:

```text
src/users/telegram-account.repository.ts
```

Методы:

```ts
findByTelegramUserId()
createTelegramAccount()
updateTelegramProfile()
```

Telegram ID хранить как:

```text
TEXT
```

Не преобразовывать Telegram ID в JS `number`.

---

# 10. Phase 7 — Telegram bot bootstrap

Создать:

```text
src/telegram/bot.ts
```

При старте приложения:

```text
Fastify starts
Telegram Bot starts
```

При graceful shutdown:

```text
Telegram Bot stops
Fastify closes
SQLite closes
```

---

## Команда /start

При `/start`:

1. получить Telegram user;
2. найти `telegram_account`;
3. если его нет:
   - создать `User`;
   - создать `TelegramAccount`;
   - создать `UserSettings`;
4. если onboarding не завершён:
   - начать выбор языков;
5. иначе:
   - показать основное приветствие.

---

# 11. Phase 8 — Languages

Создать:

```text
src/languages/languages.ts
```

На MVP использовать статический список.

Минимум:

```text
en English
ru Russian
ka Georgian
de German
fr French
es Spanish
it Italian
pt Portuguese
```

Тип:

```ts
type Language = {
  code: string
  name: string
}
```

---

# 12. Phase 9 — Language Pair

Создать:

```text
src/languages/language-pair.repository.ts
src/languages/language-pair.service.ts
```

Repository methods:

```ts
create()
findById()
findForUser()
findDefaultForUser()
setDefault()
delete()
```

---

## Правило default language pair

У пользователя максимум одна:

```text
is_default = true
```

При установке новой default pair:

```text
старые → false
новая → true
```

Операция должна выполняться transaction.

---

# 13. Phase 10 — Telegram onboarding

Flow:

```text
/start
```

↓

```text
What language are you learning?
```

↓

inline keyboard

```text
English
German
Spanish
Georgian
...
```

↓

```text
What language should translations use?
```

↓

создать LanguagePair

↓

```text
English → Russian
```

становится default.

↓

ответ:

```text
You're ready.

Send me a word or phrase.

For example:

reliable
figure out
as long as
```

---

## Acceptance criteria

Новый Telegram пользователь после `/start` получает:

```text
User
TelegramAccount
UserSettings
LanguagePair
```

в базе.

Повторный `/start` не создаёт дубликаты.

---

# 14. Phase 11 — Vocabulary repository

Создать:

```text
src/vocabulary/vocabulary.repository.ts
```

Методы:

```ts
create()
findByIdForUser()
findByNormalizedText()
listForUser()
update()
delete()
countByStatus()
search()
```

---

# 15. Phase 12 — Vocabulary Service

Создать:

```text
src/vocabulary/vocabulary.service.ts
```

Service отвечает за:

```text
normalization
duplicate detection
VocabularyItem creation
status transitions
```

---

## normalizeText()

Минимальная реализация:

```text
trim
lowercase
multiple whitespace → single whitespace
```

Пример:

```text
"  Reliable   Service "
```

→

```text
"reliable service"
```

---

# 16. Phase 13 — Duplicate detection

Перед созданием VocabularyItem:

```text
languagePairId
+
normalizedText
```

проверяются на существование.

Если слово уже существует:

Telegram должен вернуть существующую карточку вместо создания нового item.

Пример:

```text
reliable is already in your vocabulary.
```

Не считать одинаковое слово duplicate между разными language pairs.

Например:

```text
English → Russian: bank

English → Georgian: bank
```

допустимы одновременно.

---

# 17. Phase 14 — Dictionary abstraction

Создать:

```text
src/dictionary/dictionary.service.ts
src/dictionary/providers/
```

Интерфейс:

```ts
interface DictionaryProvider {
  lookup(input: {
    text: string
    sourceLanguage: string
    targetLanguage: string
  }): Promise<DictionaryResult>
}
```

---

## DictionaryResult

```ts
type DictionaryResult = {
  translations: string[]
  transcription?: string
  partOfSpeech?: string
  examples?: {
    source: string
    target?: string
  }[]
}
```

---

## На первом этапе

Допустимо создать:

```text
MockDictionaryProvider
```

чтобы сначала закончить Telegram → DB flow без зависимости от внешнего API.

После этого подключить реальный provider.

---

# 18. Phase 15 — Добавление vocabulary через Telegram

Любой обычный текст пользователя, не являющийся командой, считать кандидатом на VocabularyItem.

Flow:

```text
message
↓
find user
↓
find default language pair
↓
normalize
↓
check duplicate
↓
dictionary lookup
↓
create VocabularyItem
↓
status = inbox
↓
reply
```

---

## Ответ

Пример:

```text
reliable
/rɪˈlaɪəbəl/

надёжный
заслуживающий доверия

We need a reliable service.

Added to Inbox ✓
```

---

# 19. Phase 16 — Phrase support

Определение типа:

```text
contains whitespace → phrase
otherwise → word
```

Записать:

```text
type = word | phrase
```

Не использовать NLP для этого.

---

# 20. Phase 17 — Telegram /inbox

Добавить:

```text
/inbox
```

Показывать количество:

```text
Inbox: 12
```

и последние слова.

Например:

```text
reliable
figure out
eventually
roughly
regardless
```

Добавить кнопку:

```text
Learn all
```

---

# 21. Phase 18 — Start learning

При `Learn all`:

для всех:

```text
status = inbox
```

установить:

```text
status = learning
```

и создать:

```text
ReviewState
```

Начальный:

```text
level = 0
next_review_at = now
```

---

# 22. Phase 19 — Review algorithm

Создать:

```text
src/reviews/review.service.ts
```

Интервалы:

```ts
const REVIEW_INTERVALS = [
  0,
  1,
  3,
  7,
  14,
  30,
  60
]
```

в днях.

---

## correct

```text
level = min(level + 1, maxLevel)
```

`nextReviewAt` определяется новым level.

---

## incorrect

```text
level = max(level - 1, 0)
nextReviewAt = tomorrow
```

---

## Важно

Расчёт интервала должен быть pure function.

Например:

```ts
calculateNextReview(...)
```

чтобы его легко тестировать и заменить позже.

---

# 23. Phase 20 — Review repository

Создать:

```text
src/reviews/review.repository.ts
```

Методы:

```ts
findDueForUser()
getState()
createState()
updateState()
createReview()
countDue()
countReviewedToday()
```

---

# 24. Phase 21 — Telegram /review

Команда:

```text
/review
```

получает due words.

Если нет:

```text
Nothing to review right now 🎉
```

Если есть:

```text
8 words are ready.

Start review
```

---

# 25. Phase 22 — Telegram review session

Первая карточка:

```text
1 / 8

reliable

[Show answer]
```

После нажатия:

```text
reliable

надёжный
заслуживающий доверия

We need a reliable service.

[Didn't know]
[Knew it]
```

---

## После ответа

Создать:

```text
Review
```

и обновить:

```text
ReviewState
```

Затем показать следующую карточку.

---

# 26. Phase 23 — Review directions

Первоначально поддержать:

```text
source_to_target
```

Затем добавить:

```text
target_to_source
```

Например:

```text
надёжный
```

↓

```text
reliable
```

На MVP допустимо чередовать направления случайным образом или по простому правилу.

Не делать сложную систему weighting.

---

# 27. Phase 24 — HTML rendering

Подключить простой server-side template engine.

Предпочтительно:

```text
Eta
```

Структура:

```text
src/views/
├── layouts/
├── dashboard/
├── vocabulary/
├── review/
├── languages/
└── settings/
```

---

# 28. Phase 25 — Base web layout

Создать layout:

```text
Vocabulary Trainer

Dashboard
Vocabulary
Review
Settings
```

Web UI:

```text
responsive
mobile-first
max-width container
```

Никакой frontend framework.

---

# 29. Phase 26 — Sessions

Реализовать server-side sessions.

Таблица:

```text
sessions
```

Минимальные данные:

```text
id
user_id
expires_at
created_at
```

Browser получает session cookie.

Настройки:

```text
HttpOnly
SameSite=Lax
Secure in production
```

---

# 30. Phase 27 — Telegram web login

Добавить:

```text
Continue with Telegram
```

Flow:

```text
/login
↓
Telegram authorization
↓
/auth/telegram/callback
↓
verify identity
↓
find TelegramAccount
↓
find/create User
↓
create session
↓
/
```

Нельзя доверять Telegram user ID без проверки authorization response.

---

# 31. Phase 28 — Auth middleware

Создать:

```text
requireUser()
```

Protected pages:

```text
/
 /vocabulary
 /review
 /languages
 /settings
```

Неавторизованный пользователь:

```text
302 → /login
```

---

# 32. Phase 29 — Dashboard

Route:

```text
GET /
```

Показывать:

```text
Current language pair

Due
Inbox
Learning
Known
Total
Reviewed today
```

CTA:

```text
Start review
```

---

# 33. Phase 30 — Vocabulary web page

Route:

```text
GET /vocabulary
```

Показывать:

```text
text
translation
status
```

Добавить:

```text
search
status filter
language pair filter
```

---

# 34. Phase 31 — HTMX search

Search input:

```html
<input
  name="q"
  hx-get="/vocabulary/list"
  hx-trigger="keyup changed delay:300ms"
  hx-target="#vocabulary-list"
/>
```

Backend возвращает только fragment списка.

Не перезагружать всю страницу.

---

# 35. Phase 32 — Vocabulary edit

Route:

```text
GET /vocabulary/:id
```

Редактирование:

```text
text
translations
transcription
partOfSpeech
examples
status
```

Save:

```text
POST /vocabulary/:id
```

---

# 36. Phase 33 — Delete

HTMX endpoint:

```text
POST /vocabulary/:id/delete
```

Перед удалением показать confirmation.

Backend обязательно проверяет:

```text
item belongs to current user
```

---

# 37. Phase 34 — Web review

Route:

```text
GET /review
```

Получает due words.

Карточка:

```text
reliable

[Show answer]
```

HTMX:

```text
POST /review/:id/reveal
```

возвращает:

```text
translation
example

[Didn't know]
[Knew it]
```

---

# 38. Phase 35 — Web review result

Endpoints:

```text
POST /review/:id/correct
POST /review/:id/incorrect
```

После записи результата server возвращает следующую review card.

Когда слова закончились:

```text
Review complete

8 words reviewed.
```

---

# 39. Phase 36 — Language management web

Route:

```text
GET /languages
```

Показывать:

```text
✓ English → Russian
  German → Russian
```

Actions:

```text
Add
Set default
Delete
```

---

# 40. Phase 37 — Telegram /languages

Реализовать аналогичный интерфейс через inline keyboard.

Команда:

```text
/languages
```

---

# 41. Phase 38 — Settings

User settings:

```text
timezone
daily_review_enabled
daily_review_time
```

Web:

```text
/settings
```

Telegram:

```text
/settings
```

Для MVP редактирование времени можно первоначально сделать только через web.

---

# 42. Phase 39 — Scheduler

Создать:

```text
src/reviews/review-scheduler.ts
```

Запуск:

```text
каждую минуту
```

Scheduler:

1. определяет пользователей;
2. переводит текущее время в timezone пользователя;
3. проверяет `daily_review_time`;
4. проверяет due words;
5. если due > 0 — отправляет Telegram notification.

---

# 43. Phase 40 — Защита от повторных notification

Нельзя отправлять:

```text
9:00
9:01
9:02
...
```

одно и то же сообщение.

Добавить хранение:

```text
last_daily_notification_at
```

или отдельную таблицу notification log.

Для MVP проще добавить поле в:

```text
user_settings
```

---

# 44. Phase 41 — Telegram daily notification

Пример:

```text
☕ English

9 words are ready to review.

[Start review]
```

Если:

```text
due = 0
```

ничего не отправлять.

---

# 45. Phase 42 — Error handling

Создать общий Fastify error handler.

Production response:

```text
Something went wrong.
```

Не отдавать stack trace.

Telegram provider errors:

```text
I couldn't process this word right now.
Please try again later.
```

---

# 46. Phase 43 — Logging

Использовать Fastify/Pino.

Логировать:

```text
startup
shutdown
migrations
telegram errors
dictionary errors
scheduler errors
HTTP 5xx
```

Не логировать:

```text
TELEGRAM_BOT_TOKEN
SESSION_SECRET
API keys
session IDs
```

---

# 47. Phase 44 — Tests

Использовать:

```text
node:test
```

или Vitest.

Для минимального количества dependencies предпочтительно:

```text
node:test
```

---

## Обязательные unit tests

### normalizeText

```text
Reliable → reliable

"  figure   out " → "figure out"
```

---

### Review algorithm

Проверить:

```text
level 0 correct → 1
level 1 correct → 2

level 4 incorrect → 3
level 0 incorrect → 0
```

Проверить `nextReviewAt`.

---

### Duplicate detection

Одинаковое слово:

```text
same language pair → duplicate
```

Но:

```text
different pair → allowed
```

---

### User isolation

User A не может:

```text
read
edit
delete
```

VocabularyItem User B.

---

# 48. Phase 45 — Dockerfile

Использовать multi-stage build.

Логически:

```text
builder
↓
npm ci
↓
npm run build
↓
runtime
↓
node dist/server.js
```

Не устанавливать dev dependencies в production image.

---

# 49. Phase 46 — Docker Compose

Создать:

```text
compose.yml
```

Один service:

```text
app
```

Persistent volume:

```text
vocabulary_data:/app/data
```

Port:

```text
3000
```

---

# 50. Phase 47 — Docker healthcheck

Использовать:

```text
GET /health
```

Container считается healthy, если:

```text
Fastify работает
SQLite доступен
```

---

# 51. Phase 48 — Graceful shutdown

Обработать:

```text
SIGTERM
SIGINT
```

При shutdown:

1. остановить scheduler;
2. остановить Telegram bot;
3. закрыть Fastify;
4. закрыть SQLite;
5. завершить процесс.

Это особенно важно для:

```text
docker compose down
```

---

# 52. Phase 49 — Backup command

Добавить:

```text
npm run db:backup
```

Backup должен использовать безопасный механизм SQLite backup.

Результат:

```text
backups/vocabulary-YYYY-MM-DD-HHMM.db
```

---

# 53. Phase 50 — README

README должен содержать:

```text
requirements
setup
Telegram bot setup
environment variables
development run
Docker run
database path
backup
restore
```

---

# 54. Локальный запуск

Целевой flow разработчика:

```bash
cp .env.example .env
```

заполнить:

```text
TELEGRAM_BOT_TOKEN
```

затем:

```bash
docker compose up --build
```

После запуска:

```text
http://localhost:3000
```

и Telegram bot работает одновременно.

---

# 55. Первый usable milestone

Не ждать реализации Web UI.

Первая версия считается уже полезной после завершения:

```text
Phase 0–22
```

Когда работает:

```text
/start
↓
language selection
↓
send "reliable"
↓
save
↓
/inbox
↓
Learn all
↓
/review
```

На этом этапе начать реально пользоваться приложением.

Это важно, потому что дальнейшие решения должны приниматься на основе собственного использования.

---

# 56. Milestone A — Telegram Vocabulary

Включает:

```text
project bootstrap
SQLite
migrations
users
Telegram
languages
vocabulary
dictionary
inbox
```

Definition of Done:

```text
User sends a word.
Word appears in SQLite.
Bot returns translation.
```

---

# 57. Milestone B — Learning

Включает:

```text
ReviewState
Review history
/review
correct/incorrect
intervals
```

Definition of Done:

```text
User can complete a real learning session entirely in Telegram.
```

---

# 58. Milestone C — Web

Включает:

```text
Telegram login
sessions
dashboard
vocabulary list
search
edit
delete
review
```

Definition of Done:

```text
User sees exactly the same vocabulary on web and Telegram.
```

---

# 59. Milestone D — Daily usage

Включает:

```text
settings
timezone
scheduler
Telegram notification
Docker
backup
```

Definition of Done:

```text
Application can run permanently on homelab.
```

---

# 60. Что не делать coding agent

Coding agent не должен самостоятельно добавлять:

```text
React
Tailwind
PostgreSQL
Redis
Prisma
Drizzle
NestJS
GraphQL
REST API
OAuth providers кроме Telegram
background queue
microservices
```

если задача явно этого не требует.

---

# 61. Правило для dependencies

Перед добавлением новой dependency задать вопрос:

> Можно ли реализовать это простой функцией на Node.js или уже установленной библиотекой?

Если да — новую dependency не добавлять.

---

# 62. Правило реализации задач

Каждая задача должна завершаться:

1. рабочим кодом;
2. тестами для business logic;
3. отсутствием TypeScript ошибок;
4. обновлением README, если изменился setup;
5. проверкой запуска Docker, если изменилась инфраструктура.

---

# 63. Проверки перед merge

Запускать:

```bash
npm run build
npm test
```

Если есть formatter/linter:

```bash
npm run lint
```

После infrastructure changes:

```bash
docker compose build
docker compose up
```

Проверить:

```text
/health
Telegram /start
```

---

# 64. Рекомендуемый порядок первых задач

Начать именно в таком порядке:

```text
001 Bootstrap TypeScript + Fastify

002 Add SQLite connection

003 Add migration runner

004 Add initial schema

005 Add User repository

006 Add TelegramAccount repository

007 Start Telegram bot

008 Implement /start

009 Add languages

010 Implement onboarding

011 Add LanguagePair

012 Add Vocabulary repository

013 Add VocabularyService

014 Add mock DictionaryProvider

015 Add Telegram text handler

016 Implement duplicate detection

017 Add /inbox

018 Implement Learn all

019 Add ReviewState

020 Implement review algorithm

021 Add /review

022 Store review result
```

После `022` остановиться и проверить приложение в реальном использовании.

Не начинать Web UI, пока Telegram flow не работает целиком.

---

# 65. Первый production deployment

После Telegram milestone:

```text
Beelink
   │
Docker
   │
Vocabulary App
   │
SQLite volume
```

Приложение может быть задеплоено ещё до Web UI.

Для Telegram long polling публичный HTTP endpoint не требуется.

Web можно пока оставить доступным:

```text
Tailscale only
```

Публичный HTTPS понадобится к моменту реализации Telegram Web Login.

---

# 66. Ключевая продуктовая проверка после первой недели

После недели использования ответить на вопросы:

```text
Добавлять слово быстрее, чем в Google Translate?

Возвращаюсь ли я к review каждый день?

Какие слова чаще добавляю:
words или phrases?

Нужен ли Inbox?

Удобны ли интервалы?

Нужен ли web вообще ежедневно?

Каких данных не хватает на карточке?

Нужен ли автоматический перевод примеров?
```

На основании этого корректировать следующие этапы.

Не добавлять функции только потому, что они были предусмотрены изначально.

---

# 67. Итоговая последовательность

```text
Foundation
    ↓
Telegram identity
    ↓
Languages
    ↓
Vocabulary capture
    ↓
Inbox
    ↓
Reviews
    ↓
Real usage
    ↓
Web UI
    ↓
Daily notifications
    ↓
Homelab deployment
```

Главная задача первой версии:

> Сделать добавление нового слова проще, чем сохранение его в Google Translate, а повторение — автоматическим.