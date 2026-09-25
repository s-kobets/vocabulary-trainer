#!/usr/bin/env bash
set -euo pipefail

database_path=${1:?database path required}
backup_directory=${2:?backup directory required}
mkdir -p "$backup_directory"
timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
temporary_path="$backup_directory/.vocabulary-$timestamp.sqlite.tmp"
backup_path="$backup_directory/vocabulary-$timestamp.sqlite"

sqlite3 "$database_path" ".backup '$temporary_path'"
[[ "$(sqlite3 "$temporary_path" 'PRAGMA integrity_check;')" == "ok" ]]
mv "$temporary_path" "$backup_path"

find "$backup_directory" -maxdepth 1 -type f -name 'vocabulary-*.sqlite' -print0 \
  | xargs -0 ls -1t \
  | awk 'NR > 7 { print }' \
  | xargs -r rm -f
printf '%s\n' "$backup_path"
