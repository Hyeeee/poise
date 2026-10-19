// Poise assistant: understands short requests in English or Korean and changes modes and settings.
// Runs entirely in the browser. `ctx` gives it access to the app (see app.js).
import { SENSITIVITY, SENS_ORDER, clamp } from './settings.js';

const OFF = /\b(off|stop|disable|hide|no|without)\b|끄|꺼|끔|빼|없애|숨겨|그만|안\s?보|필요\s?없|싫/;
const ON = /\b(on|enable|show|turn on|with)\b|켜|보여|넣어|추가|해줘|필요/;
const BREAK_WORD = /break|rest|휴식|쉬는|쉬기|쉴|브레이크|호흡|breath/;

const t = (lang, en, ko) => (lang === 'ko' ? ko : en);

function toggleValue(text) {
  if (OFF.test(text)) return false;
  if (ON.test(text)) return true;
  return null;
}

function modeAliases(mode) {
  const names = [mode.name.toLowerCase()];
  const extra = { deep: ['딥 포커스', '딥'], flow: ['플로우'], sprint: ['스프린트'], 'my-focus': ['내 집중', '마이 포커스'], 'my-reset': ['내 휴식'] };
  return names.concat(extra[mode.id] || []);
}

function extractName(raw) {
  const quoted = raw.match(/["“'‘「](.+?)["”'’」]/);
  if (quoted) return quoted[1].trim();
  const en = raw.match(/(?:called|named)\s+(.+?)(?:\s+mode)?$/i) || raw.match(/(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(.+?)\s+mode/i);
  if (en) return en[1].trim();
  const ko = raw.match(/([^\s]+)\s*(?:이라는|라는)?\s*모드/);
  if (ko && !/^(새|새로운|휴식|업무|집중|쉬는|작업)$/.test(ko[1])) return ko[1].trim();
  return '';
}

/** Split a message into clauses so "focus 40 min, breaks with breathing" makes two changes. */
function clauses(text) {
  return text.split(/[,;\n]|\.\s|\band\b|\bthen\b|그리고|그다음|그 다음/i).map(s => s.trim()).filter(Boolean);
}

export function respond(message, ctx) {
  const lang = /[가-힣]/.test(message) ? 'ko' : 'en';
  const out = [];
  let handled = false;
  const say = (en, ko) => { out.push(t(lang, en, ko)); handled = true; };

  for (const raw of clauses(message)) {
    const c = raw.toLowerCase();

    if (/help|what can you|how do i|뭐\s?(할|해)|도움|도와|기능/.test(c)) {
      say('Try things like "focus 40 minutes", "less sensitive", "turn off eye care", "breaks with breathing", "make a mode called Study", or "take a break".',
        '"집중 40분", "덜 민감하게", "눈 추적 꺼줘", "휴식은 호흡으로", "\'공부\' 모드 만들어줘", "지금 쉬자" 처럼 말해보세요.');
      continue;
    }

    if (/set ?up again|redo setup|start over|onboard|다시 설정|처음부터|온보딩/.test(c)) {
      ctx.rerunSetup(); say('Starting setup again.', '설정을 처음부터 다시 시작할게요.'); continue;
    }

    if (/settings|edit modes?|customi[sz]e|모드\s?(편집|설정|관리)|설정\s?(열|보여|창)/.test(c)) {
      ctx.openModes(); say('Opening your modes.', '모드 설정을 열었어요.'); continue;
    }

    // New mode
    if (/\b(new|create|make|add)\b.*\bmode|mode\s+(called|named)|새\s?모드|모드.*(만들|추가|생성)/.test(c)) {
      const kind = BREAK_WORD.test(c) ? 'break' : 'work';
      const mode = ctx.newMode(kind, extractName(raw));
      say(`Made "${mode.name}" from your current ${kind === 'work' ? 'focus' : 'break'} mode. Tell me what to change in it.`,
        `지금 ${kind === 'work' ? '집중' : '휴식'} 모드를 바탕으로 "${mode.name}" 모드를 만들었어요. 바꾸고 싶은 걸 말해주세요.`);
      continue;
    }

    // Switch mode by name
    const switching = /switch|\buse\b|change to|go to|select|pick|바꿔|변경|전환|으로|로\s|쓸래|써줘|모드/.test(c);
    const workHit = switching && ctx.works().find(m => modeAliases(m).some(a => c.includes(a)));
    const breakHit = switching && ctx.breaks().find(m => modeAliases(m).some(a => c.includes(a)));
    if (workHit && workHit.id !== ctx.work().id) { ctx.selectWork(workHit.id); say(`Switched to ${workHit.name}.`, `${workHit.name} 모드로 바꿨어요.`); }
    if (breakHit && breakHit.id !== ctx.brk().id) { ctx.selectBreak(breakHit.id); say(`Breaks now use ${breakHit.name}.`, `휴식은 이제 ${breakHit.name} 모드예요.`); }
    if (workHit && workHit.id === ctx.work().id && !breakHit) say(`You're already in ${workHit.name}.`, `이미 ${workHit.name} 모드예요.`);
    else if (breakHit && breakHit.id === ctx.brk().id && !workHit) say(`Breaks already use ${breakHit.name}.`, `휴식은 이미 ${breakHit.name} 모드예요.`);
    if (workHit || breakHit) continue;

    // Durations
    const min = c.match(/(\d+)\s*(분|min|mins|minutes?|m\b)/);
    if (min) {
      const n = Number(min[1]);
      if (BREAK_WORD.test(c)) {
        const v = clamp(n, 1, 15);
        if (ctx.brk().style === 'stretch') {
          const count = clamp(Math.round(v * 1.5), 1, 5);
          ctx.patchBreak({ minutes: v, count });
          say(`Breaks set to about ${v} min (${count} stretches).`, `휴식을 약 ${v}분(스트레칭 ${count}개)으로 맞췄어요.`);
        } else {
          ctx.patchBreak({ minutes: v });
          say(`Breaks are now ${v} min.`, `휴식 시간을 ${v}분으로 바꿨어요.`);
        }
      } else {
        const v = clamp(n, 1, 120);
        ctx.patchWork({ focus: v });
        say(`Focus sessions are now ${v} min.`, `집중 시간을 ${v}분으로 바꿨어요.`);
      }
    }
    const count = c.match(/(\d+)\s*(개|가지|stretch(es)?|moves?|동작)/);
    if (count && !min) {
      const v = clamp(Number(count[1]), 1, 5);
      ctx.patchBreak({ style: 'stretch', count: v });
      say(`Breaks now have ${v} stretch${v > 1 ? 'es' : ''}.`, `휴식 스트레칭을 ${v}개로 맞췄어요.`);
    }
    const sec = c.match(/(\d+)\s*(초|s\b|sec|secs|seconds?)/);
    if (sec) {
      const v = clamp(Number(sec[1]), 2, 30);
      ctx.patchWork({ delay: v });
      say(`I'll wait ${v} seconds before a strong cue.`, `자세가 ${v}초 이상 흐트러지면 알려드릴게요.`);
    }

    // Sensitivity
    const sensIdx = SENS_ORDER.indexOf(ctx.work().sensitivity);
    if (/less sensitive|gentler|gentle|softer|relax|looser|less often|덜\s?민감|둔감|느슨|부드럽|덜\s?자주|살살|약하게/.test(c)) {
      const next = SENS_ORDER[Math.max(0, sensIdx - 1)];
      ctx.patchWork({ sensitivity: next });
      say(`Sensitivity: ${SENSITIVITY[next].label}.`, `민감도를 ${({ gentle: '부드럽게', balanced: '보통', firm: '엄격하게' })[next]} 맞췄어요.`);
    } else if (/more sensitive|stricter|strict|firm|tighter|more often|민감하게|더\s?민감|엄격|빡|자주|강하게|예민/.test(c)) {
      const next = SENS_ORDER[Math.min(2, sensIdx + 1)];
      ctx.patchWork({ sensitivity: next });
      say(`Sensitivity: ${SENSITIVITY[next].label}.`, `민감도를 ${({ gentle: '부드럽게', balanced: '보통', firm: '엄격하게' })[next]} 맞췄어요.`);
    }

    // Alert timing without a number
    if (!sec && /alert|cue|notify|warn|알림|경고|알려/.test(c)) {
      if (/faster|sooner|quicker|earlier|빨리|빠르게|바로|즉시/.test(c)) {
        const v = clamp(ctx.work().delay - 2, 2, 30); ctx.patchWork({ delay: v });
        say(`Cues now come after ${v}s.`, `${v}초 뒤에 알려드릴게요.`);
      } else if (/later|slower|less often|늦게|천천히|여유/.test(c)) {
        const v = clamp(ctx.work().delay + 3, 2, 30); ctx.patchWork({ delay: v });
        say(`Cues now come after ${v}s.`, `${v}초 뒤에 알려드릴게요.`);
      }
    }

    // Toggles
    if (/eye|blink|눈|깜빡/.test(c)) {
      const v = toggleValue(c);
      if (v !== null) { ctx.patchWork({ eyes: v }); say(v ? 'Eye care is on.' : 'Eye care is off.', v ? '눈 건강 추적을 켰어요.' : '눈 건강 추적을 껐어요.'); }
    }
    if (/sound|chime|beep|소리|알림음|효과음|띵/.test(c)) {
      const v = toggleValue(c);
      if (v !== null) { ctx.patchWork({ chime: v }); say(v ? 'Chime is on.' : 'Chime is off.', v ? '알림음을 켰어요.' : '알림음을 껐어요.'); }
    }
    if (/joint|skeleton|bones|관절|스켈레톤|뼈/.test(c)) {
      const v = toggleValue(c);
      if (v !== null) { ctx.setJoints(v); say(v ? 'Showing joints.' : 'Joints hidden.', v ? '관절을 보여드릴게요.' : '관절 표시를 숨겼어요.'); }
    }
    if (/voice|speak|목소리|음성/.test(c)) {
      const v = toggleValue(c);
      if (v !== null) { ctx.setVoice(v); say(v ? 'Voice is on.' : 'Voice is off.', v ? '음성을 켰어요.' : '음성을 껐어요.'); }
    }
    if (/auto|automatic|자동/.test(c)) {
      const v = toggleValue(c);
      if (v !== null) { ctx.patchBreak({ auto: v }); say(v ? 'Breaks will start on their own.' : 'I will ask before starting a break.', v ? '집중이 끝나면 휴식을 자동으로 시작할게요.' : '휴식 전에 먼저 알려드릴게요.'); }
    }

    // Break style
    const wantsStart = /(take|start|begin)\b.*\b(break|rest)|break now|rest now|쉬자|쉴래|쉬고\s?싶|휴식\s?(시작|하자|할래)|지금\s?쉬/.test(c);
    if (/breath|호흡|숨/.test(c) && ctx.brk().style !== 'breathe') {
      ctx.patchBreak({ style: 'breathe' }); say('Breaks are now breathing and eye rest.', '휴식을 호흡과 눈 휴식으로 바꿨어요.');
    } else if (/stretch|스트레칭/.test(c) && !count && ctx.brk().style !== 'stretch') {
      ctx.patchBreak({ style: 'stretch' }); say('Breaks are now guided stretches.', '휴식을 스트레칭으로 바꿨어요.');
    }

    // Actions
    if (wantsStart) { ctx.startBreak(); say('Starting your break.', '휴식을 시작할게요.'); }
    else if (/back to (work|focus)|start (focus|work)|let'?s (work|focus)|집중\s?(시작|하자)|일하자|업무\s?시작|다시\s?일|작업\s?시작/.test(c)) { ctx.startFocus(); say('Back to focus.', '다시 집중 모드예요.'); }
    if (/pause|hold on|stop (the )?timer|멈춰|일시\s?정지|타이머\s?(정지|멈|꺼)/.test(c)) { ctx.pauseTimer(); say('Timer paused.', '타이머를 멈췄어요.'); }
    else if (/resume|start (the )?timer|continue|재개|타이머\s?(시작|켜|다시)/.test(c)) { ctx.resumeTimer(); say('Timer running.', '타이머를 다시 시작했어요.'); }
    if (/reference|calibrat|기준|캘리브/.test(c)) {
      const ok = ctx.calibrate();
      say(ok ? 'Reference saved.' : 'Keep your head and both shoulders in view, then ask again.', ok ? '지금 자세를 기준으로 저장했어요.' : '머리와 양쪽 어깨가 보이게 앉은 뒤 다시 말해주세요.');
    }
    if (/how am i|how'?s my|status|stats|summary|어때|어떤가|상태|요약|얼마나/.test(c)) {
      const s = ctx.status();
      say(s.en, s.ko);
    }
  }

  if (!handled) {
    return {
      changed: false,
      reply: t(lang,
        'I can change focus length, how sensitive cues are, eye care, break style, and your modes. Try "focus 40 minutes" or "less sensitive".',
        '집중 시간, 알림 민감도, 눈 추적, 휴식 방식, 모드를 바꿀 수 있어요. "집중 40분" 이나 "덜 민감하게" 처럼 말해보세요.'),
    };
  }
  return { changed: true, reply: out.join(' ') };
}
