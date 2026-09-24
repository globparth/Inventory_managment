#!/usr/bin/env bash
# Full database backup for the Sample Desk project.
#
# Usage:
#   export SUPABASE_DB_URL="postgresql://postgres:YOUR-PASSWORD@db.xxxxxxxx.supabase.co:5432/postgres"
#   ./scripts/backup.sh
#
# Where to find SUPABASE_DB_URL:
#   Supabase dashboard > Project Settings > Database > Connection string > URI
#   Use the "Direct connection" (not the pooler) for pg_dump. If your network
#   blocks the direct connection, use "Connection pooling" instead and switch
#   the port to 5432 -> 6543 in the string.
#
# What this makes, in ./backups/:
#   sampledesk_full_<timestamp>.dump   - complete backup (schema + data + functions
#                                         + security rules). This is the one to keep.
#                                         Restores with scripts/restore.sh.
#   sampledesk_data_<timestamp>.sql    - data only, human-readable, plain SQL.
#                                         Handy to eyeball or grep, not a full restore.
#
# Keep old backups: this script never deletes anything.
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Error: set SUPABASE_DB_URL first. See the comment at the top of this script." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"
full="backups/sampledesk_full_${stamp}.dump"
data="backups/sampledesk_data_${stamp}.sql"

echo "Backing up schema + data (this is the one you restore from)..."
pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=9 --no-owner --no-privileges \
  --schema=public \
  --file="$full"

echo "Also writing a plain-text data-only copy for quick inspection..."
pg_dump "$SUPABASE_DB_URL" \
  --format=plain --data-only --no-owner --no-privileges \
  --schema=public \
  --file="$data"

echo
echo "Done."
ls -lh "$full" "$data"
echo
echo "Copy these two files somewhere OTHER than this laptop (email to yourself,"
echo "Google Drive, a USB stick). A backup that lives in only one place isn't a backup."
