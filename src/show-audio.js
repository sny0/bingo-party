// The visual phases trigger these cues so a slow frame can't make the jackpot
// fire before the ball lands.
export function createShowAudio(AudioContext) {
  const active = new Set();
  let audio, master, noise, brassWave;
  let enabled = false;

  function update({ sound, volume }) {
    enabled = Boolean(sound && volume);
    if (master) master.gain.setTargetAtTime(enabled ? volume * 0.9 : 0, audio.currentTime, 0.012);
  }

  function prepare(settings) {
    if (!AudioContext || !settings.sound || !settings.volume) return;
    try {
      if (!audio) {
        audio = new AudioContext();
        master = audio.createGain();
        master.gain.value = 0;
        const compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 10;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.085;
        master.connect(compressor);
        compressor.connect(audio.destination);
      }
      update(settings);
      if (audio.state !== 'running') audio.resume().catch(() => {});
    } catch {
      audio = master = null;
    }
  }

  function play(source, at, duration, level, attack, body, filterType, from, to, offset) {
    const filter = audio.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = filterType === 'highpass' ? 0.5 : 0.8;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const amp = audio.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(level, at + attack);
    amp.gain.exponentialRampToValueAtTime(level * 0.55, at + duration * body);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    active.add(source);
    source.onended = () => {
      active.delete(source);
      source.disconnect();
      filter.disconnect();
      amp.disconnect();
    };
    if (offset === undefined) source.start(at);
    else source.start(at, offset);
    source.stop(at + duration);
  }

  function note(at, length, level, type, from, {
    to = from, attack = 0.004, body = 0.20, cutoff = 4200, endCutoff = cutoff, detune = 0,
  } = {}) {
    const osc = audio.createOscillator();
    if (type === 'brass') {
      brassWave ??= audio.createPeriodicWave(new Float32Array(9), Float32Array.of(0, 1, 0.68, 0.48, 0.26, 0.16, 0.12, 0.07, 0.04));
      osc.setPeriodicWave(brassWave);
    } else {
      osc.type = type;
    }
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    play(osc, at, length, level, attack, body, 'lowpass', cutoff, endCutoff);
  }

  function burst(at, length, level, from, to = from, { attack = 0.002, type = 'bandpass' } = {}) {
    if (!noise) {
      noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.5), audio.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = audio.createBufferSource();
    source.buffer = noise;
    // Different offsets keep successive drum hits from sounding identical.
    source.loop = true;
    play(source, at, length, level, attack, 0.24, type, from, to, Math.random() * 0.45);
  }

  function cue(action) {
    if (!enabled || !master) return;
    try { action(audio.currentTime + 0.004); }
    catch { /* The result must still appear if audio is unavailable. */ }
  }

  function spin(milliseconds) {
    cue(now => {
      const length = milliseconds / 1000;
      const climb = [130.81, 155.56, 196, 233.08, 261.63, 311.13, 392, 466.16];
      note(now, 0.18, 0.34, 'triangle', 195, { to: 58, cutoff: 1800, endCutoff: 620 });
      for (let t = 0.06, beat = 0; t < length - 0.12; beat++) {
        const at = now + t;
        const p = t / length;
        const accent = beat % 4 === 0;
        burst(at, 0.047 + (accent ? 0.035 : 0), 0.19 + 0.22 * p + (accent ? 0.12 : 0), 1050 + p * 3100, 780 + p * 1950);
        note(at, 0.067, accent ? 0.19 : 0.11, 'triangle', 210 + p * 100, { to: 85 + p * 60 });
        if (beat % 2 === 0) {
          const pitch = climb[Math.min(climb.length - 1, Math.floor(p * climb.length))] * (beat % 4 === 2 ? 2 : 1);
          note(at, 0.105, 0.08 + p * 0.08, 'brass', pitch, { cutoff: 650 + p * 3500, endCutoff: 880 });
        }
        t += 0.20 - 0.15 * p;
      }
      note(now + length * 0.43, length * 0.52, 0.19, 'sawtooth', 105, {
        to: 720, attack: length * 0.10, body: 0.68, cutoff: 430, endCutoff: 3000,
      });
    });
  }

  function drop(milliseconds) {
    cue(now => {
      const length = milliseconds / 1000;
      const swoosh = length - 0.16;
      burst(now, 0.09, 0.38, 3200, 1400);
      note(now, 0.155, 0.25, 'triangle', 390, { to: 98, cutoff: 1700 });
      burst(now + 0.03, swoosh, 0.25, 1000, 5500, { attack: swoosh * 0.16, type: 'highpass' });
      note(now + 0.055, swoosh - 0.04, 0.18, 'sine', 470, { to: 1920, attack: 0.025 });
      // The tail ends at least 100 ms ahead of the reveal, including on Fast.
    });
  }

  function reveal() {
    cue(now => {
      const hit = (at, notes, bass, length, level) => {
        note(at, length * 0.60, level * 0.80, 'triangle', bass * 1.8, { to: bass, cutoff: 2200, endCutoff: 580 });
        burst(at, length * 0.58, level * 1.12, 3700, 1400, { type: 'highpass' });
        for (const [i, hz] of notes.entries()) {
          const shape = { attack: 0.007, body: 0.50, cutoff: 4700, endCutoff: 2200 };
          note(at, length, level * (i === 2 ? 0.48 : 0.38), 'brass', hz, shape);
          note(at, length, level * 0.15, 'brass', hz, { ...shape, detune: i % 2 ? -8 : 8 });
        }
      };
      // A short pickup, then the bigger resolving chord: "pa-PAAAN".
      hit(now, [246.94, 293.66, 392], 85, 0.115, 0.48);
      const finale = now + 0.125;
      hit(finale, [261.63, 329.63, 523.25], 108, 0.61, 0.61);
      note(finale, 0.37, 0.18, 'triangle', 1046.5, { body: 0.45, cutoff: 3400, endCutoff: 2000 });
      [1318.51, 1567.98, 2093.0, 1567.98, 1046.5].forEach((pitch, i) => {
        note(finale + 0.08 + i * 0.05, 0.19, 0.11 - i * 0.011, 'sine', pitch);
      });
    });
  }

  function stop() {
    for (const source of active) {
      try { source.stop(); } catch { /* It may already have ended. */ }
    }
    active.clear();
  }

  return { prepare, update, spin, drop, reveal, stop, preview: () => cue(now => note(now, 0.14, 0.16, 'triangle', 659.25)) };
}
