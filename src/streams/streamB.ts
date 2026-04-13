import WebSocket from 'ws';
import pool from '../db/index.js';
import { ContextMap } from './streamA.js';
import { welford } from '../providers/WelfordProvider.js';
import { ProxyTraceService } from '../services/ProxyTraceService.js';
import { NotificationService } from '../services/NotificationService.js';
import type { PolyWebSocketMessage, ParsedTrade } from '../types.js';
import { config } from '../config.js';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';

let ws: WebSocket | null = null;
let pingInterval: NodeJS.Timeout | null = null;
let killSwitchTimeout: NodeJS.Timeout | null = null;
let batchInterval: NodeJS.Timeout | null = null;

// The Array Buffer
let tradeBuffer: ParsedTrade[] = [];
// Orderbook state map
const orderbooks = new Map<string, { bids: Map<string, number>, asks: Map<string, number> }>();

// Exponential Backoff params
let reconnectAttempt = 0;
const MAX_BACKOFF_MS = 15000;

export const startStreamB = () => {
    connectWebSocket();

    // Start the 250ms batch flusher
    if (!batchInterval) {
        batchInterval = setInterval(flushBuffer, 250);
    }
};

const connectWebSocket = () => {
    console.log('[Stream B] Connecting to Polymarket CLOB WebSocket...');
    
    // Add Proxy Agent Support (Phase 2 Fix)
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const wsOptions = proxyUrl ? { agent: new SocksProxyAgent(proxyUrl) } : {};
    
    ws = new WebSocket(config.POLYMARKET_CLOB_WS, wsOptions);

    ws.on('open', () => {
        console.log('[Stream B] WebSocket connection established.');
        reconnectAttempt = 0; // Reset backoff on success

        // Log connection event to Telegram
        NotificationService.logConnectionEvent('connected').catch(console.error);

        // Subscribe to trade events.
        // In Phase 1 docs, it says Stream A triggers Stream B to update subscription.
        // For now, we will subscribe to a generic wildcard if available, or we might need 
        // to build a dynamic list based on ContextMap. 
        // Polymarket allows subscribing to multiple assets. Since we want to capture everything
        // liquid, we might subscribe to '*' or specific markets. 
        // If wildcard isn't supported, we will send subscription payloads based on ContextMap keys.
        // Let's assume a generic topic for all trades or send an explicit list.
        // The Phase 1 document implies dynamic updates. We'll handle that via `updateSubscriptions`.

        setupPingPong();
        updateSubscriptions();
    });

    ws.on('message', (data: WebSocket.RawData) => {
        const wsReceiveTime = Date.now();
        try {
            const raw = data.toString();

            // Guard against plain-text server messages like "INVALID OPERATION"
            if (!raw.startsWith('{') && !raw.startsWith('[')) {
                console.warn('[Stream B] Non-JSON server message:', raw);
                return;
            }

            // Fast JSON parse
            const msg: PolyWebSocketMessage = JSON.parse(raw);

            // Fix 3: Handle Orderbook State Correctly
            if (msg.event === 'book' || msg.event === 'price_change') {
                {
                    for (const item of msg.data) {
                        const assetId = item.asset_id;
                        if (!assetId) continue;

                        if (!orderbooks.has(assetId)) {
                            orderbooks.set(assetId, { bids: new Map(), asks: new Map() });
                        }
                        const ob = orderbooks.get(assetId)!;

                        if (msg.event === 'book') {
                            ob.bids.clear();
                            ob.asks.clear();
                        }

                        if (Array.isArray(item.bids)) {
                            for (const b of item.bids) {
                                const size = parseFloat(b.size || "0");
                                if (size === 0) ob.bids.delete(b.price);
                                else ob.bids.set(b.price, size);
                            }
                        }

                        if (Array.isArray(item.asks)) {
                            for (const a of item.asks) {
                                const size = parseFloat(a.size || "0");
                                if (size === 0) ob.asks.delete(a.price);
                                else ob.asks.set(a.price, size);
                            }
                        }
                    }
                }
                return; 
            }

            // Handle last_trade_price events (individual trade messages)
            if (msg.event_type !== 'last_trade_price') {
                return;
            }

            // The Bouncer: Single trade processing
            {
                const tradeDataArr = [msg];
                for (let i = 0; i < tradeDataArr.length; i++) {
                    const tradeData = tradeDataArr[i];
                    if (!tradeData) continue;

                    // Step 1: Size Validation
                    const size = parseFloat(tradeData.size || "0");
                    const price = parseFloat(tradeData.price || "0");
                    const value = size * price;

                    if (value < config.MIN_USD_PER_TRADE || value > config.MAX_USD_PER_TRADE) {
                        continue;
                    }

                    // Step 2: Liquidity Validation
                    const marketId = tradeData.market;
                    const context = ContextMap.get(marketId);

                    if (!context || !context.is_active || context.liquidity < 10000) {
                        continue; // Market unknown, closed, or dead liquidity, drop perfectly
                    }

                    // Phase 2: Feature Engineering
                    const clob_consumption_pct = context.liquidity > 0 ? value / context.liquidity : 0;
                    if (isNaN(clob_consumption_pct)) continue;
                    const implied_probability_entry = price;

                    // Step 3: Buffer array
                    const parsed: ParsedTrade = {
                        trade_id: tradeData.transaction_hash || tradeData.id,
                        market_id: marketId,
                        side: tradeData.side as "BUY" | "SELL" | null,
                        price: price,
                        size: size,
                        value: value,
                        timestamp: new Date(parseInt(tradeData.timestamp)),
                        maker_address: tradeData.maker_address || null,
                        taker_address: tradeData.taker_address || null,
                        clob_consumption_pct: clob_consumption_pct,
                        implied_probability_entry: implied_probability_entry,
                        market_slug: context.slug,
                        timestamp_ws_receive: wsReceiveTime
                    };

                    tradeBuffer.push(parsed);

                    // Phase 2: Feed the mathematical engine
                    welford.addTrade(marketId, value, clob_consumption_pct);

                    // Phase 3: The Z-Score Trigger (Anomaly Detection)
                    const welfordState = welford.getRawState(marketId);
                    let zScore: number | null = null;
                    let signalType: "POTENTIAL_SIGNAL" | "RETAIL_WHALE" | null = null;

                    if (welfordState && welfordState.count > 1) {
                        const variance = welfordState.m2 / (welfordState.count - 1);
                        const stdDev = Math.sqrt(variance);

                        if (stdDev > 0) {
                            zScore = (clob_consumption_pct - welfordState.mean) / stdDev;

                            // Phase 3 Signal Gate (Now allows uncalibrated passes for Phase 4B Bypasses)
                            if (zScore > config.Z_SCORE_TRIGGER) {
                                signalType = "POTENTIAL_SIGNAL";
                            }
                        }
                    }

                    // Append phase 3 parameters to buffer before flush
                    if (zScore !== null) {
                        parsed.z_score = zScore;
                    }
                    if (signalType !== null) {
                        parsed.signal_type = signalType;
                    }

                    // Phase 4B: Pass calibration and age to trace engine
                    if (welfordState) {
                        parsed.is_calibrated = welfordState.is_calibrated;
                        if (welfordState.first_trade_at) {
                            const ageMs = Date.now() - welfordState.first_trade_at.getTime();
                            parsed.market_age_hours = Math.floor(ageMs / (1000 * 60 * 60));
                        }
                    }

                    // Phase 3 Blockchain Trace Routing
                    if (signalType === "POTENTIAL_SIGNAL") {
                        // Fire-and-forget automated blockchain verification.
                        // The service mutates 'parsed' BY-REFERENCE prior to the 250ms batch flush.
                        ProxyTraceService.evaluate(parsed).catch(console.error);
                    }
                }

            }
        } catch (error) {
            console.error('[Stream B] Message parse error:', error);
        }
    });

    ws.on('pong', () => {
        // Clear kill switch when pong received
        if (killSwitchTimeout) {
            clearTimeout(killSwitchTimeout);
            killSwitchTimeout = null;
        }
    });

    ws.on('close', () => {
        console.log('[Stream B] WebSocket closed.');

        // Log disconnection event to Telegram
        NotificationService.logConnectionEvent('disconnected').catch(console.error);

        handleReconnect();
    });

    ws.on('error', (err) => {
        console.error('[Stream B] WebSocket error:', err);
        // Let the close event handle reconnects to avoid duplicate attempts
    });
};

