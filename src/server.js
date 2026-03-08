import { validate } from "@telegram-apps/init-data-node";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

import {
  initDb,
  getOrCreateUser,
  getUserByTelegramId,
  updateBalance,
  changeBalance,
  addGameLog,
  getUserLogs
} from "./db.js";

const app = express();
app.use(express.json());
function verifyTelegram(req, res, next) {

  try {

    const initData = req.headers["x-telegram-init-data"];

    if (!initData) {
      return res.status(403).json({ error: "No telegram auth" });
    }

    const data = validate(initData, process.env.BOT_TOKEN);

    req.telegramUser = data.user;

    next();

  } catch (err) {

    return res.status(403).json({ error: "Invalid telegram auth" });
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", express.static(path.join(__dirname, "..", "public")));

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map(Number);

const games = {};
const lastAction = {};
const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return shuffle(deck);
}

function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getCardValue(card) {
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  if (card.rank === "A") return 11;
  return parseInt(card.rank, 10);
}

function calculateScore(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += getCardValue(card);
    if (card.rank === "A") aces++;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function getUserId(req) {
  const id = req.body?.userId ?? req.query?.userId ?? "";
  return String(id);
}

function getGame(userId) {
  if (!games[userId]) {
    games[userId] = {
      bet: 50,
      deck: [],
      player: [],
      dealer: [],
      gameOver: true,
      status: "Нажми «Новая игра»"
    };
  }

  return games[userId];
}

async function buildState(userId, hideDealerSecondCard = true) {
  const game = getGame(userId);
  const dbUser = await getUserByTelegramId(userId);
  const logs = await getUserLogs(userId, 20);

  const playerScore = calculateScore(game.player);

  let dealerCards = [];
  let dealerScore = 0;

  if (hideDealerSecondCard && !game.gameOver) {
    dealerCards = [
      game.dealer[0] ? formatCard(game.dealer[0]) : "🂠",
      "🂠"
    ];
    dealerScore = game.dealer[0] ? getCardValue(game.dealer[0]) : 0;
  } else {
    dealerCards = game.dealer.map(formatCard);
    dealerScore = calculateScore(game.dealer);
  }

  return {
    balance: dbUser?.balance ?? 1000,
    bet: game.bet,
    player: game.player.map(formatCard),
    dealer: dealerCards,
    playerScore,
    dealerScore,
    gameOver: game.gameOver,
    status: game.status,
    logs,
    canRescueBonus: (dbUser?.balance ?? 0) === 0 && game.gameOver
  };
}

async function logAction(userId, action) {
  const game = getGame(userId);
  const dbUser = await getUserByTelegramId(userId);

  await addGameLog({
    telegramId: Number(userId),
    action,
    status: game.status,
    bet: game.bet,
    balance: dbUser?.balance ?? 0,
    playerCards: game.player.map(formatCard),
    dealerCards: game.dealer.map(formatCard),
    playerScore: calculateScore(game.player),
    dealerScore: calculateScore(game.dealer)
  });
}

function dealerTurn(game) {
  while (calculateScore(game.dealer) < 17) {
    game.dealer.push(game.deck.pop());
  }
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

app.get("/api/game/state", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: "Нет userId" });

    await getOrCreateUser(userId, null, null);
    res.json(await buildState(userId, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/game/start", verifyTelegram, async (req, res) => {
  
  const now = Date.now();

    if (lastAction[userId] && now - lastAction[userId] < 1000) {
      return res.status(429).json({ error: "Слишком быстро" });
    }

    lastAction[userId] = now;
  
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: "Нет userId" });

    const username = req.body.username || null;
    const firstName = req.body.firstName || null;
    const bet = Number(req.body.bet);

    const dbUser = await getOrCreateUser(userId, username, firstName);

    if (!Number.isFinite(bet) || bet <= 0) {
      return res.status(400).json({ error: "Некорректная ставка" });
    }
    if (bet > 10000) {
      return res.status(400).json({ error: "Слишком большая ставка" });
    }
    if (!Number.isInteger(bet)) {
      return res.status(400).json({ error: "Ставка должна быть целым числом" });
    }

    if (bet > dbUser.balance) {
      return res.status(400).json({ error: "Недостаточно баланса" });
    }

    const game = getGame(userId);
    game.bet = bet;
    game.deck = createDeck();
    game.player = [game.deck.pop(), game.deck.pop()];
    game.dealer = [game.deck.pop(), game.deck.pop()];
    game.gameOver = false;
    game.status = "Игра началась. Твой ход.";

    const playerScore = calculateScore(game.player);
    const dealerScore = calculateScore(game.dealer);

    if (playerScore === 21 && dealerScore === 21) {
      game.gameOver = true;
      game.status = "У обоих Blackjack. Ничья.";
      await logAction(userId, "start_double_blackjack");
      return res.json(await buildState(userId, false));
    }

    if (playerScore === 21) {
      game.gameOver = true;
      const blackjackWin = Math.floor(game.bet * 1.5);
      await updateBalance(userId, dbUser.balance + blackjackWin);
      game.status = `Blackjack! Ты выиграл +${blackjackWin}!`;
      await logAction(userId, "start_player_blackjack");
      return res.json(await buildState(userId, false));
    }

    if (dealerScore === 21) {
      game.gameOver = true;
      await updateBalance(userId, dbUser.balance - game.bet);
      game.status = `У дилера Blackjack. Ты проиграл -${game.bet}.`;
      await logAction(userId, "start_dealer_blackjack");
      return res.json(await buildState(userId, false));
    }

    await logAction(userId, "start_game");
    res.json(await buildState(userId, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/game/hit", verifyTelegram, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: "Нет userId" });

    const dbUser = await getOrCreateUser(userId, null, null);
    const game = getGame(userId);

    if (game.gameOver) {
      return res.status(400).json({ error: "Игра уже завершена" });
    }

    if (!game.deck.length) {
      return res.status(400).json({ error: "Игра не начата" });
    }

    game.player.push(game.deck.pop());

    const playerScore = calculateScore(game.player);

    if (playerScore > 21) {
      game.gameOver = true;
      await updateBalance(userId, dbUser.balance - game.bet);
      game.status = `Перебор! Ты проиграл -${game.bet}.`;
      await logAction(userId, "hit_bust");
      return res.json(await buildState(userId, false));
    }

    game.status = "Ты взял карту.";
    await logAction(userId, "hit");
    res.json(await buildState(userId, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/game/stand", verifyTelegram, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: "Нет userId" });

    const dbUser = await getOrCreateUser(userId, null, null);
    const game = getGame(userId);

    if (game.gameOver) {
      return res.status(400).json({ error: "Игра уже завершена" });
    }

    if (!game.deck.length) {
      return res.status(400).json({ error: "Игра не начата" });
    }

    dealerTurn(game);

    const playerScore = calculateScore(game.player);
    const dealerScore = calculateScore(game.dealer);

    game.gameOver = true;

    if (dealerScore > 21) {
      await updateBalance(userId, dbUser.balance + game.bet);
      game.status = `У дилера перебор! Ты выиграл +${game.bet}.`;
      await logAction(userId, "finish_dealer_bust");
      return res.json(await buildState(userId, false));
    }

    if (playerScore > dealerScore) {
      await updateBalance(userId, dbUser.balance + game.bet);
      game.status = `Ты выиграл +${game.bet}!`;
      await logAction(userId, "finish_win");
      return res.json(await buildState(userId, false));
    }

    if (playerScore < dealerScore) {
      await updateBalance(userId, dbUser.balance - game.bet);
      game.status = `Ты проиграл -${game.bet}.`;
      await logAction(userId, "finish_lose");
      return res.json(await buildState(userId, false));
    }

    game.status = "Ничья.";
    await logAction(userId, "finish_push");
    res.json(await buildState(userId, false));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/bonus/rescue", verifyTelegram, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: "Нет userId" });

    const dbUser = await getOrCreateUser(userId, null, null);
    const game = getGame(userId);

    if (dbUser.balance !== 0) {
      return res.status(400).json({ error: "Rescue bonus доступен только при балансе 0" });
    }

    if (!game.gameOver) {
      return res.status(400).json({ error: "Нельзя получать бонус во время активной игры" });
    }

    await updateBalance(userId, 1000);
    game.status = "Ты получил rescue bonus: +1000";
    await logAction(userId, "rescue_bonus");

    res.json(await buildState(userId, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/admin/user", verifyTelegram, async (req, res) => {
  try {
    const adminId = getUserId(req);

    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: "Нет доступа" });
    }

    const targetId = String(req.body.targetId || "").trim();
    if (!targetId) {
      return res.status(400).json({ error: "Нет targetId" });
    }

    const user = await getUserByTelegramId(targetId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const logs = await getUserLogs(targetId, 20);

    res.json({ user, logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/leaderboard", async (req, res) => {

  const { rows } = await pool.query(`
    SELECT telegram_id, balance
    FROM users
    ORDER BY balance DESC
    LIMIT 10
  `);

  res.json(rows);

});

app.post("/api/admin/balance", verifyTelegram, async (req, res) => {
  try {
    const adminId = getUserId(req);

    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: "Нет доступа" });
    }

    const targetId = String(req.body.targetId || "").trim();
    const amount = Number(req.body.amount);

    if (!targetId || !Number.isFinite(amount)) {
      return res.status(400).json({ error: "Некорректные данные" });
    }

    const updated = await changeBalance(targetId, amount);

    if (!updated) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    await addGameLog({
      telegramId: Number(targetId),
      action: "admin_balance_change",
      status: `Админ изменил баланс на ${amount}`,
      bet: 0,
      balance: updated.balance,
      playerCards: [],
      dealerCards: [],
      playerScore: 0,
      dealerScore: 0
    });

    res.json({ user: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB init error:", err);
  });
