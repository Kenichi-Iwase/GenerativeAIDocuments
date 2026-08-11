/* ===========================================================
   ラッキーセブン スロット - ゲームロジック
   3リール × 3行 / 5ペイライン / ワイルド・スキャッター搭載
   =========================================================== */
'use strict';

/* ---------------- 設定 ---------------- */

/** 絵柄の定義。weight が出現比率、pay が3つ揃い時の倍率、pay2 が左から2つ揃い時の倍率。 */
const SYMBOLS = [
  { id: 'cherry',  ch: '🍒',  name: 'チェリー',   weight: 22, pay: 10,  pay2: 1 },
  { id: 'lemon',   ch: '🍋',  name: 'レモン',     weight: 20, pay: 15,  pay2: 1 },
  { id: 'orange',  ch: '🍊',  name: 'オレンジ',   weight: 18, pay: 20 },
  { id: 'melon',   ch: '🍉',  name: 'メロン',     weight: 15, pay: 28 },
  { id: 'bell',    ch: '🔔',  name: 'ベル',       weight: 12, pay: 42 },
  { id: 'star',    ch: '⭐',  name: 'スター',     weight: 8,  pay: 85 },
  { id: 'diamond', ch: '💎',  name: 'ダイヤ',     weight: 7,  pay: 100, scatter: true },
  { id: 'seven',   ch: '7️⃣',  name: 'セブン',     weight: 3,  pay: 400 },
  { id: 'wild',    ch: '🃏',  name: 'ワイルド',   weight: 2,  pay: 700, wild: true },
];

/** 各ペイラインが通過する行番号（リール0,1,2 の順）。 */
const PAYLINES = [
  { no: 1, rows: [1, 1, 1] }, // 中段
  { no: 2, rows: [0, 0, 0] }, // 上段
  { no: 3, rows: [2, 2, 2] }, // 下段
  { no: 4, rows: [0, 1, 2] }, // 右下がり
  { no: 5, rows: [2, 1, 0] }, // 右上がり
];

const REEL_COUNT = 3;
const ROW_COUNT = 3;
const BET_STEPS = [1, 2, 5, 10, 25, 50];
const START_CREDIT = 1000;
const FILLER_COUNT = 22;          // 回転演出用のダミー絵柄数
const SPIN_BASE_MS = 850;         // 1リール目の停止までの時間
const SPIN_STEP_MS = 380;         // リールごとの停止時間差
const SCATTER_MIN = 3;            // フリースピン突入に必要なスキャッター数
const FREE_SPINS_AWARD = 5;       // 1回の突入で得られるフリースピン数
const SCATTER_PAY_MULT = 2;       // スキャッター配当（総ベットに対する倍率）
const BIG_WIN_RATIO = 15;         // 総ベットの何倍以上で BIG WIN 演出にするか
const STORAGE_KEY = 'lucky-seven-slot';

const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

/* ---------------- 状態 ---------------- */

const state = {
  credit: START_CREDIT,
  betIndex: 0,
  freeSpins: 0,
  lastWin: 0,
  spinning: false,
  auto: false,
  soundOn: true,
  board: [],       // board[reel][row] = SYMBOL
};

/* ---------------- DOM ---------------- */

const el = {
  reels: document.getElementById('reels'),
  credit: document.getElementById('credit'),
  totalBet: document.getElementById('totalBet'),
  betDetail: document.getElementById('betDetail'),
  win: document.getElementById('win'),
  winMeter: document.querySelector('.meter--win'),
  screen: document.querySelector('.screen'),
  banner: document.getElementById('banner'),
  freeSpinBadge: document.getElementById('freeSpinBadge'),
  freeSpinCount: document.getElementById('freeSpinCount'),
  payLabels: Array.from(document.querySelectorAll('.paylabels span')),
  spin: document.getElementById('spin'),
  betUp: document.getElementById('betUp'),
  betDown: document.getElementById('betDown'),
  betMax: document.getElementById('betMax'),
  auto: document.getElementById('auto'),
  sound: document.getElementById('sound'),
  reset: document.getElementById('reset'),
  togglePaytable: document.getElementById('togglePaytable'),
  paytable: document.getElementById('paytable'),
  paytableList: document.getElementById('paytableList'),
};

