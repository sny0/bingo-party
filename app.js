import { TOTAL, SHOW_TIMING, newGame, decodeGame, chooseNumber, commitDraw, cleanSettings } from './src/bingo.js?v=1.7.1';
import { createShowAudio } from './src/show-audio.js?v=1.7.1';

const STORAGE_KEY = 'garagara-bingo-v1';
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['sound-button','fullscreen-button','settings-button','settings-dialog','settings-form','settings-message','title-input','duration-input','volume-input','volume-output','event-title','draw-button','draw-button-text','draw-status','result-kicker','result-ball','ball-number','drawn-count','remaining-count','number-board','recent-numbers','save-status','export-button','import-button','import-input','reset-button','confirm-dialog','confirm-heading','confirm-description','confirm-kicker','confirm-ok','confirm-cancel','toast','machine-canvas','confetti-layer','fallback-number','skip-label','draw-dialog','draw-dialog-heading','dialog-status','skip-effects','draw-sound-button'].map(id => [id.replaceAll('-', '_'), $(id)]));
const stage = document.querySelector('.draw-stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let game = newGame();
let displayedHistory;
let busy = false;
let drawPending = false;
let phase = 'idle';
let persistent = true;
const showAudio = createShowAudio(window.AudioContext || window.webkitAudioContext);
let toastTimer;
let confirmationAction = null;
let storageWarning = false;
let machine;
let showWaiter = null;
let skipRequested = false;

function notify(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('visible'), 4200);
}

function updateSaveStatus() {
  ui.save_status.classList.toggle('warning', !persistent);
  ui.save_status.replaceChildren();
  const dot = document.createElement('i');
  dot.className = 'save-dot';
  ui.save_status.append(dot, document.createTextNode(persistent ? 'このブラウザに自動保存' : '自動保存できません'));
}

function readSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) game = decodeGame(raw);
  } catch (error) {
    if (error instanceof SyntaxError || error.message.includes('履歴') || error.message.includes('ビンゴ')) {
      storageWarning = true;
    } else {
      persistent = false;
    }
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    persistent = true;
  } catch {
    persistent = false;
    notify('自動保存できません。終了前に「履歴を保存」を押してください。');
  }
  updateSaveStatus();
}

function createBoard() {
  for (let group = 0; group < 5; group++) {
    const row = document.createElement('div');
    row.className = 'board-row';
    const range = document.createElement('span');
    range.className = 'board-range';
    range.textContent = (group * 15 + 1) + '–' + (group + 1) * 15;
    row.append(range);
    for (let offset = 1; offset <= 15; offset++) {
      const number = group * 15 + offset;
      const cell = document.createElement('span');
      cell.className = 'board-number';
      cell.id = 'number-' + number;
      cell.textContent = number;
      cell.setAttribute('aria-label', number + ' 未抽選');
      row.append(cell);
    }
    ui.number_board.append(row);
  }
}

function updateSoundButtons() {
  for (const button of [ui.sound_button, ui.draw_sound_button]) {
    button.setAttribute('aria-pressed', String(game.settings.sound));
    button.setAttribute('aria-label', game.settings.sound ? '効果音をオフにする' : '効果音をオンにする');
  }
}

function render() {
  const drawn = new Set(game.drawn);
  const latest = game.drawn.at(-1);
  const complete = game.drawn.length === TOTAL;
  ui.event_title.textContent = game.settings.title;
  ui.event_title.title = game.settings.title;
  document.title = game.settings.title + ' | BINGO NIGHT';
  updateSoundButtons();
  ui.drawn_count.textContent = game.drawn.length;
  ui.remaining_count.textContent = TOTAL - game.drawn.length;
  ui.ball_number.textContent = latest ?? '?';
  ui.result_ball.classList.toggle('is-waiting', !latest);
  ui.result_kicker.textContent = complete ? '抽選終了' : latest ? '今回の番号' : '抽選スタンバイ';
  ui.draw_status.textContent = complete ? '75個すべての番号が出ました。' : latest ? '第' + game.drawn.length + '球 · ' + latest + '番' : 'ボタンを押して抽選を始めてください。';
  ui.draw_button_text.textContent = complete ? '抽選は終了しました' : latest ? '次の番号を引く' : 'ガラガラを回す';
  ui.draw_button.disabled = busy || complete;
  ui.settings_button.disabled = busy;
  ui.export_button.disabled = busy || !game.drawn.length;
  ui.result_ball.setAttribute('aria-label', latest ? '最新の抽選結果 ' + latest + '番' : '未抽選');
  for (let number = 1; number <= TOTAL; number++) {
    const cell = $('number-' + number);
    cell.classList.toggle('is-drawn', drawn.has(number));
    cell.classList.toggle('is-latest', number === latest);
    cell.setAttribute('aria-label', number + (number === latest ? ' 直前の番号' : drawn.has(number) ? ' 抽選済み' : ' 未抽選'));
  }
  renderHistory(game.drawn);
  updateSaveStatus();
}

