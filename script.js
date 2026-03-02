const ROUND_SIZES = [3, 4, 5, 6];
const TOTAL_ROUNDS = ROUND_SIZES.length;
const STORAGE_KEY = "xo-difficulty";
const WIN_LENGTH_BY_SIZE = {
  3: 3,
  4: 3,
  5: 3,
  6: 4,
};

const boardEl = document.getElementById("board");
const roundCounterEl = document.getElementById("roundCounter");
const scoreCounterEl = document.getElementById("scoreCounter");
const statusTextEl = document.getElementById("statusText");
const difficultyButtonsWrap = document.getElementById("difficultyButtons");
const controlsEl = document.querySelector(".controls");
const startBtn = document.getElementById("startBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const restartBtn = document.getElementById("restartBtn");
const winModalEl = document.getElementById("winModal");
const winTextEl = document.getElementById("winText");
const declineBtn = document.getElementById("declineBtn");
const playAgainBtn = document.getElementById("playAgainBtn");

const state = {
  round: 1,
  boardSize: ROUND_SIZES[0],
  winLength: WIN_LENGTH_BY_SIZE[ROUND_SIZES[0]],
  board: [],
  isPlaying: false,
  isRoundFinished: false,
  difficulty: null,
  playerSymbol: "O",
  botSymbol: "X",
  playerWins: 0,
  botWins: 0,
  draws: 0,
  seriesActive: false,
  botTurnTimer: null,
};

const windowsCache = new Map();

init();

function init() {
  const savedDifficulty = localStorage.getItem(STORAGE_KEY);
  if (savedDifficulty && ["easy", "medium", "hard"].includes(savedDifficulty)) {
    state.difficulty = savedDifficulty;
    highlightDifficulty(savedDifficulty);
    startBtn.classList.remove("hidden");
  }

  difficultyButtonsWrap.addEventListener("click", onDifficultyClick);
  startBtn.addEventListener("click", startSeries);
  nextRoundBtn.addEventListener("click", startNextRound);
  restartBtn.addEventListener("click", startSeries);
  declineBtn.addEventListener("click", declineNewGame);
  playAgainBtn.addEventListener("click", playAgainFromModal);

  renderBoard(ROUND_SIZES[0]);
  updateCounters();
  updateMobileControls();
}

function onDifficultyClick(event) {
  const button = event.target.closest(".difficulty-btn");
  if (!button) {
    return;
  }

  state.difficulty = button.dataset.level;
  localStorage.setItem(STORAGE_KEY, state.difficulty);
  highlightDifficulty(state.difficulty);

  startBtn.classList.remove("hidden");
  nextRoundBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");

  statusTextEl.textContent = `Сложность: ${difficultyLabel(state.difficulty)}. Нажмите "Начать игру".`;
}

function highlightDifficulty(selectedLevel) {
  const buttons = difficultyButtonsWrap.querySelectorAll(".difficulty-btn");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.level === selectedLevel);
  });
}

function startSeries() {
  if (!state.difficulty) {
    statusTextEl.textContent = "Сначала выберите сложность.";
    return;
  }

  hideWinModal();
  clearTimeout(state.botTurnTimer);

  state.round = 1;
  state.playerWins = 0;
  state.botWins = 0;
  state.draws = 0;
  state.seriesActive = true;

  startBtn.classList.add("hidden");
  nextRoundBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
  updateMobileControls();

  setupRound();
}

function startNextRound() {
  clearTimeout(state.botTurnTimer);

  if (nextRoundBtn.dataset.mode === "retry") {
    nextRoundBtn.classList.add("hidden");
    setupRound();
    return;
  }

  if (state.round < TOTAL_ROUNDS) {
    state.round += 1;
  }

  nextRoundBtn.classList.add("hidden");
  setupRound();
}

function setupRound() {
  state.boardSize = ROUND_SIZES[state.round - 1];
  state.winLength = WIN_LENGTH_BY_SIZE[state.boardSize] || 3;
  state.board = Array(state.boardSize * state.boardSize).fill(null);
  state.isPlaying = true;
  state.isRoundFinished = false;

  renderBoard(state.boardSize);
  updateCounters();
  const roundInfo = `Раунд ${state.round}: ваш ход (синий O). Цель: ${state.winLength} подряд.`;
  statusTextEl.textContent = state.round === 1
    ? `${roundInfo} Первый раунд тренировочный (легкий).`
    : roundInfo;
}

function renderBoard(size) {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.dataset.locked = state.isPlaying ? "false" : "true";

  const totalCells = size * size;
  for (let i = 0; i < totalCells; i += 1) {
    const cell = document.createElement("button");
    const row = Math.floor(i / size);
    const col = i % size;

    cell.type = "button";
    cell.className = "cell";
    if (col < size - 1) {
      cell.classList.add("line-right");
    }
    if (row < size - 1) {
      cell.classList.add("line-bottom");
    }

    cell.dataset.index = String(i);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `Клетка ${i + 1}`);
    cell.addEventListener("click", onCellClick);
    boardEl.appendChild(cell);
  }
}

