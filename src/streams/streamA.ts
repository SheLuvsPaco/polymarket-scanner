import type { GammaMarket, MarketContext } from '../types.js';
import { config } from '../config.js';
import { NotificationService } from '../services/NotificationService.js';

// The global in-memory Market Context map.
// Stores active markets and liquidity.
// Keys = market_id
export const ContextMap = new Map<string, MarketContext>();

// 60-second polling interval ID
let pollerInterval: NodeJS.Timeout | null = null;

// Triggered after context map successfully updates
type OnContextUpdatedCallback = () => void;
let onUpdateCallback: OnContextUpdatedCallback | null = null;

export const setOnContextUpdated = (callback: OnContextUpdatedCallback) => {
    onUpdateCallback = callback;
}

const fetchMarkets = async () => {
    try {
        // Fetch from Gamma API. Note: Polygon API handles millions of markets, 
        // we might need to paginate or only fetch active specifically if their API is huge.
        // For Phase 1, we hit the generic endpoint and filter.
        // Let's assume hitting the active markets URL. 
        console.log(`[Stream A] Fetching market context from Gamma API at ${new Date().toISOString()}`);

        // Polymarket Gamma API - paginated fetch for broader coverage
        const PAGE_SIZE = 25;
        const TOTAL_PAGES = 8;
        let data: GammaMarket[] = [];
        for (let page = 0; page < TOTAL_PAGES; page++) {
            const url = `${config.POLYMARKET_GAMMA_API}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`[Stream A] Gamma API page ${page} returned ${response.status}, skipping.`);
                continue;
            }
            const pageData = (await response.json()) as GammaMarket[];
            if (pageData.length === 0) break;
            data.push(...pageData);
        }

        let newCount = 0;

        // Clear the old context to garbage collect closed/resolved "Ghost Markets"
        ContextMap.clear();

        // Populate the Shared Context Map
         for (const market of data) {
            if (market.active && !market.closed) {
                const liquidity = parseFloat(market.liquidity || "0");
                const tokenIds = typeof market.clobTokenIds === 'string' 
                    ? JSON.parse(market.clobTokenIds) 
                    : (market.clobTokenIds || []);
                ContextMap.set(market.conditionId, {
                    market_id: market.conditionId,
                    liquidity: liquidity,
                    slug: market.slug || market.conditionId,
                    is_active: true,
                    tokens: tokenIds.map((tid: string) => ({
                        outcome: '',
                        token_id: tid
                    }))
                });
                newCount++;
            }
        }

        console.log(`[Stream A] Context initialized. Tracking ${newCount} active markets.`);

        // Log context update to Telegram
        // NotificationService.logContextUpdate(newCount).catch(console.error);

        // Trigger Stream B WebSocket dynamic update if needed.
        if (onUpdateCallback) {
            onUpdateCallback();
        }

    } catch (error) {
        console.error('[Stream A] Failed to fetch context map:', error);
    }
};

export const startStreamA = () => {
    console.log('[Stream A] Starting 60s Context Poller loop.');
    // Immediate first fetch
    fetchMarkets();

    // Strict 60-second Interval
    pollerInterval = setInterval(fetchMarkets, 60000);
};

export const stopStreamA = () => {
    if (pollerInterval) {
        clearInterval(pollerInterval);
        pollerInterval = null;
        console.log('[Stream A] Context Poller stopped.');
    }
};
