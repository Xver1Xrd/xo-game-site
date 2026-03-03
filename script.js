const ROUND_SIZES = [3, 4, 5, 6];
const TOTAL_ROUNDS = ROUND_SIZES.length;
const STORAGE_KEY = "xo-difficulty";
const SYMBOL_STORAGE_KEY = "xo-player-symbol";
const WIN_LENGTH_BY_SIZE = {
  3: 3,
  4: 4,
  5: 5,
  6: 6,
};

const boardEl = document.getElementById("board");
const roundCounterEl = document.getElementById("roundCounter");
const scoreCounterEl = document.getElementById("scoreCounter");
const statusTextEl = document.getElementById("statusText");
const difficultyButtonsWrap = document.getElementById("difficultyButtons");
const symbolButtonsWrap = document.getElementById("symbolButtons");
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
  currentTurn: "X",
  pendingMoveSource: null,
  difficulty: null,
  playerSymbol: "O",
  botSymbol: "X",
  playerWins: 0,
  botWins: 0,
  draws: 0,
  roundAttempts: 1,
  seriesActive: false,
  botTurnTimer: null,
};

const windowsCache = new Map();

init();

function init() {
  let savedDifficulty = localStorage.getItem(STORAGE_KEY);
  if (savedDifficulty === "medium") {
    savedDifficulty = "hard";
    localStorage.setItem(STORAGE_KEY, savedDifficulty);
  }

  if (savedDifficulty && ["easy", "hard"].includes(savedDifficulty)) {
    state.difficulty = savedDifficulty;
    highlightDifficulty(savedDifficulty);
    startBtn.classList.remove("hidden");
  }

  const savedSymbol = localStorage.getItem(SYMBOL_STORAGE_KEY);
  const selectedSymbol = savedSymbol && ["X", "O"].includes(savedSymbol) ? savedSymbol : "O";
  applyPlayerSymbol(selectedSymbol);
  highlightSymbol(selectedSymbol);

  difficultyButtonsWrap.addEventListener("click", onDifficultyClick);
  symbolButtonsWrap.addEventListener("click", onSymbolClick);
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

function onSymbolClick(event) {
  const button = event.target.closest(".symbol-btn");
  if (!button) {
    return;
  }

  const symbol = button.dataset.symbol;
  applyPlayerSymbol(symbol);
  localStorage.setItem(SYMBOL_STORAGE_KEY, symbol);
  highlightSymbol(symbol);

  const difficultyText = state.difficulty ? difficultyLabel(state.difficulty) : "не выбрана";
  statusTextEl.textContent = `Вы выбрали ${symbolName(state.playerSymbol)}. Сложность: ${difficultyText}.`;
}

function highlightSymbol(selectedSymbol) {
  const buttons = symbolButtonsWrap.querySelectorAll(".symbol-btn");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.symbol === selectedSymbol);
  });
}

function applyPlayerSymbol(symbol) {
  state.playerSymbol = symbol;
  state.botSymbol = symbol === "X" ? "O" : "X";
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
  state.roundAttempts = 1;
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
    state.roundAttempts += 1;
    nextRoundBtn.classList.add("hidden");
    setupRound();
    return;
  }

  if (state.round < TOTAL_ROUNDS) {
    state.round += 1;
  }
  state.roundAttempts = 1;

  nextRoundBtn.classList.add("hidden");
  setupRound();
}