// -- BATCH INSERTER --
const flushBuffer = async () => {
    // Keep a local reference and instantly clear the global to not block event loop.
    if (tradeBuffer.length === 0) return;

    const bufferToFlush = tradeBuffer;
    tradeBuffer = [];

    const startTime = Date.now();

    try {
        // Parameterized Batch Insert logic
        // We use $1, $2 arrays to do a fast insert
        const values = [];
        const placeholders = [];
        let index = 1;

        for (const t of bufferToFlush) {
            values.push(
                t.trade_id, t.market_id, t.side, t.price, t.size,
                t.value, t.timestamp, t.maker_address, t.taker_address,
                t.clob_consumption_pct || null, t.implied_probability_entry || null,
                t.z_score || null, t.signal_type || null, t.funding_source || null,
                t.funder_nonce ?? null, t.funder_age_days ?? null, t.flow_ratio ?? null, t.is_dormant_wake_up ?? false,
                t.funding_chain ? JSON.stringify(t.funding_chain) : null
            );
            placeholders.push(`($${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++}, $${index++})`);
        }

        const query = `
            INSERT INTO trades 
            (trade_id, market_id, side, price, size, value, timestamp, maker_address, taker_address, clob_consumption_pct, implied_probability_entry, z_score, signal_type, funding_source, funder_nonce, funder_age_days, flow_ratio, is_dormant_wake_up, funding_chain) 
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (trade_id) DO NOTHING;
        `;

        await pool.query(query, values);

        // Phase 2: Welford UPSERT (The First-Trade Lock enforced here)
        const dirtyStates = welford.getDirtyStates();
        if (dirtyStates.length > 0) {
            const wValues = [];
            const wPlaceholders = [];
            let wIndex = 1;

            for (const s of dirtyStates) {
                wValues.push(
                    s.market_id, s.count, s.mean, s.m2, s.is_calibrated, s.first_trade_at
                );
                wPlaceholders.push(`($${wIndex++}, $${wIndex++}, $${wIndex++}, $${wIndex++}, $${wIndex++}, $${wIndex++})`);
            }

            const wQuery = `
                INSERT INTO market_baselines 
                (market_id, count, mean, m2, is_calibrated, first_trade_at) 
                VALUES ${wPlaceholders.join(', ')}
                ON CONFLICT (market_id) DO UPDATE SET 
                    count = EXCLUDED.count,
                    mean = EXCLUDED.mean,
                    m2 = EXCLUDED.m2,
                    is_calibrated = EXCLUDED.is_calibrated,
                    first_trade_at = COALESCE(market_baselines.first_trade_at, EXCLUDED.first_trade_at),
                    last_updated_at = NOW();
            `;

            await pool.query(wQuery, wValues);
            const duration = Date.now() - startTime;
            console.log(`[Stream B] Batch inserted ${bufferToFlush.length} trades | UPSERTED ${dirtyStates.length} baselines.`);

            // Log to Telegram if enabled
            await NotificationService.logDatabaseFlush(bufferToFlush.length, dirtyStates.length, duration);

            // Check for newly calibrated markets and log them
            for (const state of dirtyStates) {
                if (state.is_calibrated && state.first_trade_at) {
                    const hoursActive = (Date.now() - new Date(state.first_trade_at).getTime()) / (1000 * 60 * 60);
                    await NotificationService.logMarketCalibration(state.market_id, state.count, hoursActive);
                }
            }
        } else {
            console.log(`[Stream B] Flushed ${bufferToFlush.length} trades. (0 dirty baselines)`);
        }

    } catch (error) {
        console.error('[Stream B] Batch flush failed:', error);
        await NotificationService.logError('StreamB', `Batch flush failed: ${error}`, 'error');
        // We do NOT put them back into the buffer. Forward-only processing edge rule. Drops the data.
    }
};

