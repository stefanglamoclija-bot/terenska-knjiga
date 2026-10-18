#!/bin/sh
# Builds the standalone page (GitHub Pages) from src/app.html.
# src/app.html is the artifact-style source (no <html>/<head>); this wraps it in a full document.
set -e
cd "$(dirname "$0")"
SRC=src/app.html
OUT=docs/index.html
{
  printf '<!doctype html>\n<html lang="bs" data-theme="light">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<meta name="color-scheme" content="light">\n<meta name="robots" content="noindex, nofollow">\n'
  sed -n '1,/^<\/style>$/p' "$SRC" | grep -v 'claude:viewport-fit-sides'
  printf '</head>\n<body>\n'
  sed -n '/^<\/style>$/,$p' "$SRC" | tail -n +2
  printf '</body>\n</html>\n'
} > "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