/** 各リールの DOM 要素と現在の停止絵柄。 */
const reels = [];

/* ---------------- ユーティリティ ---------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 重み付き抽選で絵柄を1つ返す。 */
function randomSymbol() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SYMBOLS) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

const betPerLine = () => BET_STEPS[state.betIndex];
const totalBet = () => betPerLine() * PAYLINES.length;
const isFreeSpin = () => state.freeSpins > 0;

/* ---------------- サウンド ---------------- */

/** WebAudio による簡易効果音。初回の操作時に AudioContext を生成する。 */
const sound = (() => {
  let ctx = null;

  function ensure() {
    if (!state.soundOn) return null;
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, dur = 0.12, type = 'square', gain = 0.06, delay = 0, sweepTo = null }) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    unlock: ensure,
    start() { tone({ freq: 220, sweepTo: 660, dur: 0.22, type: 'sawtooth', gain: 0.05 }); },
    stop(i) { tone({ freq: 180 + i * 40, dur: 0.09, type: 'square', gain: 0.07 }); },
    click() { tone({ freq: 900, dur: 0.05, type: 'triangle', gain: 0.05 }); },
    win(steps) {
      const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      const n = Math.min(steps, scale.length);
      for (let i = 0; i < n; i++) {
        tone({ freq: scale[i], dur: 0.16, type: 'triangle', gain: 0.07, delay: i * 0.09 });
      }
    },
    freeSpin() {
      [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        tone({ freq: f, dur: 0.2, type: 'sine', gain: 0.08, delay: i * 0.12 });
      });
    },
  };
})();

/* ---------------- 描画 ---------------- */

function cellHTML(symbol) {
  return `<div class="cell" data-sym="${symbol.id}"><span>${symbol.ch}</span></div>`;
}

/** リール要素を生成し、初期絵柄を並べる。 */
function buildReels() {
  el.reels.innerHTML = '';
  reels.length = 0;
  state.board = [];

  for (let i = 0; i < REEL_COUNT; i++) {
    const reel = document.createElement('div');
    reel.className = 'reel';
    const strip = document.createElement('div');
    strip.className = 'strip';
    reel.appendChild(strip);
    el.reels.appendChild(reel);

    const result = Array.from({ length: ROW_COUNT }, randomSymbol);
    strip.innerHTML = result.map(cellHTML).join('');
    strip.style.transform = 'translateY(0)';

    reels.push({ strip, result });
    state.board.push(result);
  }
}

/**
 * 1リールを回転させて指定の結果で停止する。
 * ストリップは [新しい結果, ダミー…, 現在の結果] の順に並べ、
 * 末尾（＝現在の見た目）から先頭へスクロールさせることで下方向の回転を表現する。
 */
function spinReel(index, result, duration) {
  const reel = reels[index];
  const items = [...result, ...Array.from({ length: FILLER_COUNT }, randomSymbol), ...reel.result];

  reel.strip.style.transition = 'none';
  reel.strip.innerHTML = items.map(cellHTML).join('');
  reel.strip.style.transform = `translateY(${-((items.length - ROW_COUNT) / items.length) * 100}%)`;
  reel.strip.classList.add('is-blurred');

  // レイアウトを確定させてからトランジションを開始する
  void reel.strip.offsetHeight;

  reel.strip.style.transition = `transform ${duration}ms cubic-bezier(.16,.72,.24,1.02)`;
  reel.strip.style.transform = 'translateY(0)';
  reel.result = result;

  return new Promise((resolve) => {
    setTimeout(() => reel.strip.classList.remove('is-blurred'), Math.max(duration - 320, 0));
    setTimeout(() => {
      // 停止後は結果の3コマだけを残しておく（次回の起点になる）
      reel.strip.style.transition = 'none';
      reel.strip.innerHTML = result.map(cellHTML).join('');
      reel.strip.style.transform = 'translateY(0)';
      sound.stop(index);
      resolve();
    }, duration);
  });
}

