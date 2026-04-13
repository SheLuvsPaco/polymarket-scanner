import { ethers } from 'ethers';
import type { ParsedTrade } from '../types.js';
import { NotificationService } from './NotificationService.js';
import { config } from '../config.js';

// Using standard Polygon RPC for resolution.
const POLYGON_RPC = config.POLYGON_RPC_WSS;
const provider = new ethers.WebSocketProvider(POLYGON_RPC);

// Mutex Lock for Concurrency Control
const ActiveTraces = new Set<string>();

// Global RPC Cooldown (Rate Limit Protection)
let globalRPCCooldownUntil = 0;

// Known USDC Contracts on Polygon
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8bC21B5ebd52'.toLowerCase();
const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'.toLowerCase();

// ERC-20 Transfer Event Signature
const transferAbi = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
const nativeContract = new ethers.Contract(USDC_NATIVE, transferAbi, provider);
const bridgedContract = new ethers.Contract(USDC_BRIDGED, transferAbi, provider);

// The Verification Matrix (Deprecated in favor of Behavioral Forensics)
// const VerificationMatrix: Record<string, string> = { ... };

const POLYGONSCAN_API_KEY = config.POLYGONSCAN_API_KEY;

export class ProxyTraceService {

    public static async evaluate(trade: ParsedTrade): Promise<void> {
        // Resolve maker_address from transaction_hash if not provided
        let proxyAddress = trade.maker_address;
        if (!proxyAddress && trade.trade_id && trade.trade_id.startsWith('0x')) {
            try {
                const tx = await provider.getTransaction(trade.trade_id);
                if (tx && tx.from) {
                    proxyAddress = tx.from;
                    trade.maker_address = tx.from;
                    console.log(`[ProxyHunter] Resolved address from tx: ${tx.from}`);
                }
            } catch (e) {
                console.warn(`[ProxyHunter] Failed to resolve address from tx ${trade.trade_id}:`, e);
            }
        }
        if (!proxyAddress) {
            if (trade.signal_type === "POTENTIAL_SIGNAL" || trade.signal_type === "CONFIRMED_INSIDER" || trade.signal_type === "DORMANT_STRIKE") {
                const latency = trade.timestamp_ws_receive ? Date.now() - trade.timestamp_ws_receive : 0;
                await NotificationService.sendTelegramAlert(trade, latency);
            }
            return;
        }

        // Step 1: The Mutex Pattern (Concurrency Control)
        if (ActiveTraces.has(proxyAddress)) {
            console.log(`[ProxyHunter] SKIPPING Trace: ${proxyAddress} is already being analyzed (Sweep cluster detected).`);
            return;
        }

        // Rate Limit Protection
        if (Date.now() < globalRPCCooldownUntil) {
            console.warn(`[ProxyHunter] GLOBAL COOLDOWN ACTIVE. Skipping trace for ${proxyAddress}. Preserving POTENTIAL_SIGNAL.`);
            this.handleTraceFallback(trade);
            return;
        }

        ActiveTraces.add(proxyAddress);

        // Ensure cleanup after 60 seconds identically to the blueprint
        setTimeout(() => {
            ActiveTraces.delete(proxyAddress);
        }, 60000);

        console.log(`[ProxyHunter] INIT TRACE: Potential Signal detected on Market ${trade.market_id}. Tracing Proxy ${proxyAddress}...`);

        // Log trace start to Telegram
        await NotificationService.logRPCActivity('trace_started', proxyAddress);

        try {
            // Step 2: Proxy to EOA Resolution (The 0-Hop Trace)
            const funderInfo = await this.findProxyFunder(proxyAddress);
            if (!funderInfo) {
                console.log(`[ProxyHunter] FAILED: Could not resolve EOA for Proxy ${proxyAddress}. Downgrading to RETAIL_WHALE.`);
                trade.signal_type = "RETAIL_WHALE";
                return;
            }

            const eoa = funderInfo.address;
            const fundingAmount = funderInfo.amount;

            console.log(`[ProxyHunter] RESOLVED EOA: Proxy ${proxyAddress} is controlled by EOA ${eoa}. Funding: $${fundingAmount}`);

            trade.funding_chain = [
                { address: eoa, amount: fundingAmount, label: "Funder EOA" },
                { address: proxyAddress, amount: trade.value, label: "Polymarket Proxy" }
            ];

            // Phase 3B: Behavioral Forensics

            // Pillar A: Nonce Check
            const nonce = await provider.getTransactionCount(eoa);
            trade.funder_nonce = nonce;
            console.log(`[IntentEngine] EOA ${eoa} Nonce: ${nonce}`);

            // If nonce > LIMIT, it's an established wallet. We can skip dormancy check to save API calls.
            if (nonce > config.ESTABLISHED_NONCE_LIMIT) {
                console.log(`[IntentEngine] EOA ${eoa} is an established wallet (Nonce ${nonce} > ${config.ESTABLISHED_NONCE_LIMIT}). Skipping Dormancy Check.`);
            }

            // Pillar B: Flow Ratio (Just-in-Time Funding)
            const flowRatio = await this.getFlowRatio(eoa, trade.value);
            trade.flow_ratio = flowRatio;
            console.log(`[IntentEngine] EOA ${eoa} Flow Ratio: ${flowRatio.toFixed(2)}`);

            // Pillar C: Dormancy Check 
            let isDormant = false;
            trade.is_dormant_wake_up = false;
            // Only check dormancy if Z-Score > Trigger and Nonce <= Established Limit (optimization)
            if (trade.z_score && trade.z_score > config.Z_SCORE_TRIGGER && nonce <= config.ESTABLISHED_NONCE_LIMIT) {
                isDormant = await this.checkDormancy(eoa);
                trade.is_dormant_wake_up = isDormant;
                console.log(`[IntentEngine] EOA ${eoa} Dormant Wake-Up: ${isDormant}`);
            }

            // The New Signal Hierarchy Classification
            const isZScoreHigh = trade.z_score ? trade.z_score > config.Z_SCORE_TRIGGER : false;

            if (isZScoreHigh && nonce < config.BURNER_NONCE_LIMIT && flowRatio > config.FLOW_RATIO_TARGET) {
                console.log(`[IntentEngine] 🚨 CONFIRMED INSIDER 🚨 - EOA ${eoa} satisfies Burner + Flow Ratio rules.`);
                trade.signal_type = "CONFIRMED_INSIDER";
                trade.funding_source = `Burner Strike (Nonce < ${config.BURNER_NONCE_LIMIT}, FlowRatio > ${config.FLOW_RATIO_TARGET * 100}%)`;
            } else if (isZScoreHigh && isDormant && flowRatio > config.FLOW_RATIO_TARGET) {
                console.log(`[IntentEngine] ⚡ DORMANT STRIKE ⚡ - EOA ${eoa} satisfies Dormant Wake-Up + Flow Ratio rules.`);
                trade.signal_type = "DORMANT_STRIKE";
                trade.funding_source = `Dormant Strike (> ${config.DORMANCY_DAYS} Days Silence)`;
            } else {
                console.log(`[IntentEngine] RESOLVED: EOA ${eoa} acts like Retail. Downgrading to RETAIL_WHALE.`);
                trade.signal_type = "RETAIL_WHALE";
                if (nonce >= config.ESTABLISHED_NONCE_LIMIT * 2) {
                    trade.funding_source = `Established Wallet (Nonce: ${nonce})`;
                } else {
                    trade.funding_source = `Unconfirmed Intent (FlowRatio: ${flowRatio.toFixed(2)}, Nonce: ${nonce})`;
                }
            }

        } catch (error: any) {
            console.error(`[ProxyHunter] ERROR tracing ${proxyAddress}:`, error.message || error);

            // If we hit a Rate Limit (429) or severe RPC error, lock the engine for 60 seconds
            if (error?.message?.includes('429') || error?.message?.includes('rate limit')) {
                console.warn(`[ProxyHunter] RATE LIMIT REACHED! Initiating 60-second Global RPC Cooldown.`);
                globalRPCCooldownUntil = Date.now() + 60000;

                // Log rate limit event to Telegram
                await NotificationService.logRPCActivity('rate_limit');
            }

            this.handleTraceFallback(trade);
        }

        // Step 5: Route to Telegram Alerting Engine
        if (trade.signal_type === "CONFIRMED_INSIDER" || trade.signal_type === "DORMANT_STRIKE" || trade.signal_type === "POTENTIAL_SIGNAL") {
            const latency = trade.timestamp_ws_receive ? Date.now() - trade.timestamp_ws_receive : 0;
            await NotificationService.sendTelegramAlert(trade, latency);
        }

        // Log trace completion to Telegram
        await NotificationService.logRPCActivity('trace_completed', proxyAddress);
    }

