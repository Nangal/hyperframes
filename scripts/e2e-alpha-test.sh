#!/usr/bin/env bash
set -euo pipefail

# E2E Alpha Preview Test Suite for HyperFrames
# Tests the full composition lifecycle: init → preview → render → validate

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="/tmp/hyperframes-e2e-$(date +%Y%m%d%H%M%S)"
LOG_FILE="${TEST_DIR}/test-results.log"
ISSUES_FILE="${TEST_DIR}/issues.log"
PASS=0
FAIL=0
WARN=0

mkdir -p "$TEST_DIR"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
pass() { PASS=$((PASS + 1)); log "  PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); log "  FAIL: $*"; echo "ISSUE: $*" >> "$ISSUES_FILE"; }
warn() { WARN=$((WARN + 1)); log "  WARN: $*"; echo "WARNING: $*" >> "$ISSUES_FILE"; }
section() { log ""; log "=== $* ==="; }

# ── 1. CLI Version & Help ────────────────────────────────────────────────────

section "CLI basics"

if hyperframes --version > /dev/null 2>&1; then
  VERSION=$(hyperframes --version)
  pass "CLI version: $VERSION"
else
  fail "CLI --version fails"
fi

if hyperframes --help > /dev/null 2>&1; then
  pass "CLI --help works"
else
  fail "CLI --help fails"
fi

for cmd in render preview init validate info; do
  if hyperframes $cmd --help > /dev/null 2>&1; then
    pass "CLI '$cmd --help' works"
  else
    fail "CLI '$cmd --help' fails"
  fi
done

# ── 2. Init & Validate compositions ─────────────────────────────────────────

section "Init compositions"

EXAMPLES=(warm-grain kinetic-type swiss-grid product-promo vignelli nyt-graph decision-tree)

for example in "${EXAMPLES[@]}"; do
  PROJ_DIR="${TEST_DIR}/init-${example}"
  if hyperframes init "$PROJ_DIR" --example "$example" --non-interactive --skip-skills 2>&1 | tail -3 >> "$LOG_FILE"; then
    if [ -f "$PROJ_DIR/index.html" ]; then
      pass "init --example $example created project with index.html"
    else
      fail "init --example $example: missing index.html"
    fi
  else
    fail "init --example $example failed"
  fi
done

section "Validate compositions"

for example in "${EXAMPLES[@]}"; do
  PROJ_DIR="${TEST_DIR}/init-${example}"
  if [ -d "$PROJ_DIR" ]; then
    VALIDATE_OUT=$(hyperframes validate "$PROJ_DIR" 2>&1) || true
    # Count only real errors (✗ lines), not contrast warnings or GSAP warnings
    ERROR_COUNT=$(echo "$VALIDATE_OUT" | grep -c '✗' || echo 0)
    if [ "$ERROR_COUNT" -gt 0 ]; then
      fail "validate $example: $ERROR_COUNT error(s)"
      echo "$VALIDATE_OUT" >> "$ISSUES_FILE"
    else
      CONTRAST_WARNINGS=$(echo "$VALIDATE_OUT" | grep -c 'contrast warning' || echo 0)
      if [ "$CONTRAST_WARNINGS" -gt 0 ]; then
        warn "validate $example: contrast warnings only"
      else
        pass "validate $example: clean"
      fi
    fi
  fi
done

# ── 3. Render compositions ──────────────────────────────────────────────────

section "Render compositions (MP4)"

RENDER_EXAMPLES=(warm-grain kinetic-type swiss-grid)

for example in "${RENDER_EXAMPLES[@]}"; do
  PROJ_DIR="${TEST_DIR}/init-${example}"
  OUTPUT="${TEST_DIR}/render-${example}.mp4"
  if [ -d "$PROJ_DIR" ]; then
    log "  Rendering $example..."
    RENDER_START=$(date +%s)
    if hyperframes render "$PROJ_DIR" --output "$OUTPUT" --quality draft --fps 24 2>&1 | tee -a "$LOG_FILE"; then
      RENDER_END=$(date +%s)
      RENDER_TIME=$((RENDER_END - RENDER_START))
      if [ -f "$OUTPUT" ]; then
        SIZE=$(stat --printf="%s" "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 1000 ]; then
          pass "render $example: ${SIZE} bytes in ${RENDER_TIME}s"
          # Validate with ffprobe
          if command -v ffprobe > /dev/null 2>&1; then
            DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT" 2>/dev/null || echo "0")
            VCODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$OUTPUT" 2>/dev/null || echo "unknown")
            RESOLUTION=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUTPUT" 2>/dev/null || echo "unknown")
            log "    Duration: ${DURATION}s, Codec: $VCODEC, Resolution: $RESOLUTION"
            if [ "$(echo "$DURATION > 0.5" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
              pass "render $example: valid duration ${DURATION}s"
            else
              fail "render $example: duration too short (${DURATION}s)"
            fi
          fi
        else
          fail "render $example: output too small (${SIZE} bytes)"
        fi
      else
        fail "render $example: output file missing"
      fi
    else
      fail "render $example: command failed"
    fi
  fi
done

# ── 4. Render format variants ────────────────────────────────────────────────

section "Render format variants"

PROJ_DIR="${TEST_DIR}/init-warm-grain"

for format in webm mov; do
  OUTPUT="${TEST_DIR}/render-warm-grain.${format}"
  if [ -d "$PROJ_DIR" ]; then
    log "  Rendering warm-grain as $format..."
    if hyperframes render "$PROJ_DIR" --output "$OUTPUT" --format "$format" --quality draft --fps 24 2>&1 | tee -a "$LOG_FILE"; then
      if [ -f "$OUTPUT" ]; then
        SIZE=$(stat --printf="%s" "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 1000 ]; then
          pass "render warm-grain.$format: ${SIZE} bytes"
        else
          fail "render warm-grain.$format: output too small (${SIZE} bytes)"
        fi
      else
        fail "render warm-grain.$format: output file missing"
      fi
    else
      fail "render warm-grain.$format: command failed"
    fi
  fi
done

# ── 5. Sub-composition rendering ─────────────────────────────────────────────

section "Sub-composition rendering"

for example in "${EXAMPLES[@]}"; do
  PROJ_DIR="${TEST_DIR}/init-${example}"
  if [ -d "$PROJ_DIR/compositions" ]; then
    COMPS=$(find "$PROJ_DIR/compositions" -name '*.html' 2>/dev/null | head -3)
    if [ -n "$COMPS" ]; then
      for comp in $COMPS; do
        COMP_REL=$(echo "$comp" | sed "s|$PROJ_DIR/||")
        OUTPUT="${TEST_DIR}/render-${example}-sub-$(basename "$comp" .html).mp4"
        log "  Rendering sub-comp: $example / $COMP_REL"
        if hyperframes render "$PROJ_DIR" -c "$COMP_REL" --output "$OUTPUT" --quality draft --fps 24 2>&1 | tee -a "$LOG_FILE"; then
          if [ -f "$OUTPUT" ]; then
            SIZE=$(stat --printf="%s" "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT" 2>/dev/null || echo 0)
            if [ "$SIZE" -gt 1000 ]; then
              pass "sub-comp $example/$COMP_REL: ${SIZE} bytes"
            else
              fail "sub-comp $example/$COMP_REL: output too small (${SIZE} bytes)"
            fi
          else
            fail "sub-comp $example/$COMP_REL: output file missing"
          fi
        else
          fail "sub-comp $example/$COMP_REL: render failed"
        fi
      done
    else
      log "  (no sub-compositions in $example)"
    fi
  fi
done

# ── 6. Preview server health check ──────────────────────────────────────────

section "Preview server health check"

PROJ_DIR="${TEST_DIR}/init-warm-grain"
PREVIEW_PORT=13099
PREVIEW_PID=""

if [ -d "$PROJ_DIR" ]; then
  hyperframes preview "$PROJ_DIR" --port "$PREVIEW_PORT" &
  PREVIEW_PID=$!
  sleep 5

  if kill -0 "$PREVIEW_PID" 2>/dev/null; then
    pass "preview server started (PID $PREVIEW_PID)"

    # Test API endpoints
    for endpoint in "/api/projects" "/api/runtime.js"; do
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PREVIEW_PORT}${endpoint}" 2>/dev/null || echo "000")
      if [ "$STATUS" = "200" ]; then
        pass "GET $endpoint: $STATUS"
      else
        fail "GET $endpoint: $STATUS (expected 200)"
      fi
    done

    # Test preview endpoint
    PROJECTS_JSON=$(curl -s "http://localhost:${PREVIEW_PORT}/api/projects" 2>/dev/null || echo "[]")
    if echo "$PROJECTS_JSON" | python3 -c "import sys,json; data=json.load(sys.stdin); assert len(data) > 0" 2>/dev/null; then
      pass "GET /api/projects returns project list"
      PROJECT_ID=$(echo "$PROJECTS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null || echo "")
      if [ -n "$PROJECT_ID" ]; then
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PREVIEW_PORT}/api/projects/${PROJECT_ID}/preview" 2>/dev/null || echo "000")
        if [ "$STATUS" = "200" ]; then
          pass "GET /api/projects/$PROJECT_ID/preview: $STATUS"
        else
          fail "GET /api/projects/$PROJECT_ID/preview: $STATUS"
        fi
      fi
    else
      fail "GET /api/projects returns empty or invalid JSON"
    fi

    kill "$PREVIEW_PID" 2>/dev/null || true
    wait "$PREVIEW_PID" 2>/dev/null || true
  else
    fail "preview server failed to start"
  fi
fi

# ── 7. Lint check on compositions ────────────────────────────────────────────

section "Lint compositions"

for example in "${EXAMPLES[@]}"; do
  PROJ_DIR="${TEST_DIR}/init-${example}"
  if [ -d "$PROJ_DIR" ]; then
    LINT_OUT=$(hyperframes lint "$PROJ_DIR" 2>&1) || true
    LINT_EXIT=$?
    if [ $LINT_EXIT -eq 0 ]; then
      pass "lint $example: clean"
    else
      # Lint warnings are ok, errors are not
      if echo "$LINT_OUT" | grep -qi "error"; then
        fail "lint $example: errors found"
        echo "$LINT_OUT" >> "$ISSUES_FILE"
      else
        warn "lint $example: warnings"
      fi
    fi
  fi
done

# ── 8. Info command ──────────────────────────────────────────────────────────

section "Info command"

for example in warm-grain kinetic-type; do
  PROJ_DIR="${TEST_DIR}/init-${example}"
  if [ -d "$PROJ_DIR" ]; then
    if hyperframes info "$PROJ_DIR" 2>&1 | tee -a "$LOG_FILE" | grep -qi "duration\|fps\|resolution"; then
      pass "info $example: shows metadata"
    else
      fail "info $example: missing metadata in output"
    fi
  fi
done

# ── 9. Parallel render (if supported) ───────────────────────────────────────

section "Parallel render"

PROJ_DIR="${TEST_DIR}/init-warm-grain"
OUTPUT="${TEST_DIR}/render-parallel.mp4"
if [ -d "$PROJ_DIR" ]; then
  log "  Rendering warm-grain with --workers 2..."
  if hyperframes render "$PROJ_DIR" --output "$OUTPUT" --workers 2 --quality draft --fps 24 2>&1 | tee -a "$LOG_FILE"; then
    if [ -f "$OUTPUT" ]; then
      SIZE=$(stat --printf="%s" "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT" 2>/dev/null || echo 0)
      if [ "$SIZE" -gt 1000 ]; then
        pass "parallel render (2 workers): ${SIZE} bytes"
      else
        fail "parallel render: output too small (${SIZE} bytes)"
      fi
    else
      fail "parallel render: output file missing"
    fi
  else
    fail "parallel render: command failed"
  fi
fi

# ── 10. PNG sequence render ─────────────────────────────────────────────────

section "PNG sequence render"

PROJ_DIR="${TEST_DIR}/init-warm-grain"
OUTPUT_DIR="${TEST_DIR}/render-png-seq"
if [ -d "$PROJ_DIR" ]; then
  if hyperframes render "$PROJ_DIR" --output "$OUTPUT_DIR" --format png-sequence --quality draft --fps 24 2>&1 | tee -a "$LOG_FILE"; then
    PNG_COUNT=$(find "$OUTPUT_DIR" -name '*.png' 2>/dev/null | wc -l)
    if [ "$PNG_COUNT" -gt 5 ]; then
      pass "png-sequence render: $PNG_COUNT frames"
    else
      fail "png-sequence render: only $PNG_COUNT frames"
    fi
  else
    fail "png-sequence render: command failed"
  fi
fi

# ── 11. Resolution variants ─────────────────────────────────────────────────

section "Resolution variants"

PROJ_DIR="${TEST_DIR}/init-warm-grain"
# Only test resolutions matching the composition's aspect ratio.
# warm-grain is landscape (1920x1080) — portrait would correctly fail.
for res in landscape landscape-4k; do
  OUTPUT="${TEST_DIR}/render-${res}.mp4"
  if [ -d "$PROJ_DIR" ]; then
    log "  Rendering warm-grain at $res resolution..."
    if hyperframes render "$PROJ_DIR" --output "$OUTPUT" --resolution "$res" --quality draft --fps 24 2>&1 | tee -a "$LOG_FILE"; then
      if [ -f "$OUTPUT" ]; then
        ACTUAL_RES=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUTPUT" 2>/dev/null || echo "unknown")
        pass "render resolution=$res: $ACTUAL_RES"
      else
        fail "render resolution=$res: output file missing"
      fi
    else
      fail "render resolution=$res: command failed"
    fi
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

section "Summary"
log "PASS: $PASS | FAIL: $FAIL | WARN: $WARN"
log "Test dir: $TEST_DIR"
log "Log: $LOG_FILE"
if [ -f "$ISSUES_FILE" ]; then
  log "Issues: $ISSUES_FILE"
  log ""
  log "Issues found:"
  cat "$ISSUES_FILE" | tee -a "$LOG_FILE"
fi

# Cleanup preview server if still running
if [ -n "$PREVIEW_PID" ] && kill -0 "$PREVIEW_PID" 2>/dev/null; then
  kill "$PREVIEW_PID" 2>/dev/null || true
fi

echo ""
echo "EXIT_CODE: $FAIL"
exit 0