function updateMeters() {
  el.credit.textContent = state.credit.toLocaleString();
  el.totalBet.textContent = totalBet().toLocaleString();
  el.betDetail.textContent = `${betPerLine()} × ${PAYLINES.length}ライン`;
  el.win.textContent = state.lastWin.toLocaleString();

  el.freeSpinBadge.hidden = !isFreeSpin();
  el.freeSpinCount.textContent = state.freeSpins;
  el.screen.classList.toggle('is-freespin', isFreeSpin());

  const busy = state.spinning;
  el.betUp.disabled = busy || isFreeSpin() || state.betIndex >= BET_STEPS.length - 1;
  el.betDown.disabled = busy || isFreeSpin() || state.betIndex <= 0;
  el.betMax.disabled = busy || isFreeSpin();
  el.reset.disabled = busy;
  el.spin.disabled = busy || (!isFreeSpin() && state.credit < totalBet());
  el.spin.querySelector('.btn__main').textContent = isFreeSpin() ? 'FREE' : 'SPIN';
  el.spin.classList.toggle('is-stop', isFreeSpin());
  el.auto.classList.toggle('is-on', state.auto);
  el.auto.textContent = state.auto ? 'AUTO 停止' : 'AUTO';
}

function showBanner(text, variant) {
  el.banner.textContent = text;
  el.banner.className = 'banner is-visible' + (variant ? ` is-${variant}` : '');
}

function hideBanner() {
  el.banner.className = 'banner';
}

function clearHighlights() {
  el.reels.querySelectorAll('.cell.is-win').forEach((c) => c.classList.remove('is-win'));
  el.payLabels.forEach((s) => s.classList.remove('is-hot'));
  el.winMeter.classList.remove('is-hit');
}

/** 当たったマスとライン番号を光らせる。 */
function highlight(wins) {
  const hotLines = new Set();
  wins.forEach((w) => {
    w.cells.forEach(([reel, row]) => {
      const cell = reels[reel].strip.children[row];
      if (cell) cell.classList.add('is-win');
    });
    if (w.lineIndex !== undefined) hotLines.add(w.lineIndex);
  });
  el.payLabels.forEach((span) => {
    if (hotLines.has(Number(span.dataset.line))) span.classList.add('is-hot');
  });
}

