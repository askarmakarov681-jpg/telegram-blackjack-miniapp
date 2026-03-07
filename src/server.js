import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", express.static(path.join(__dirname, "..", "public")));

// ------------------------
// Временное хранилище игры
// ------------------------
let gameState = {
  balance: 1000,
  bet: 50,
  deck: [],
  player: [],
  dealer: [],
  gameOver: true,
  status: "Нажми 'Новая игра'"
};

let gameLogs = [];

// ------------------------
// Карты и логика
// ------------------------
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

function addLog(action, extra = {}) {
  gameLogs.unshift({
    time: new Date().toLocaleString("ru-RU"),
    action,
    balance: gameState.balance,
    bet: gameState.bet,
    player: gameState.player.map(formatCard),
    dealer: gameState.dealer.map(formatCard),
    playerScore: calculateScore(gameState.player),
    dealerScore: calculateScore(gameState.dealer),
    gameOver: gameState.gameOver,
    status: gameState.status,
    ...extra
  });

  if (gameLogs.length > 20) {
    gameLogs = gameLogs.slice(0, 20);
  }
}

function getPublicGameState(hideDealerSecondCard = true) {
  const playerScore = calculateScore(gameState.player);

  let dealerCards = [];
  let dealerScore = 0;

  if (hideDealerSecondCard && !gameState.gameOver) {
    dealerCards = [
      gameState.dealer[0] ? formatCard(gameState.dealer[0]) : "🂠",
      "🂠"
    ];
    dealerScore = gameState.dealer[0] ? getCardValue(gameState.dealer[0]) : 0;
  } else {
    dealerCards = gameState.dealer.map(formatCard);
    dealerScore = calculateScore(gameState.dealer);
  }

  return {
    balance: gameState.balance,
    bet: gameState.bet,
    player: gameState.player.map(formatCard),
    dealer: dealerCards,
    playerScore,
    dealerScore,
    gameOver: gameState.gameOver,
    status: gameState.status,
    logs: gameLogs
  };
}

function dealerTurn() {
  while (calculateScore(gameState.dealer) < 17) {
    gameState.dealer.push(gameState.deck.pop());
  }
}

function finishGame() {
  const playerScore = calculateScore(gameState.player);
  const dealerScore = calculateScore(gameState.dealer);

  gameState.gameOver = true;

  if (playerScore > 21) {
    gameState.balance -= gameState.bet;
    gameState.status = `Перебор! Ты проиграл -${gameState.bet}.`;
    addLog("finish_bust");
    return;
  }

  if (dealerScore > 21) {
    gameState.balance += gameState.bet;
    gameState.status = `У дилера перебор! Ты выиграл +${gameState.bet}.`;
    addLog("finish_dealer_bust");
    return;
  }

  if (playerScore > dealerScore) {
    gameState.balance += gameState.bet;
    gameState.status = `Ты выиграл +${gameState.bet}!`;
    addLog("finish_win");
    return;
  }

  if (playerScore < dealerScore) {
    gameState.balance -= gameState.bet;
    gameState.status = `Ты проиграл -${gameState.bet}.`;
    addLog("finish_lose");
    return;
  }

  gameState.status = "Ничья.";
  addLog("finish_push");
}

// ------------------------
// API
// ------------------------
app.post("/api/game/start", (req, res) => {
  const bet = Number(req.body.bet);

  if (!Number.isFinite(bet) || bet <= 0) {
    return res.status(400).json({ error: "Некорректная ставка" });
  }

  if (bet > gameState.balance) {
    return res.status(400).json({ error: "Недостаточно баланса" });
  }

  gameState.bet = Math.floor(bet);
  gameState.deck = createDeck();
  gameState.player = [gameState.deck.pop(), gameState.deck.pop()];
  gameState.dealer = [gameState.deck.pop(), gameState.deck.pop()];
  gameState.gameOver = false;
  gameState.status = "Игра началась. Твой ход.";

  const playerScore = calculateScore(gameState.player);
  const dealerScore = calculateScore(gameState.dealer);

  if (playerScore === 21 && dealerScore === 21) {
    gameState.gameOver = true;
    gameState.status = "У обоих Blackjack. Ничья.";
    addLog("start_double_blackjack");
    return res.json(getPublicGameState(false));
  }

  if (playerScore === 21) {
    gameState.gameOver = true;
    const blackjackWin = Math.floor(gameState.bet * 1.5);
    gameState.balance += blackjackWin;
    gameState.status = `Blackjack! Ты выиграл +${blackjackWin}!`;
    addLog("start_player_blackjack", { blackjackWin });
    return res.json(getPublicGameState(false));
  }

  if (dealerScore === 21) {
    gameState.gameOver = true;
    gameState.balance -= gameState.bet;
    gameState.status = `У дилера Blackjack. Ты проиграл -${gameState.bet}.`;
    addLog("start_dealer_blackjack");
    return res.json(getPublicGameState(false));
  }

  addLog("start_game");
  res.json(getPublicGameState(true));
});

app.post("/api/game/hit", (req, res) => {
  if (gameState.gameOver) {
    return res.status(400).json({ error: "Игра уже завершена" });
  }

  gameState.player.push(gameState.deck.pop());

  const playerScore = calculateScore(gameState.player);

  if (playerScore > 21) {
    gameState.gameOver = true;
    gameState.balance -= gameState.bet;
    gameState.status = `Перебор! Ты проиграл -${gameState.bet}.`;
    addLog("hit_bust");
    return res.json(getPublicGameState(false));
  }

  gameState.status = "Ты взял карту.";
  addLog("hit");
  res.json(getPublicGameState(true));
});

app.post("/api/game/stand", (req, res) => {
  if (gameState.gameOver) {
    return res.status(400).json({ error: "Игра уже завершена" });
  }

  dealerTurn();
  addLog("dealer_turn");
  finishGame();

  res.json(getPublicGameState(false));
});

app.get("/api/game/state", (req, res) => {
  res.json(getPublicGameState(true));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
