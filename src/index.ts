import dotenv from 'dotenv';
import pool, { initDb } from './db/index.js';
import { startStreamA, setOnContextUpdated, stopStreamA } from './streams/streamA.js';
import { startStreamB, stopStreamB, updateSubscriptions } from './streams/streamB.js';
import { welford } from './providers/WelfordProvider.js';
import { ProxyTraceService } from './services/ProxyTraceService.js';
import { NotificationService } from './services/NotificationService.js';
import { config } from './config.js';
import type { ParsedTrade } from './types.js';

dotenv.config();

// Track startup time for heartbeat
const STARTUP_TIME = new Date();
let heartbeatInterval: NodeJS.Timeout | null = null;
const main = async () => {
    console.log('--- PAST INGESTION ENGINE INITIALIZING ---');
    console.log(`[System] Startup Time: ${STARTUP_TIME.toISOString()}`);
    console.log(`[Config] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Config] Heartbeat: ${config.HEARTBEAT_ENABLED ? 'ENABLED' : 'DISABLED'} (${config.HEARTBEAT_INTERVAL_MINUTES} min interval)`);

    try {
        // Step 1: Initialize raw database connection & schema
        await initDb();
        console.log('[System] Database connection established and schema verified.');

        // Initialize Welford Baselines
        const res = await pool.query('SELECT * FROM market_baselines;');
        welford.loadState(res.rows);
        console.log(`[System] Loaded ${res.rows.length} market baselines from database.`);

        // Step 2: Establish the Bridge between Stream A and Stream B
        setOnContextUpdated(() => {
            console.log('[Orchestrator] Context Update triggered. Refreshing WebSocket subscriptions.');
            updateSubscriptions();
        });

        // Step 3: Boot Stream A (Context Poller)
        console.log('[System] Starting Stream A (Market Context Poller)...');
        startStreamA();

        // Step 4: Boot Stream B (Firehose) after a slight delay
        setTimeout(() => {
            console.log('[System] Starting Stream B (WebSocket Trade Ingestion)...');
            startStreamB();
        }, 3000);

        // Step 5: Start Heartbeat if enabled
        if (config.HEARTBEAT_ENABLED && config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
            startHeartbeat();
        }

        // Send startup notification to Telegram
        await sendStartupNotification(res.rows.length);

    } catch (error) {
        console.error('CRITICAL STARTUP FAILURE:', error);
        process.exit(1);
    }
};

/**
 * Send startup notification to Telegram with system status
 */
const sendStartupNotification = async (baselineCount: number) => {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
        console.warn('[Notification] Telegram credentials not configured. Skipping startup notification.');
        return;
    }

    const botToken = config.TELEGRAM_BOT_TOKEN;
    const chatId = config.TELEGRAM_CHAT_ID;
    const threadId = config.TELEGRAM_THREAD_ID;

    const uptimeSeconds = Math.floor((Date.now() - STARTUP_TIME.getTime()) / 1000);

    const textPayload = `🚀 <b>POLYMARKET SCANNER STARTED</b>\n\n` +
        `✅ <b>Status:</b> Online & Scanning\n` +
        `📊 <b>Markets Tracked:</b> ${baselineCount}\n` +
        `⏱️ <b>Startup Time:</b> ${uptimeSeconds}s\n` +
        `🔁 <b>Heartbeat:</b> Every ${config.HEARTBEAT_INTERVAL_MINUTES} minutes\n` +
        `🌍 <b>Proxy:</b> ${process.env.HTTPS_PROXY || 'Not configured'}\n\n` +
        `<i>System is now monitoring for insider trading signals...</i>`;

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

        if (response.ok) {
            console.log('[Notification] Startup notification sent successfully.');
        } else {
            const errData = await response.text();
            console.error('[Notification] Failed to send startup notification:', errData);
        }
    } catch (e) {
        console.error('[Notification] Error sending startup notification:', e);
    }
};

/**
 * Start heartbeat interval to send periodic health status to Telegram
 */
const startHeartbeat = () => {
    const intervalMs = config.HEARTBEAT_INTERVAL_MINUTES * 60 * 1000;

    console.log(`[Heartbeat] Starting health check every ${config.HEARTBEAT_INTERVAL_MINUTES} minutes...`);

    heartbeatInterval = setInterval(async () => {
        await sendHeartbeat();
    }, intervalMs);
};

/**
 * Send heartbeat notification with system health status
 */
const sendHeartbeat = async () => {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

    const botToken = config.TELEGRAM_BOT_TOKEN;
    const chatId = config.TELEGRAM_CHAT_ID;
    const threadId = config.TELEGRAM_THREAD_ID;

    const uptime = Math.floor((Date.now() - STARTUP_TIME.getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    // Get current stats
    const marketCount = welford.getMarketCount();

    const textPayload = `💓 <b>SYSTEM HEARTBEAT</b>\n\n` +
        `✅ <b>Status:</b> Healthy & Scanning\n` +
        `⏱️ <b>Uptime:</b> ${hours}h ${minutes}m\n` +
        `📊 <b>Active Markets:</b> ${marketCount}\n` +
        `🔄 <b>Last Check:</b> ${new Date().toISOString()}\n\n` +
        `<i>Scanner is running and monitoring Polymarket...</i>`;

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

        if (response.ok) {
            console.log(`[Heartbeat] Health status sent (${new Date().toISOString()})`);
        } else {
            console.error('[Heartbeat] Failed to send health status');
        }
    } catch (e) {
        console.error('[Heartbeat] Error sending health status:', e);
    }
};

// Handle Shutdown Gracefully
const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Initiating graceful shutdown...`);

    // Stop heartbeat
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('[Heartbeat] Stopped.');
    }

    // Stop streams
    stopStreamA();
    stopStreamB();
    console.log('[System] Streams stopped.');

    // Send shutdown notification
    await sendShutdownNotification(signal);

    console.log('[Shutdown] Complete. Goodbye!');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT (Ctrl+C)'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * Send shutdown notification to Telegram
 */
const sendShutdownNotification = async (signal: string) => {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

    const botToken = config.TELEGRAM_BOT_TOKEN;
    const chatId = config.TELEGRAM_CHAT_ID;
    const threadId = config.TELEGRAM_THREAD_ID;

    const uptime = Math.floor((Date.now() - STARTUP_TIME.getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const textPayload = `🛑 <b>SCANNER SHUTDOWN</b>\n\n` +
        `⚠️ <b>Signal:</b> ${signal}\n` +
        `⏱️ <b>Total Uptime:</b> ${hours}h ${minutes}m\n` +
        `📅 <b>Shutdown Time:</b> ${new Date().toISOString()}\n\n` +
        `<i>Polymarket scanner has been stopped.</i>`;

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

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        console.log('[Notification] Shutdown notification sent.');
    } catch (e) {
        console.error('[Notification] Error sending shutdown notification:', e);
    }
};

// Boot
main();
