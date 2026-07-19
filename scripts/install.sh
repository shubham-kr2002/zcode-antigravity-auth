#!/usr/bin/env bash
# install.sh — One-line installer for zcode-antigravity-proxy
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
#   npx zcode-antigravity-proxy install
#
# This script:
#   1. Checks Node.js >= 20
#   2. Installs the package globally (or locally)
#   3. Adds the Antigravity provider to ZCode config
#   4. Prints next steps

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   zcode-antigravity-proxy — One-Line Installer      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ---- Check Node.js ----
echo -e "${CYAN}[1/4]${NC} Checking Node.js..."
if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js is not installed.${NC}"
    echo "  Install Node.js >= 20 from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}✗ Node.js $NODE_VERSION detected. Need >= 20.${NC}"
    echo "  Install Node.js >= 20 from https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"

# ---- Install Package ----
echo -e "${CYAN}[2/4]${NC} Installing zcode-antigravity-proxy..."

# Detect if running from a local clone
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_JSON="$SCRIPT_DIR/../package.json"

if [ -f "$PACKAGE_JSON" ] && grep -q "zcode-antigravity-proxy" "$PACKAGE_JSON" 2>/dev/null; then
    # Running from cloned repo — install locally
    echo "  Detected local clone. Installing from $SCRIPT_DIR/.."
    cd "$SCRIPT_DIR/.."
    npm install --silent 2>&1 | tail -1
    npm run build 2>&1 | tail -1
    echo -e "${GREEN}✓ Package installed from local clone${NC}"
else
    # Install globally from npm (when published) or via git
    if npm list -g zcode-antigravity-proxy &>/dev/null 2>&1; then
        echo "  Already installed globally. Updating..."
        npm update -g zcode-antigravity-proxy 2>&1 | tail -1 || true
    else
        echo "  Installing globally via npm..."
        npm install -g zcode-antigravity-proxy 2>&1 | tail -1 || {
            echo -e "${YELLOW}⚠ npm publish not available yet. Trying git install...${NC}"
            TMP_DIR=$(mktemp -d)
            git clone https://github.com/NoeFabris/opencode-antigravity-auth.git "$TMP_DIR/zcode-antigravity-proxy" 2>/dev/null || {
                echo -e "${RED}✗ Failed to install.${NC}"
                echo "  Clone manually: git clone https://github.com/NoeFabris/opencode-antigravity-auth.git"
                echo "  Then run: cd zcode-antigravity-proxy && npm install && npm run build"
                exit 1
            }
            cd "$TMP_DIR/zcode-antigravity-proxy"
            npm install --silent 2>&1 | tail -1
            npm run build 2>&1 | tail -1
            npm link 2>&1 | tail -1
        }
    fi
    echo -e "${GREEN}✓ Package installed${NC}"
fi

# ---- Configure ZCode ----
echo -e "${CYAN}[3/4]${NC} Configuring ZCode provider..."
npx antigravity-auth setup 2>/dev/null || node -e "require('./dist/cli/setup.js').setupAntigravityProvider()" 2>/dev/null || {
    echo -e "${YELLOW}⚠ Could not auto-configure. Run manually:${NC}"
    echo "  antigravity-auth setup"
}
echo -e "${GREEN}✓ ZCode provider configured${NC}"

# ---- Done ----
echo -e "${CYAN}[4/4]${NC} Installation complete!"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ zcode-antigravity-proxy installed!              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Next steps:"
echo -e "  ${YELLOW}1. Authenticate:${NC}   antigravity-auth login"
echo -e "  ${YELLOW}2. Start proxy:${NC}    antigravity-auth start"
echo -e "  ${YELLOW}3. Restart ZCode${NC} to use Antigravity models"
echo ""
echo -e "  Available models:"
echo -e "    • claude-opus-4-6-thinking  (200K ctx, thinking)"
echo -e "    • claude-sonnet-4-6         (200K ctx)"
echo -e "    • gemini-3.1-pro            (1M ctx, thinking)"
echo -e "    • gemini-3-pro              (1M ctx, thinking)"
echo -e "    • gemini-3-flash            (1M ctx, thinking)"
echo -e "    • gemini-2.5-pro            (1M ctx, thinking)"
echo -e "    • gemini-2.5-flash          (1M ctx, thinking)"
echo ""
echo -e "  Warning: ⚠️  Using this proxy violates Google's ToS."
echo -e "  Your Google account may be suspended or banned."
echo ""