function renderHistory(numbers) {
  const historyKey = numbers.join(',');
  if (historyKey === displayedHistory) return;
  displayedHistory = historyKey;
  if (!numbers.length) {
    const empty = document.createElement('li');
    empty.className = 'recent-empty';
    empty.textContent = 'まだ抽選されていません';
    ui.recent_numbers.replaceChildren(empty);
  } else {
    const items = [...numbers].reverse().map((number, index) => {
      const item = document.createElement('li');
      item.textContent = number;
      item.setAttribute('aria-label', '第' + (numbers.length - index) + '球、' + number + '番');
      return item;
    });
    ui.recent_numbers.replaceChildren(...items);
  }
  ui.recent_numbers.scrollLeft = 0;
}

function launchConfetti(layer = ui.confetti_layer, columns = 8, rows = 7) {
  const colors = ['#ff710d', '#ffffff', '#ffad5a', '#be4909', '#fff0db', '#ff852c'];
  const pieces = Array.from({ length: columns * rows }, (_, index) => {
    const piece = document.createElement('span');
    const direction = index % 2 === 0 ? -1 : 1;
    const x = 3 + ((index % columns + Math.random()) / columns) * 94;
    const y = 4 + ((Math.floor(index / columns) + Math.random()) / rows) * 89;
    piece.style.setProperty('--paper-color', colors[index % colors.length]);
    piece.style.setProperty('--origin-x', x + '%');
    piece.style.setProperty('--origin-y', y + '%');
    piece.style.setProperty('--drift', direction * Math.min(2 + Math.random() * 7, direction < 0 ? x - 1 : 98 - x) + 'cqw');
    piece.style.setProperty('--fall', Math.min(98 - y, 12 + Math.random() * 20) + 'cqh');
    piece.style.setProperty('--turn', direction * (220 + Math.random() * 380) + 'deg');
    piece.style.setProperty('--time', 1450 + Math.random() * 550 + 'ms');
    piece.addEventListener('animationend', () => piece.remove(), { once: true });
    return piece;
  });
  layer.replaceChildren(...pieces);
}

function setPhase(next) {
  phase = next;
  stage.setAttribute('data-phase', next);
  $('bingo-button').disabled = next !== 'idle';
  $('result-bingo-button').disabled = next !== 'result';
}

function clearShowEffects() {
  machine?.stop();
  ui.confetti_layer.replaceChildren();
  stage.classList.remove('is-drawing', 'is-launching', 'is-finale', 'has-machine-3d');
}

function startMachine(spinDuration) {
  clearShowEffects();
  setPhase('spin');
  ui.skip_label.textContent = '演出をスキップ';
  ui.fallback_number.textContent = '';
  stage.style.setProperty('--spin-time', spinDuration + 'ms');
  stage.style.setProperty('--flash-time', SHOW_TIMING.flash + 'ms');
  stage.style.setProperty('--pop-time', SHOW_TIMING.numberPop + 'ms');
  stage.classList.add('is-drawing');
  if (!reduceMotion.matches && machine?.start(spinDuration)) {
    stage.classList.add('has-machine-3d');
  }
}