/** WIN メーターを 0 から目標値までカウントアップする。 */
function countUp(target, ms = 600) {
  return new Promise((resolve) => {
    if (target <= 0) {
      el.win.textContent = '0';
      resolve();
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / ms, 1);
      el.win.textContent = Math.round(target * p).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/* ---------------- 判定 ---------------- */

/**
 * 盤面を判定して当選内容を返す。
 * @returns {{wins:Array, total:number, scatterCount:number, scatterPay:number}}
 */
function evaluate(board) {
  const wins = [];
  const line = betPerLine();

  PAYLINES.forEach((payline, lineIndex) => {
    const syms = payline.rows.map((row, reel) => board[reel][row]);

    // ワイルドは代用可能。基準となる絵柄はライン上で最初に現れる非ワイルド。
    const base = syms.find((s) => !s.wild) || syms[0];
    const matches = (s) => s.wild || s.id === base.id;

    if (syms.every(matches)) {
      wins.push({
        lineIndex,
        lineNo: payline.no,
        symbol: base,
        count: 3,
        amount: base.pay * line,
        cells: payline.rows.map((row, reel) => [reel, row]),
      });
      return;
    }

    // 左から2つ揃い（pay2 を持つ絵柄のみ）
    const [a, b] = syms;
    const base2 = a.wild ? b : a;
    if (base2.pay2 && matches2(a, base2) && matches2(b, base2)) {
      wins.push({
        lineIndex,
        lineNo: payline.no,
        symbol: base2,
        count: 2,
        amount: base2.pay2 * line,
        cells: [[0, payline.rows[0]], [1, payline.rows[1]]],
      });
    }
  });

  function matches2(s, base2) {
    return s.wild || s.id === base2.id;
  }

  // スキャッターは位置に関係なく盤面全体で数える
  const scatterCells = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    for (let row = 0; row < ROW_COUNT; row++) {
      if (board[reel][row].scatter) scatterCells.push([reel, row]);
    }
  }

  let scatterPay = 0;
  if (scatterCells.length >= SCATTER_MIN) {
    scatterPay = SCATTER_PAY_MULT * totalBet();
    wins.push({
      symbol: SYMBOLS.find((s) => s.scatter),
      count: scatterCells.length,
      amount: scatterPay,
      cells: scatterCells,
      scatter: true,
    });
  }

  return {
    wins,
    total: wins.reduce((sum, w) => sum + w.amount, 0),
    scatterCount: scatterCells.length,
    scatterPay,
  };
}

/* ---------------- ゲーム進行 ---------------- */

async function spin() {
  if (state.spinning) return;

  const free = isFreeSpin();
  if (!free && state.credit < totalBet()) {
    showBanner('クレジットが足りません', 'big');
    stopAuto();
    return;
  }

  state.spinning = true;
  clearHighlights();
  hideBanner();
  state.lastWin = 0;

  if (free) {
    state.freeSpins -= 1;
  } else {
    state.credit -= totalBet();
  }
  updateMeters();
  el.win.textContent = '0';
  sound.start();

  // 結果を先に決めてから、演出としてリールを回す
  const board = Array.from({ length: REEL_COUNT }, () =>
    Array.from({ length: ROW_COUNT }, randomSymbol)
  );

  await Promise.all(
    board.map((result, i) => spinReel(i, result, SPIN_BASE_MS + i * SPIN_STEP_MS))
  );

  state.board = board;
  const outcome = evaluate(board);

  if (outcome.total > 0) {
    state.credit += outcome.total;
    state.lastWin = outcome.total;
    highlight(outcome.wins);
    el.winMeter.classList.add('is-hit');
    sound.win(Math.min(5, Math.ceil(outcome.total / Math.max(totalBet(), 1))));
    updateMeters();
    el.win.textContent = '0';
    await countUp(outcome.total);
    showBanner(winMessage(outcome), outcome.total >= totalBet() * BIG_WIN_RATIO ? 'big' : null);
  } else {
    updateMeters();
  }

  // フリースピン突入・再突入
  if (outcome.scatterCount >= SCATTER_MIN) {
    state.freeSpins += FREE_SPINS_AWARD;
    updateMeters();   // バッジと画面演出を獲得と同時に反映する
    sound.freeSpin();
    showBanner(`💎 ${outcome.scatterCount}個！ フリースピン ${FREE_SPINS_AWARD}回獲得`, 'free');
    await sleep(900);
  }

  state.spinning = false;
  updateMeters();
  save();

  if (isFreeSpin()) {
    await sleep(outcome.total > 0 ? 900 : 500);
    if (!state.spinning) spin();
    return;
  }

  if (state.auto) {
    if (state.credit < totalBet()) {
      stopAuto();
      showBanner('クレジットが足りません', 'big');
      return;
    }
    await sleep(outcome.total > 0 ? 1100 : 450);
    if (state.auto && !state.spinning) spin();
  }
}

function winMessage(outcome) {
  const big = outcome.total >= totalBet() * BIG_WIN_RATIO;
  const lineWins = outcome.wins.filter((w) => !w.scatter);
  const head = big ? '🎉 BIG WIN！ ' : '';

  const gain = `+${outcome.total.toLocaleString()} クレジット`;

  if (lineWins.length === 0) return `${head}💎 スキャッター｜${gain}`;

  const best = lineWins.reduce((a, b) => (b.amount > a.amount ? b : a));
  const lines = lineWins.map((w) => w.lineNo).sort((a, b) => a - b).join('・');
  return `${head}${best.symbol.ch} ×${best.count}｜ライン ${lines}｜${gain}`;
}

function stopAuto() {
  state.auto = false;
  updateMeters();
}

/* ---------------- 保存 ---------------- */

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        credit: state.credit,
        betIndex: state.betIndex,
        freeSpins: state.freeSpins,
        soundOn: state.soundOn,
      })
    );
  } catch (e) {
    /* プライベートモードなどで保存できない場合は無視する */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Number.isFinite(data.credit) && data.credit >= 0) state.credit = Math.floor(data.credit);
    if (Number.isInteger(data.betIndex) && BET_STEPS[data.betIndex] !== undefined) {
      state.betIndex = data.betIndex;
    }
    if (Number.isInteger(data.freeSpins) && data.freeSpins >= 0) state.freeSpins = data.freeSpins;
    if (typeof data.soundOn === 'boolean') state.soundOn = data.soundOn;
  } catch (e) {
    /* 壊れたデータは初期値のまま扱う */
  }
}

