#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Rollback for migration C3 — atomic writes (safe-write.js)
#
#  C3 step 1 adds a NEW leaf module and its tests. It changes no existing module,
#  so rollback cannot lose data. Later C3 steps migrate one ledger writer at a
#  time; each has its own backups/migration-C3-*/ROLLBACK.sh.
#
#  Usage:  bash scripts/rollback-C3.sh [--check]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY="${1:-}"

FILES=(
  "safe-write.js"
  "test/safe-write.test.js"
  "test/fixtures/c3-writer.js"
  "docs/migrations/C3-01-safe-write.md"
  "scripts/rollback-C3.sh"
)

echo "C3 rollback — files introduced by this migration:"
for f in "${FILES[@]}"; do
  if [ -e "$f" ]; then echo "  present  $f"; else echo "  absent   $f"; fi
done

# Orphaned temp files from a crashed writer are inert (the rename never happened),
# but list them so an operator can see whether a writer died mid-flight.
echo
echo "Orphaned safe-write temp files under data/ (inert; the ledger was never touched):"
found=$(find data -name '.*.tmp-*' 2>/dev/null || true)
if [ -z "$found" ]; then echo "  none"; else echo "$found" | sed 's/^/  /'; fi

echo
echo "Stale lock files under data/:"
locks=$(find data -name '*.lock' 2>/dev/null || true)
if [ -z "$locks" ]; then echo "  none"; else echo "$locks" | sed 's/^/  /'; fi

if [ "$CHECK_ONLY" = "--check" ]; then
  echo
  echo "--check given; nothing removed."
  exit 0
fi

echo
read -r -p "Remove the C3 module and its tests? No ledger or .bak is touched. [y/N] " ans
case "$ans" in
  [yY]*) ;;
  *) echo "Aborted."; exit 1;;
esac

# NOTE: .bak files are NOT removed. They are the last known good copy of a ledger
# and may be the only surviving record if a writer crashed. Delete them by hand,
# deliberately, never as part of a rollback.
rm -f safe-write.js test/safe-write.test.js test/fixtures/c3-writer.js docs/migrations/C3-01-safe-write.md
rmdir test/fixtures 2>/dev/null || true

echo "C3 rolled back. .bak files were deliberately preserved:"
find data -name '*.bak' 2>/dev/null | sed 's/^/  /' || echo "  none"
echo
echo "Run 'npm test' to confirm the suite is green without C3."
