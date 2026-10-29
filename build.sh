#!/bin/sh
# Builds the standalone page (GitHub Pages) from src/app.html.
# src/app.html is the artifact-style source (no <html>/<head>); this wraps it in a full document
# and adds the installable-app parts (manifest, icons, service worker) that only work on a real URL.
set -e
cd "$(dirname "$0")"
SRC=src/app.html
OUT=docs/index.html
FONT_CSS=$(grep -o 'https://fonts.googleapis.com/css2[^"]*' "$SRC" | head -1)
{
  printf '<!doctype html>\n<html lang="bs" data-theme="light">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<meta name="color-scheme" content="light">\n<meta name="robots" content="noindex, nofollow">\n'
  printf '<meta name="theme-color" content="#1F3D35">\n<link rel="manifest" href="manifest.webmanifest">\n'
  printf '<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-180.png">\n'
  printf '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Terenska knjiga">\n'
  sed -n '1,/^<\/style>$/p' "$SRC" | grep -v 'claude:viewport-fit-sides'
  printf '</head>\n<body>\n'
  sed -n '/^<\/style>$/,$p' "$SRC" | tail -n +2
  printf "<script>if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));</script>\n"
  printf '</body>\n</html>\n'
} > "$OUT"
cp src/manifest.webmanifest docs/manifest.webmanifest
VERSION=$(shasum "$OUT" src/manifest.webmanifest | shasum | cut -c1-10)
FONT_ESC=$(printf '%s' "$FONT_CSS" | sed 's/[&#\\]/\\&/g')
sed -e "s/__VERSION__/$VERSION/" -e "s#__FONT_CSS__#$FONT_ESC#" src/sw.js > docs/sw.js
echo "built $OUT ($(wc -c < "$OUT") bytes), sw version $VERSION"
