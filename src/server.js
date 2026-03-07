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
  deck: [],
  player: [],
  dealer: [],
  gameOver: true,
  status: "Нажми 'Новая игра'"
};

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

function getPublicGameState(hideDealerSecondCard = true) {
  return {
    balance: gameState.balance,
    player: gameState.player.map(formatCard),
    dealer: hideDealerSecondCard && !gameState.gameOver
      ? [
          gameState.dealer[0] ? formatCard(gameState.dealer[0]) : "🂠",
          "🂠"
        ]
      : gameState.dealer.map(formatCard),
    playerScore: calculateScore(gameState.player),
    dealerScore: hideDealerSecondCard && !gameState.gameOver
      ? getCardValue(gameState.dealer[0] || { rank: "0", suit: "" })
      : calculateScore(gameState.dealer),
    gameOver: gameState.gameOver,
    status: gameState.status
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
    gameState.status = "Перебор! Ты проиграл.";
    return;
  }

  if (dealerScore > 21) {
    gameState.balance += 100;
    gameState.status = "У дилера перебор! Ты выиграл +100.";
    return;
  }

  if (playerScore > dealerScore) {
    gameState.balance += 100;
    gameState.status = "Ты выиграл +100!";
    return;
  }

  if (playerScore < dealerScore) {
    gameState.balance -= 100;
    gameState.status = "Ты проиграл -100.";
    return;
  }

  gameState.status = "Ничья.";
}

// ------------------------
// API
// ------------------------
app.post("/api/game/start", (req, res) => {
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
  } else if (playerScore === 21) {
    gameState.gameOver = true;
    gameState.balance += 150;
    gameState.status = "Blackjack! Ты выиграл +150!";
  } else if (dealerScore === 21) {
    gameState.gameOver = true;
    gameState.balance -= 100;
    gameState.status = "У дилера Blackjack. Ты проиграл -100.";
  }

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
    gameState.balance -= 100;
    gameState.status = "Перебор! Ты проиграл -100.";
    return res.json(getPublicGameState(false));
  }

  gameState.status = "Ты взял карту.";
  res.json(getPublicGameState(true));
});

app.post("/api/game/stand", (req, res) => {
  if (gameState.gameOver) {
    return res.status(400).json({ error: "Игра уже завершена" });
  }

  dealerTurn();
  finishGame();

  res.json(getPublicGameState(false));
});

// Доп. эндпоинт для начальной загрузки
app.get("/api/game/state", (req, res) => {
  res.json(getPublicGameState(true));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
