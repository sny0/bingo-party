import { TOTAL, newGame, decodeGame, chooseNumber, commitDraw, bingoLetter, cleanSettings } from './src/bingo.js';

const STORAGE_KEY = 'garagara-bingo-v1';
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['sound-button','fullscreen-button','settings-button','settings-dialog','settings-form','settings-message','title-input','duration-input','volume-input','volume-output','event-title','stage-label','machine','draw-button','draw-button-text','draw-status','result-kicker','result-ball','ball-letter','ball-number','drawn-count','remaining-count','number-board','recent-numbers','save-status','export-button','import-button','import-input','reset-button','confirm-dialog','confirm-heading','confirm-description','confirm-kicker','confirm-ok','confirm-cancel','toast','confetti-container','exit-ball','exit-number','drum','crank','inside-balls'].map(id => [id.replaceAll('-', '_'), $(id)]));
const stage = document.querySelector('.draw-stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let game = newGame();
let busy = false;
let persistent = true;
let audio;
let audioMaster;
let toastTimer;
let confirmationAction = null;
let storageWarning = false;
let animations = [];

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
  ui.save_status.append(dot, document.createTextNode(persistent ? 'この端末に自動保存' : '保存できません · 履歴を保存してください'));
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
    const letter = document.createElement('span');
    letter.className = 'board-letter';
    letter.textContent = 'BINGO'[group];
    row.append(letter);
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

function render() {
  const drawn = new Set(game.drawn);
  const latest = game.drawn.at(-1);
  const complete = game.drawn.length === TOTAL;
  ui.event_title.textContent = game.settings.title;
  document.title = game.settings.title + ' | BINGO NIGHT';
  ui.sound_button.setAttribute('aria-pressed', String(game.settings.sound));
  ui.sound_button.setAttribute('aria-label', game.settings.sound ? '効果音をオフにする' : '効果音をオンにする');
  ui.drawn_count.textContent = game.drawn.length;
  ui.remaining_count.textContent = TOTAL - game.drawn.length;
  ui.ball_number.textContent = latest ?? '?';
  ui.ball_letter.textContent = bingoLetter(latest);
  ui.result_kicker.textContent = complete ? 'THANK YOU FOR PLAYING' : 'YOUR LUCKY NUMBER';
  ui.draw_status.textContent = complete ? 'すべての番号が出ました。いい夜を！' : latest ? '第' + game.drawn.length + '球 · ' + bingoLetter(latest) + ' の ' + latest + ' 番！' : '最初のラッキーナンバーは？';
  ui.stage_label.textContent = complete ? 'WHAT A NIGHT!' : 'READY TO ROLL';
  ui.draw_button_text.textContent = complete ? 'すべての抽選が終了しました' : latest ? '次のナンバーを引く' : 'ガラガラを回す';
  stage.classList.toggle('all-done', complete);
  ui.draw_button.disabled = busy || complete;
  ui.settings_button.disabled = busy;
  ui.export_button.disabled = busy || !game.drawn.length;
  ui.result_ball.setAttribute('aria-label', latest ? '最新の抽選結果 ' + bingoLetter(latest) + ' の ' + latest + ' 番' : '未抽選');
  for (let number = 1; number <= TOTAL; number++) {
    const cell = $('number-' + number);
    cell.classList.toggle('is-drawn', drawn.has(number));
    cell.classList.toggle('is-latest', number === latest);
    cell.setAttribute('aria-label', number + (number === latest ? ' 直前の番号' : drawn.has(number) ? ' 抽選済み' : ' 未抽選'));
  }
  ui.recent_numbers.replaceChildren();
  if (!game.drawn.length) {
    const empty = document.createElement('li');
    empty.className = 'recent-empty';
    empty.textContent = 'まだ抽選されていません';
    ui.recent_numbers.append(empty);
  } else {
    [...game.drawn].reverse().slice(0, 7).forEach((number, index) => {
      const item = document.createElement('li');
      item.textContent = number;
      item.setAttribute('aria-label', index === 0 ? '直前 ' + number + ' 番' : (index + 1) + 'つ前 ' + number + ' 番');
      ui.recent_numbers.append(item);
    });
  }
  updateSaveStatus();
}

function syncAudio() {
  if (audio && audioMaster) {
    audioMaster.gain.setTargetAtTime(game.settings.sound ? game.settings.volume * 0.6 : 0, audio.currentTime, 0.02);
  }
}

function unlockAudio() {
  if (!game.settings.sound || !game.settings.volume) return;
  try {
    if (!audio) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio = new Audio();
      audioMaster = audio.createGain();
      audioMaster.connect(audio.destination);
    }
    syncAudio();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch {
    audio = null;
    audioMaster = null;
  }
}

function tone(frequency, start, length, gain = 0.15, type = 'sine') {
  if (!audio || !audioMaster || !game.settings.sound || !game.settings.volume) return;
  try {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + length);
    oscillator.connect(envelope);
    envelope.connect(audioMaster);
    oscillator.start(start);
    oscillator.stop(start + length + 0.01);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  } catch { /* Audio is optional; the draw must finish even if it is unavailable. */ }
}