function onCellClick(event) {
  if (!state.isPlaying || state.isRoundFinished) {
    return;
  }

  const cell = event.currentTarget;
  const index = Number(cell.dataset.index);

  if (state.board[index]) {
    return;
  }

  placeSymbol(index, state.playerSymbol);

  if (handleRoundResult(state.playerSymbol)) {
    return;
  }

  statusTextEl.textContent = "Ход бота...";
  state.botTurnTimer = setTimeout(botMove, 360);
}

function botMove() {
  if (!state.isPlaying || state.isRoundFinished) {
    return;
  }

  const index = chooseBotMove();
  if (index === -1) {
    return;
  }

  placeSymbol(index, state.botSymbol);

  if (handleRoundResult(state.botSymbol)) {
    return;
  }

  statusTextEl.textContent = `Раунд ${state.round}: ваш ход (синий O).`;
}

function chooseBotMove() {
  const free = availableMoves();
  if (!free.length) {
    return -1;
  }

  const activeDifficulty = getActiveDifficulty();

  if (activeDifficulty === "easy") {
    return randomFrom(free);
  }

  if (activeDifficulty === "medium") {
    const mustWin = findImmediateMove(state.botSymbol);
    if (mustWin !== -1) {
      return mustWin;
    }

    const mustBlock = findImmediateMove(state.playerSymbol);
    if (mustBlock !== -1) {
      return mustBlock;
    }

    const playSmart = Math.random() < 0.6;
    return playSmart ? bestHeuristicMove(free, 0.65) : randomFrom(free);
  }

  const winNow = findImmediateMove(state.botSymbol);
  if (winNow !== -1) {
    return winNow;
  }

  const blockNow = findImmediateMove(state.playerSymbol);
  if (blockNow !== -1) {
    return blockNow;
  }

  return bestHeuristicMove(free, 1);
}

function bestHeuristicMove(freeMoves, intensity) {
  const center = Math.floor(state.boardSize / 2);
  let bestMove = freeMoves[0];
  let bestScore = -Infinity;

  freeMoves.forEach((move) => {
    state.board[move] = state.botSymbol;

    const lineScore = evaluateLines(state.botSymbol) - evaluateLines(state.playerSymbol) * 0.88;

    const row = Math.floor(move / state.boardSize);
    const col = move % state.boardSize;
    const centerDistance = Math.abs(center - row) + Math.abs(center - col);
    const centerBias = (state.boardSize - centerDistance) * 2.2;

    const cornerBias = isCorner(row, col, state.boardSize) ? 3.6 : 0;
    const score = lineScore * intensity + centerBias + cornerBias;

    state.board[move] = null;

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });

  return bestMove;
}

function evaluateLines(symbol) {
  const opponent = symbol === state.playerSymbol ? state.botSymbol : state.playerSymbol;
  const lines = getWinningWindows(state.boardSize, state.winLength);
  let total = 0;

  lines.forEach((line) => {
    let symbolCount = 0;
    let opponentCount = 0;

    line.forEach((index) => {
      if (state.board[index] === symbol) {
        symbolCount += 1;
      } else if (state.board[index] === opponent) {
        opponentCount += 1;
      }
    });

    if (symbolCount > 0 && opponentCount > 0) {
      return;
    }

    if (symbolCount > 0) {
      total += Math.pow(4, symbolCount);
    }
  });

  return total;
}

function isCorner(row, col, size) {
  const max = size - 1;
  return (row === 0 || row === max) && (col === 0 || col === max);
}

function findImmediateMove(symbol) {
  const free = availableMoves();
  for (let i = 0; i < free.length; i += 1) {
    const move = free[i];
    state.board[move] = symbol;
    const win = hasWinner(symbol);
    state.board[move] = null;

    if (win) {
      return move;
    }
  }

  return -1;
}

function availableMoves() {
  const moves = [];
  for (let i = 0; i < state.board.length; i += 1) {
    if (!state.board[i]) {
      moves.push(i);
    }
  }
  return moves;
}

function placeSymbol(index, symbol) {
  state.board[index] = symbol;

  const cell = boardEl.children[index];
  cell.classList.add(symbol === "X" ? "mark-x" : "mark-o", "disabled");
  cell.disabled = true;
}

function handleRoundResult(lastSymbol) {
  if (hasWinner(lastSymbol)) {
    endRound(lastSymbol === state.playerSymbol ? "player" : "bot");
    return true;
  }

  if (availableMoves().length === 0) {
    endRound("draw");
    return true;
  }

  return false;
}

