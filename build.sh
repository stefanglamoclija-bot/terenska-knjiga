#!/bin/sh
# Builds the standalone page (GitHub Pages) from src/app.html.
# src/app.html is the artifact-style source (no <html>/<head>); this wraps it in a full document
# and adds the installable-app parts (manifest, icons, service worker) that only work on a real URL.
#
# Fonts: the app makes no network calls at runtime, so it does not load Google Fonts. To use the brand fonts offline,
# put woff2 files (SIL Open Font License) in docs/fonts/ named Family-Name-<weight>.woff2, e.g.
#   Barlow-Condensed-700.woff2  IBM-Plex-Sans-400.woff2  IBM-Plex-Mono-500.woff2
# and rebuild: @font-face rules are generated and the service worker precaches the files. Without them the system
# fonts in the CSS stacks are used.
#
# Security: a Content-Security-Policy is added that allows only the inline scripts of this build (by SHA-256 hash),
# so markup injected through a crafted backup or import file cannot run script.
set -e
cd "$(dirname "$0")"
SRC=src/app.html
OUT=docs/index.html

FONT_FACES=""
FONT_FILES=""
for f in docs/fonts/*.woff2; do
  [ -e "$f" ] || continue
  b=$(basename "$f" .woff2)
  w=${b##*-}
  fam=$(printf '%s' "${b%-*}" | tr '-' ' ')
  FONT_FACES="$FONT_FACES@font-face{font-family:\"$fam\";font-weight:$w;font-style:normal;font-display:swap;src:url(fonts/$b.woff2) format(\"woff2\")}"
  FONT_FILES="$FONT_FILES, './fonts/$b.woff2'"
done

{
  printf '<!doctype html>\n<html lang="bs" data-theme="light">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<meta name="color-scheme" content="light">\n<meta name="robots" content="noindex, nofollow">\n'
  printf '<meta name="theme-color" content="#1F3D35">\n<link rel="manifest" href="manifest.webmanifest">\n'
  printf '<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-180.png">\n'
  printf '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Terenska knjiga">\n'
  [ -n "$FONT_FACES" ] && printf '<style>%s</style>\n' "$FONT_FACES"
  sed -n '1,/^<\/style>$/p' "$SRC" | grep -v 'claude:viewport-fit-sides'
  printf '</head>\n<body>\n'
  sed -n '/^<\/style>$/,$p' "$SRC" | tail -n +2
  printf '</body>\n</html>\n'
} > "$OUT"

# CSP with the hash of every inline <script> of this build (needs node; without it the page is built without a CSP)
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs=require("fs"),c=require("crypto"),f=process.argv[1];let h=fs.readFileSync(f,"utf8");
    const hs=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>"'"'"'sha256-"+c.createHash("sha256").update(m[1],"utf8").digest("base64")+"'"'"'");
    const csp="default-src '"'"'self'"'"'; script-src "+hs.join(" ")+"; style-src '"'"'self'"'"' '"'"'unsafe-inline'"'"'; img-src '"'"'self'"'"' data: blob:; font-src '"'"'self'"'"'; connect-src '"'"'self'"'"'; worker-src '"'"'self'"'"'; manifest-src '"'"'self'"'"'; object-src '"'"'none'"'"'; base-uri '"'"'none'"'"'; form-action '"'"'none'"'"'";
    h=h.replace("<meta charset=\"utf-8\">\n","<meta charset=\"utf-8\">\n<meta http-equiv=\"Content-Security-Policy\" content=\""+csp+"\">\n");
    fs.writeFileSync(f,h);' "$OUT"
else
  echo "warning: node not found, docs/index.html built WITHOUT a Content-Security-Policy" >&2
fi

cp src/manifest.webmanifest docs/manifest.webmanifest
VERSION=$(shasum "$OUT" src/manifest.webmanifest src/sw.js | shasum | cut -c1-10)
FF_ESC=$(printf '%s' "$FONT_FILES" | sed 's/[&#\\]/\\&/g')
sed -e "s/__VERSION__/$VERSION/" -e "s#__FONT_FILES__#$FF_ESC#" src/sw.js > docs/sw.js
echo "built $OUT ($(wc -c < "$OUT") bytes), sw version $VERSION"
