#!/usr/bin/env bash
set -euo pipefail

backup_path=${1:?backup path required}
database_path=${2:?database path required}
sqlite3 "$backup_path" 'PRAGMA integrity_check;' | grep -qx ok
mkdir -p "$(dirname "$database_path")"
if [[ -f "$database_path" ]]; then
  cp "$database_path" "$database_path.before-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
fi
temporary_path="$database_path.restore.tmp"
sqlite3 "$backup_path" ".backup '$temporary_path'"
mv "$temporary_path" "$database_path"
