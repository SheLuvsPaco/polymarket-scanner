import pool from '../db/index.js';
import type { ParsedTrade } from '../types.js';
import { config } from '../config.js';

// Market Cooldown Cache
const MarketCooldownCache = new Map<string, number>();
const COOLDOWN_DURATION_MS = config.MARKET_COOLDOWN_HOURS * 60 * 60 * 1000;

// Phase 4B: Cluster Cache
interface ClusterEntry {
    trade_id: string;
    value: number;
    z_score: number;
    funding: string;
    timestamp: number;
}
const ClusterCache = new Map<string, ClusterEntry[]>();
const LastClusterAlertValue = new Map<string, number>();

export class NotificationService {

    /**
     * Log database batch operation to Telegram
     */
    public static async logDatabaseFlush(tradeCount: number, baselineCount: number, durationMs: number) {
        if (!config.LOG_DB_FLUSHES && !config.LOG_ERRORS_ONLY) return;
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        const textPayload = `💾 <b>Database Flush</b>\n\n` +
            `📝 <b>Trades:</b> ${tradeCount}\n` +
            `📊 <b>Baselines:</b> ${baselineCount}\n` +
            `⏱️ <b>Duration:</b> ${durationMs}ms`;

        await this.sendToTelegram(botToken, chatId, threadId, textPayload);
    }

    /**
     * Log WebSocket connection event to Telegram
     */
    public static async logConnectionEvent(event: 'connected' | 'disconnected' | 'reconnecting', attemptNumber?: number) {
        if (!config.LOG_STREAM_EVENTS && !config.LOG_ERRORS_ONLY) return;
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        let emoji = '🔌';
        let message = '';

        if (event === 'connected') {
            emoji = '✅';
            message = `<b>WebSocket Connected</b>\n\nScanner is receiving real-time trades.`;
        } else if (event === 'disconnected') {
            emoji = '❌';
            message = `<b>WebSocket Disconnected</b>\n\nConnection lost. Attempting to reconnect...`;
        } else if (event === 'reconnecting') {
            emoji = '🔄';
            message = `<b>WebSocket Reconnecting...</b>\n\nAttempt: ${attemptNumber || '?'}`;
        }

        const textPayload = `${emoji} ${message}`;

        await this.sendToTelegram(botToken, chatId, threadId, textPayload);
    }

    /**
     * Log market context update to Telegram
     */
    public static async logContextUpdate(marketCount: number) {
        if (!config.LOG_CONTEXT_UPDATES && !config.LOG_ERRORS_ONLY) return;
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        const textPayload = `🔄 <b>Market Context Updated</b>\n\n` +
            `📊 <b>Active Markets:</b> ${marketCount}\n` +
            `⏰ <b>Updated:</b> ${new Date().toISOString()}`;

        await this.sendToTelegram(botToken, chatId, threadId, textPayload);
    }

    /**
     * Log market calibration event to Telegram
     */
    public static async logMarketCalibration(marketId: string, tradeCount: number, hoursActive: number) {
        if (!config.LOG_BASELINE_CALIBRATION && !config.LOG_ERRORS_ONLY) return;
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        const textPayload = `📈 <b>Market Calibrated</b>\n\n` +
            `🎯 <b>Market:</b> ${marketId.substring(0, 8)}...\n` +
            `📊 <b>Trades:</b> ${tradeCount}\n` +
            `⏱️ <b>Active:</b> ${hoursActive.toFixed(1)}h\n\n` +
            `<i>Market has reached stable baseline for anomaly detection.</i>`;

        await this.sendToTelegram(botToken, chatId, threadId, textPayload);
    }

    /**
     * Log RPC activity to Telegram
     */
    public static async logRPCActivity(action: 'trace_started' | 'trace_completed' | 'rate_limit', address?: string) {
        if (!config.LOG_RPC_CALLS && !config.LOG_ERRORS_ONLY) return;
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        let textPayload = '';

        if (action === 'trace_started') {
            textPayload = `🔍 <b>Blockchain Trace Started</b>\n\n` +
                `📍 <b>Proxy:</b> ${address ? address.substring(0, 8) + '...' : 'Unknown'}`;
        } else if (action === 'trace_completed') {
            textPayload = `✅ <b>Blockchain Trace Completed</b>\n\n` +
                `📍 <b>Proxy:</b> ${address ? address.substring(0, 8) + '...' : 'Unknown'}`;
        } else if (action === 'rate_limit') {
            textPayload = `⚠️ <b>RPC Rate Limit Detected</b>\n\n` +
                `Entering 60-second cooldown period.`;
        }

        await this.sendToTelegram(botToken, chatId, threadId, textPayload);
    }

