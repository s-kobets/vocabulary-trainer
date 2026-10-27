#!/usr/bin/env bash
set -euo pipefail

backup_path=${1:?backup path required}
database_path=${2:?database path required}
[[ -f "$backup_path" ]] || { printf 'Backup does not exist: %s\n' "$backup_path" >&2; exit 1; }
sqlite3 -readonly "$backup_path" 'PRAGMA integrity_check;' | grep -qx ok
[[ "$(sqlite3 -readonly "$backup_path" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'users', 'telegram_accounts', 'user_settings', 'language_pairs', 'vocabulary_items', 'review_states', 'reviews', 'sessions');")" == 9 ]] || {
  printf 'Backup is not a vocabulary database\n' >&2; exit 1;
}
mkdir -p "$(dirname "$database_path")"
if [[ -f "$database_path" ]]; then
  cp "$database_path" "$database_path.before-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
fi
temporary_path="$database_path.restore.tmp"
trap 'rm -f "$temporary_path"' EXIT
sqlite3 -readonly "$backup_path" ".backup '$temporary_path'"
mv "$temporary_path" "$database_path"