    /**
     * Handled Fallback logic when traces fail to preserve the mathematically anomalous alert natively.
     */
    private static handleTraceFallback(trade: ParsedTrade) {
        if (trade.z_score && trade.z_score > config.Z_SCORE_TRIGGER) {
            trade.signal_type = "POTENTIAL_SIGNAL";
            trade.funding_source = "Trace Aborted / Cooldown";
        } else {
            trade.signal_type = "RETAIL_WHALE";
        }
    }

    /**
     * Queries recent USDC transfers to the proxy to find the EOA that funded it.
     */
    private static async findProxyFunder(proxyAddress: string): Promise<{ address: string, amount: number } | null> {
        try {
            const currentBlock = await provider.getBlockNumber();
            const startBlock = currentBlock - 9; // Capped to 9 for Alchemy Free Tier Limit (inclusive 10)

            // Transfer(address,address,uint256) topic hash
            const transferTopic = ethers.id("Transfer(address,address,uint256)");
            const proxyPadded = ethers.zeroPadValue(proxyAddress, 32);

            const [nativeLogs, bridgedLogs] = await Promise.all([
                provider.getLogs({
                    address: USDC_NATIVE,
                    fromBlock: startBlock,
                    toBlock: currentBlock,
                    topics: [transferTopic, null, proxyPadded]
                }),
                provider.getLogs({
                    address: USDC_BRIDGED,
                    fromBlock: startBlock,
                    toBlock: currentBlock,
                    topics: [transferTopic, null, proxyPadded]
                })
            ]);

            const allLogs = [...nativeLogs, ...bridgedLogs].sort((a, b) => b.blockNumber - a.blockNumber);

            if (allLogs.length > 0) {
                const log = allLogs[0];
                if (log && log.topics && log.topics.length > 1 && log.topics[1]) {
                    const fromAddress = ethers.dataSlice(log.topics[1] as string, 12); // Strip padding
                    const amount = parseFloat(ethers.formatUnits(log.data, 6)); // USDC 6 decimals
                    return { address: ethers.getAddress(fromAddress), amount };
                }
            }
            return null;
        } catch (e) {
            console.error("RPC Error in findProxyFunder:", e);
            return null;
        }
    }