    /**
     * Log error to Telegram
     */
    public static async logError(component: string, error: string, severity: 'warning' | 'error' | 'critical' = 'error') {
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        const emoji = severity === 'critical' ? '🚨' : severity === 'error' ? '❌' : '⚠️';

        const textPayload = `${emoji} <b>${component} Error</b>\n\n` +
            `<code>${error.substring(0, 300)}${error.length > 300 ? '...' : ''}</code>\n` +
            `\n⏰ ${new Date().toISOString()}`;

        await this.sendToTelegram(botToken, chatId, threadId, textPayload);
    }

    public static async sendTelegramAlert(trade: ParsedTrade, latencyMs: number) {

        // Phase 4B: Signal Gates & Bypasses
        const isConfirmedInsider = trade.signal_type === "CONFIRMED_INSIDER";
        const isDormantStrike = trade.signal_type === "DORMANT_STRIKE";
        const isSignal = isConfirmedInsider || isDormantStrike;

        let isUnstableBaseline = !trade.is_calibrated;
        let isEarlyBypass = false;

        if (isUnstableBaseline && isConfirmedInsider && trade.value > config.EARLY_MARKET_BYPASS_USD) {
            isEarlyBypass = true;
        }

        // Phase 4B: Cluster Interception
        if (isSignal) {
            let cluster = ClusterCache.get(trade.market_id) || [];
            const now = Date.now();

            // Purge entries older than 15 minutes
            cluster = cluster.filter(c => (now - c.timestamp) <= 15 * 60 * 1000);

            cluster.push({
                trade_id: trade.trade_id,
                value: trade.value,
                z_score: trade.z_score || 0,
                funding: trade.funding_source || "Unknown",
                timestamp: now
            });

            ClusterCache.set(trade.market_id, cluster);

            let clusterTrigger = false;
            if (cluster.length >= 3) {
                clusterTrigger = true;
            } else if (cluster.length >= 2 && trade.market_age_hours !== undefined && trade.market_age_hours < 24) {
                // Cluster Calibration Bypass
                clusterTrigger = true;
                isUnstableBaseline = true;
            }

            if (clusterTrigger) {
                const totalValue = cluster.reduce((sum, c) => sum + c.value, 0);
                const lastValue = LastClusterAlertValue.get(trade.market_id) || 0;

                // Debounce increase necessary for subsequent cluster alerts
                if (totalValue > lastValue * config.CLUSTER_DEBOUNCE_MULTIPLIER) {
                    LastClusterAlertValue.set(trade.market_id, totalValue);
                    await this.dispatchClusterAlert(trade, cluster, totalValue, isUnstableBaseline, latencyMs);
                } else {
                    console.log(`[Notification] Cluster alert suppressed for ${trade.market_id} (Debounce).`);
                }
                return; // Supress individual alert
            }

            // If it didn't trigger a cluster, and the baseline is unstable, it must meet early bypass to fire a single.
            if (isUnstableBaseline && !isEarlyBypass) {
                console.log(`[Notification] SKIPPED: Market ${trade.market_id} is uncalibrated and bypass rules not met.`);
                return;
            }
        } else {
            // For RETAIL_WHALE or other fallbacks
            if (isUnstableBaseline) return;
        }

        // Step 1: Market Cooldown Lock Check (Idempotency) - For Single Alerts Only
        const lastAlertTime = MarketCooldownCache.get(trade.market_id);
        if (lastAlertTime && (Date.now() - lastAlertTime) < COOLDOWN_DURATION_MS) {
            console.log(`[Notification] SKIPPED: Market ${trade.market_id} is in ${config.MARKET_COOLDOWN_HOURS}-hour cooldown.`);
            await this.logDroppedSignal(trade.trade_id, "DROPPED_DUPLICATE_MARKET");
            return;
        }

        // Step 2: Global Throttle Database Enforcement
        let allowed = false;
        let currentCount = 0;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                INSERT INTO signal_throttle (date, signal_count) 
                VALUES (CURRENT_DATE, 0) 
                ON CONFLICT (date) DO NOTHING;
            `);
            const res = await client.query('SELECT signal_count FROM signal_throttle WHERE date = CURRENT_DATE FOR UPDATE;');
            currentCount = res.rows[0].signal_count;

            if (currentCount < config.DAILY_SIGNAL_LIMIT) {
                await client.query('UPDATE signal_throttle SET signal_count = signal_count + 1 WHERE date = CURRENT_DATE;');
                allowed = true;
                currentCount += 1;
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error('[Notification] Throttle Database Error:', e);
            return;
        } finally {
            client.release();
        }

        if (!allowed) {
            console.log(`[Notification] THROTTLED: Daily Signal Limit (${config.DAILY_SIGNAL_LIMIT}) Exhausted. Trade ${trade.trade_id} dropped.`);
            await this.logDroppedSignal(trade.trade_id, "DROPPED_RATE_LIMIT");
            return;
        }

        MarketCooldownCache.set(trade.market_id, Date.now());

        const slug = trade.market_slug || trade.market_id;
        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        if (!botToken || !chatId) {
            console.warn("[Notification] Missing Telegram Credentials. Message skipped.");
            return;
        }

        const urgencyLabel = trade.signal_type === "CONFIRMED_INSIDER" ? "🔥 CONFIRMED" : "🚨 POTENTIAL";
        let unstableTag = isUnstableBaseline ? "\n⚠️ <b>UNSTABLE BASELINE: Burn-in < 72H</b>\n" : "";
        let latencyWarning = latencyMs > 1500 ? "\n\n⚠️ <b>CRITICAL LATENCY DEGRADATION: DO NOT EXECUTE. SLIPPAGE IMMINENT.</b>" : "";

        let forensicPathStr = "";
        if (trade.funding_chain && trade.funding_chain.length > 0) {
            forensicPathStr = `\n🕵️ <b>Forensic Path:</b>\n`;
            for (const step of trade.funding_chain) {
                const shortAddr = `${step.address.substring(0, 6)}...${step.address.substring(38)}`;
                forensicPathStr += ` ├ ${step.label}: <a href="https://polygonscan.com/address/${step.address}">${shortAddr}</a> ($${Math.round(step.amount).toLocaleString()})\n`;
            }
        }

        const textPayload = `${urgencyLabel} <b>ASYMMETRIC SIGNAL</b>\n${unstableTag}\n` +
            `<b>Market:</b> <a href="https://polymarket.com/event/${slug}">${slug}</a>\n` +
            `<b>Entry Price (Max):</b> ${trade.price} ¢\n` +
            `<b>Volume Swept:</b> $${trade.value.toFixed(2)}\n` +
            `<b>Z-Score:</b> ${trade.z_score?.toFixed(2) || 'N/A'} σ\n` +
            `<b>Topology:</b> ${trade.funding_source || 'Unknown'} ➔ 0-Hop ➔ Proxy\n` +
            `${forensicPathStr}\n` +
            `⏱️ <i>Latency: ${latencyMs}ms | Daily Signals Remaining: ${config.DAILY_SIGNAL_LIMIT - currentCount}</i>` +
            `${latencyWarning}`;

        await this.postToTelegram(botToken, chatId, threadId, textPayload, slug, trade, latencyMs);
    }

    private static async dispatchClusterAlert(trade: ParsedTrade, cluster: ClusterEntry[], totalValue: number, isUnstableBaseline: boolean, latencyMs: number) {
        const slug = trade.market_slug || trade.market_id;
        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;

        if (!botToken || !chatId) return;

        const meanZ = cluster.reduce((sum, c) => sum + c.z_score, 0) / cluster.length;
        const firstTradeTime = Math.min(...cluster.map(c => c.timestamp));
        const timeSpanMins = Math.max(1, Math.round((Date.now() - firstTradeTime) / 60000));
        let unstableTag = isUnstableBaseline ? "\n⚠️ <b>UNSTABLE BASELINE: Burn-in < 72H</b>\n" : "";

        let forensicPathStr = "";
        if (trade.funding_chain && trade.funding_chain.length > 0) {
            forensicPathStr = `\n🕵️ <b>Latest Forensic Path (Trigger):</b>\n`;
            for (const step of trade.funding_chain) {
                const shortAddr = `${step.address.substring(0, 6)}...${step.address.substring(38)}`;
                forensicPathStr += ` ├ ${step.label}: <a href="https://polygonscan.com/address/${step.address}">${shortAddr}</a> ($${Math.round(step.amount).toLocaleString()})\n`;
            }
        }

        const textPayload = `🚨 <b>INSIDER CLUSTER DETECTED</b> 🚨\n${unstableTag}\n` +
            `<b>Market:</b> <a href="https://polymarket.com/event/${slug}">${slug}</a>\n` +
            `<b>Total Cluster Value:</b> $${totalValue.toFixed(2)}\n` +
            `<b>Wallets Involved:</b> ${cluster.length} (All 0-hop Behavioral Matches)\n` +
            `<b>Average Z-Score:</b> ${meanZ.toFixed(2)} σ\n` +
            `<b>Time Span:</b> ${timeSpanMins} Minutes\n` +
            `${forensicPathStr}`;

        await this.postToTelegram(botToken, chatId, threadId, textPayload, slug, trade, latencyMs);
    }

    private static async postToTelegram(botToken: string, chatId: string, threadId: string | undefined, textPayload: string, slug: string, trade: ParsedTrade, latencyMs: number) {
        const payload: any = {
            chat_id: chatId,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            text: textPayload,
            reply_markup: {
                inline_keyboard: [[{ text: "⚡ EXECUTE ON POLYMARKET", url: `https://polymarket.com/event/${slug}` }]]
            }
        };

        if (threadId) {
            payload.message_thread_id = threadId;
        }

        try {
            console.log(`[Notification] Dispatching Webhook...`);
            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errData = await response.text();
                console.error("[Notification] Telegram API Error:", errData);
            } else {
                console.log(`[Notification] Message delivered successfully.`);
                await pool.query(
                    'INSERT INTO webhook_logs (market_id, z_score, latency_ms) VALUES ($1, $2, $3)',
                    [trade.market_id, trade.z_score || 0, latencyMs]
                );
            }
        } catch (e) {
            console.error("[Notification] Webhook Dispatch Exception:", e);
        }
    }

    private static async logDroppedSignal(tradeId: string, type: string) {
        try {
            await pool.query('UPDATE trades SET signal_type = $1 WHERE trade_id = $2', [type, tradeId]);
        } catch (e) {
            console.error(`[Notification] Error Logging dropped signal ${tradeId}:`, e);
        }
    }

     /**
     * Comprehensive 6-hour report with full system intelligence
     */
    public static async sendPeriodicReport() {
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

        const botToken = config.TELEGRAM_BOT_TOKEN;
        const chatId = config.TELEGRAM_CHAT_ID;
        const threadId = config.TELEGRAM_THREAD_ID;
        const hoursBack = config.REPORT_INTERVAL_HOURS;

        try {
            // Trade summary
            const tradeStats = await pool.query(`
                SELECT 
                    COUNT(*) as total_trades,
                    COALESCE(SUM(value), 0) as total_volume,
                    COALESCE(AVG(value), 0) as avg_trade_size,
                    COALESCE(MAX(value), 0) as largest_trade,
                    COUNT(CASE WHEN signal_type = 'POTENTIAL_SIGNAL' THEN 1 END) as potential_signals,
                    COUNT(CASE WHEN signal_type = 'CONFIRMED_INSIDER' THEN 1 END) as confirmed_insiders,
                    COUNT(CASE WHEN signal_type = 'DORMANT_STRIKE' THEN 1 END) as dormant_strikes,
                    COUNT(CASE WHEN signal_type = 'RETAIL_WHALE' THEN 1 END) as retail_whales,
                    COUNT(DISTINCT market_id) as unique_markets
                FROM trades 
                WHERE created_at > NOW() - INTERVAL '${hoursBack} hours'
            `);

            const ts = tradeStats.rows[0];

            // Top markets by volume
            const topMarkets = await pool.query(`
                SELECT 
                    market_id, MAX(market_slug) as market_slug,
                    COUNT(*) as trade_count,
                    SUM(value) as total_volume,
                    AVG(value) as avg_size,
                    MAX(z_score) as max_z_score
                FROM trades 
                WHERE created_at > NOW() - INTERVAL '${hoursBack} hours'
                GROUP BY market_id 
                ORDER BY total_volume DESC 
                LIMIT 5
            `);

            // Baseline health
            const baselineStats = await pool.query(`
                SELECT 
                    COUNT(*) as total_baselines,
                    COUNT(CASE WHEN is_calibrated = true THEN 1 END) as calibrated,
                    COUNT(CASE WHEN is_calibrated = false THEN 1 END) as uncalibrated,
                    AVG(count) as avg_trade_count,
                    MAX(count) as max_trade_count
                FROM market_baselines
            `);

            const bs = baselineStats.rows[0];

            // Top baselines by trade count
            const topBaselines = await pool.query(`
                SELECT 
                    market_id, market_slug,
                    count as trade_count,
                    mean,
                    CASE WHEN count > 1 THEN SQRT(m2 / (count - 1)) ELSE 0 END as std_dev,
                    is_calibrated,
                    first_trade_at
                FROM market_baselines 
                ORDER BY count DESC 
                LIMIT 5
            `);

            // Build the report
            let report = `📋 <b>COMPREHENSIVE REPORT</b>\n`;
            report += `⏰ <b>Period:</b> Last ${hoursBack} hours\n`;
            report += `📅 <b>Generated:</b> ${new Date().toISOString()}\n\n`;

            // Trade Overview
            report += `━━━ 📊 TRADE OVERVIEW ━━━\n`;
            report += `Total Trades: ${ts.total_trades}\n`;
            report += `Total Volume: $${parseFloat(ts.total_volume).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
            report += `Avg Trade Size: $${parseFloat(ts.avg_trade_size).toFixed(2)}\n`;
            report += `Largest Trade: $${parseFloat(ts.largest_trade).toFixed(2)}\n`;
            report += `Unique Markets: ${ts.unique_markets}\n\n`;

            // Signal Summary
            report += `━━━ 🚨 SIGNAL SUMMARY ━━━\n`;
            report += `🔥 Confirmed Insiders: ${ts.confirmed_insiders}\n`;
            report += `⚡ Dormant Strikes: ${ts.dormant_strikes}\n`;
            report += `🟡 Potential Signals: ${ts.potential_signals}\n`;
            report += `🐋 Retail Whales: ${ts.retail_whales}\n\n`;

            // Top Markets
            report += `━━━ 🏆 TOP MARKETS BY VOLUME ━━━\n`;
            for (const m of topMarkets.rows) {
                const shortId = m.market_slug || m.market_id.substring(0, 10) + '...';
                report += `${shortId}\n`;
                report += `  Trades: ${m.trade_count} | Vol: $${parseFloat(m.total_volume).toFixed(0)} | Max Z: ${m.max_z_score ? parseFloat(m.max_z_score).toFixed(2) : 'N/A'}\n`;
            }
            report += `\n`;

            // Welford Baselines
            report += `━━━ 🧠 WELFORD BASELINES ━━━\n`;
            report += `Total Baselines: ${bs.total_baselines}\n`;
            report += `Calibrated: ${bs.calibrated} ✅\n`;
            report += `Uncalibrated: ${bs.uncalibrated} ⏳\n`;
            report += `Avg Trades/Market: ${parseFloat(bs.avg_trade_count || 0).toFixed(0)}\n`;
            report += `Max Trades/Market: ${bs.max_trade_count || 0}\n\n`;

            // Top Baselines Detail
            report += `━━━ 📈 BASELINE DETAIL (Top 5) ━━━\n`;
            for (const b of topBaselines.rows) {
                const shortId = b.market_slug || b.market_id.substring(0, 10) + '...';
                const status = b.is_calibrated ? '✅' : '⏳';
                const age = b.first_trade_at ? Math.floor((Date.now() - new Date(b.first_trade_at).getTime()) / 3600000) : 0;
                report += `${status} ${shortId}\n`;
                report += `  Trades: ${b.trade_count} | Mean: ${parseFloat(b.mean).toFixed(6)} | StdDev: ${parseFloat(b.std_dev).toFixed(6)} | Age: ${age}h\n`;
            }

            await this.sendToTelegram(botToken, chatId, threadId, report);
            console.log(`[Report] Periodic report sent (${new Date().toISOString()})`);

        } catch (e) {
            console.error('[Report] Error generating report:', e);
        }
    }


    /**
     * Generic method to send a message to Telegram without trade-specific formatting
     */
    private static async sendToTelegram(botToken: string, chatId: string, threadId: string | undefined, textPayload: string) {
        try {
            const payload: any = {
                chat_id: chatId,
                parse_mode: "HTML",
                disable_web_page_preview: true,
                text: textPayload
            };

            if (threadId) {
                payload.message_thread_id = threadId;
            }

            const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errData = await response.text();
                console.error("[Notification] Telegram API Error:", errData);
            } else {
                console.log(`[Notification] Message sent successfully.`);
            }
        } catch (e) {
            console.error("[Notification] Error sending message to Telegram:", e);
        }
    }
}
