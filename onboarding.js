// Voice-guided setup that turns a few answers into a personal focus mode and break mode.
import { store, describeWork, describeBreak } from './settings.js';
import { mountAgents } from './agent.js';
import { ambient } from './ambient.js';

const $ = id => document.getElementById(id);

const QUESTIONS = [
  {
    key: 'focus',
    say: 'When you sit down to work, how long do you usually stay focused?',
    input: 'minutes', min: 5, max: 120, step: 5, start: 30, quick: [10, 30, 60],
  },
  {
    key: 'nudge',
    say: 'When your posture starts to drift, how should I let you know?',
    options: [
      { label: 'Gently', sub: 'After 10 seconds', icon: 'gentle', value: { sensitivity: 'gentle', delay: 10 } },
      { label: 'Clearly', sub: 'After 5 seconds', icon: 'clear', value: { sensitivity: 'balanced', delay: 5 } },
      { label: 'Right away', sub: 'With a chime', icon: 'chime', value: { sensitivity: 'firm', delay: 3, chime: true } },
    ],
  },
  {
    key: 'rest',
    say: 'And when it is time to rest, what helps you reset?',
    options: [
      { label: 'Stretch', sub: 'Follow a figure', icon: 'stretch', value: { style: 'stretch', count: 10 } },
      { label: 'Breathe', sub: 'Slow and calm', icon: 'breathe', value: { style: 'breathe', minutes: .5 } },
      { label: 'Game', sub: 'Move to play', icon: 'game', value: { style: 'game', minutes: 1 } },
    ],
  },
  {
    key: 'auto',
    say: 'Last one. When focus time ends, should I start your break for you?',
    options: [
      { label: 'Start it for me', sub: 'No need to tap', icon: 'auto', value: true },
      { label: 'Ask me first', sub: 'I’ll check first', icon: 'ask', value: false },
    ],
  },
];

