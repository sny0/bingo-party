import test from 'node:test';
import assert from 'node:assert/strict';
import { TOTAL, newGame, decodeGame, chooseNumber, commitDraw, secureIndex, bingoLetter, cleanSettings } from '../src/bingo.js';

test('all 75 numbers are drawn once and the game finishes', () => {
  for (let trial = 0; trial < 20; trial++) {
    let game = newGame();
    for (let count = 0; count < TOTAL; count++) {
      const number = chooseNumber(game.drawn);
      assert.ok(Number.isInteger(number) && number >= 1 && number <= 75);
      assert.ok(!game.drawn.includes(number));
      game = commitDraw(game, number);
      assert.equal(game.drawn.length, count + 1);
    }
    assert.equal(new Set(game.drawn).size, TOTAL);
    assert.equal(chooseNumber(game.drawn), null);
    assert.deepEqual([...game.drawn].sort((a,b) => a-b), Array.from({length:75}, (_,i) => i+1));
  }
});

test('only the last remaining number can be selected', () => {
  const drawn = Array.from({ length: TOTAL }, (_, i) => i + 1).filter(n => n !== 42);
  assert.equal(chooseNumber(drawn, () => 0), 42);
});

test('rejection sampling discards biased upper values', () => {
  let calls = 0;
  const index = secureIndex(75, buffer => { buffer[0] = ++calls === 1 ? 0xffffffff : 74; });
  assert.equal(calls, 2);
  assert.equal(index, 74);
  assert.equal(secureIndex(1, buffer => { buffer[0] = 0xffffffff; }), 0);
  for (const length of [0, -1, 76, 2.5]) assert.throws(() => secureIndex(length), RangeError);
});

test('committing a result does not mutate the old state and rejects repeats', () => {
  const original = newGame();
  const next = commitDraw(original, 7);
  assert.deepEqual(original.drawn, []);
  assert.deepEqual(next.drawn, [7]);
  assert.throws(() => commitDraw(next, 7));
  for (const number of [0, 76, -1, 1.2, '7', null]) assert.throws(() => commitDraw(original, number));
});

test('saved results and settings survive serialization and resume without repeats', () => {
  const game = commitDraw(newGame({ title: 'みんなの忘年会', volume: 0.25, duration: 5200, sound: false }), 42);
  const restored = decodeGame(JSON.stringify(game));
  assert.deepEqual(restored, game);
  for (let i = 0; i < 74; i++) assert.notEqual(chooseNumber(restored.drawn), 42);
  assert.notEqual(restored.drawn, game.drawn);
});

test('invalid and duplicate histories cannot be imported', () => {
  for (const value of [null, {}, [], {schema: 2, drawn: []}, {schema: 1, drawn: [1,1]}, {schema: 1, drawn: [0]}, {schema: 1, drawn: [76]}, {schema: 1, drawn: ['1']}, {schema: 1, drawn: [1.5]}]) {
    assert.throws(() => decodeGame(value));
  }
  assert.throws(() => decodeGame('not json'));
});

test('settings are constrained and absent optional settings use defaults', () => {
  assert.deepEqual(decodeGame({ schema:1, drawn:[] }).settings, newGame().settings);
  const settings = cleanSettings({ title:'   ', duration:0, volume:500, sound:'yes' });
  assert.equal(settings.title, '忘年会ビンゴ');
  assert.equal(settings.duration, 3400);
  assert.equal(settings.volume, 1);
  assert.equal(settings.sound, true);
  assert.equal(cleanSettings({title:'a'.repeat(100)}).title.length, 36);
});

test('standard BINGO letter boundaries are correct', () => {
  for (const [number, letter] of [[1,'B'],[15,'B'],[16,'I'],[30,'I'],[31,'N'],[45,'N'],[46,'G'],[60,'G'],[61,'O'],[75,'O']]) assert.equal(bingoLetter(number), letter);
  assert.equal(bingoLetter(undefined), 'BINGO');
});