function endRound(result) {
  state.isPlaying = false;
  state.isRoundFinished = true;
  boardEl.dataset.locked = "true";

  if (result === "player") {
    state.playerWins += 1;
    statusTextEl.textContent = `Раунд ${state.round}: победа!`;
  } else if (result === "bot") {
    state.botWins += 1;
    statusTextEl.textContent = `Раунд ${state.round}: бот победил.`;
  } else {
    state.draws += 1;
    statusTextEl.textContent = `Раунд ${state.round}: ничья.`;
  }

  updateCounters();

  if (result === "player") {
    if (state.round < TOTAL_ROUNDS) {
      nextRoundBtn.dataset.mode = "next";
      nextRoundBtn.textContent = "Следующий раунд";
      nextRoundBtn.classList.remove("hidden");
      restartBtn.classList.add("hidden");
      startBtn.classList.add("hidden");
      statusTextEl.textContent = `Раунд ${state.round}: победа! Можно перейти дальше.`;
    } else {
      showFinalMessage();
    }
    return;
  }

  nextRoundBtn.dataset.mode = "retry";
  nextRoundBtn.textContent = "Переиграть раунд";
  nextRoundBtn.classList.remove("hidden");
  restartBtn.classList.add("hidden");
  startBtn.classList.add("hidden");

  if (result === "bot") {
    statusTextEl.textContent = `Раунд ${state.round}: бот победил. Чтобы перейти дальше, нужно выиграть раунд.`;
  } else {
    statusTextEl.textContent = `Раунд ${state.round}: ничья. Чтобы перейти дальше, нужно выиграть раунд.`;
  }
}

function showFinalMessage() {
  nextRoundBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
  startBtn.classList.add("hidden");

  const resultLine = "Поздравляем! Вы прошли все 4 раунда.";
  statusTextEl.textContent = `${resultLine} Итог: ${state.playerWins}:${state.botWins}, ничьих: ${state.draws}.`;
  showWinModal(resultLine);
}

function updateCounters() {
  roundCounterEl.textContent = `Раунд ${state.round} / ${TOTAL_ROUNDS}`;
  scoreCounterEl.textContent = `Вы ${state.playerWins} : ${state.botWins} Бот`;
}

function hasWinner(symbol) {
  const lines = getWinningWindows(state.boardSize, state.winLength);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let allSame = true;

    for (let j = 0; j < line.length; j += 1) {
      if (state.board[line[j]] !== symbol) {
        allSame = false;
        break;
      }
    }

    if (allSame) {
      return true;
    }
  }

  return false;
}

function getWinningWindows(size, targetLength) {
  const cacheKey = `${size}x${targetLength}`;
  if (windowsCache.has(cacheKey)) {
    return windowsCache.get(cacheKey);
  }

  const windows = [];

  // Горизонтальные отрезки.
  for (let row = 0; row < size; row += 1) {
    for (let startCol = 0; startCol <= size - targetLength; startCol += 1) {
      const line = [];
      for (let k = 0; k < targetLength; k += 1) {
        line.push(row * size + (startCol + k));
      }
      windows.push(line);
    }
  }

  // Вертикальные отрезки.
  for (let col = 0; col < size; col += 1) {
    for (let startRow = 0; startRow <= size - targetLength; startRow += 1) {
      const line = [];
      for (let k = 0; k < targetLength; k += 1) {
        line.push((startRow + k) * size + col);
      }
      windows.push(line);
    }
  }

  // Диагонали сверху-слева вниз-вправо.
  for (let startRow = 0; startRow <= size - targetLength; startRow += 1) {
    for (let startCol = 0; startCol <= size - targetLength; startCol += 1) {
      const line = [];
      for (let k = 0; k < targetLength; k += 1) {
        line.push((startRow + k) * size + (startCol + k));
      }
      windows.push(line);
    }
  }

  // Диагонали сверху-справа вниз-влево.
  for (let startRow = 0; startRow <= size - targetLength; startRow += 1) {
    for (let startCol = targetLength - 1; startCol < size; startCol += 1) {
      const line = [];
      for (let k = 0; k < targetLength; k += 1) {
        line.push((startRow + k) * size + (startCol - k));
      }
      windows.push(line);
    }
  }

  windowsCache.set(cacheKey, windows);
  return windows;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function difficultyLabel(level) {
  if (level === "easy") {
    return "Легко";
  }

  if (level === "medium") {
    return "Нормально";
  }

  return "Сложно";
}

function getActiveDifficulty() {
  if (state.round === 1) {
    return "easy";
  }

  return state.difficulty;
}

function showWinModal(message) {
  winTextEl.textContent = `${message} Хотите сыграть снова?`;
  winModalEl.classList.add("show");
}

function hideWinModal() {
  winModalEl.classList.remove("show");
}

function declineNewGame() {
  hideWinModal();
  state.seriesActive = false;
  statusTextEl.textContent = "Вы отказались от новой игры. Спасибо за игру!";
  nextRoundBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
  startBtn.classList.remove("hidden");
  startBtn.textContent = "Начать игру";
  updateMobileControls();
}

function playAgainFromModal() {
  hideWinModal();
  startSeries();
}

function updateMobileControls() {
  controlsEl.classList.toggle("mobile-locked", state.seriesActive);
}