function setupRound() {
  state.boardSize = ROUND_SIZES[state.round - 1];
  const baseWinLength = WIN_LENGTH_BY_SIZE[state.boardSize] || 3;
  const handicapStep = getRoundHandicapStep();
  state.winLength = Math.max(3, baseWinLength - handicapStep);
  state.board = Array(state.boardSize * state.boardSize).fill(null);
  state.isPlaying = true;
  state.isRoundFinished = false;
  state.currentTurn = state.playerSymbol;
  state.pendingMoveSource = null;

  renderBoard(state.boardSize);
  updateCounters();
  const roundInfo = `Раунд ${state.round}. Цель: ${state.winLength} подряд.`;
  const trainingInfo = state.round === 1 ? " Первый раунд тренировочный (легкий)." : "";
  const assistInfo = handicapStep > 0 ? " Подсказка: эта попытка упрощена." : "";

  statusTextEl.textContent = `${roundInfo} Ваш ход (${symbolName(state.playerSymbol)}). Можно перенести свою фишку: нажмите на свою клетку, затем на пустую.${trainingInfo}${assistInfo}`;
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
  if (!state.isPlaying || state.isRoundFinished || state.currentTurn !== state.playerSymbol) {
    return;
  }

  const cell = event.currentTarget;
  const index = Number(cell.dataset.index);
  const mark = state.board[index];

  if (mark === state.playerSymbol) {
    if (state.pendingMoveSource === index) {
      clearPendingSource();
      statusTextEl.textContent = getPlayerTurnText();
      return;
    }

    clearPendingSource();
    state.pendingMoveSource = index;
    cell.classList.add("selected-source");
    statusTextEl.textContent = "Фишка выбрана. Нажмите на пустую клетку, чтобы поставить ее.";
    return;
  }

  if (mark === state.botSymbol) {
    return;
  }

  if (state.pendingMoveSource !== null) {
    const source = state.pendingMoveSource;
    clearPendingSource();
    clearMarkAt(source);
  }

  placeSymbol(index, state.playerSymbol);
  state.currentTurn = state.botSymbol;

  if (handleRoundResult(state.playerSymbol)) {
    return;
  }

  statusTextEl.textContent = "Ход бота...";
  state.botTurnTimer = setTimeout(botMove, 360);
}

function botMove() {
  if (!state.isPlaying || state.isRoundFinished || state.currentTurn !== state.botSymbol) {
    return;
  }

  const index = chooseBotMove();
  if (index === -1) {
    return;
  }

  placeSymbol(index, state.botSymbol);
  state.currentTurn = state.playerSymbol;

  if (handleRoundResult(state.botSymbol)) {
    return;
  }

  statusTextEl.textContent = getPlayerTurnText();
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

  if (activeDifficulty === "hard_relaxed") {
    return chooseRelaxedHardMove(free);
  }

  return chooseHardMove(free);
}

function chooseRelaxedHardMove(freeMoves) {
  const winNow = findImmediateMove(state.botSymbol);
  if (winNow !== -1) {
    return winNow;
  }

  const blockNow = findImmediateMove(state.playerSymbol);
  if (blockNow !== -1) {
    return blockNow;
  }

  const openingMove = chooseOpeningMove(freeMoves);
  if (openingMove !== -1) {
    return openingMove;
  }

  const playSmart = Math.random() < 0.56;
  if (playSmart) {
    const ranked = getRankedSearchMoves(freeMoves, 3);
    if (ranked.length) {
      return selectHardMoveWithVariance(ranked, freeMoves.length);
    }

    return bestHeuristicMove(freeMoves, 0.9);
  }

  const candidates = getCandidateMoves(freeMoves);
  return randomFrom(candidates.length ? candidates : freeMoves);
}

function chooseHardMove(freeMoves) {
  const winNow = findImmediateMove(state.botSymbol);
  if (winNow !== -1) {
    return winNow;
  }

  const blockNow = findImmediateMove(state.playerSymbol);
  if (blockNow !== -1) {
    return blockNow;
  }

  const botFork = findForkMove(state.botSymbol);
  if (botFork !== -1) {
    return botFork;
  }

  const forkDefense = findBestForkDefense(freeMoves);
  if (forkDefense !== -1) {
    return forkDefense;
  }

  const openingMove = chooseOpeningMove(freeMoves);
  if (openingMove !== -1) {
    return openingMove;
  }

  const rankedSearch = getRankedSearchMoves(freeMoves, 4);
  if (rankedSearch.length) {
    return selectHardMoveWithVariance(rankedSearch, freeMoves.length);
  }

  return bestHeuristicMove(freeMoves, 1.12);
}

function findForkMove(symbol) {
  const free = availableMoves();
  let bestMove = -1;
  let bestWins = -1;

  for (let i = 0; i < free.length; i += 1) {
    const move = free[i];
    state.board[move] = symbol;
    const winningReplies = countImmediateWinningMoves(symbol);
    state.board[move] = null;

    if (winningReplies >= 2 && winningReplies > bestWins) {
      bestWins = winningReplies;
      bestMove = move;
    }
  }

  return bestMove;
}