function launchEffects(fallDuration) {
  setPhase('drop');
  stage.style.setProperty('--fall-time', fallDuration + 'ms');
  if (stage.classList.contains('has-machine-3d')) machine?.release(fallDuration);
  stage.classList.add('is-launching');
  ui.draw_dialog_heading.textContent = '玉が出ます';
  ui.dialog_status.textContent = '玉が出ます。';
  showAudio.drop(fallDuration);
}

function revealEffects(number) {
  machine?.stop();
  showAudio.stop();
  stage.classList.remove('is-drawing', 'is-launching');
  setPhase('result');
  stage.classList.add('is-finale');
  render();
  ui.fallback_number.textContent = number;
  ui.draw_dialog_heading.textContent = '抽選結果';
  ui.dialog_status.textContent = number + '番が出ました。';
  ui.skip_label.textContent = '閉じる';
  showAudio.reveal();
  if (!reduceMotion.matches) {
    launchConfetti();
  }
}

function skipDrawShow() {
  if (!busy || $('bingo-dialog').open) return;
  skipRequested = true;
  showAudio.stop();
  showWaiter?.();
}

const waitForShow = milliseconds => new Promise(resolve => {
  let timer;
  const finish = () => {
    clearTimeout(timer);
    if (showWaiter === finish) showWaiter = null;
    resolve();
  };
  showWaiter = finish;
  if (milliseconds !== undefined) timer = setTimeout(finish, milliseconds);
  if (skipRequested) finish();
});

async function runDraw() {
  // The result is saved before the modal opens, including when the show is skipped.
  if (busy) return;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && persistent) game = decodeGame(saved);
  } catch { /* Keep the current game when storage is unavailable. */ }
  if (game.drawn.length === TOTAL) { render(); return; }
  const number = chooseNumber(game.drawn);
  if (number === null) return;
  const previous = game.drawn.at(-1);
  game = commitDraw(game, number);
  persist();
  busy = true;
  skipRequested = false;
  ui.draw_button.disabled = true;
  ui.settings_button.disabled = true;
  ui.export_button.disabled = true;
  ui.draw_button_text.textContent = '抽選中…';
  ui.draw_status.textContent = '抽選機を回しています。';
  ui.result_ball.setAttribute('aria-label', '抽選中');
  ui.ball_number.textContent = previous ?? '?';
  ui.draw_dialog_heading.textContent = '抽選中';
  ui.dialog_status.textContent = '抽選機を回しています。';
  const duration = reduceMotion.matches ? SHOW_TIMING.machineReduced : game.settings.duration;
  const spinDuration = duration * SHOW_TIMING.spinFraction;
  const fallDuration = duration - spinDuration;
  try {
    ui.draw_dialog.showModal();
    document.body.classList.add('showing-draw');
    startMachine(spinDuration);
    if (!reduceMotion.matches) showAudio.spin(spinDuration);
    await waitForShow(spinDuration);
    if (!skipRequested) {
      launchEffects(fallDuration);
      await waitForShow(fallDuration);
    }
    if (!skipRequested) {
      setPhase('land');
      if (stage.classList.contains('has-machine-3d')) machine.land();
      showAudio.land();
      await waitForShow(SHOW_TIMING.landingHold);
    }
    if (!ui.draw_dialog.open) return;
    skipRequested = false;
    revealEffects(number);
    await waitForShow();
  } finally {
    showWaiter?.();
    showWaiter = null;
    clearShowEffects();
    showAudio.stop();
    busy = false;
    setPhase('idle');
    render();
    if (ui.draw_dialog.open) ui.draw_dialog.close();
    document.body.classList.remove('showing-draw');
    const nextControl = ui.draw_button.disabled ? ui.export_button : ui.draw_button;
    nextControl.focus({ preventScroll: true });
  }
}

