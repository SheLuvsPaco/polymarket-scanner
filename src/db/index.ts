import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Max number of connections in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const initDb = async () => {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL. Initializing schema...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        trade_id VARCHAR(255) UNIQUE NOT NULL,
        market_id VARCHAR(255) NOT NULL,
        side VARCHAR(10),
        price NUMERIC(10, 4) NOT NULL,
        size NUMERIC(20, 6) NOT NULL,
        value NUMERIC(20, 6) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        maker_address VARCHAR(42),
        taker_address VARCHAR(42),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        clob_consumption_pct NUMERIC(10, 6),
        implied_probability_entry NUMERIC(10, 4)
      );
    `);

    // In Phase 3, we add Z-score and Signal fields
    await client.query(`
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS clob_consumption_pct NUMERIC(10, 6);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS implied_probability_entry NUMERIC(10, 4);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS z_score NUMERIC(10, 4);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_type VARCHAR(50);
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS funding_source VARCHAR(255);
    `);

    // Phase 4 Extensions
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_throttle (
        date DATE PRIMARY KEY,
        signal_count INTEGER DEFAULT 0
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id SERIAL PRIMARY KEY,
        market_id VARCHAR(255) NOT NULL,
        z_score NUMERIC(10, 4) NOT NULL,
        latency_ms INTEGER NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS market_baselines (
        market_id VARCHAR(255) PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        mean NUMERIC(20, 10) NOT NULL DEFAULT 0,
        m2 NUMERIC(20, 10) NOT NULL DEFAULT 0,
        is_calibrated BOOLEAN NOT NULL DEFAULT FALSE,
        first_trade_at TIMESTAMPTZ,
        last_updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_market_baselines_calibrated ON market_baselines(is_calibrated);
    `);

    console.log('Schema initialization complete.');
  } catch (error) {
    console.error('Error initializing schema:', error);
    throw error;
  } finally {
    client.release();
  }
};

export default pool;