function countImmediateWinningMoves(symbol) {
  const free = availableMoves();
  let count = 0;

  for (let i = 0; i < free.length; i += 1) {
    const move = free[i];
    state.board[move] = symbol;
    if (hasWinner(symbol)) {
      count += 1;
    }
    state.board[move] = null;
  }

  return count;
}

function findBestForkDefense(freeMoves) {
  const opponentForks = countForkMovesForSymbol(state.playerSymbol);
  if (opponentForks === 0) {
    return -1;
  }

  let bestMove = -1;
  let bestRemainingForks = Infinity;
  let bestScore = -Infinity;

  for (let i = 0; i < freeMoves.length; i += 1) {
    const move = freeMoves[i];
    state.board[move] = state.botSymbol;
    const remainingForks = countForkMovesForSymbol(state.playerSymbol);
    const score = evaluateBoardState();
    state.board[move] = null;

    if (remainingForks < bestRemainingForks || (remainingForks === bestRemainingForks && score > bestScore)) {
      bestRemainingForks = remainingForks;
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

function countForkMovesForSymbol(symbol) {
  const free = availableMoves();
  let forks = 0;

  for (let i = 0; i < free.length; i += 1) {
    if (moveCreatesFork(free[i], symbol)) {
      forks += 1;
    }
  }

  return forks;
}

function moveCreatesFork(move, symbol) {
  state.board[move] = symbol;
  const winningReplies = countImmediateWinningMoves(symbol);
  state.board[move] = null;
  return winningReplies >= 2;
}

function chooseOpeningMove(freeMoves) {
  const occupiedCount = state.board.length - freeMoves.length;
  const centerCells = getCenterCells(state.boardSize).filter((index) => !state.board[index]);

  if (occupiedCount === 0) {
    if (centerCells.length) {
      return randomFrom(centerCells);
    }
    return -1;
  }

  if (occupiedCount === 1) {
    if (centerCells.length) {
      return centerCells[0];
    }

    const corners = [
      0,
      state.boardSize - 1,
      state.boardSize * (state.boardSize - 1),
      state.boardSize * state.boardSize - 1,
    ].filter((index) => !state.board[index]);

    if (corners.length) {
      return randomFrom(corners);
    }
  }

  return -1;
}

function getCenterCells(size) {
  if (size % 2 === 1) {
    const mid = Math.floor(size / 2);
    return [mid * size + mid];
  }

  const right = size / 2;
  const left = right - 1;
  return [
    left * size + left,
    left * size + right,
    right * size + left,
    right * size + right,
  ];
}

function findBestMoveBySearch(freeMoves) {
  const ranked = getRankedSearchMoves(freeMoves, 1);
  return ranked.length ? ranked[0].move : -1;
}

function getRankedSearchMoves(freeMoves, topCount) {
  const depth = getSearchDepth(freeMoves.length);
  if (depth <= 0) {
    return [];
  }

  const maxCandidates = state.boardSize <= 4 ? 10 : (state.boardSize === 5 ? 8 : 7);
  const candidates = getCandidateMoves(freeMoves);
  const orderedMoves = getOrderedMoves(state.botSymbol, candidates, maxCandidates);

  const scoredMoves = [];

  for (let i = 0; i < orderedMoves.length; i += 1) {
    const move = orderedMoves[i];
    state.board[move] = state.botSymbol;
    const score = minimax(depth - 1, -Infinity, Infinity, false);
    state.board[move] = null;
    scoredMoves.push({ move, score });
  }

  scoredMoves.sort((a, b) => b.score - a.score);
  return scoredMoves.slice(0, Math.max(1, topCount));
}

function selectHardMoveWithVariance(rankedMoves, freeCount) {
  if (rankedMoves.length === 1) {
    return rankedMoves[0].move;
  }

  const best = rankedMoves[0];
  const second = rankedMoves[1];
  const gap = best.score - second.score;

  // Явно лучший ход не портим.
  if (gap >= 4500) {
    return best.move;
  }

  let imperfectionChance = state.boardSize >= 5 ? 0.18 : 0.12;
  if (freeCount <= 7) {
    imperfectionChance *= 0.5;
  }

  if (Math.random() > imperfectionChance) {
    return best.move;
  }

  const poolSize = Math.min(rankedMoves.length, freeCount > 10 ? 3 : 2);
  const altIndex = 1 + Math.floor(Math.random() * (poolSize - 1));
  return rankedMoves[altIndex].move;
}

function minimax(depth, alpha, beta, isBotTurn) {
  if (hasWinner(state.botSymbol)) {
    return 100000 + depth;
  }

  if (hasWinner(state.playerSymbol)) {
    return -100000 - depth;
  }

  const free = availableMoves();
  if (!free.length) {
    return 0;
  }

  if (depth <= 0) {
    return evaluateBoardState();
  }

  const symbol = isBotTurn ? state.botSymbol : state.playerSymbol;
  const maxCandidates = state.boardSize <= 4 ? 10 : (state.boardSize === 5 ? 9 : 7);
  const candidates = getCandidateMoves(free);
  const orderedMoves = getOrderedMoves(symbol, candidates, maxCandidates);

  if (isBotTurn) {
    let bestScore = -Infinity;

    for (let i = 0; i < orderedMoves.length; i += 1) {
      const move = orderedMoves[i];
      state.board[move] = symbol;
      const score = minimax(depth - 1, alpha, beta, false);
      state.board[move] = null;

      if (score > bestScore) {
        bestScore = score;
      }

      if (score > alpha) {
        alpha = score;
      }

      if (alpha >= beta) {
        break;
      }
    }

    return bestScore;
  }

  let bestScore = Infinity;

  for (let i = 0; i < orderedMoves.length; i += 1) {
    const move = orderedMoves[i];
    state.board[move] = symbol;
    const score = minimax(depth - 1, alpha, beta, true);
    state.board[move] = null;

    if (score < bestScore) {
      bestScore = score;
    }

    if (score < beta) {
      beta = score;
    }

    if (alpha >= beta) {
      break;
    }
  }

  return bestScore;
}

function evaluateBoardState() {
  const botPressure = evaluateLines(state.botSymbol);
  const playerPressure = evaluateLines(state.playerSymbol);
  const positionControl = evaluatePositionalControl(state.botSymbol) - evaluatePositionalControl(state.playerSymbol);

  return botPressure - playerPressure * 1.15 + positionControl * 2.4;
}

function evaluatePositionalControl(symbol) {
  let score = 0;

  for (let i = 0; i < state.board.length; i += 1) {
    if (state.board[i] !== symbol) {
      continue;
    }

    const row = Math.floor(i / state.boardSize);
    const col = i % state.boardSize;
    score += getCenterBias(row, col);
  }

  return score;
}

function getOrderedMoves(symbol, movePool, limit) {
  const opponent = symbol === state.botSymbol ? state.playerSymbol : state.botSymbol;

  const scored = movePool.map((move) => {
    const row = Math.floor(move / state.boardSize);
    const col = move % state.boardSize;

    state.board[move] = symbol;

    let score = 0;
    if (hasWinner(symbol)) {
      score += 50000;
    }

    const pressure = evaluateLines(symbol) - evaluateLines(opponent) * 0.72;
    score += pressure;
    score += getCenterBias(row, col) * 2.3;

    state.board[move] = null;

    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.move);
}

function getSearchDepth(freeCount) {
  if (state.boardSize === 3) {
    return Math.min(7, freeCount);
  }

  if (state.boardSize === 4) {
    return freeCount > 10 ? 3 : 4;
  }

  if (state.boardSize === 5) {
    return freeCount > 16 ? 2 : 3;
  }

  return 2;
}

function getCandidateMoves(freeMoves) {
  const occupiedCount = state.board.length - freeMoves.length;
  if (occupiedCount <= 1) {
    return freeMoves;
  }

  const nearMoves = freeMoves.filter((move) => hasNeighborMark(move));
  return nearMoves.length ? nearMoves : freeMoves;
}

function hasNeighborMark(index) {
  const row = Math.floor(index / state.boardSize);
  const col = index % state.boardSize;

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) {
        continue;
      }

      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= state.boardSize || c < 0 || c >= state.boardSize) {
        continue;
      }

      if (state.board[r * state.boardSize + c]) {
        return true;
      }
    }
  }

  return false;
}

