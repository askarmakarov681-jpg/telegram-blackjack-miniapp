import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      balance INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_logs (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      action TEXT NOT NULL,
      status TEXT,
      bet INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      player_cards JSONB DEFAULT '[]'::jsonb,
      dealer_cards JSONB DEFAULT '[]'::jsonb,
      player_score INTEGER DEFAULT 0,
      dealer_score INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getOrCreateUser(telegramId, username, firstName) {
  const existing = await pool.query(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [telegramId, username || null, firstName || null]
  );

  return inserted.rows[0];
}

export async function getUserByTelegramId(telegramId) {
  const result = await pool.query(
    `SELECT * FROM users WHERE telegram_id = $1`,
    [telegramId]
  );

  return result.rows[0] || null;
}

export async function updateBalance(telegramId, balance) {
  const result = await pool.query(
    `UPDATE users
     SET balance = $2
     WHERE telegram_id = $1
     RETURNING *`,
    [telegramId, balance]
  );

  return result.rows[0];
}

export async function changeBalance(telegramId, amount) {
  const result = await pool.query(
    `UPDATE users
     SET balance = balance + $2
     WHERE telegram_id = $1
     RETURNING *`,
    [telegramId, amount]
  );

  return result.rows[0];
}

export async function addGameLog({
  telegramId,
  action,
  status,
  bet,
  balance,
  playerCards,
  dealerCards,
  playerScore,
  dealerScore
}) {
  await pool.query(
    `INSERT INTO game_logs
     (telegram_id, action, status, bet, balance, player_cards, dealer_cards, player_score, dealer_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      telegramId,
      action,
      status || null,
      bet || 0,
      balance || 0,
      JSON.stringify(playerCards || []),
      JSON.stringify(dealerCards || []),
      playerScore || 0,
      dealerScore || 0
    ]
  );
}

export async function getUserLogs(telegramId, limit = 20) {
  const result = await pool.query(
    `SELECT *
     FROM game_logs
     WHERE telegram_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [telegramId, limit]
  );

  return result.rows;
}