let voice;
// Pick the most natural English voice the browser has. Neural "Natural" (Edge),
// "Premium"/"Enhanced" (macOS downloads) and Google voices sound far less robotic.
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter(v => v.lang?.startsWith('en'));
  const score = v => {
    const n = v.name;
    if (/Natural|Neural/i.test(n)) return 100;
    if (/Premium/i.test(n)) return 90;
    if (/Enhanced/i.test(n)) return 80;
    if (/Google US English|Google UK English Female/i.test(n)) return 70;
    if (/Ava|Samantha|Zoe|Allison|Serena|Aria|Jenny/i.test(n)) return 50;
    return v.localService ? 10 : 20;
  };
  voice = voices.sort((a, b) => score(b) - score(a))[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

// File name for a pre-recorded line: voice/<hash>.mp3 (made by tools/make-voice.py).
// Voices to choose from. Ava lives in voice/, the others in voice/<id>/.
export const VOICES = [
  { id: 'ava', name: 'Ava', vibe: 'Warm and clear' },
  { id: 'sonia', name: 'Sonia', vibe: 'Calm, British' },
  { id: 'andrew', name: 'Andrew', vibe: 'Soft and steady' },
];
export function voiceFile(text, id = store.state.voiceId || 'ava') {
  let h = 5381;
  for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `voice/${id === 'ava' ? '' : id + '/'}${h.toString(16)}.mp3`;
}

// For lines that can't be pre-recorded (chat replies), use the browser voice closest to the chosen one.
const LIKE = { ava: { lang: 'en-US', female: true }, sonia: { lang: 'en-GB', female: true }, andrew: { lang: 'en-US', female: false } };
const FEMALE = /ava|samantha|allison|susan|zira|aria|jenny|emma|sonia|serena|kate|libby|female|victoria|karen|moira|fiona/i;
function matchVoice() {
  const want = LIKE[store.state.voiceId || 'ava'];
  const all = ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter(v => v.lang?.startsWith('en'));
  const score = v => (v.lang === want.lang ? 4 : 0) + (FEMALE.test(v.name) === want.female ? 5 : 0) + (/natural|premium|enhanced|neural/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 1 : 0);
  return all.sort((a, b) => score(b) - score(a))[0] || voice;
}

let currentAudio = null;
// Speak a line. Uses a natural pre-recorded voice when one exists for this exact text,
// otherwise falls back to the browser's built-in speech.
// Small line icons for the voice cards.
const VOICE_ICON = {
  ava: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/></svg>',
  sonia: '<svg viewBox="0 0 24 24"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>',
  andrew: '<svg viewBox="0 0 24 24"><path d="M3 9c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1"/><path d="M3 15c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1"/></svg>',
  off: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3l4.5-4v13l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/></svg>',
};
const OPT_ICON = {
  gentle: '<svg viewBox="0 0 24 24"><path d="M4 15c3-4 5-4 8 0s5 4 8 0"/></svg>',
  clear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/></svg>',
  chime: '<svg viewBox="0 0 24 24"><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  stretch: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M6 3.5 10 9h4l4-5.5M12 9v6M9 21l3-6 3 6"/></svg>',
  breathe: '<svg viewBox="0 0 24 24"><path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h7"/></svg>',
  game: '<svg viewBox="0 0 24 24"><circle cx="9" cy="10" r="4.5"/><circle cx="17" cy="15" r="3"/><circle cx="7" cy="18" r="1.5"/></svg>',
  auto: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><path d="M5 5h14v10H10l-4 4v-4H5z"/><path d="M10 9.5a2 2 0 1 1 2.5 2V12"/></svg>',
};
// Stop whatever is speaking right now.
export function stopVoice(orb) {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  orb?.classList.remove('speaking'); ambient.duck(false);
}

export function speak(text, orb, lang = 'en') {
  if (!store.state.voice) return;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const begin = () => { orb?.classList.add('speaking'); ambient.duck(true); };
  const end = () => { orb?.classList.remove('speaking'); ambient.duck(false); };
  const fallback = () => {
    if (!('speechSynthesis' in window)) return end();
    const u = new SpeechSynthesisUtterance(text);
    if (lang === 'ko') {
      u.lang = 'ko-KR';
      const ko = speechSynthesis.getVoices().find(v => v.lang?.startsWith('ko'));
      if (ko) u.voice = ko;
    } else { const v = matchVoice(); if (v) u.voice = v; }
    u.rate = 0.9; u.pitch = 0.95; u.volume = 0.7;
    u.onstart = begin;
    u.onend = u.onerror = end;
    speechSynthesis.speak(u);
  };
  if (lang !== 'en') return fallback();
  const audio = new Audio(voiceFile(text));
  audio.volume = 0.7;
  currentAudio = audio;
  audio.onplay = begin;
  audio.onended = end;
  audio.onerror = () => { if (currentAudio === audio) { currentAudio = null; fallback(); } };
  audio.play().catch(() => { if (currentAudio === audio) { currentAudio = null; fallback(); } });
}

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

// Words drift in one after another, softly, instead of typing letter by letter.
function typeLine(el, text, token) {
  return new Promise(resolve => {
    if (reducedMotion()) { el.innerHTML = ''; text.replace('Poise. A ', 'Poise.\nA ').replace(' First, ', '\nFirst, ').split('\n').forEach((t, i) => { if (i) el.append(document.createElement('br')); el.append(t); }); return resolve(); }
    el.innerHTML = '';
    el.classList.toggle('lines', / First, /.test(text));   // intro: fixed line breaks, no extra wrapping
    const words = text.split(' ');
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'word'; s.textContent = w + (i < words.length - 1 ? ' ' : '');
      s.style.animationDelay = `${i * 70}ms`;
      // The voice ask in the intro starts on its own line (display only; the spoken text is unchanged).
      if ((w === 'First,' || (w === 'A' && words[i - 1] === 'Poise.')) && i > 0) el.append(document.createElement('br'));
      el.append(s);
    });
    setTimeout(() => resolve(), words.length * 70 + 350);
  });
}

