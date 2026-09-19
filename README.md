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
