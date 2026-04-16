#!/usr/bin/env bash
# Sets up an isolated git workspace pre-loaded with the test fixtures.
# After running this, cd into the workspace and run Claude Code commands
# against it to verify they catch the expected issues in tests/EXPECTED.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE=$(mktemp -d)

echo "Creating test workspace at: $WORKSPACE"

cd "$WORKSPACE"
git init -q
git checkout -q -b main
git commit --allow-empty -q -m "chore: init"
git checkout -q -b test-branch

# Copy fixtures into workspace
cp "$SCRIPT_DIR/fixtures/"* .

# Stage everything so /cleanup and /review see the diff vs main
git add .

echo ""
echo "Workspace ready: $WORKSPACE"
echo ""
echo "Run the following from inside the workspace:"
echo ""
echo "  cd $WORKSPACE"
echo ""
echo "  claude /review          # all three fixtures (staged + untracked)"
echo "  claude /cleanup         # dirty-*.ts/tsx files (branch diff vs main)"
echo "  claude /sweep           # entire workspace"
echo "  claude /security-scan   # dirty-backend.ts + dirty-security.ts"
echo ""
echo "Compare output against: $(dirname "$SCRIPT_DIR")/tests/EXPECTED.md"
