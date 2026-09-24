#!/usr/bin/env bash
# Restores a backup made by backup.sh into a NEW, EMPTY Supabase project.
# Use this if your current project is paused, deleted, or you are moving to
# a fresh free project because you hit a Supabase account limit.
#
# Usage:
#   export SUPABASE_DB_URL="postgresql://postgres:NEW-PASSWORD@db.yyyyyyyy.supabase.co:5432/postgres"
#   ./scripts/restore.sh backups/sampledesk_full_20260924-101500.dump
#
# Steps before running this, IN THIS ORDER:
#   1. Create a brand new Supabase project.
#   2. In its SQL Editor, run supabase/schema.sql ONCE (this recreates the
#      empty tables, security rules and functions -- pg_restore then fills
#      them with your data).
#   3. Do NOT add any team logins yet -- add them AFTER this script finishes
#      (adding one first and restoring after can hit a duplicate-key error).
#   4. Get that NEW project's connection string and export it as SUPABASE_DB_URL.
#   5. Run this script with the .dump file from backup.sh.
#   6. NOW add your team's logins in the new project's Authentication tab
#      (logins themselves are not part of this backup -- Supabase manages
#      those separately, and each new login gets a new internal ID).
#   7. Update your hosting provider's VITE_SUPABASE_URL and
#      VITE_SUPABASE_ANON_KEY to the new project and redeploy.
#
# Note: the restored sample log keeps showing who gave out each sample
# (the name is stored as plain text on every entry), even though the
# restore can't reconnect old entries to the old logins. That's expected.
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Error: set SUPABASE_DB_URL first (the NEW project's connection string)." >&2
  exit 1
fi
if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: $0 backups/sampledesk_full_<timestamp>.dump" >&2
  exit 1
fi

echo "Restoring $1 into the database at:"
echo "  $(echo "$SUPABASE_DB_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')"
read -r -p "Have you already run supabase/schema.sql on this NEW project? [y/N] " ok
if [ "$ok" != "y" ] && [ "$ok" != "Y" ]; then
  echo "Run supabase/schema.sql first (SQL Editor, new project), then re-run this script."
  exit 1
fi

pg_restore --dbname="$SUPABASE_DB_URL" \
  --data-only --disable-triggers --no-owner --no-privileges \
  --schema=public \
  "$1"

echo
echo "Data restored. Now:"
echo "  1. Add your team back in Authentication > Users (they need new passwords)."
echo "  2. Run this once in the new project's SQL Editor for each team member:"
echo "       update public.profiles set role = 'team'  where email = '...';"
echo "       update public.profiles set role = 'admin' where email = '...';"
echo "  3. Update VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY on your hosting"
echo "     provider and redeploy."
