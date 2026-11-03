import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as bingo from '../src/bingo.js';

const source = (await readFile(new URL('../app.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/, '');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// Exercise real app events and the persisted game with a deterministic clock.
// This harness checks state transitions; it does not emulate CSS or browser layout.
function mount({ saved, reduced = false, failAnimation = false, failDialog = false } = {}) {
  const elements = new Map();
  const storage = saved ?? new Map([['garagara-bingo-v1', JSON.stringify(bingo.newGame({ sound: false, duration: 1800 }))]]);
  const timers = new Map();
  const animated = [];
  let now = 0;
  let timerId = 0;

  class Element {
    constructor(id = '') {
      this.children = [];
      this.listeners = new Map();
      this.attributes = new Map();
      this.textContent = '';
      this.disabled = false;
      this.open = false;
      this.value = '';
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle: (name, force) => { const add = force ?? !classes.has(name); if (add) classes.add(name); else classes.delete(name); return add; },
      };
      this.style = { setProperty() {} };
      this.id = id;
    }
    set id(value) { this._id = value; if (value) elements.set(value, this); }
    get id() { return this._id; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    animate(frames, options) {
      if (failAnimation) throw new Error('Animation API unavailable');
      const animation = { frames, options, canceled: false, cancel() { this.canceled = true; } };
      animated.push(animation);
      return animation;
    }
    showModal() {
      if (failDialog && this.id === 'draw-dialog') throw new Error('Modal unavailable');
      this.open = true;
    }
    close() {
      if (!this.open) return;
      this.open = false;
      for (const callback of this.listeners.get('close') ?? []) callback({});
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    remove() {}
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) new Element(match[1]);
  const stage = new Element('test-stage');
  const close = new Element('test-close');
  const documentEvents = new Map();
  const document = {
    title: '',
    body: new Element(),
    fullscreenEnabled: false,
    getElementById: id => elements.get(id) ?? null,
    createElement: () => new Element(),
    createTextNode: text => text,
    querySelector: selector => selector === '.draw-stage' ? stage : selector === '.close-dialog' ? close : null,
    addEventListener: (name, callback) => documentEvents.set(name, callback),
  };
  const context = vm.createContext({
    ...bingo, document, console,
    window: { addEventListener() {} },
    navigator: { locks: { request: async (_name, _options, callback) => callback({}) } },
    location: { protocol: 'http:' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  new vm.Script(source, { filename: 'app.js' }).runInContext(context);
  async function tick(milliseconds) {
    const target = now + milliseconds;
    for (let step = 0; step < 1000; step++) {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > target) { now = target; return; }
      now = next[1].due;
      timers.delete(next[0]);
      next[1].callback();
    }
    throw new Error('Timer loop did not settle');
  }
  return {
    elements, stage, storage, animated, tick, document,
    dispatch: (id, name, event = {}) => Promise.all((elements.get(id).listeners.get(name) ?? []).map(callback => callback(event))),
    snapshot: () => JSON.parse(storage.get('garagara-bingo-v1')),
    click: id => {
      const element = elements.get(id);
      const callbacks = element.listeners.get('click') ?? [];
      return Promise.all(callbacks.map(callback => callback({ target: element })));
    },
  };
}

test('charge, launch and finale keep one saved draw and block repeated clicks', async () => {
  const app = mount();
  const completion = app.click('draw-button');
  assert.equal(app.snapshot().drawn.length, 1, 'result is committed before the show');
  assert.equal(app.elements.get('draw-button').disabled, true);
  assert.equal(app.elements.get('ball-number').textContent, '?');
  assert.equal(app.elements.get('draw-dialog').open, true);
  assert.equal(app.document.body.classList.contains('showing-draw'), true);
  assert.equal(app.stage.classList.contains('is-drawing'), true);
  await app.click('draw-button');
  assert.equal(app.snapshot().drawn.length, 1);

  await app.click('sound-button');
  assert.equal(app.elements.get('ball-number').textContent, '?', 'sound toggle must not expose the pending result');
  await app.tick(1600);
  assert.equal(app.stage.classList.contains('is-launching'), true);
  assert.equal(app.elements.get('fx-caption').textContent, '出た！');
  await app.tick(300);
  assert.equal(app.stage.classList.contains('is-finale'), true);
  assert.equal(Number(app.elements.get('fx-number').textContent), app.snapshot().drawn[0]);
  assert.equal(app.elements.get('draw-button').disabled, true, 'finale still owns the draw lock');
  await app.click('draw-button');
  assert.equal(app.snapshot().drawn.length, 1);

  await app.tick(1400);
  await completion;
  assert.equal(app.elements.get('draw-button').disabled, false);
  assert.equal(app.elements.get('settings-button').disabled, false);
  assert.equal(app.stage.classList.contains('is-finale'), false);
  assert.equal(app.elements.get('draw-dialog').open, false);
  assert.equal(app.document.activeElement, app.elements.get('draw-button'));
  assert.equal(app.document.body.classList.contains('showing-draw'), false);
  assert.equal(app.elements.get('confetti-container').children.length, 0);
  assert.ok(app.animated.every(animation => animation.canceled));
});

test('reloading mid-show restores the committed number without replay or loss', async () => {
  const first = mount();
  const completion = first.click('draw-button');
  const number = first.snapshot().drawn[0];
  const restored = mount({ saved: first.storage });
  assert.equal(Number(restored.elements.get('ball-number').textContent), number);
  assert.equal(Number(restored.elements.get('drawn-count').textContent), 1);
  assert.equal(restored.stage.classList.contains('is-drawing'), false);
  assert.equal(restored.elements.get('draw-dialog').open, false);
  assert.equal(restored.elements.get('draw-button').disabled, false);
  await first.tick(3500);
  await completion;
});

test('reduced motion finishes promptly without a burst or animated machine', async () => {
  const app = mount({ reduced: true });
  const completion = app.click('draw-button');
  await app.tick(400);
  await completion;
  assert.equal(app.snapshot().drawn.length, 1);
  assert.equal(app.elements.get('draw-button').disabled, false);
  assert.equal(app.animated.length, 0);
  assert.equal(app.stage.classList.contains('is-finale'), false);
  assert.equal(app.elements.get('confetti-container').children.length, 0);
});

test('animation failure still reveals the saved result and releases the controls', async () => {
  const app = mount({ failAnimation: true });
  await app.click('draw-button');
  assert.equal(app.snapshot().drawn.length, 1);
  assert.equal(Number(app.elements.get('ball-number').textContent), app.snapshot().drawn[0]);
  assert.equal(app.elements.get('draw-button').disabled, false);
  assert.equal(app.elements.get('settings-button').disabled, false);
  assert.equal(app.stage.classList.contains('is-drawing'), false);
});

test('successive shows reuse their effect elements and clean up finished particles', async () => {
  const app = mount();
  for (let round = 0; round < 3; round++) {
    const completion = app.click('draw-button');
    await app.tick(3500);
    await completion;
    assert.equal(app.elements.get('fx-lights').children.length, 36);
    assert.equal(app.elements.get('fx-sparks').children.length, 26);
    assert.equal(app.elements.get('confetti-container').children.length, 0);
    assert.equal(app.snapshot().drawn.length, round + 1);
  }
  assert.equal(new Set(app.snapshot().drawn).size, 3);
  assert.ok(app.animated.every(animation => animation.canceled));
});

test('the seventy-fifth result gets its finale and leaves the completed game disabled', async () => {
  const game = bingo.newGame({ sound: false, duration: 1800 });
  game.drawn = Array.from({ length: 74 }, (_, index) => index + 1);
  const app = mount({ saved: new Map([['garagara-bingo-v1', JSON.stringify(game)]]) });
  const completion = app.click('draw-button');
  await app.tick(1900);
  assert.equal(app.stage.classList.contains('is-finale'), true);
  assert.equal(Number(app.elements.get('fx-number').textContent), 75);
  await app.tick(1400);
  await completion;
  assert.equal(app.elements.get('draw-button').disabled, true);
  assert.equal(Number(app.elements.get('remaining-count').textContent), 0);
  assert.equal(app.elements.get('draw-dialog').open, false);
  assert.equal(app.document.activeElement, app.elements.get('export-button'));
  await app.click('draw-button');
  assert.equal(app.snapshot().drawn.length, 75);
});

test('skipping during any show phase returns to the board with exactly one result', async () => {
  for (const elapsed of [0, 1500, 1900]) {
    const app = mount();
    const completion = app.click('draw-button');
    await app.tick(elapsed);
    await app.click('skip-effects');
    await completion;
    assert.equal(app.snapshot().drawn.length, 1);
    assert.equal(Number(app.elements.get('ball-number').textContent), app.snapshot().drawn[0]);
    assert.equal(app.elements.get('draw-dialog').open, false);
    assert.equal(app.document.body.classList.contains('showing-draw'), false);
    assert.equal(app.document.activeElement, app.elements.get('draw-button'));
    assert.equal(app.elements.get('draw-button').disabled, false);
    assert.ok(app.animated.every(animation => animation.canceled));

    const next = app.click('draw-button');
    await app.tick(1900);
    assert.equal(app.elements.get('draw-dialog').open, true, 'an old skipped timer cannot close the next draw');
    assert.equal(app.stage.classList.contains('is-finale'), true);
    await app.click('skip-effects');
    await next;
    assert.equal(new Set(app.snapshot().drawn).size, 2);
  }
});

test('Escape skips the show without canceling the selected number', async () => {
  const app = mount();
  const completion = app.click('draw-button');
  let prevented = false;
  await app.dispatch('draw-dialog', 'cancel', { preventDefault() { prevented = true; } });
  await completion;
  assert.equal(prevented, true);
  assert.equal(app.elements.get('draw-dialog').open, false);
  assert.equal(app.snapshot().drawn.length, 1);
  assert.equal(app.elements.get('draw-button').disabled, false);
});

test('closing the dialog externally also settles the pending result', async () => {
  const app = mount();
  const completion = app.click('draw-button');
  await app.tick(600);
  app.elements.get('draw-dialog').close();
  await completion;
  assert.equal(app.snapshot().drawn.length, 1);
  assert.equal(app.elements.get('draw-dialog').open, false);
  assert.equal(app.document.body.classList.contains('showing-draw'), false);
  assert.equal(app.elements.get('settings-button').disabled, false);
});

test('failure to open the modal preserves the draw and unlocks the board', async () => {
  const app = mount({ failDialog: true });
  await app.click('draw-button');
  assert.equal(app.snapshot().drawn.length, 1);
  assert.equal(app.elements.get('draw-dialog').open, false);
  assert.equal(app.document.body.classList.contains('showing-draw'), false);
  assert.equal(Number(app.elements.get('ball-number').textContent), app.snapshot().drawn[0]);
  assert.equal(app.elements.get('draw-button').disabled, false);
});

test('sound can be toggled inside the modal and both controls stay in sync', async () => {
  const app = mount();
  const completion = app.click('draw-button');
  assert.equal(app.elements.get('draw-sound-button').getAttribute('aria-pressed'), 'false');
  await app.click('draw-sound-button');
  assert.equal(app.elements.get('sound-button').getAttribute('aria-pressed'), 'true');
  assert.equal(app.elements.get('draw-sound-button').getAttribute('aria-pressed'), 'true');
  assert.equal(app.elements.get('ball-number').textContent, '?');
  await app.click('draw-sound-button');
  assert.equal(app.snapshot().settings.sound, false);
  await app.click('skip-effects');
  await completion;
});

test('a delayed close event from the previous show cannot skip a newly opened dialog', async () => {
  const app = mount();
  const first = app.click('draw-button');
  await app.click('skip-effects');
  await first;
  const second = app.click('draw-button');
  await app.dispatch('draw-dialog', 'close');
  await app.tick(1600);
  assert.equal(app.elements.get('draw-dialog').open, true);
  assert.equal(app.stage.classList.contains('is-launching'), true);
  assert.equal(app.snapshot().drawn.length, 2);
  await app.click('skip-effects');
  await second;
});
