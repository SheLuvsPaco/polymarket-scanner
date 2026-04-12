// --- Stream A (REST Context) Types ---
export interface GammaMarket {
    id: string;
    liquidity: string; // The API usually returns string values for numbers, will convert to float
    active: boolean;
    closed: boolean;
    [key: string]: any; // Catch-all for other fields we don't strictly need
}

export interface MarketContext {
    market_id: string;
    liquidity: number;
    slug: string; // Used for Polymarket deep-links
    is_active: boolean;
    tokens?: {
        outcome: string;
        token_id: string;
    }[];
}

// --- Stream B (WebSocket) Types ---
export interface PolyWebSocketMessage {
    event: string;
    data: any[];
}

export interface PolyTradeEvent {
    event: string;
    condition_id: string;
    market: string; // This is the market_id
    asset_id: string;
    side: "BUY" | "SELL";
    price: string;
    size: string;
    timestamp: number;
    maker_address: string;
    taker_address: string;
    transaction_hash: string;
    id: string; // This is the trade_id
}

// Internal standardized trade representation before insertion
export interface ParsedTrade {
    trade_id: string;
    market_id: string;
    side: "BUY" | "SELL" | null;
    price: number;
    size: number;
    value: number;
    timestamp: Date;
    maker_address: string;
    taker_address: string;
    clob_consumption_pct?: number;
    implied_probability_entry?: number;
    z_score?: number;
    signal_type?: "POTENTIAL_SIGNAL" | "CONFIRMED_INSIDER" | "DORMANT_STRIKE" | "RETAIL_WHALE" | null;
    funding_source?: string;
    market_slug?: string;
    timestamp_ws_receive?: number;

    // Phase 3B Behavioral Forensics columns
    funder_nonce?: number;
    funder_age_days?: number;
    flow_ratio?: number;
    is_dormant_wake_up?: boolean;

    // Phase 4B Metadata
    is_calibrated?: boolean;
    market_age_hours?: number;

    // Phase 4C Trace Transparency
    funding_chain?: { address: string, amount: number, label: string }[];
}
