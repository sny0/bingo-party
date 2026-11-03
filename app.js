import { TOTAL, newGame, decodeGame, chooseNumber, commitDraw, bingoLetter, cleanSettings } from './src/bingo.js';

const STORAGE_KEY = 'garagara-bingo-v1';
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['sound-button','fullscreen-button','settings-button','settings-dialog','settings-form','settings-message','title-input','duration-input','volume-input','volume-output','event-title','stage-label','machine','draw-button','draw-button-text','draw-status','result-kicker','result-ball','ball-letter','ball-number','drawn-count','remaining-count','number-board','recent-numbers','save-status','export-button','import-button','import-input','reset-button','confirm-dialog','confirm-heading','confirm-description','confirm-kicker','confirm-ok','confirm-cancel','toast','confetti-container','exit-ball','exit-number','drum','crank','inside-balls','fx-sparks','fx-lights','fx-kicker','fx-caption','fx-letter','fx-number','fx-round','draw-dialog','draw-dialog-heading','dialog-status','skip-effects','draw-sound-button'].map(id => [id.replaceAll('-', '_'), $(id)]));
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
let showWaiter = null;
let skipRequested = false;
const soundSources = new Set();

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
  ui.ball_letter.textContent = bingoLetter(latest);
  ui.result_kicker.textContent = complete ? '抽選終了' : '今回の番号';
  ui.draw_status.textContent = complete ? '75個すべての番号が出ました。' : latest ? '第' + game.drawn.length + '球 · ' + bingoLetter(latest) + 'の' + latest + '番' : 'ボタンを押して抽選を始めてください。';
  ui.stage_label.textContent = complete ? '抽選終了' : '抽選できます';
  ui.draw_button_text.textContent = complete ? '抽選は終了しました' : latest ? '次の番号を引く' : 'ガラガラを回す';
  stage.classList.toggle('all-done', complete);
  ui.draw_button.disabled = busy || complete;
  ui.settings_button.disabled = busy;
  ui.export_button.disabled = busy || !game.drawn.length;
  ui.result_ball.setAttribute('aria-label', latest ? '最新の抽選結果 ' + bingoLetter(latest) + 'の' + latest + '番' : '未抽選');
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
      const compressor = audio.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      audioMaster.connect(compressor);
      compressor.connect(audio.destination);
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
    soundSources.add(oscillator);
    oscillator.start(start);
    oscillator.stop(start + length + 0.01);
    oscillator.onended = () => { soundSources.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
  } catch { /* Audio is optional; the draw must finish even if it is unavailable. */ }
}

function sweep(from, to, start, length, gain = 0.12, type = 'sawtooth') {
  if (!audio || !audioMaster || !game.settings.sound || !game.settings.volume) return;
  try {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const filter = audio.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + length);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, start);
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.08, length / 4));
    envelope.gain.exponentialRampToValueAtTime(0.001, start + length);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(audioMaster);
    soundSources.add(oscillator);
    oscillator.start(start);
    oscillator.stop(start + length + 0.02);
    oscillator.onended = () => { soundSources.delete(oscillator); oscillator.disconnect(); filter.disconnect(); envelope.disconnect(); };
  } catch { /* The draw continues when optional audio is unavailable. */ }
}

function rattle(duration) {
  if (!audio) return;
  const begin = audio.currentTime;
  const seconds = duration / 1000;
  let beat = 0;
  for (let t = 0; t < seconds - 0.08;) {
    const progress = t / seconds;
    tone(210 + progress * 380, begin + t, 0.05, 0.13, 'triangle');
    tone(1100 + progress * 1300, begin + t + 0.018, 0.035, 0.04, 'square');
    if (beat++ % 3 === 0) tone([261.63, 329.63, 392, 523.25][beat % 4], begin + t, 0.13, 0.07, 'triangle');
    t += 0.17 - progress * 0.115;
  }
  sweep(90, 650, begin, seconds, 0.08, 'triangle');
  sweep(360, 1900, begin + seconds * 0.55, seconds * 0.43, 0.09);
}

function launchSound() {
  if (!audio) return;
  const start = audio.currentTime;
  sweep(1800, 170, start, 0.38, 0.24);
  sweep(120, 38, start, 0.3, 0.38, 'sine');
  [1046.5, 1567.98, 2093].forEach((frequency, i) => tone(frequency, start + i * 0.035, 0.4, 0.09));
}

function chime() {
  if (!audio) return;
  const start = audio.currentTime;
  sweep(140, 45, start, 0.38, 0.32, 'sine');
  const melody = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
  melody.forEach((note, i) => {
    tone(note, start + i * 0.095, 0.42, 0.16, 'triangle');
    tone(note * 2, start + i * 0.095, 0.3, 0.06);
  });
  [523.25, 659.25, 783.99, 1046.5].forEach(note => tone(note, start + 0.64, 0.6, 0.12));
}