    /**
     * Pillar B: Flow-Through Ratio
     * Calculates (Trade Value) / (USDC Received in lookback blocks)
     */
    private static async getFlowRatio(eoaAddress: string, tradeValue: number): Promise<number> {
        try {
            const currentBlock = await provider.getBlockNumber();
            // Alchemy free tier limits log queries (varies by plan, usually 10k blocks range is fine, but result count can hit limits).
            const startBlock = Math.max(0, currentBlock - config.FLOW_RATIO_LOOKBACK_BLOCKS);

            const transferTopic = ethers.id("Transfer(address,address,uint256)");
            const eoaPadded = ethers.zeroPadValue(eoaAddress, 32);

            const [nativeLogs, bridgedLogs] = await Promise.all([
                provider.getLogs({
                    address: USDC_NATIVE,
                    fromBlock: startBlock,
                    toBlock: currentBlock,
                    topics: [transferTopic, null, eoaPadded]
                }),
                provider.getLogs({
                    address: USDC_BRIDGED,
                    fromBlock: startBlock,
                    toBlock: currentBlock,
                    topics: [transferTopic, null, eoaPadded]
                })
            ]);

            const allLogs = [...nativeLogs, ...bridgedLogs];

            let totalUSDCReceived = 0;
            for (const log of allLogs) {
                // USDC has 6 decimals on Polygon
                const amountHex = log.data;
                const parsedValue = parseFloat(ethers.formatUnits(amountHex, 6));
                totalUSDCReceived += parsedValue;
            }

            if (totalUSDCReceived === 0) return 0; // Prevent divide by zero if they used WETH or another token instead of USDC

            return tradeValue / totalUSDCReceived;

        } catch (e) {
            console.error("RPC Error in getFlowRatio:", e);
            return 0; // Fallback to 0 completely invalidates flow ratio trigger safely
        }
    }

    /**
     * Pillar C: Dormancy Evaluation
     * Queries Polygonscan for the last normal outgoing transaction. Returns true if > 30 days old.
     */
    private static async checkDormancy(eoaAddress: string): Promise<boolean> {
        if (!POLYGONSCAN_API_KEY) {
            console.warn("[IntentEngine] Polysonscan API Key missing, skipping Dormancy check.");
            return false;
        }

        try {
            // Query for the latest 1 normal outgoing transaction
            const url = `https://api.polygonscan.com/api?module=account&action=txlist&address=${eoaAddress}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${POLYGONSCAN_API_KEY}`;
            const res = await fetch(url);
            const data = await res.json() as any;

            if (data.status !== "1" || !data.result || data.result.length === 0) {
                // No transactions found? Very weird for an EOA initiating a tx now, likely fresh wallet.
                return false;
            }

            // Find the first matching *outgoing* tx
            // (Polygonscan returns them in DESC order based on offset=100)
            let lastOutgoingTimestamp = 0;
            for (const tx of data.result) {
                // Convert to lowercase to be safe
                if (tx.from.toLowerCase() === eoaAddress.toLowerCase()) {
                    lastOutgoingTimestamp = parseInt(tx.timeStamp, 10);
                    break;
                }
            }

            if (lastOutgoingTimestamp === 0) {
                return false;
            }

            // Check if it's > DORMANCY_DAYS ago
            const nowInSeconds = Math.floor(Date.now() / 1000);
            const diff = nowInSeconds - lastOutgoingTimestamp;
            const thresholdSeconds = config.DORMANCY_DAYS * 24 * 60 * 60;

            return diff > thresholdSeconds;

        } catch (e) {
            console.error("Error in checkDormancy:", e);
            return false;
        }
    }
}
