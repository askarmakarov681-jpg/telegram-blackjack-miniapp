import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", express.static(path.join(__dirname, "..", "public")));

// ========================
// Хранилище пользователей
// ========================
const users = {};

// ========================
// Карты и логика
// ========================
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
  const userId = req.body.userId || req.query.userId;
  return String(userId || "");
}

function getOrCreateUserState(userId) {
  if (!userId) return null;

  if (!users[userId]) {
    users[userId] = {
      balance: 1000,
      bet: 50,
      deck: [],
      player: [],
      dealer: [],
      gameOver: true,
      status: "Нажми 'Новая игра'",
      logs: []
    };
  }

  return users[userId];
}

function addLog(state, action, extra = {}) {
  state.logs.unshift({
    time: new Date().toLocaleString("ru-RU"),
    action,
    balance: state.balance,
    bet: state.bet,
    player: state.player.map(formatCard),
    dealer: state.dealer.map(formatCard),
    playerScore: calculateScore(state.player),
    dealerScore: calculateScore(state.dealer),
    gameOver: state.gameOver,
    status: state.status,
    ...extra
  });

  if (state.logs.length > 20) {
    state.logs = state.logs.slice(0, 20);
  }
}

function getPublicGameState(state, hideDealerSecondCard = true) {
  const playerScore = calculateScore(state.player);

  let dealerCards = [];
  let dealerScore = 0;

  if (hideDealerSecondCard && !state.gameOver) {
    dealerCards = [
      state.dealer[0] ? formatCard(state.dealer[0]) : "🂠",
      "🂠"
    ];
    dealerScore = state.dealer[0] ? getCardValue(state.dealer[0]) : 0;
  } else {
    dealerCards = state.dealer.map(formatCard);
    dealerScore = calculateScore(state.dealer);
  }

  return {
    balance: state.balance,
    bet: state.bet,
    player: state.player.map(formatCard),
    dealer: dealerCards,
    playerScore,
    dealerScore,
    gameOver: state.gameOver,
    status: state.status,
    logs: state.logs
  };
}

function dealerTurn(state) {
  while (calculateScore(state.dealer) < 17) {
    state.dealer.push(state.deck.pop());
  }
}

function finishGame(state) {
  const playerScore = calculateScore(state.player);
  const dealerScore = calculateScore(state.dealer);

  state.gameOver = true;

  if (playerScore > 21) {
    state.balance -= state.bet;
    state.status = `Перебор! Ты проиграл -${state.bet}.`;
    addLog(state, "finish_bust");
    return;
  }

  if (dealerScore > 21) {
    state.balance += state.bet;
    state.status = `У дилера перебор! Ты выиграл +${state.bet}.`;
    addLog(state, "finish_dealer_bust");
    return;
  }

  if (playerScore > dealerScore) {
    state.balance += state.bet;
    state.status = `Ты выиграл +${state.bet}!`;
    addLog(state, "finish_win");
    return;
  }

  if (playerScore < dealerScore) {
    state.balance -= state.bet;
    state.status = `Ты проиграл -${state.bet}.`;
    addLog(state, "finish_lose");
    return;
  }

  state.status = "Ничья.";
  addLog(state, "finish_push");
}

// ========================
// API
// ========================
app.post("/api/game/start", (req, res) => {
  const userId = getUserId(req);
  const state = getOrCreateUserState(userId);

  if (!state) {
    return res.status(400).json({ error: "Нет userId" });
  }

  const bet = Number(req.body.bet);

  if (!Number.isFinite(bet) || bet <= 0) {
    return res.status(400).json({ error: "Некорректная ставка" });
  }

  if (bet > state.balance) {
    return res.status(400).json({ error: "Недостаточно баланса" });
  }

  state.bet = Math.floor(bet);
  state.deck = createDeck();
  state.player = [state.deck.pop(), state.deck.pop()];
  state.dealer = [state.deck.pop(), state.deck.pop()];
  state.gameOver = false;
  state.status = "Игра началась. Твой ход.";

  const playerScore = calculateScore(state.player);
  const dealerScore = calculateScore(state.dealer);

  if (playerScore === 21 && dealerScore === 21) {
    state.gameOver = true;
    state.status = "У обоих Blackjack. Ничья.";
    addLog(state, "start_double_blackjack");
    return res.json(getPublicGameState(state, false));
  }

  if (playerScore === 21) {
    state.gameOver = true;
    const blackjackWin = Math.floor(state.bet * 1.5);
    state.balance += blackjackWin;
    state.status = `Blackjack! Ты выиграл +${blackjackWin}!`;
    addLog(state, "start_player_blackjack", { blackjackWin });
    return res.json(getPublicGameState(state, false));
  }

  if (dealerScore === 21) {
    state.gameOver = true;
    state.balance -= state.bet;
    state.status = `У дилера Blackjack. Ты проиграл -${state.bet}.`;
    addLog(state, "start_dealer_blackjack");
    return res.json(getPublicGameState(state, false));
  }

  addLog(state, "start_game");
  res.json(getPublicGameState(state, true));
});

app.post("/api/game/hit", (req, res) => {
  const userId = getUserId(req);
  const state = getOrCreateUserState(userId);

  if (!state) {
    return res.status(400).json({ error: "Нет userId" });
  }

  if (state.gameOver) {
    return res.status(400).json({ error: "Игра уже завершена" });
  }

  state.player.push(state.deck.pop());

  const playerScore = calculateScore(state.player);

  if (playerScore > 21) {
    state.gameOver = true;
    state.balance -= state.bet;
    state.status = `Перебор! Ты проиграл -${state.bet}.`;
    addLog(state, "hit_bust");
    return res.json(getPublicGameState(state, false));
  }

  state.status = "Ты взял карту.";
  addLog(state, "hit");
  res.json(getPublicGameState(state, true));
});

app.post("/api/game/stand", (req, res) => {
  const userId = getUserId(req);
  const state = getOrCreateUserState(userId);

  if (!state) {
    return res.status(400).json({ error: "Нет userId" });
  }

  if (state.gameOver) {
    return res.status(400).json({ error: "Игра уже завершена" });
  }

  dealerTurn(state);
  addLog(state, "dealer_turn");
  finishGame(state);

  res.json(getPublicGameState(state, false));
});

app.get("/api/game/state", (req, res) => {
  const userId = getUserId(req);
  const state = getOrCreateUserState(userId);

  if (!state) {
    return res.status(400).json({ error: "Нет userId" });
  }

  res.json(getPublicGameState(state, true));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
