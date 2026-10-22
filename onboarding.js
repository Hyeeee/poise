// Voice-guided setup that turns a few answers into a personal focus mode and break mode.
import { store, describeWork, describeBreak } from './settings.js';
import { mountAgents } from './agent.js';
import { ambient } from './ambient.js';

const $ = id => document.getElementById(id);

const QUESTIONS = [
  {
    key: 'focus',
    say: 'When you sit down to work, how long do you usually stay focused?',
    options: [
      { label: 'About 15 minutes', value: 15 },
      { label: 'About 30 minutes', value: 30 },
      { label: 'About 50 minutes', value: 50 },
    ],
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
      { label: 'Five guided stretches', value: { style: 'stretch', count: 5 } },
      { label: 'Three quick stretches', value: { style: 'stretch', count: 3 } },
      { label: 'Breathing and eye rest', value: { style: 'breathe', minutes: 3 } },
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
export function voiceFile(text) {
  let h = 5381;
  for (const ch of text) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return `voice/${h.toString(16)}.mp3`;
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
    } else if (voice) u.voice = voice;
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
      $('setup-back').hidden = true;
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
      setTimeout(() => { if (!my.cancelled) $('setup-back').hidden = index < 0; }, reducedMotion() ? 0 : 1100);
      choices.querySelector('button')?.focus({ preventScroll: true });
    }

    function next() {
      index++;
      bar.style.width = `${Math.min(100, (index / QUESTIONS.length) * 100)}%`;
      if (index >= QUESTIONS.length) return summary();
      const q = QUESTIONS[index];
      show(q.say, () => {
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
            <div class="summary-card"><span>Focus</span><b>${work.name}</b><p>${describeWork(work)}</p></div>
            <div class="summary-card"><span>Break</span><b>${rest.name}</b><p>${describeBreak(rest)}${rest.auto ? ', starts on its own' : ''}</p></div>
          </div>
          <div class="summary-actions"><button class="primary" id="setup-save">Start</button><button class="text-btn" id="setup-again">Start over</button></div>`;
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
        $('setup-again').onclick = () => { index = -1; next(); };
      });
    }

    function intro() {
      show('Hi, I am Poise. A few quick questions, so your focus and breaks fit the way you work.', () => {
        const b = document.createElement('button');
        b.className = 'choice';
        b.textContent = "Let's start";
        b.onclick = next;
        choices.append(b);
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