function rattle(duration) {
  if (!audio) return;
  const begin = audio.currentTime;
  const seconds = duration / 1000;
  for (let t = 0; t < seconds - 0.6; t += 0.115) {
    tone(230 + (Math.sin(t * 17) + 1) * 180, begin + t, 0.055, 0.07, 'triangle');
    tone(950 + (Math.cos(t * 31) + 1) * 650, begin + t + 0.025, 0.027, 0.035, 'square');
  }
}

function chime() {
  if (!audio) return;
  const start = audio.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => {
    tone(note, start + i * 0.085, 0.65, 0.14);
    tone(note * 2, start + i * 0.085, 0.35, 0.025);
  });
}

function playAnimation(target, frames, options) {
  if (!target.animate) return null;
  const animation = target.animate(frames, options);
  animations.push(animation);
  return animation;
}

function startMachine(duration, number) {
  ui.exit_number.textContent = number;
  ui.exit_ball.setAttribute('opacity', '0');
  stage.classList.remove('is-revealing');
  stage.classList.add('is-drawing');
  const spinDuration = duration * 0.77;
  if (!reduceMotion.matches) {
    playAnimation(ui.drum, [
      { transform: 'rotate(0deg)', offset: 0 },
      { transform: 'rotate(55deg)', offset: 0.12 },
      { transform: 'rotate(680deg)', offset: 0.83 },
      { transform: 'rotate(720deg)', offset: 1 },
    ], { duration: spinDuration, easing: 'ease-in-out', fill: 'forwards' });
    playAnimation(ui.crank, [
      { transform: 'rotate(0deg)' }, { transform: 'rotate(1080deg)' },
    ], { duration: spinDuration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    playAnimation(ui.inside_balls, [
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: 'translate(5px,-38px) rotate(-35deg)' },
      { transform: 'translate(-13px,-12px) rotate(25deg)' },
      { transform: 'translate(10px,-30px) rotate(-18deg)' },
      { transform: 'translate(0,0) rotate(0deg)' },
    ], { duration: spinDuration / 3, iterations: 3, easing: 'ease-in-out' });
  }
  playAnimation(ui.exit_ball, [
    { transform: 'translate(328px,285px) scale(.3)', opacity: 0, offset: 0 },
    { transform: 'translate(335px,290px) scale(1)', opacity: 1, offset: 0.08 },
    { transform: 'translate(386px,313px) scale(1)', opacity: 1, offset: 0.42 },
    { transform: 'translate(421px,314px) scale(1)', opacity: 1, offset: 0.6 },
    { transform: 'translate(460px,332px) scale(1)', opacity: 1, offset: 0.81 },
    { transform: 'translate(460px,322px) scale(1)', opacity: 1, offset: 0.91 },
    { transform: 'translate(460px,333px) scale(1)', opacity: 1, offset: 1 },
  ], { duration: duration * 0.23, delay: duration * 0.77, fill: 'forwards', easing: 'linear' });
}

function confetti() {
  if (reduceMotion.matches) return;
  ui.confetti_container.replaceChildren();
  const colors = ['#a72e30', '#caa04f', '#6d7561', '#e1ba6f', '#c96e55'];
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--x', Math.sin(i * 2.4) * (90 + i * 4) + 'px');
    piece.style.setProperty('--y', 200 + (i % 9) * 28 + 'px');
    piece.style.setProperty('--r', (i % 2 ? 1 : -1) * (160 + i * 31) + 'deg');
    piece.style.animationDelay = (i % 5) * 0.025 + 's';
    ui.confetti_container.append(piece);
  }
  setTimeout(() => ui.confetti_container.replaceChildren(), 2000);
}

