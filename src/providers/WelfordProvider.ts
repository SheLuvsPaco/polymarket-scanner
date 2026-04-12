export interface WelfordState {
    market_id: string;
    count: number;
    mean: number;
    m2: number;
    is_calibrated: boolean;
    first_trade_at: Date | null;
    is_dirty: boolean; // Flag to know if we need to UPSERT this during the batch flush
}

import { config } from '../config.js';

export class WelfordProvider {
    private baselines = new Map<string, WelfordState>();

    // Load initial state from the database at startup
    public loadState(existingBaselines: WelfordState[]) {
        for (const b of existingBaselines) {
            // Ensure boolean and date types are correct from pg row
            b.is_dirty = false;
            this.baselines.set(b.market_id, b);
        }
        console.log(`[WelfordProvider] Loaded ${this.baselines.size} existing market baselines from Postgres.`);
    }

    public addTrade(marketId: string, value: number, clobConsumptionPct: number) {
        // Data Poisoning Prevention: Outlier Exclusion Rule
        if (clobConsumptionPct > config.WELFORD_OUTLIER_PCT) {
            console.warn(`[WelfordProvider] OUTLIER DROPPED - Market: ${marketId} | Clob Consumption: ${(clobConsumptionPct * 100).toFixed(2)}% > ${config.WELFORD_OUTLIER_PCT * 100}% limit.`);
            return;
        }

        let state = this.baselines.get(marketId);
        const now = new Date();

        if (!state) {
            state = {
                market_id: marketId,
                count: 0,
                mean: 0,
                m2: 0,
                is_calibrated: false,
                first_trade_at: now,
                is_dirty: true
            };
            this.baselines.set(marketId, state);
        }

        // Welford's Math O(1)
        state.count += 1;
        const delta = value - state.mean;
        state.mean += delta / state.count;
        const delta2 = value - state.mean;
        state.m2 += delta * delta2;

        state.is_dirty = true;

        // Ensure first_trade_at is set if it was null in DB
        if (!state.first_trade_at) {
            state.first_trade_at = now;
        }

        // Burn-In Rule Check
        if (!state.is_calibrated) {
            const msSinceFirstTrade = now.getTime() - state.first_trade_at.getTime();
            const hoursSinceFirstTrade = msSinceFirstTrade / (1000 * 60 * 60);

            if (state.count >= config.BURN_IN_MIN_TRADES && hoursSinceFirstTrade >= config.BURN_IN_HOURS) {
                state.is_calibrated = true;
                console.log(`[WelfordProvider] MARKET CALIBRATED: ${marketId}. Thresholds met (${config.BURN_IN_HOURS}h+, ${config.BURN_IN_MIN_TRADES}+ trades).`);
            }
        }
    }

    // Pass the raw memory state by reference for the Stream B Phase 3 Synchronous Array Math
    public getRawState(marketId: string): WelfordState | undefined {
        return this.baselines.get(marketId);
    }

    // Retrieve dirty states for batch UPSERT flushing
    public getDirtyStates(): WelfordState[] {
        const dirty: WelfordState[] = [];
        for (const state of this.baselines.values()) {
            if (state.is_dirty) {
                dirty.push({ ...state }); // clone
                state.is_dirty = false; // reset flag
            }
        }
        return dirty;
    }

    // Get all baselines for heartbeat monitoring
    public getAllBaselines(): Map<string, WelfordState> {
        return this.baselines;
    }

    // Get count of tracked markets
    public getMarketCount(): number {
        return this.baselines.size;
    }
}

export const welford = new WelfordProvider();