async function draw() {
  if (drawPending || busy || $('bingo-dialog').open || game.drawn.length === TOTAL) return;
  drawPending = true;
  showAudio.prepare(game.settings); // Must run directly within the tap/keypress on iPhone and iPad.
  try {
    if (navigator.locks) {
      await navigator.locks.request('garagara-bingo-draw', { ifAvailable: true }, async lock => {
        if (!lock) { notify('別のタブで抽選中です。少し待ってからお試しください。'); return; }
        await runDraw();
      });
    } else {
      await runDraw();
    }
  } catch {
    busy = false;
    clearShowEffects();
    render();
    notify('抽選中にエラーが起きました。ページを再読み込みしてください。');
  } finally {
    drawPending = false;
  }
}

function openSettings() {
  if (busy) return;
  ui.title_input.value = game.settings.title;
  ui.duration_input.value = game.settings.duration;
  ui.volume_input.value = Math.round(game.settings.volume * 100);
  ui.volume_output.value = Math.round(game.settings.volume * 100) + '%';
  ui.settings_message.textContent = '';
  ui.settings_dialog.showModal();
}

function askConfirmation({ title, description, button, kicker = '抽選のやり直し', action }) {
  confirmationAction = action;
  ui.confirm_heading.textContent = title;
  ui.confirm_description.textContent = description;
  ui.confirm_ok.textContent = button;
  ui.confirm_kicker.textContent = kicker;
  ui.confirm_dialog.showModal();
}

ui.draw_button.addEventListener('click', draw);
function celebrate() {
  if ($('bingo-dialog').open || ui.settings_dialog.open || ui.confirm_dialog.open) return;
  if (phase !== 'result' && (phase !== 'idle' || drawPending)) return;
  $('bingo-dialog').showModal();
  showAudio.prepare(game.settings);
  showAudio.stop();
  showAudio.celebrate();
  if (!reduceMotion.matches) launchConfetti($('bingo-confetti'), 16, 10);
}

function closeCelebration() {
  showAudio.stop();
  $('bingo-confetti').replaceChildren();
  $('bingo-dialog').close();
}

$('bingo-button').addEventListener('click', celebrate);
$('result-bingo-button').addEventListener('click', celebrate);
$('close-bingo').addEventListener('click', closeCelebration);
$('bingo-dialog').addEventListener('cancel', event => {
  event.preventDefault();
  closeCelebration();
});
ui.skip_effects.addEventListener('click', skipDrawShow);
ui.draw_dialog.addEventListener('cancel', event => {
  event.preventDefault();
  skipDrawShow();
});
ui.draw_dialog.addEventListener('close', () => {
  if (busy && !ui.draw_dialog.open) skipDrawShow();
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
  if ($('bingo-dialog').open) {
    if (event.code === 'Space') event.preventDefault();
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (!event.repeat) closeCelebration();
    }
    return;
  }
  if (event.key === 'Escape' && event.repeat && ui.draw_dialog.open) {
    event.preventDefault();
    return;
  }
  if (event.key?.toLowerCase() === 'b' && !event.repeat &&
      !ui.settings_dialog.open && !ui.confirm_dialog.open &&
      !event.target?.closest?.('input,textarea,select,[contenteditable]')) {
    event.preventDefault();
    celebrate();
    return;
  }
  if (event.key === 'Enter') {
    if (ui.draw_dialog.open) {
      event.preventDefault();
      if (!event.repeat) skipDrawShow();
    } else if (event.repeat) {
      event.preventDefault();
    }
    return;
  }
  if (event.code !== 'Space') return;
  if (event.repeat || (ui.draw_dialog.open && event.target === ui.skip_effects)) {
    event.preventDefault();
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (event.target.closest('button,input,select,textarea,a,[contenteditable]')) return;
  event.preventDefault();
  draw();
});
ui.settings_button.addEventListener('click', openSettings);
document.querySelector('.close-dialog').addEventListener('click', () => ui.settings_dialog.close());
ui.settings_form.addEventListener('submit', event => {
  event.preventDefault();
  game.settings = cleanSettings({ ...game.settings, title: ui.title_input.value, duration: Number(ui.duration_input.value), volume: Number(ui.volume_input.value) / 100 });
  persist();
  showAudio.update(game.settings);
  render();
  ui.settings_dialog.close();
  notify('設定を保存しました。');
});
ui.volume_input.addEventListener('input', () => { ui.volume_output.value = ui.volume_input.value + '%'; });
function toggleSound() {
  game.settings.sound = !game.settings.sound;
  persist();
  showAudio.update(game.settings);
  // Keep the drawing state and its hidden result unchanged when sound is toggled mid-animation.
  updateSoundButtons();
  if (game.settings.sound) {
    showAudio.prepare(game.settings);
    if (phase === 'idle') showAudio.preview();
  }
}
ui.sound_button.addEventListener('click', toggleSound);
ui.draw_sound_button.addEventListener('click', toggleSound);

