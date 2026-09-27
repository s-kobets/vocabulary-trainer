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

## Telegram commands

- `/start` starts onboarding and chooses the first language pair.
- `/help` shows the available commands.
- `/status` shows the active language pair and Inbox, Learning, and Known counts.
- `/languages` lists saved language pairs, selects the active pair, and adds new
  pairs. A pair containing vocabulary cannot be deleted.
- `/inbox` shows words and translations waiting to be learned, with per-word edit
  and move actions plus a bulk `Learn all` action.
- `/learning` shows up to 10 words currently being learned for the active pair,
  reports the full count, and provides a button to review due words.
- `/review` starts a review session for due words.
- `/delete` deletes one word immediately or asks for confirmation before bulk deletion.
- `/edit <word>` replaces translations for a word in the active language pair.

To add multiple words at once, paste one word or phrase per line. Empty lines
are ignored and the bot reports Added, Duplicates, and Failed counts.

```text
approximate
besties
filled
waste
exceeded
milestone
blast
affordable
```

To delete one word, send `/delete word`. For bulk deletion, send `/delete` and
then one word or phrase per line; the bot asks for confirmation before deleting.
The `/inbox` preview shows each source word with its translations and offers
`Edit translation` and `Move to Learning` for each listed word. `Learn all` still
moves all Inbox words in the active pair, including words beyond the 10-word
preview.

## How It Works

### 1. Choose Languages

Send `/start` the first time you use the bot. Select a source language and a
target language. The selected pair becomes the active pair.

Use `/languages` later to:

- See all saved language pairs.
- Switch the active pair.
- Add another pair.

Words always belong to the language pair that was active when they were added.
Switching pairs does not move or delete existing words.

### 2. Add Words to Inbox

Send one word or phrase directly to the bot:

```text
approximate
```

The bot looks up the word and adds it to the active pair's `Inbox`.

For bulk import, send one word or phrase per line. Empty lines are ignored and
the bot reports how many items were added, duplicated, or failed.

```text
approximate
besties
filled
waste
exceeded
milestone
blast
affordable
```

### 3. Move Inbox Words to Learning

Use `/inbox` to see up to 10 recent Inbox words with their translations and the
total Inbox count. Check the suggested translation before studying it.

Use `Edit translation` to replace an incorrect translation, or `Move to
Learning` to start studying one word. The inbox view refreshes after an
individual move. Press `Learn all` to move every Inbox word for the active pair
at once.

`Learn all` moves **all Inbox words in the active language pair** to `Learning`,
not only the 10 words displayed in the preview. It also creates their initial
review schedules. Words from other language pairs are not affected.

### 4. Browse Learning Words

Use `/learning` to see up to 10 words currently in `Learning` for the active
pair. The message also shows the complete Learning count.

`/learning` does not change any word or review state. If learning words exist,
press `Review due words` to start a review session for words that are due now.

### 5. Review Due Words

You can start a review in either way:

- Press `Review due words` from `/learning`.
- Send `/review` directly.

The bot shows one source word at a time. Press `Show answer`, then choose:

- `Knew it` when you remembered the answer.
- `Didn't know` when you did not remember it.

Each answer updates the word's review schedule. Only due words are included in
the session. A word can be reviewed again later when its next review time is
reached.

### 6. Reach Known

Words move from `Learning` to `Known` after enough successful reviews at the
highest review level. If you answer incorrectly for a `Known` word, it can move
back to `Learning` so it receives more practice.

Use `/status` to see counts for the active pair:

```text
Active pair: English -> Russian
Inbox: 4
Learning: 12
Known: 5
```

### 7. Delete Words

Delete one word immediately with:

```text
/delete approximate
```

This works for words in `Inbox`, `Learning`, `Known`, or an active review
session. The word is deleted only from the current active language pair.

For bulk deletion, send `/delete` followed by one word or phrase per line:

```text
/delete
approximate
besties
filled
```

The bot asks for confirmation before deleting the batch. Empty lines and
duplicate entries are ignored. Deleting a word also removes its review schedule
and review history.

### 8. Edit Translations

Replace translations on an existing word without deleting its card:

```text
/edit approximate
примерный
приблизительный
```

Send one replacement translation per line. The new list replaces all previous
translations. During `/review`, use `Edit translation` on a revealed answer card
to start the same flow without typing the source word.

## Command Lifecycle

The usual learning flow connects commands and inline buttons as follows:

```text
/start
  -> choose source and target languages
  -> active language pair is created

send a word or phrase
  -> word is saved in Inbox

/inbox
  -> Learn all
  -> all Inbox words for the active pair move to Learning

/learning
  -> Review due words
  -> a review session starts for due Learning words

/review
  -> Show answer
  -> Knew it / Didn't know
  -> review schedule is updated
  -> word eventually reaches Known after successful reviews
```

The related commands are:

- `/languages` changes the active language pair. Words remain attached to the
  pair that was active when they were added.
- `/status` shows the current language pair and vocabulary counts.
- `/help` shows the available commands.
- `/delete` removes words from any vocabulary state. Bulk deletion requires
  `Confirm delete` or `Cancel`.

Inline buttons continue a workflow started by a command. `Learn all` moves
words from `Inbox` to `Learning`, `Review due words` starts review, and review
buttons record the answer for the current word. These buttons are temporary
actions, not separate Telegram commands.

## Typical Daily Workflow

1. Select the desired pair with `/languages`.
2. Send new words individually or paste a newline-separated list.
3. Use `/inbox` to verify translations, edit or move individual words, or press
   `Learn all` when ready to study the whole Inbox.
4. Use `/learning` to see the learning list and its total count.
5. Press `Review due words` whenever available, or send `/review`.
6. Answer each card with `Knew it` or `Didn't know`.
7. Use `/status` to check Inbox, Learning, and Known totals.
8. Use `/delete word` or confirmed bulk `/delete` to remove unwanted words.

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
