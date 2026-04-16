#!/usr/bin/env bash
# FC Dashboard — one-command installer
set -euo pipefail

BOLD='\033[1m'; RESET='\033[0m'
ORANGE='\033[38;5;214m'; GREEN='\033[38;5;82m'; RED='\033[38;5;196m'; DIM='\033[2m'

ok()   { echo -e "  ${GREEN}✔${RESET}  $1"; }
fail() { echo -e "  ${RED}✘${RESET}  $1"; exit 1; }
info() { echo -e "  ${ORANGE}◆${RESET}  ${DIM}$1${RESET}"; }

echo ""
echo -e "  ${ORANGE}${BOLD}◆ FC Dashboard — Install${RESET}"
echo -e "  ${DIM}─────────────────────────────${RESET}"
echo ""

# Check Node.js
NODE_VER=$(node --version 2>/dev/null | tr -d 'v' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 18 ]; then
  fail "Node.js 18+ required. Install: https://nodejs.org"
fi
ok "Node.js v$(node --version | tr -d 'v') detected"

# Install dir
INSTALL_DIR="$HOME/.local/share/fc-dashboard"
mkdir -p "$INSTALL_DIR/public"
mkdir -p "$HOME/.local/bin"

# Copy files
cp server.js "$INSTALL_DIR/server.js"
cp public/index.html "$INSTALL_DIR/public/index.html"
ok "Files installed to $INSTALL_DIR"

# Write launcher
cat > "$HOME/.local/bin/dashboard" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

PORT=19999
SERVER="$HOME/.local/share/fc-dashboard/server.js"
URL="http://localhost:$PORT"

echo -e "\n  \033[1m\033[38;5;214m◆ FC Dashboard\033[0m\n"

if curl -fsS "$URL" >/dev/null 2>&1; then
  echo -e "  \033[32m✔\033[0m  Already running"
  open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true
  exit 0
fi

echo -e "  \033[38;5;214m◆\033[0m  Starting server..."
nohup node "$SERVER" > /tmp/fc-dashboard.log 2>&1 &

for i in $(seq 1 30); do
  curl -fsS "$URL" >/dev/null 2>&1 && break
  sleep 0.3
done

echo -e "  \033[32m✔\033[0m  Ready → \033[36m$URL\033[0m\n"
open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || echo "  Open: $URL"
LAUNCHER
chmod +x "$HOME/.local/bin/dashboard"
ok "Command 'dashboard' installed"

# Add to PATH hint
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
  echo ""
  info "Add to your shell config (~/.zshrc or ~/.bashrc):"
  echo -e "       \033[36mexport PATH=\"\$HOME/.local/bin:\$PATH\"\033[0m"
fi

echo ""
echo -e "  ${GREEN}${BOLD}Done!${RESET} Run: ${ORANGE}dashboard${RESET}"
echo ""