function playAnimation(target, frames, options) {
  if (!target.animate) return null;
  const animation = target.animate(frames, options);
  animations.push(animation);
  return animation;
}

function createShowEffects() {
  // Reuse a bounded set of decorative elements on every draw.
  for (let i = 0; i < 36; i++) {
    const light = document.createElement('i');
    light.style.setProperty('--i', i);
    if (i < 12) { light.style.left = (4 + i * 92 / 11) + '%'; light.style.top = '8px'; }
    else if (i < 24) { light.style.left = (4 + (i - 12) * 92 / 11) + '%'; light.style.bottom = '8px'; }
    else if (i < 30) { light.style.left = '8px'; light.style.top = (12 + (i - 24) * 76 / 5) + '%'; }
    else { light.style.right = '8px'; light.style.top = (12 + (i - 30) * 76 / 5) + '%'; }
    ui.fx_lights.append(light);
  }
  for (let i = 0; i < 26; i++) {
    const spark = document.createElement('i');
    spark.style.setProperty('--sx', Math.sin(i * 2.4) * (45 + i * 6) + 'px');
    spark.style.setProperty('--sy', -(70 + (i % 7) * 32) + 'px');
    spark.style.setProperty('--delay', -(i % 9) * 0.19 + 's');
    spark.style.setProperty('--size', (3 + i % 4) + 'px');
    ui.fx_sparks.append(spark);
  }
}

function clearShowEffects() {
  stage.classList.remove('is-drawing', 'is-launching', 'is-revealing', 'is-finale');
  ui.confetti_container.replaceChildren();
  animations.forEach(animation => animation.cancel());
  animations = [];
}

function startMachine(duration, number) {
  clearShowEffects();
  const launchAt = duration * 0.7;
  ui.exit_number.textContent = number;
  ui.exit_ball.setAttribute('opacity', '0');
  ui.fx_kicker.textContent = '';
  ui.fx_caption.textContent = '抽選開始';
  stage.style.setProperty('--charge-duration', launchAt + 'ms');
  stage.classList.add('is-drawing');
  if (!reduceMotion.matches) {
    playAnimation(ui.drum, [
      { transform: 'rotate(0deg)', offset: 0 },
      { transform: 'rotate(50deg)', offset: 0.15 },
      { transform: 'rotate(1330deg)', offset: 0.91 },
      { transform: 'rotate(1440deg)', offset: 1 },
    ], { duration: launchAt, easing: 'cubic-bezier(.46,.02,.34,1)', fill: 'forwards' });
    playAnimation(ui.crank, [
      { transform: 'rotate(0deg)' }, { transform: 'rotate(2160deg)' },
    ], { duration: launchAt, easing: 'cubic-bezier(.46,.02,.34,1)', fill: 'forwards' });
    playAnimation(ui.inside_balls, [
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: 'translate(7px,-48px) rotate(-45deg)' },
      { transform: 'translate(-17px,-16px) rotate(30deg)' },
      { transform: 'translate(14px,-38px) rotate(-24deg)' },
      { transform: 'translate(0,0) rotate(0deg)' },
    ], { duration: launchAt / 4, iterations: 4, easing: 'ease-in-out' });
    playAnimation(ui.exit_ball, [
      { transform: 'translate(328px,285px) scale(.35)', opacity: 0, offset: 0 },
      { transform: 'translate(340px,282px) scale(1.6)', opacity: 1, offset: 0.13 },
      { transform: 'translate(386px,305px) scale(1.3)', opacity: 1, offset: 0.4 },
      { transform: 'translate(421px,314px) scale(1.12)', opacity: 1, offset: 0.6 },
      { transform: 'translate(460px,332px) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(460px,317px) scale(1)', opacity: 1, offset: 0.91 },
      { transform: 'translate(460px,333px) scale(1)', opacity: 1, offset: 1 },
    ], { duration: duration - launchAt, delay: launchAt, fill: 'forwards', easing: 'linear' });
  }
}

function launchEffects() {
  stage.classList.add('is-launching');
  ui.fx_kicker.textContent = '';
  ui.fx_caption.textContent = '出た！';
  ui.stage_label.textContent = '番号が出ます';
  ui.draw_status.textContent = '番号が出ます。';
  ui.dialog_status.textContent = '玉が出ます。';
  launchSound();
}