async function runDraw() {
  // Save the selected result before animation, so closing or refreshing cannot lose a draw.
  if (busy) return;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && persistent) game = decodeGame(saved);
  } catch { /* Keep the current in-memory game if storage becomes unavailable. */ }
  if (game.drawn.length === TOTAL) { render(); return; }
  const number = chooseNumber(game.drawn);
  if (number === null) return;
  const previous = game.drawn.at(-1);
  game = commitDraw(game, number);
  persist();
  busy = true;
  ui.draw_button.disabled = true;
  ui.settings_button.disabled = true;
  ui.export_button.disabled = true;
  ui.draw_button_text.textContent = 'ガラガラ、抽選中…';
  ui.draw_status.textContent = 'どの番号が出るかな…';
  ui.result_ball.setAttribute('aria-label', '抽選中');
  ui.ball_number.textContent = previous ?? '?';
  ui.stage_label.textContent = 'A LITTLE LUCK IS ON ITS WAY';
  const duration = reduceMotion.matches ? 350 : game.settings.duration;
  try {
    startMachine(duration, number);
    rattle(duration);
    await new Promise(resolve => setTimeout(resolve, duration));
  } finally {
    busy = false;
    stage.classList.remove('is-drawing');
    animations.forEach(animation => animation.cancel());
    animations = [];
    ui.exit_ball.setAttribute('opacity', '1');
    ui.exit_ball.setAttribute('transform', 'translate(460 333)');
    render();
    stage.classList.add('is-revealing');
    chime();
    confetti();
  }
}

async function draw() {
  if (busy || game.drawn.length === TOTAL) return;
  unlockAudio(); // Must run directly within the tap/keypress on iPhone and iPad.
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
    stage.classList.remove('is-drawing');
    render();
    notify('抽選を開始できませんでした。ページを再読み込みしてください。');
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

function askConfirmation({ title, description, button, kicker = 'A FRESH START', action }) {
  confirmationAction = action;
  ui.confirm_heading.textContent = title;
  ui.confirm_description.textContent = description;
  ui.confirm_ok.textContent = button;
  ui.confirm_kicker.textContent = kicker;
  ui.confirm_dialog.showModal();
}

ui.draw_button.addEventListener('click', draw);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
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
  syncAudio();
  render();
  ui.settings_dialog.close();
  notify('パーティーの設定を保存しました。');
});
ui.volume_input.addEventListener('input', () => { ui.volume_output.value = ui.volume_input.value + '%'; });
ui.sound_button.addEventListener('click', () => {
  game.settings.sound = !game.settings.sound;
  persist();
  syncAudio();
  // Keep the drawing state and its hidden result unchanged when sound is toggled mid-animation.
  ui.sound_button.setAttribute('aria-pressed', String(game.settings.sound));
  ui.sound_button.setAttribute('aria-label', game.settings.sound ? '効果音をオフにする' : '効果音をオンにする');
  if (game.settings.sound) { unlockAudio(); tone(659.25, audio?.currentTime ?? 0, 0.15, 0.1); }
});

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
  notify('履歴ファイルを保存します。別の端末でも読み込めます。');
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
      description: '現在の結果を、ファイルの' + imported.drawn.length + '球分の履歴に置き換えます。',
      button: '履歴を読み込む',
      kicker: 'PICK UP WHERE YOU LEFT OFF',
      action: () => { game = imported; persist(); syncAudio(); render(); ui.exit_ball.setAttribute('opacity', '0'); notify('履歴を読み込みました。続きから抽選できます。'); },
    });
  } catch (error) {
    ui.settings_message.textContent = error instanceof SyntaxError ? 'ファイルを読み取れません。正しいJSON形式の履歴を選んでください。' : error.message;
  }
});
ui.reset_button.addEventListener('click', () => {
  ui.settings_dialog.close();
  askConfirmation({
    title: '新しいゲームを始めますか？',
    description: '現在の抽選結果を消して、1〜75のすべての番号でやり直します。必要なら先に履歴を保存してください。',
    button: '新しく始める',
    action: () => { game = newGame(game.settings); persist(); render(); stage.classList.remove('is-revealing'); ui.exit_ball.setAttribute('opacity', '0'); ui.confetti_container.replaceChildren(); notify('新しいゲームを始めました。幸運を！'); },
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
  try { game = decodeGame(event.newValue); syncAudio(); render(); } catch { /* Ignore invalid writes from outside the app. */ }
});

readSaved();
createBoard();
render();
$('edition-year').textContent = new Date().getFullYear();
if (storageWarning) notify('保存されていた履歴を読み込めませんでした。履歴ファイルがあれば設定から読み込めます。');
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