// -- TCP KEEPALIVE & KILL SWITCH --
const setupPingPong = () => {
    if (pingInterval) clearInterval(pingInterval);
    if (killSwitchTimeout) clearTimeout(killSwitchTimeout);

    pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.ping();
            // Expect a pong within 5000ms
            killSwitchTimeout = setTimeout(() => {
                console.warn('[Stream B] Ping timeout. Zombified socket detected. Executing kill handle.');
                if (ws) {
                    ws.terminate(); // Forcibly kill socket
                }
            }, 5000);
        }
    }, 15000);
};

// -- RECONNECT EXPONENTIAL BACKOFF --
const handleReconnect = async () => {
    if (pingInterval) clearInterval(pingInterval);
    if (killSwitchTimeout) clearTimeout(killSwitchTimeout);
    ws = null;

    reconnectAttempt++;

    // Formula: 1000, 2000, 4000, 8000, 15000...
    let delay = Math.pow(2, reconnectAttempt - 1) * 1000;
    if (delay > MAX_BACKOFF_MS) delay = MAX_BACKOFF_MS;

    console.log(`[Stream B] Reconnecting in ${delay}ms (Attempt ${reconnectAttempt})...`);

    // Log reconnection event to Telegram
    await NotificationService.logConnectionEvent('reconnecting', reconnectAttempt);

    setTimeout(connectWebSocket, delay);
};