/** Runs the setup. Resolves with true when saved, false when skipped. */
export function runOnboarding() {
  return new Promise(resolve => {
    const section = $('setup'), line = $('setup-line'), choices = $('setup-choices'), orb = $('setup-orb'), bar = $('setup-bar');
    const answers = {};
    const token = { cancelled: false };
    let index = -1;
    section.hidden = false;
    mountAgents(section);
    syncVoiceButton();

    const finish = saved => {
      token.cancelled = true;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      section.hidden = true;
      $('setup-skip').onclick = null;
      $('setup-back').onclick = null;
      resolve(saved);
    };
    $('setup-skip').onclick = () => {
      store.update(s => { s.onboarded = true; });
      finish(false);
    };
    $('setup-voice').onclick = () => {
      store.update(s => { s.voice = !s.voice; });
      if (!store.state.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
      syncVoiceButton();
    };

    let step = null; // token for the line currently on screen, so Back can interrupt it
    async function show(text, renderChoices) {
      if (step) step.cancelled = true;
      const my = step = { get cancelled() { return this._c || token.cancelled; }, set cancelled(v) { this._c = v; } };
      $('setup-back').classList.remove('show');
      choices.classList.remove('in');
      choices.innerHTML = '';
      orb.classList.add('thinking');
      await new Promise(r => setTimeout(r, reducedMotion() ? 0 : 650));
      orb.classList.remove('thinking');
      if (my.cancelled) return;
      speak(text, orb);
      await typeLine(line, text, my);
      if (my.cancelled) return;
      renderChoices();
      requestAnimationFrame(() => choices.classList.add('in'));
      setTimeout(() => { if (!my.cancelled) $('setup-back').classList.toggle('show', index >= 0); }, reducedMotion() ? 0 : 1100);
      choices.querySelector('button')?.focus({ preventScroll: true });
    }

    // Minutes picker: type a number, nudge it with − / +, or tap a quick chip.
    // Focus length: one slider. The value reads above it in the app's number style, small marks
    // under the track jump to common lengths. No text field (people rarely typed a number).
    function minutesPicker(q) {
      let value = answers[q.key] ?? q.start;
      const clampV = v => Math.max(q.min, Math.min(q.max, Math.round(v / q.step) * q.step || q.start));
      const MARKS = [15, 30, 45, 60, 90, 120];
      const pct = m => (m - q.min) / (q.max - q.min) * 100;
      const short = m => m < 60 ? `${m}m` : m % 60 ? `${(m / 60).toFixed(1)}h` : `${m / 60}h`;
      const wrap = document.createElement('div');
      wrap.className = 'len-slider';
      wrap.innerHTML = `
        <div class="ls-value"><b aria-hidden="true"></b><span></span></div>
        <div class="ls-track">
          <div class="ls-rail"><i class="ls-fill"></i>${MARKS.map(m => `<i class="ls-tick" style="left:${pct(m)}%"></i>`).join('')}</div>
          <input type="range" min="${q.min}" max="${q.max}" step="${q.step}" value="${value}" aria-label="Focus length in minutes">
        </div>
        <div class="ls-ends"><span>${short(q.min)}</span><span>${short(q.max)}</span></div>
        <div class="quick">${q.quick.map(m => `<button type="button" class="quick-chip" data-m="${m}">${m >= 60 ? m / 60 + ' hour' : m + ' min'}</button>`).join('')}</div>`;
      const range = wrap.querySelector('input'), b = wrap.querySelector('.ls-value b'), u = wrap.querySelector('.ls-value span');
      const set = v => {
        value = clampV(v); range.value = value;
        const h = Math.floor(value / 60), m = value % 60;
        b.textContent = value < 60 ? value : m ? `${h}h ${m}` : h;
        u.textContent = value < 60 ? 'min' : m ? 'min' : h > 1 ? 'hours' : 'hour';
        range.setAttribute('aria-valuetext', `${value} minutes`);
        wrap.style.setProperty('--p', pct(value) + '%');
        wrap.querySelectorAll('.quick-chip').forEach(x => x.classList.toggle('on', +x.dataset.m === value));
        wrap.querySelectorAll('.ls-tick').forEach((t, i) => t.classList.toggle('past', MARKS[i] <= value));
      };
      range.oninput = () => set(+range.value);
      wrap.querySelectorAll('.quick-chip').forEach(x => x.onclick = () => set(+x.dataset.m));
      const go = document.createElement('button');
      go.className = 'choice next'; go.textContent = 'Continue';
      go.onclick = () => { answers[q.key] = value; go.classList.add('picked'); setTimeout(next, 220); };
      choices.append(wrap, go);
      set(value);
    }

    let editUntil = null; // when editing from the summary, return there after this question index
    function next() {
      if (editUntil !== null && index >= editUntil) { editUntil = null; index = QUESTIONS.length - 1; }
      index++;
      bar.style.width = `${Math.min(100, (index / QUESTIONS.length) * 100)}%`;
      if (index >= QUESTIONS.length) return summary();
      const q = QUESTIONS[index];
      show(q.say, () => {
        if (q.input === 'minutes') return minutesPicker(q);
        // Each answer is a card like the voice cards: icon tile, label, one short line.
        const row = document.createElement('div');
        row.className = 'opt-cards'; row.style.setProperty('--n', q.options.length);
        q.options.forEach(opt => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'voice-opt opt-card';
          b.innerHTML = `<span class="vo-icon" aria-hidden="true">${OPT_ICON[opt.icon] || ''}</span><b>${opt.label}</b><small>${opt.sub || ''}</small>`;
          b.onclick = () => { answers[q.key] = opt.value; row.querySelectorAll('.opt-card').forEach(x => x.classList.toggle('on', x === b)); setTimeout(next, 260); };
          row.append(b);
        });
        choices.append(row);
      });
    }

    function back() {
      if (index <= 0) { index = -1; bar.style.width = '0%'; return intro(); }
      index -= 2;
      next();
    }
    $('setup-back').onclick = back;

    function summary() {
      const work = {
        id: 'my-focus', name: 'My focus', preset: false,
        focus: answers.focus ?? 30,
        sensitivity: answers.nudge?.sensitivity ?? 'balanced',
        delay: answers.nudge?.delay ?? 5,
        chime: !!answers.nudge?.chime,
        eyes: false,
      };
      const rest = {
        id: 'my-reset', name: 'My reset', preset: false,
        style: answers.rest?.style ?? 'stretch',
        count: answers.rest?.count ?? 10,
        minutes: answers.rest?.minutes ?? 3,
        auto: answers.auto ?? true,
      };
      const SENS_WORD = { gentle: 'Gentle', balanced: 'Clear', firm: 'Quick' };
      const row = (q, label, value) => `<button type="button" class="sum-row" data-q="${q}"><span>${label}</span><b>${value}</b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`;
      show('Here is what I set up for you. You can change anything later, or just ask me.', () => {
        choices.innerHTML = `
          <div class="summary">
            <div class="sum-card"><h3>Focus</h3>
              ${row('focus', 'Focus length', `${work.focus} min`)}
              ${row('nudge', 'Posture cues', `${SENS_WORD[work.sensitivity]}, after ${work.delay}s${work.chime ? ' + chime' : ''}`)}
            </div>
            <div class="sum-card"><h3>Break</h3>
              ${row('rest', 'Break type', rest.style === 'breathe' ? 'Calm reset' : rest.style === 'game' ? 'Movement game' : `${rest.count} stretches`)}
              ${row('auto', 'Starts', rest.auto ? 'Automatically' : 'When I say')}
            </div>
          </div>
          <div class="summary-actions"><button class="primary" id="setup-save">Start</button></div>`;
        $('setup-save').onclick = () => {
          store.update(s => {
            s.works = s.works.filter(m => m.id !== 'my-focus');
            s.breaks = s.breaks.filter(m => m.id !== 'my-reset');
            s.works.unshift(work); s.breaks.unshift(rest);
            s.workId = work.id; s.breakId = rest.id; s.onboarded = true;
          });
          speak('All set.', orb);
          finish(true);
        };
        // Each row opens just its own question, then comes straight back here.
        choices.querySelectorAll('.sum-row').forEach(r => r.onclick = () => {
          const i = QUESTIONS.findIndex(q => q.key === r.dataset.q);
          editUntil = i; index = i - 1; next();
        });
      });
    }

    function intro() {
      const hello = 'Hi, I’m Poise. A few questions to fit how you work. First, pick a voice.';
      show(hello, () => {
        const pick = document.createElement('div');
        pick.className = 'voice-pick';
        pick.setAttribute('role', 'radiogroup'); pick.setAttribute('aria-label', 'Voice');
        // Three voices plus "No voice". Each card: a small icon tile, the name, and a one-line feel.
        const current = store.state.voice === false ? 'off' : (store.state.voiceId || 'ava');
        const OPTS = [...VOICES, { id: 'off', name: 'No voice', vibe: 'Text only' }];
        OPTS.forEach(v => {
          const o = document.createElement('button');
          o.type = 'button'; o.className = 'voice-opt' + (v.id === current ? ' on' : '') + (v.id === 'off' ? ' off-opt' : '');
          o.setAttribute('role', 'radio'); o.setAttribute('aria-checked', v.id === current);
          // Top-right play mark says "tap to hear" without a label; it turns into moving bars while that voice speaks.
          const play = v.id === 'off' ? '' : '<span class="vo-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 7.5v9l7.5-4.5z"/></svg><i></i><i></i><i></i></span>';
          o.innerHTML = `<span class="vo-icon" aria-hidden="true">${VOICE_ICON[v.id] || ''}</span>${play}<b>${v.name}</b><small>${v.vibe}</small>`;
          if (v.id !== 'off') o.setAttribute('aria-label', `${v.name}, ${v.vibe}. Plays a sample.`);
          o.onclick = () => {
            if (v.id === 'off') {
              store.update(s => { s.voice = false; });
              if ('speechSynthesis' in window) speechSynthesis.cancel();
              stopVoice(orb);
            } else {
              store.update(s => { s.voiceId = v.id; s.voice = true; });
              speak(hello, orb);
            }
            pick.querySelectorAll('.voice-opt').forEach(x => { x.classList.toggle('on', x === o); x.setAttribute('aria-checked', x === o); });
            syncVoiceButton();
          };
          pick.append(o);
        });
        const label = document.createElement('div');
        label.className = 'voice-label';
        // After the intro, one short line asks for a voice before moving on.
        label.hidden = true;   // the intro line already asks for a voice
        // Bars play on the selected card for as long as Poise is speaking.
        const syncPlaying = () => pick.querySelectorAll('.voice-opt').forEach(x => x.classList.toggle('playing', x.classList.contains('on') && orb.classList.contains('speaking')));
        new MutationObserver(syncPlaying).observe(orb, { attributes: true, attributeFilter: ['class'] });
        syncPlaying();
        const b = document.createElement('button');
        b.className = 'choice next';
        b.textContent = "Let's start";
        b.onclick = next;
        choices.append(label, pick, b);
      });
    }
    intro();
  });
}

function syncVoiceButton() {
  const on = store.state.voice;
  const btn = $('setup-voice');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Mute voice' : 'Turn voice on');
  btn.classList.toggle('off', !on);
}
