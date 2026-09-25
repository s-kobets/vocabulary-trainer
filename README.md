# Vocabulary Trainer

## Requirements

- Node.js and npm
- Telegram bot token from BotFather

## Setup

```bash
cp .env.example .env
npm install
```

## Environment variables

`TELEGRAM_BOT_TOKEN` is the token issued by BotFather. `DATABASE_PATH` defaults to
`./data/vocabulary.db`.

## Telegram bot setup

Create a bot with BotFather and put its token in `TELEGRAM_BOT_TOKEN`. The bot
uses Telegram long polling.

## Development run

```bash
npm run dev
```

## Production deployment

On the Beelink host, create persistent directories and configure `.env` with
`TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY`:

```bash
sudo mkdir -p /srv/vocabulary/data /srv/vocabulary/backups
docker compose build
docker compose up -d
curl --fail http://127.0.0.1:3000/health
docker compose logs -f vocabulary-app
```

The database is stored in `/srv/vocabulary/data` and survives container
recreation. Telegram sessions are stored in the same SQLite database.

Create a daily local backup with host cron:

```cron
15 3 * * * /srv/vocabulary/app/scripts/backup-sqlite.sh /srv/vocabulary/data/vocabulary.db /srv/vocabulary/backups >> /var/log/vocabulary-backup.log 2>&1
```

The backup script verifies SQLite integrity and keeps the newest seven copies.
To restore, stop the service, restore a verified backup, and start it again:

```bash
docker compose stop vocabulary-app
./scripts/restore-sqlite.sh /srv/vocabulary/backups/vocabulary-YYYY-MM-DDTHH-MM-SSZ.sqlite /srv/vocabulary/data/vocabulary.db
docker compose up -d vocabulary-app
```

`OPENAI_MODEL` defaults to `gpt-4o-mini`. If OpenAI is temporarily unavailable,
the word is still saved in `Inbox` and its card enrichment is retried by the
application. The Telegram command menu is registered automatically at startup.

## Database path

Set `DATABASE_PATH` to change the SQLite database location. The default is
`./data/vocabulary.db`.

## Testing

```bash
npm test
npm run build
```

## Current scope

The current milestone ends at Telegram review. It includes Telegram onboarding,
language pairs, vocabulary capture with the mock dictionary, inbox, learning,
and review history. Web, scheduler, Docker, backup, and real dictionary
providers are outside this milestone.