function confetti() {
  if (reduceMotion.matches) return;
  ui.confetti_container.replaceChildren();
  const colors = ['#ffdc69', '#fff5c1', '#eabc4a', '#ff788b', '#7ee9df', '#d4a4ff'];
  for (let i = 0; i < 64; i++) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--x', Math.sin(i * 2.4) * (90 + i * 5) + 'px');
    piece.style.setProperty('--y', (80 + (i % 11) * 39) + 'px');
    piece.style.setProperty('--r', (i % 2 ? 1 : -1) * (160 + i * 31) + 'deg');
    piece.style.animationDelay = (i % 4) * 0.025 + 's';
    ui.confetti_container.append(piece);
  }
}

function revealEffects(number) {
  animations.forEach(animation => animation.cancel());
  animations = [];
  ui.exit_ball.setAttribute('opacity', '1');
  ui.exit_ball.setAttribute('transform', 'translate(460 333)');
  stage.classList.remove('is-drawing', 'is-launching');
  render();
  ui.fx_number.textContent = number;
  ui.fx_letter.textContent = bingoLetter(number);
  ui.fx_round.textContent = '第' + game.drawn.length + '球';
  ui.draw_dialog_heading.textContent = '抽選結果';
  ui.dialog_status.textContent = '第' + game.drawn.length + '球 · ' + bingoLetter(number) + 'の' + number + '番';
  stage.classList.add('is-revealing');
  if (!reduceMotion.matches) {
    stage.classList.add('is-finale');
    ui.draw_button_text.textContent = '番号を表示しています';
  }
  chime();
  confetti();
}

function stopShowAudio() {
  for (const source of soundSources) {
    try { source.stop(); } catch { /* The source may already have ended. */ }
  }
  soundSources.clear();
}

function skipDrawShow() {
  if (!busy) return;
  skipRequested = true;
  stopShowAudio();
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
  timer = setTimeout(finish, milliseconds);
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
  ui.stage_label.textContent = '抽選中';
  ui.draw_dialog_heading.textContent = '抽選中';
  ui.dialog_status.textContent = '抽選機を回しています。';
  const duration = reduceMotion.matches ? 350 : game.settings.duration;
  try {
    ui.draw_dialog.showModal();
    document.body.classList.add('showing-draw');
    startMachine(duration, number);
    if (!reduceMotion.matches) rattle(duration * 0.7);
    await waitForShow(duration * 0.7);
    if (skipRequested) return;
    if (!reduceMotion.matches) launchEffects();
    await waitForShow(duration * 0.3);
    if (skipRequested) return;
    revealEffects(number);
    if (!reduceMotion.matches) await waitForShow(1300);
  } finally {
    showWaiter?.();
    showWaiter = null;
    clearShowEffects();
    stopShowAudio();
    ui.exit_ball.setAttribute('opacity', '1');
    ui.exit_ball.setAttribute('transform', 'translate(460 333)');
    busy = false;
    render();
    if (ui.draw_dialog.open) ui.draw_dialog.close();
    document.body.classList.remove('showing-draw');
    const nextControl = ui.draw_button.disabled ? ui.export_button : ui.draw_button;
    nextControl.focus({ preventScroll: true });
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
    clearShowEffects();
    render();
    notify('抽選中にエラーが起きました。ページを再読み込みしてください。');
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
ui.skip_effects.addEventListener('click', skipDrawShow);
ui.draw_dialog.addEventListener('cancel', event => {
  event.preventDefault();
  skipDrawShow();
});
ui.draw_dialog.addEventListener('close', () => {
  if (busy && !ui.draw_dialog.open) skipDrawShow();
});
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
  notify('設定を保存しました。');
});
ui.volume_input.addEventListener('input', () => { ui.volume_output.value = ui.volume_input.value + '%'; });
function toggleSound() {
  game.settings.sound = !game.settings.sound;
  persist();
  syncAudio();
  // Keep the drawing state and its hidden result unchanged when sound is toggled mid-animation.
  updateSoundButtons();
  if (game.settings.sound) { unlockAudio(); tone(659.25, audio?.currentTime ?? 0, 0.15, 0.1); }
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
      action: () => { game = imported; persist(); syncAudio(); render(); ui.exit_ball.setAttribute('opacity', '0'); notify('履歴を読み込みました。'); },
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
    action: () => { game = newGame(game.settings); persist(); render(); stage.classList.remove('is-revealing'); ui.exit_ball.setAttribute('opacity', '0'); ui.confetti_container.replaceChildren(); notify('履歴を消して、新しいゲームを始めました。'); },
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
createShowEffects();
render();
if (storageWarning) notify('このブラウザの履歴を復元できませんでした。保存済みの履歴ファイルは、設定画面から読み込めます。');
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