function getCenterBias(row, col) {
  const center = (state.boardSize - 1) / 2;
  const distance = Math.abs(row - center) + Math.abs(col - center);
  return state.boardSize - distance;
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
}

function clearMarkAt(index) {
  state.board[index] = null;
  const cell = boardEl.children[index];
  if (!cell) {
    return;
  }

  cell.classList.remove("mark-x", "mark-o", "disabled", "selected-source");
  cell.disabled = false;
}

function clearPendingSource() {
  if (state.pendingMoveSource === null) {
    return;
  }

  const cell = boardEl.children[state.pendingMoveSource];
  if (cell) {
    cell.classList.remove("selected-source");
  }

  state.pendingMoveSource = null;
}

function handleRoundResult(lastSymbol) {
  const winningLine = getWinningLine(lastSymbol);
  if (winningLine) {
    endRound(lastSymbol === state.playerSymbol ? "player" : "bot", winningLine, lastSymbol);
    return true;
  }

  if (availableMoves().length === 0) {
    endRound("draw", null, null);
    return true;
  }

  return false;
}

function endRound(result, winningLine, winnerSymbol) {
  state.isPlaying = false;
  state.isRoundFinished = true;
  boardEl.dataset.locked = "true";
  clearPendingSource();

  if (winningLine && winnerSymbol) {
    drawWinningLine(winningLine, winnerSymbol);
  }

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

  if (result === "player" || result === "draw") {
    if (state.round < TOTAL_ROUNDS) {
      nextRoundBtn.dataset.mode = "next";
      nextRoundBtn.textContent = "Следующий раунд";
      nextRoundBtn.classList.remove("hidden");
      restartBtn.classList.add("hidden");
      startBtn.classList.add("hidden");

      if (result === "player") {
        statusTextEl.textContent = `Раунд ${state.round}: победа! Можно перейти дальше.`;
      } else {
        statusTextEl.textContent = `Раунд ${state.round}: ничья засчитана как прохождение. Можно перейти дальше.`;
      }
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
    statusTextEl.textContent = `Раунд ${state.round}: бот победил. Переиграйте раунд — следующая попытка будет проще.`;
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

function getWinningLine(symbol) {
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
      return line;
    }
  }

  return null;
}

function hasWinner(symbol) {
  return !!getWinningLine(symbol);
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
    return "Легкая";
  }

  return "Сложная";
}

