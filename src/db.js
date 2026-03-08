import pkg from "pg";
import "dotenv/config";

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function initDb() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      first_name TEXT,
      balance INTEGER DEFAULT 1000
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_logs (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT,
      action TEXT,
      status TEXT,
      bet INTEGER,
      balance INTEGER,
      player_cards JSONB,
      dealer_cards JSONB,
      player_score INTEGER,
      dealer_score INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function getUserByTelegramId(id) {

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE telegram_id=$1`,
    [id]
  );

  return rows[0];
}

export async function getOrCreateUser(id, username, firstName) {

  let user = await getUserByTelegramId(id);

  if (user) return user;

  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id,username,first_name)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [id, username, firstName]
  );

  return rows[0];
}

export async function updateBalance(id, balance) {

  const { rows } = await pool.query(
    `UPDATE users SET balance=$1 WHERE telegram_id=$2 RETURNING *`,
    [balance, id]
  );

  return rows[0];
}

export async function changeBalance(id, amount) {

  const { rows } = await pool.query(
    `UPDATE users SET balance=balance+$1 WHERE telegram_id=$2 RETURNING *`,
    [amount, id]
  );

  return rows[0];
}

export async function addGameLog(data) {

  await pool.query(
    `
    INSERT INTO game_logs (
      telegram_id,
      action,
      status,
      bet,
      balance,
      player_cards,
      dealer_cards,
      player_score,
      dealer_score
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      data.telegramId,
      data.action,
      data.status,
      data.bet,
      data.balance,
      JSON.stringify(data.playerCards),
      JSON.stringify(data.dealerCards),
      data.playerScore,
      data.dealerScore
    ]
  );
}

export async function getUserLogs(id) {

  const { rows } = await pool.query(
    `SELECT * FROM game_logs
     WHERE telegram_id=$1
     ORDER BY id DESC
     LIMIT 20`,
    [id]
  );

  return rows;
}