/* ---------------- 配当表 ---------------- */

function buildPaytable() {
  el.paytableList.innerHTML = SYMBOLS.slice()
    .sort((a, b) => b.pay - a.pay)
    .map((s) => {
      const extra = s.scatter
        ? `<small>3個以上で総ベット×${SCATTER_PAY_MULT}</small>`
        : s.pay2
          ? `<small>2つ揃い ×${s.pay2}</small>`
          : '';
      return `<li>
        <span class="paytable__sym">${s.ch}</span>
        <span class="paytable__name">${s.name}${s.wild ? '（代用）' : ''}</span>
        <span class="paytable__pay">×${s.pay}${extra}</span>
      </li>`;
    })
    .join('');
}

/* ---------------- 入力 ---------------- */

function changeBet(delta) {
  const next = state.betIndex + delta;
  if (next < 0 || next >= BET_STEPS.length) return;
  state.betIndex = next;
  sound.click();
  updateMeters();
  save();
}

function bindEvents() {
  el.spin.addEventListener('click', () => {
    sound.unlock();
    spin();
  });

  el.betUp.addEventListener('click', () => changeBet(1));
  el.betDown.addEventListener('click', () => changeBet(-1));

  el.betMax.addEventListener('click', () => {
    // 支払えるうちで最大のベットを選ぶ
    let index = 0;
    for (let i = BET_STEPS.length - 1; i >= 0; i--) {
      if (BET_STEPS[i] * PAYLINES.length <= state.credit) { index = i; break; }
    }
    state.betIndex = index;
    sound.click();
    updateMeters();
    save();
  });

  el.auto.addEventListener('click', () => {
    sound.unlock();
    state.auto = !state.auto;
    updateMeters();
    if (state.auto && !state.spinning && !isFreeSpin()) spin();
  });

  el.sound.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    el.sound.textContent = state.soundOn ? '🔊 ON' : '🔇 OFF';
    el.sound.setAttribute('aria-pressed', String(state.soundOn));
    el.sound.classList.toggle('is-on', state.soundOn);
    if (state.soundOn) { sound.unlock(); sound.click(); }
    save();
  });

  el.reset.addEventListener('click', () => {
    if (state.spinning) return;
    stopAuto();
    state.credit = START_CREDIT;
    state.freeSpins = 0;
    state.lastWin = 0;
    state.betIndex = 0;
    clearHighlights();
    showBanner(`クレジットを ${START_CREDIT.toLocaleString()} に戻しました`);
    updateMeters();
    save();
  });

  el.togglePaytable.addEventListener('click', () => {
    const open = el.paytable.hidden;
    el.paytable.hidden = !open;
    el.togglePaytable.setAttribute('aria-expanded', String(open));
    el.togglePaytable.textContent = open ? '配当表を閉じる' : '配当表を見る';
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'BUTTON') return;  // ボタン操作の二重発火を防ぐ
    e.preventDefault();
    sound.unlock();
    if (!state.spinning) spin();
  });
}

/* ---------------- 起動 ---------------- */

function init() {
  load();
  buildReels();
  buildPaytable();
  bindEvents();
  el.sound.textContent = state.soundOn ? '🔊 ON' : '🔇 OFF';
  el.sound.classList.toggle('is-on', state.soundOn);
  updateMeters();
  if (isFreeSpin()) showBanner(`フリースピン ${state.freeSpins} 回が残っています`, 'free');
}

init();
