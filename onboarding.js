// Voice-guided setup that turns a few answers into a personal focus mode and break mode.
import { store, describeWork, describeBreak } from './settings.js';

const $ = id => document.getElementById(id);

const QUESTIONS = [
  {
    key: 'focus',
    say: 'When you sit down to work, how long do you usually stay focused?',
    options: [
      { label: 'Long, deep sessions', value: 50 },
      { label: 'About 25 minutes', value: 25 },
      { label: 'Short bursts', value: 15 },
    ],
  },
  {
    key: 'nudge',
    say: 'When your posture starts to drift, how should I let you know?',
    options: [
      { label: 'Barely. A soft glow', value: { sensitivity: 'gentle', delay: 10 } },
      { label: 'Clearly, after a few seconds', value: { sensitivity: 'balanced', delay: 5 } },
      { label: 'Right away, with a sound', value: { sensitivity: 'firm', delay: 3, chime: true } },
    ],
  },
  {
    key: 'eyes',
    say: 'Should I look after your eyes too? I can count blinks and notice when you lean in close.',
    options: [
      { label: 'Yes, watch my eyes', value: true },
      { label: 'Just my posture', value: false },
    ],
  },
  {
    key: 'rest',
    say: 'And when it is time to rest, what helps you reset?',
    options: [
      { label: 'Stretching along with a guide', value: { style: 'stretch', count: 5 } },
      { label: 'A little movement', value: { style: 'stretch', count: 3 } },
      { label: 'Breathing and resting my eyes', value: { style: 'breathe', minutes: 3 } },
    ],
  },
  {
    key: 'auto',
    say: 'Last one. When focus time ends, should I start your break for you?',
    options: [
      { label: 'Yes, start it for me', value: true },
      { label: 'Just let me know', value: false },
    ],
  },
];

let voice;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const prefer = ['Samantha', 'Ava', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Karen', 'Serena'];
  voice = prefer.map(n => voices.find(v => v.name.includes(n))).find(Boolean) || voices.find(v => v.lang?.startsWith('en')) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function speak(text, orb, lang = 'en') {
  if (!store.state.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (lang === 'ko') {
    u.lang = 'ko-KR';
    const ko = speechSynthesis.getVoices().find(v => v.lang?.startsWith('ko'));
    if (ko) u.voice = ko;
  } else if (voice) u.voice = voice;
  u.rate = 1.02; u.pitch = 1.05;
  u.onstart = () => orb?.classList.add('speaking');
  u.onend = u.onerror = () => orb?.classList.remove('speaking');
  speechSynthesis.speak(u);
}

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

function typeLine(el, text, token) {
  return new Promise(resolve => {
    if (reducedMotion()) { el.textContent = text; return resolve(); }
    el.textContent = '';
    let i = 0;
    const step = () => {
      if (token.cancelled) return resolve();
      el.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(step, 18); else resolve();
    };
    step();
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
    syncVoiceButton();

    const finish = saved => {
      token.cancelled = true;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      section.hidden = true;
      $('setup-skip').onclick = null;
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

    async function show(text, renderChoices) {
      choices.classList.remove('in');
      choices.innerHTML = '';
      speak(text, orb);
      await typeLine(line, text, token);
      if (token.cancelled) return;
      renderChoices();
      requestAnimationFrame(() => choices.classList.add('in'));
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

    function summary() {
      const work = {
        id: 'my-focus', name: 'My focus', preset: false,
        focus: answers.focus ?? 25,
        sensitivity: answers.nudge?.sensitivity ?? 'balanced',
        delay: answers.nudge?.delay ?? 5,
        chime: !!answers.nudge?.chime,
        eyes: answers.eyes ?? true,
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

    show('Hi, I am Poise. A few quick questions, so your focus and breaks fit the way you work.', () => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.textContent = 'Sounds good';
      b.onclick = next;
      choices.append(b);
    });
  });
}

function syncVoiceButton() {
  const on = store.state.voice;
  const btn = $('setup-voice');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Mute voice' : 'Turn voice on');
  btn.classList.toggle('off', !on);
}