function getActiveDifficulty() {
  if (state.round === 1) {
    return "easy";
  }

  if (state.difficulty === "easy") {
    return "easy";
  }

  if (state.roundAttempts >= 2) {
    return "easy";
  }

  return "hard_relaxed";
}

function getRoundHandicapStep() {
  return Math.min(2, Math.max(0, state.roundAttempts - 1));
}

function symbolName(symbol) {
  return symbol === "X" ? "красный X" : "синий O";
}

function getPlayerTurnText() {
  return `Раунд ${state.round}: ваш ход (${symbolName(state.playerSymbol)}). Можно перенести свою фишку: нажмите на свою клетку, затем на пустую.`;
}

function drawWinningLine(line, symbol) {
  if (!line || line.length < 2) {
    return;
  }

  const existingLine = boardEl.querySelector(".win-line-svg");
  if (existingLine) {
    existingLine.remove();
  }

  const startCell = boardEl.children[line[0]];
  const endCell = boardEl.children[line[line.length - 1]];
  if (!startCell || !endCell) {
    return;
  }

  const x1 = startCell.offsetLeft + startCell.offsetWidth / 2;
  const y1 = startCell.offsetTop + startCell.offsetHeight / 2;
  const x2 = endCell.offsetLeft + endCell.offsetWidth / 2;
  const y2 = endCell.offsetTop + endCell.offsetHeight / 2;

  const length = Math.hypot(x2 - x1, y2 - y1);
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "win-line-svg");
  svg.setAttribute("viewBox", `0 0 ${boardEl.clientWidth} ${boardEl.clientHeight}`);
  svg.setAttribute("preserveAspectRatio", "none");

  const stroke = document.createElementNS(svgNS, "line");
  stroke.setAttribute("x1", `${x1}`);
  stroke.setAttribute("y1", `${y1}`);
  stroke.setAttribute("x2", `${x2}`);
  stroke.setAttribute("y2", `${y2}`);
  stroke.setAttribute("class", `win-line-stroke ${symbol === "X" ? "line-x" : "line-o"}`);
  stroke.style.setProperty("--dash", `${length}`);

  svg.appendChild(stroke);
  boardEl.appendChild(svg);
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
