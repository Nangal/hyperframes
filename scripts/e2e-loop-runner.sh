#!/usr/bin/env bash
# E2E loop runner — called by the hourly schedule
# Appends results to a persistent log across iterations
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="/tmp/hyperframes-e2e-loop"
mkdir -p "$RESULTS_DIR"

ITERATION=${1:-1}
LOG="$RESULTS_DIR/iteration-${ITERATION}.log"
SUMMARY="$RESULTS_DIR/summary.log"

echo "=== Iteration $ITERATION — $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$SUMMARY"

# Run the e2e suite and capture output
bash "$SCRIPT_DIR/e2e-alpha-test.sh" > "$LOG" 2>&1
EXIT=$?

# Extract summary line
RESULT=$(grep -E '^.*PASS:.*FAIL:.*WARN:' "$LOG" | tail -1)
echo "  $RESULT" | tee -a "$SUMMARY"

# Extract issues
if grep -q "^ISSUE:" "$LOG"; then
  echo "  Issues:" | tee -a "$SUMMARY"
  grep "^ISSUE:" "$LOG" | sort -u | while read -r line; do
    echo "    $line" | tee -a "$SUMMARY"
  done
fi

echo "" >> "$SUMMARY"
echo "Iteration $ITERATION complete. Log: $LOG"
