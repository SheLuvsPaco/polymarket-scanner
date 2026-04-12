#!/bin/bash

echo "============================================"
echo "Polymarket Scanner Setup Verification"
echo "============================================"
echo ""

# Check Node.js version
echo "🔍 Checking Node.js version..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js installed: $NODE_VERSION"
    if [[ $(echo "$NODE_VERSION" | cut -d. -f1 | sed 's/v//') -lt 20 ]]; then
        echo "⚠️  Warning: Node.js 20+ recommended"
    fi
else
    echo "❌ Node.js not found. Please install Node.js 20+"
    exit 1
fi
echo ""

# Check PostgreSQL
echo "🔍 Checking PostgreSQL..."
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL client installed"
else
    echo "⚠️  PostgreSQL client not found (may be using Docker)"
fi
echo ""

# Check .env file
echo "🔍 Checking environment configuration..."
if [ -f .env ]; then
    echo "✅ .env file exists"

    # Check required variables
    MISSING_VARS=()

    # Source .env to check variables
    set -a
    source .env
    set +a

    [ -z "$DATABASE_URL" ] && MISSING_VARS+=("DATABASE_URL")
    [ -z "$TELEGRAM_BOT_TOKEN" ] && MISSING_VARS+=("TELEGRAM_BOT_TOKEN")
    [ -z "$TELEGRAM_CHAT_ID" ] && MISSING_VARS+=("TELEGRAM_CHAT_ID")
    [ -z "$POLYGON_RPC_WSS" ] && MISSING_VARS+=("POLYGON_RPC_WSS")

    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
        echo "⚠️  Missing required variables: ${MISSING_VARS[*]}"
        echo ""
        echo "Please add these to your .env file:"
        for var in "${MISSING_VARS[@]}"; do
            echo "   - $var"
        done
    else
        echo "✅ All required variables set"
    fi
else
    echo "❌ .env file not found. Please copy .env.example to .env and configure it."
    echo ""
    echo "Run: cp .env.example .env"
    exit 1
fi
echo ""

# Check proxy configuration (important for geobypass)
echo "🔍 Checking proxy configuration..."
if [ -n "$HTTPS_PROXY" ] || [ -n "$HTTP_PROXY" ]; then
    echo "✅ Proxy configured:"
    echo "   HTTPS_PROXY=$HTTPS_PROXY"
    echo "   HTTP_PROXY=$HTTP_PROXY"

    # Test proxy connection
    if command -v curl &> /dev/null; then
        echo ""
        echo "🧪 Testing proxy connection..."
        if curl -s --max-time 10 --proxy "$HTTPS_PROXY" https://www.google.com > /dev/null 2>&1; then
            echo "✅ Proxy connection successful"
        else
            echo "❌ Proxy connection failed. Please check your proxy is running."
        fi
    fi
else
    echo "⚠️  No proxy configured. This may cause issues if Polymarket is blocked in your region."
    echo "   Add to .env: HTTPS_PROXY=socks5://127.0.0.1:1080"
fi
echo ""

# Check dependencies
echo "🔍 Checking dependencies..."
if [ -d node_modules ]; then
    echo "✅ Dependencies installed (node_modules exists)"
else
    echo "❌ Dependencies not found. Run: npm install"
    exit 1
fi
echo ""

# Test Polymarket API access (with or without proxy)
echo "🧪 Testing Polymarket API access..."
if command -v curl &> /dev/null; then
    API_ENDPOINT="${POLYMARKET_GAMMA_API:-https://gamma-api.polymarket.com/markets?active=true&closed=false}"

    if [ -n "$HTTPS_PROXY" ]; then
        CURL_CMD="curl -s --max-time 10 --proxy '$HTTPS_PROXY' '$API_ENDPOINT'"
    else
        CURL_CMD="curl -s --max-time 10 '$API_ENDPOINT'"
    fi

    if eval $CURL_CMD > /dev/null 2>&1; then
        echo "✅ Polymarket API accessible"
    else
        echo "❌ Cannot reach Polymarket API. Check:"
        echo "   - Your proxy configuration"
        echo "   - Polymarket availability in your region"
        echo "   - Network connectivity"
    fi
else
    echo "⚠️  curl not found. Skipping API test."
fi
echo ""

echo "============================================"
echo "✅ Setup verification complete!"
echo "============================================"
echo ""
echo "To start the scanner, run:"
echo "  npm start"
echo ""
echo "Or with Docker:"
echo "  docker-compose up -d"
echo ""
echo "For logs:"
echo "  docker-compose logs -f app"