// -- SUBSCRIPTIONS --
export const updateSubscriptions = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const marketIds = Array.from(ContextMap.keys());
    console.log(`[Stream B] updateSubscriptions called. ContextMap size: ${marketIds.length}`);
    if (marketIds.length > 0) {
        const assetIds: string[] = [];
        
        // Resolve Token IDs dynamically
        for (const marketId of marketIds) {
            const context = ContextMap.get(marketId);
            if (!context) continue;

            if (context.tokens) {
                assetIds.push(...context.tokens.map((t: any) => t.token_id));
            } else {
                try {
                    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
                    const fetchOptions = proxyUrl ? { agent: new SocksProxyAgent(proxyUrl) } : {};
                    const res = await fetch(`https://clob.polymarket.com/markets/${marketId}`, fetchOptions);
                    if (res.ok) {
                        const marketDetail = await res.json() as any;
                        context.tokens = marketDetail.tokens.map((t: any) => ({
                            outcome: t.outcome,
                            token_id: t.token_id
                        }));
                        assetIds.push(...context.tokens!.map((t: any) => t.token_id));
                    }
                } catch (e) {
                    console.error('[Stream B] Failed to resolve tokens for market:', marketId, e);
                }
            }
        }

        if (assetIds.length > 0) {
            const payload = {
                type: "market",
                assets_ids: assetIds
            };
            ws.send(JSON.stringify(payload));
            console.log(`[Stream B] Sent dynamic subscription for ${assetIds.length} tokens across ${marketIds.length} markets.`);
        }
    }
};

export const stopStreamB = () => {
    if (batchInterval) {
        clearInterval(batchInterval);
        batchInterval = null;
    }
    if (pingInterval) clearInterval(pingInterval);
    if (killSwitchTimeout) clearTimeout(killSwitchTimeout);

    if (ws) {
        ws.terminate();
        ws = null;
    }
};
