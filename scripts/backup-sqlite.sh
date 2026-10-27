#!/usr/bin/env bash
set -euo pipefail

database_path=${1:?database path required}
backup_directory=${2:?backup directory required}
[[ -f "$database_path" ]] || { printf 'Database does not exist: %s\n' "$database_path" >&2; exit 1; }
[[ "$(sqlite3 -readonly "$database_path" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'users', 'telegram_accounts', 'user_settings', 'language_pairs', 'vocabulary_items', 'review_states', 'reviews', 'sessions');")" == 9 ]] || {
  printf 'Source is not a vocabulary database\n' >&2; exit 1;
}
mkdir -p "$backup_directory"
timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
temporary_path="$backup_directory/.vocabulary-$timestamp.sqlite.tmp"
backup_path="$backup_directory/vocabulary-$timestamp.sqlite"

trap 'rm -f "$temporary_path"' EXIT
sqlite3 -readonly "$database_path" ".backup '$temporary_path'"
[[ "$(sqlite3 "$temporary_path" 'PRAGMA integrity_check;')" == "ok" ]]
mv "$temporary_path" "$backup_path"

find "$backup_directory" -maxdepth 1 -type f -name 'vocabulary-*.sqlite' -print0 \
  | xargs -0 ls -1t \
  | awk 'NR > 7 { print }' \
  | xargs -r rm -f
printf '%s\n' "$backup_path"
