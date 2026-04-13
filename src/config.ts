import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // URLs
    POLYMARKET_GAMMA_API: process.env.POLYMARKET_GAMMA_API || 'https://gamma-api.polymarket.com/markets?active=true&closed=false',
    POLYMARKET_CLOB_WS: process.env.POLYMARKET_CLOB_WS || 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    POLYGON_RPC_WSS: process.env.POLYGON_RPC_WSS || 'wss://polygon-mainnet.g.alchemy.com/v2/demo',

    // Operational Circuit Breakers
    MIN_USD_PER_TRADE: parseFloat(process.env.MIN_USD_PER_TRADE || '1000'),
    MAX_USD_PER_TRADE: parseFloat(process.env.MAX_USD_PER_TRADE || '500000'),
    DAILY_SIGNAL_LIMIT: parseInt(process.env.DAILY_SIGNAL_LIMIT || '3', 10),

    // Baseline Math (Welford)
    WELFORD_OUTLIER_PCT: parseFloat(process.env.WELFORD_OUTLIER_PCT || '0.05'),
    BURN_IN_HOURS: parseInt(process.env.BURN_IN_HOURS || '72', 10),
    BURN_IN_MIN_TRADES: parseInt(process.env.BURN_IN_MIN_TRADES || '1000', 10),
    Z_SCORE_TRIGGER: parseFloat(process.env.Z_SCORE_TRIGGER || '3.0'),

    // Behavioral Forensics (Phase 3B)
    BURNER_NONCE_LIMIT: parseInt(process.env.BURNER_NONCE_LIMIT || '5', 10),
    ESTABLISHED_NONCE_LIMIT: parseInt(process.env.ESTABLISHED_NONCE_LIMIT || '50', 10),
    FLOW_RATIO_TARGET: parseFloat(process.env.FLOW_RATIO_TARGET || '0.90'),
    FLOW_RATIO_LOOKBACK_BLOCKS: parseInt(process.env.FLOW_RATIO_LOOKBACK_BLOCKS || '7200', 10), // ~4 hours on Polygon
    DORMANCY_DAYS: parseInt(process.env.DORMANCY_DAYS || '30', 10),

    // Cluster Intelligence (Phase 4B)
    CLUSTER_WINDOW_MINUTES: parseInt(process.env.CLUSTER_WINDOW_MINUTES || '15', 10),
    CLUSTER_TRIGGER_COUNT: parseInt(process.env.CLUSTER_TRIGGER_COUNT || '3', 10),
    MARKET_COOLDOWN_HOURS: parseInt(process.env.MARKET_COOLDOWN_HOURS || '12', 10),
    EARLY_MARKET_BYPASS_USD: parseFloat(process.env.EARLY_MARKET_BYPASS_USD || '25000'),
    CLUSTER_DEBOUNCE_MULTIPLIER: parseFloat(process.env.CLUSTER_DEBOUNCE_MULTIPLIER || '1.25'),

    // Feature Flags / Keys
    POLYGONSCAN_API_KEY: process.env.POLYGONSCAN_API_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    TELEGRAM_THREAD_ID: process.env.TELEGRAM_THREAD_ID || '',

    // Heartbeat & Health Monitoring
    HEARTBEAT_INTERVAL_MINUTES: parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES || '30', 10),
    HEARTBEAT_ENABLED: process.env.HEARTBEAT_ENABLED !== 'false', // true by default
    REPORT_INTERVAL_HOURS: parseInt(process.env.REPORT_INTERVAL_HOURS || '6', 10),
    REPORT_ENABLED: process.env.REPORT_ENABLED !== 'false',

    // Enhanced Telegram Logging
    LOG_STREAM_EVENTS: process.env.LOG_STREAM_EVENTS === 'true', // Log WebSocket events
    LOG_CONTEXT_UPDATES: process.env.LOG_CONTEXT_UPDATES === 'true', // Log market context refreshes
    LOG_BASELINE_CALIBRATION: process.env.LOG_BASELINE_CALIBRATION === 'true', // Log market calibrations
    LOG_DB_FLUSHES: process.env.LOG_DB_FLUSHES === 'true', // Log database batch operations
    LOG_RPC_CALLS: process.env.LOG_RPC_CALLS === 'true', // Log blockchain RPC activity
    LOG_ALL_SIGNALS: process.env.LOG_ALL_SIGNALS === 'true', // Log all signals (not just confirmed)
    LOG_ERRORS_ONLY: process.env.LOG_ERRORS_ONLY === 'true', // Only log errors (overrides other flags)

    // Connection Health Thresholds
    WEBSOCKET_RECONNECT_ALERT: parseInt(process.env.WEBSOCKET_RECONNECT_ALERT || '3', 10), // Alert after N reconnection attempts
    API_FAILURE_ALERT_THRESHOLD: parseInt(process.env.API_FAILURE_ALERT_THRESHOLD || '3', 10), // Alert after N consecutive API failures
};
