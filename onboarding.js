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
      { label: 'Gently, after 10 seconds', value: { sensitivity: 'gentle', delay: 10 } },
      { label: 'Clearly, after 5 seconds', value: { sensitivity: 'balanced', delay: 5 } },
      { label: 'Right away, with a chime', value: { sensitivity: 'firm', delay: 3, chime: true } },
    ],
  },
  {
    key: 'rest',
    say: 'And when it is time to rest, what helps you reset?',
    options: [
      { label: 'Guided stretches', value: { style: 'stretch', count: 5 } },
      { label: 'Breathing and eye rest', value: { style: 'breathe', minutes: 3 } },
      { label: 'A quick movement game', value: { style: 'game', minutes: 1 } },
    ],
  },
  {
    key: 'auto',
    say: 'Last one. When focus time ends, should I start your break for you?',
    options: [
      { label: 'Start it for me', value: true },
      { label: 'Ask me first', value: false },
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
    if (reducedMotion()) { el.textContent = text; return resolve(); }
    el.innerHTML = '';
    const words = text.split(' ');
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'word'; s.textContent = w + (i < words.length - 1 ? ' ' : '');
      s.style.animationDelay = `${i * 70}ms`;
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
    function minutesPicker(q) {
      let value = answers[q.key] ?? q.start;
      const clampV = v => Math.max(q.min, Math.min(q.max, Math.round(v) || q.start));
      const wrap = document.createElement('div');
      wrap.className = 'min-picker';
      wrap.innerHTML = `
        <label class="min-field">
          <span class="min-label">Minutes</span>
          <span class="min-box">
            <input type="number" inputmode="numeric" min="${q.min}" max="${q.max}" step="${q.step}" value="${value}" aria-label="Focus minutes">
            <span class="min-unit">min</span>
            <span class="min-arrows">
              <button type="button" class="step-btn" data-d="1" aria-label="More"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button>
              <button type="button" class="step-btn" data-d="-1" aria-label="Less"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
            </span>
          </span>
          <span class="min-help">Type a number or use the arrows</span>
        </label>

        <div class="quick">${q.quick.map(m => `<button type="button" class="quick-chip" data-m="${m}">${m >= 60 ? m / 60 + ' hour' : m + ' min'}</button>`).join('')}</div>`;
      const input = wrap.querySelector('input');
      const set = v => {
        value = clampV(v); input.value = value;
        wrap.querySelectorAll('.quick-chip').forEach(c => c.classList.toggle('on', +c.dataset.m === value));
      };
      wrap.querySelectorAll('.step-btn').forEach(b => b.onclick = () => set(value + q.step * +b.dataset.d));
      wrap.querySelectorAll('.quick-chip').forEach(c => c.onclick = () => set(+c.dataset.m));
      input.onchange = () => set(+input.value);
      input.onkeydown = e => { if (e.key === 'Enter') { set(+input.value); go.click(); } };
      const go = document.createElement('button');
      go.className = 'choice'; go.textContent = 'Continue';
      go.onclick = () => { set(+input.value); answers[q.key] = value; go.classList.add('picked'); setTimeout(next, 220); };
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
        q.options.forEach(opt => {
          const b = document.createElement('button');
          b.className = 'choice';
          b.textContent = opt.label;
          b.onclick = () => { answers[q.key] = opt.value; b.classList.add('picked'); setTimeout(next, 220); };
          choices.append(b);
        });
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
        count: answers.rest?.count ?? 5,
        minutes: answers.rest?.minutes ?? 3,
        auto: answers.auto ?? true,
      };
      show('Here is what I set up for you. You can change anything later, or just ask me.', () => {
        choices.innerHTML = `
          <div class="summary">
            <button type="button" class="summary-card" id="edit-focus" aria-label="Change focus"><span>Focus <em>Edit</em></span><b>${work.name}</b><p>${describeWork(work)}</p></button>
            <button type="button" class="summary-card" id="edit-break" aria-label="Change break"><span>Break <em>Edit</em></span><b>${rest.name}</b><p>${describeBreak(rest)}${rest.auto ? ', starts on its own' : ''}</p></button>
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
        const edit = (from, to) => { editUntil = to; index = from - 1; next(); };
        $('edit-focus').onclick = () => edit(QUESTIONS.findIndex(q => q.key === 'focus'), QUESTIONS.findIndex(q => q.key === 'nudge'));
        $('edit-break').onclick = () => edit(QUESTIONS.findIndex(q => q.key === 'rest'), QUESTIONS.findIndex(q => q.key === 'auto'));
      });
    }

    function intro() {
      const hello = 'Hi, I am Poise. A few quick questions, so your focus and breaks fit the way you work.';
      show(hello, () => {
        const pick = document.createElement('div');
        pick.className = 'voice-pick';
        pick.setAttribute('role', 'radiogroup'); pick.setAttribute('aria-label', 'Voice');
        const current = store.state.voiceId || 'ava';
        VOICES.forEach(v => {
          const o = document.createElement('button');
          o.type = 'button'; o.className = 'voice-opt' + (v.id === current ? ' on' : '');
          o.setAttribute('role', 'radio'); o.setAttribute('aria-checked', v.id === current);
          o.innerHTML = `<b>${v.name}</b><small>${v.vibe}</small>`;
          o.onclick = () => {
            store.update(s => { s.voiceId = v.id; s.voice = true; });
            pick.querySelectorAll('.voice-opt').forEach(x => { x.classList.toggle('on', x === o); x.setAttribute('aria-checked', x === o); });
            speak(hello, orb);
          };
          pick.append(o);
        });
        const label = document.createElement('p');
        label.className = 'voice-label'; label.textContent = 'Choose a voice';
        const b = document.createElement('button');
        b.className = 'choice';
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