if (!document.fullscreenEnabled) ui.fullscreen_button.hidden = true;
ui.fullscreen_button.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { notify('このブラウザでは全画面表示を利用できません。'); }
});
document.addEventListener('fullscreenchange', () => ui.fullscreen_button.setAttribute('aria-label', document.fullscreenElement ? '全画面を終了する' : '全画面にする'));

ui.export_button.addEventListener('click', () => {
  if (busy || !game.drawn.length) return;
  const data = JSON.stringify({ ...game, exportedAt: new Date().toISOString() }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'bingo-history-' + new Date().toISOString().slice(0, 10) + '.json';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  notify('履歴ファイルを保存します。');
});
ui.import_button.addEventListener('click', () => ui.import_input.click());
ui.import_input.addEventListener('change', async () => {
  const file = ui.import_input.files[0];
  ui.import_input.value = '';
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error('ファイルが大きすぎます。ビンゴの履歴ファイルを選んでください。');
    const imported = decodeGame(await file.text());
    ui.settings_dialog.close();
    askConfirmation({
      title: '履歴を読み込みますか？',
      description: 'このブラウザの履歴を、ファイルに保存された' + imported.drawn.length + '球分の履歴に置き換えます。',
      button: '履歴を読み込む',
      kicker: '履歴の読み込み',
      action: () => { game = imported; persist(); showAudio.update(game.settings); render(); notify('履歴を読み込みました。'); },
    });
  } catch (error) {
    ui.settings_message.textContent = error instanceof SyntaxError ? 'ファイルを読み取れません。「履歴を保存」でダウンロードしたファイルを選んでください。' : error.message;
  }
});
ui.reset_button.addEventListener('click', () => {
  ui.settings_dialog.close();
  askConfirmation({
    title: '新しいゲームを始めますか？',
    description: '現在の履歴を消して、最初から引き直します。残しておきたい履歴は、先にファイルへ保存してください。',
    button: '新しく始める',
    action: () => { game = newGame(game.settings); persist(); render(); notify('履歴を消して、新しいゲームを始めました。'); },
  });
});
ui.confirm_cancel.addEventListener('click', () => { confirmationAction = null; ui.confirm_dialog.close(); });
ui.confirm_ok.addEventListener('click', () => {
  const action = confirmationAction;
  confirmationAction = null;
  ui.confirm_dialog.close();
  action?.();
});
ui.confirm_dialog.addEventListener('cancel', () => { confirmationAction = null; });

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || busy || !event.newValue) return;
  try { game = decodeGame(event.newValue); showAudio.update(game.settings); render(); } catch { /* Ignore invalid writes from outside the app. */ }
});

for (const [label, duration] of [
  ['短め', SHOW_TIMING.machineShort],
  ['標準', SHOW_TIMING.machineStandard],
  ['長め', SHOW_TIMING.machineLong],
]) {
  const option = document.createElement('option');
  option.value = duration;
  option.textContent = label + ' · 約' + Math.round(duration / 1000) + '秒';
  ui.duration_input.append(option);
}
readSaved();
createBoard();
render();
if ('WebGL2RenderingContext' in window && !reduceMotion.matches) {
  import('./src/machine.js?v=1.7.1')
    .then(({ createMachine }) => createMachine(ui.machine_canvas, () => stage.classList.remove('has-machine-3d')))
    .then(loaded => { machine = loaded; })
    .catch(() => { /* The static poster and number readout work without 3D. */ });
}
if (storageWarning) notify('このブラウザの履歴を復元できませんでした。保存済みの履歴ファイルは、設定画面から読み込めます。');
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
