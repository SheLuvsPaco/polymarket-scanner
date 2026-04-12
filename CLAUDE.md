# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Polymarket Insider Trading Detection System** - a real-time surveillance engine that monitors prediction market trading activity for potential insider signals using statistical anomaly detection (Welford's algorithm) and behavioral forensics (blockchain analysis).

## Development Commands

```bash
# Run the main application
tsx src/index.ts

# Build TypeScript (not typically needed - uses tsx for direct execution)
tsc

# Check TypeScript for errors
tsc --noEmit
```

## Architecture

The system uses a **dual-stream architecture**:

### Stream A (REST Context Poller)
- **File**: [src/streams/streamA.ts](src/streams/streamA.ts)
- Polls Polymarket Gamma API every 60 seconds
- Maintains `ContextMap`: an in-memory registry of active markets and liquidity
- Triggers Stream B to update WebSocket subscriptions when context changes

### Stream B (WebSocket Firehose)
- **File**: [src/streams/streamB.ts](src/streams/streamB.ts)
- Connects to Polymarket CLOB WebSocket for real-time trade events
- Implements 250ms batch flushing for efficient database inserts
- Uses exponential backoff for reconnection resilience
- Maintains orderbook state per asset (bids/asks)

### Statistical Baseline Engine (Welford)
- **File**: [src/providers/WelfordProvider.ts](src/providers/WelfordProvider.ts)
- Implements Welford's online algorithm for O(1) mean/variance calculation
- Tracks per-market baselines loaded from PostgreSQL at startup
- **Burn-in calibration**: Markets require 72+ hours AND 1000+ trades before baseline is stable
- **Outlier exclusion**: Trades consuming >5% of CLOB liquidity are excluded from baseline math

### Behavioral Forensics Pipeline
- **File**: [src/services/ProxyTraceService.ts](src/services/ProxyTraceService.ts)
- Trades with Z-scores > 3.0 trigger blockchain forensics
- **0-Hop Trace**: Resolves proxy address → funding EOA via USDC transfer events
- **Signal Hierarchy** (strongest to weakest):
  - `CONFIRMED_INSIDER`: Burner wallet (nonce < 5) + Just-in-Time funding (Flow Ratio > 90%)
  - `DORMANT_STRIKE`: Dormant wallet (>30 days silence) + Just-in-Time funding
  - `RETAIL_WHALE`: Established wallet or inconclusive behavior
- **Rate Limit Protection**: Global RPC cooldown on 429 errors

### Notification Service
- **File**: [src/services/NotificationService.ts](src/services/NotificationService.ts)
- **Cluster Detection**: 3+ anomalous trades within 15 minutes on same market trigger cluster alert
- **Market Cooldown**: 12-hour cooldown per market after alert
- **Daily Throttle**: Database-enforced limit (default: 3 signals/day)
- Sends formatted alerts to Telegram with trade details, z-scores, and forensic paths

### Database Schema
- **File**: [src/db/index.ts](src/db/index.ts)
- PostgreSQL with connection pooling (max: 20)
- Key tables:
  - `trades`: Raw trade data with computed fields (z_score, signal_type, funding_chain)
  - `market_baselines`: Welford state per market (count, mean, m2, is_calibrated)
  - `signal_throttle`: Daily signal count for rate limiting
  - `webhook_logs`: Alert delivery tracking

## Configuration

All configuration is environment-based via [src/config.ts](src/config.ts). Required environment variables:

```bash
# Database
DATABASE_URL=postgresql://...

# API Endpoints
POLYMARKET_GAMMA_API=https://gamma-api.polymarket.com/markets?active=true&closed=false
POLYMARKET_CLOB_WS=wss://ws-subscriptions-clob.polymarket.com/ws/market
POLYGON_RPC_WSS=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

# Circuit Breakers
MIN_USD_PER_TRADE=1000
MAX_USD_PER_TRADE=500000
DAILY_SIGNAL_LIMIT=3

# Welford Baseline Parameters
WELFORD_OUTLIER_PCT=0.05
BURN_IN_HOURS=72
BURN_IN_MIN_TRADES=1000
Z_SCORE_TRIGGER=3.0

# Behavioral Forensics
BURNER_NONCE_LIMIT=5
ESTABLISHED_NONCE_LIMIT=50
FLOW_RATIO_TARGET=0.90
FLOW_RATIO_LOOKBACK_BLOCKS=7200
DORMANCY_DAYS=30

# Cluster Detection
CLUSTER_WINDOW_MINUTES=15
CLUSTER_TRIGGER_COUNT=3
MARKET_COOLDOWN_HOURS=12
EARLY_MARKET_BYPASS_USD=25000
CLUSTER_DEBOUNCE_MULTIPLIER=1.25

# External APIs
POLYGONSCAN_API_KEY=your_key_here
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_THREAD_ID=optional_thread_id

# Proxy Support (optional)
HTTPS_PROXY=socks5://127.0.0.1:1080
```

## Important Design Constraints

1. **Forward-Only Processing**: Failed batch inserts are NOT retried (data drops). This is intentional to avoid blocking the event loop.

2. **Mutex Pattern**: Only one blockchain trace per proxy address at a time. Duplicate signals from same proxy within 60 seconds are skipped.

3. **First-Trade Lock**: Welford baseline's `first_trade_at` is immutable once set. Prevents backfilling attacks.

4. **Proxy Support**: All external HTTP/WebSocket requests respect `HTTPS_PROXY`/`HTTP_PROXY` environment variables (uses `socks-proxy-agent`).

5. **TypeScript Module System**: Uses `"module": "NodeNext"` with `.js` extensions in imports. Always add `.js` when importing local modules.

## Key Types

See [src/types.ts](src/types.ts):
- `GammaMarket`: Market data from REST API
- `MarketContext`: In-memory market state
- `PolyTradeEvent`: Raw WebSocket trade message
- `ParsedTrade`: Normalized trade representation with all computed fields
- `WelfordState`: Per-market baseline statistics
