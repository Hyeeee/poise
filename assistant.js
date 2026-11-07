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
  return text.replace(/\band a half\b/gi, 'andahalf').split(/[,;\n]|\.\s|\band\b|\bthen\b|그리고|그다음|그 다음/i).map(s => s.trim()).filter(Boolean);
}

export function respond(message, ctx) {
  const lang = /[가-힣]/.test(message) ? 'ko' : 'en';
  const out = [];
  let handled = false;
  const say = (en, ko) => { out.push(t(lang, en, ko)); handled = true; };

  for (const raw of clauses(message)) {
    const c = raw.toLowerCase();

    if (/help|what can you|how do i|뭐\s?(할|해)|도움|도와|기능/.test(c)) {
      say('Try things like "focus 1 hour", "only big changes", "breaks with breathing", "make a mode called Study", or "take a break".',
        '"집중 1시간", "큰 변화만", "휴식은 호흡으로", "\'공부\' 모드 만들어줘", "지금 쉬자" 처럼 말해보세요.');
      continue;
    }

    if (/set ?up again|redo setup|start over|onboard|다시 설정|처음부터|온보딩/.test(c)) {
      ctx.rerunSetup(); say('Starting setup again.', '설정을 처음부터 다시 시작할게요.'); continue;
    }

    if (/settings|edit modes?|customi[sz]e|모드\s?(편집|설정|관리)|설정\s?(열|보여|창)/.test(c)) {
      ctx.openModes(); say('Opening your modes.', '모드 설정을 열었어요.'); continue;
    }

    // Small talk
    if (/^(hi|hey|hello|yo)\b|안녕|하이/.test(c)) { say('Hi. Tell me what to change, or ask how you are doing.', '안녕하세요. 바꾸고 싶은 걸 말하거나 지금 어떤지 물어보세요.'); continue; }
    if (/thank|thanks|thx|고마|감사/.test(c)) { say('Anytime.', '언제든지요.'); continue; }

    // Questions people ask about Poise itself
    if (/record|privacy|private|saved?|sent|upload|watching me|spy|녹화|저장|전송|개인\s?정보|사생활|보내/.test(c) && /camera|video|카메라|영상|\?|is it|are you|do you|하나|돼|되나/.test(c)) {
      say('Your posture is read on this device. Nothing is recorded, saved or sent.', '자세는 이 기기 안에서만 읽어요. 녹화하거나 저장하거나 보내지 않아요.'); continue;
    }
    if (/(what|why).*(yellow|red|white|color|colour|light)|(yellow|red|노란|빨간|색).*(뭐|의미|mean|왜)/.test(c)) {
      say('White means you are in your reference posture. Yellow means you are drifting. Red means you have drifted for a while.', '흰색은 기준 자세, 노란색은 자세가 흐트러지는 중, 빨간색은 오래 흐트러진 상태예요.'); continue;
    }
    if (/what('?s| is)( a| the)? reference|레퍼런스가 뭐|기준 자세가 뭐/.test(c)) {
      say('Your reference is the posture you want to keep. Poise tells you when you drift from it. Say "set reference" to save how you sit now.', '기준 자세는 유지하고 싶은 자세예요. 여기서 벗어나면 알려드려요. "기준 저장"이라고 말하면 지금 자세를 저장해요.'); continue;
    }
    if (/why (did|do) you (alert|remind|tell|cue)|왜 알려|왜 울려/.test(c)) {
      say(`I cue you when you drift past your reference for ${ctx.work().delay} seconds. Say "only big changes" or "wait 10 seconds" if it feels too often.`, `기준 자세에서 ${ctx.work().delay}초 넘게 벗어나면 알려드려요. 너무 잦으면 "큰 변화만" 이나 "10초 기다려" 라고 말해보세요.`); continue;
    }
    if (/time left|how (long|much time)|남은 시간|몇 분 남|얼마나 남/.test(c)) {
      const m = ctx.timeLeft(); say(`${m} min left.`, `${m}분 남았어요.`); continue;
    }

    // Things on the top bar
    if (/music|sound|음악|배경음|소리/.test(c) && !/voice|목소리|음성/.test(c)) {
      const v = toggleValue(c) ?? (/mute|quiet|조용/.test(c) ? false : null);
      if (v !== null) { ctx.setMusic(v); say(v ? 'Music is on.' : 'Music is off.', v ? '음악을 켰어요.' : '음악을 껐어요.'); continue; }
    }
    if (/^(mute|be quiet|quiet|shh)|stop talking|don'?t talk|조용히|말\s?하지\s?마|그만\s?말/.test(c)) { ctx.setVoice(false); say('Voice is off. I will show text only.', '음성을 껐어요. 글로만 보여드릴게요.'); continue; }
    if (/^unmute|talk to me|목소리\s?다시/.test(c)) { ctx.setVoice(true); say('Voice is on.', '음성을 켰어요.'); continue; }
    if (/camera|cam\b|카메라/.test(c) && !/record|녹화|저장/.test(c)) {
      const v = toggleValue(c);
      if (v !== null) { ctx.setCamera(v); say(v ? 'Turning the camera on.' : 'Camera is off. Connect the light bar to keep tracking with its sensor.', v ? '카메라를 켤게요.' : '카메라를 껐어요. 라이트바를 연결하면 센서로 계속 볼 수 있어요.'); continue; }
    }
    if (/light ?bar|lightbar|라이트\s?바/.test(c) && /connect|pair|plug|연결|켜/.test(c)) {
      if (ctx.barOn()) say('The light bar is already connected.', '라이트바는 이미 연결돼 있어요.');
      else { ctx.connectBar(); say('Pick your light bar in the window that opens.', '열리는 창에서 라이트바를 골라주세요.'); }
      continue;
    }
    if (/mini ?window|small window|picture in picture|\bpip\b|작은\s?창|미니\s?창/.test(c)) { ctx.openPip(); say('Opening the mini window.', '작은 창을 열었어요.'); continue; }
    if (/\btour\b|show me around|walk me through|guide me|가이드|둘러보|사용법/.test(c)) { ctx.tour(); say('Here is a quick tour.', '간단히 둘러볼게요.'); continue; }

    // Ending things
    if (/(end|finish|stop|wrap up).*(session|focus|work)|(session|focus).*(done|over)|report|세션\s?(끝|종료)|리포트|보고서|오늘\s?끝/.test(c)) {
      if (ctx.endSession()) say('Ending the session. Here is your report.', '세션을 마칠게요. 리포트를 보여드릴게요.');
      else say('Set a reference first so there is a session to end.', '먼저 기준 자세를 저장해야 세션을 마칠 수 있어요.');
      continue;
    }
    if (/(end|skip|stop|finish|done with).*(break|rest)|i'?m done|back to it|휴식\s?(끝|그만|종료|스킵)|그만\s?쉬/.test(c) && ctx.screen() === 'break') {
      ctx.endBreak(); say('Ending your break.', '휴식을 마칠게요.'); continue;
    }

    // Timer tweaks that are not the mode length
    if (/reset|restart/.test(c) && /timer|session|clock|타이머/.test(c) || /타이머\s?(리셋|초기화|처음)/.test(c)) { ctx.resetTimer(); say('Timer reset.', '타이머를 처음으로 되돌렸어요.'); continue; }
    const more = c.match(/(?:add|extend|give me|another|plus)\s*(\d+)\s*(?:more\s*)?(?:min|minutes?|분)|(\d+)\s*more\s*(?:min|minutes?)|(\d+)\s*분\s*(?:더|추가|연장)/);
    if (more) { const m = Number(more[1] || more[2] || more[3]); ctx.addTime(m); say(`Added ${m} min to this session.`, `이번 세션에 ${m}분 더했어요.`); continue; }
    if (/(longer|more time|extend).*(focus|session)|(focus|session).*(longer)|더\s?길게/.test(c)) {
      const v = clamp(ctx.work().focus + 10, 1, 120); ctx.patchWork({ focus: v }); say(`Focus sessions are now ${v} min.`, `집중 시간을 ${v}분으로 늘렸어요.`); continue;
    }
    if (/(shorter|less time).*(focus|session)|(focus|session).*(shorter)|더\s?짧게|짧게/.test(c)) {
      const v = clamp(ctx.work().focus - 10, 5, 120); ctx.patchWork({ focus: v }); say(`Focus sessions are now ${v} min.`, `집중 시간을 ${v}분으로 줄였어요.`); continue;
    }

    // Undo the last change made from chat
    if (/^undo|undo that|take that back|go back|change it back|never ?mind|revert|되돌|취소|원래대로/.test(c)) {
      { const ok = ctx.undo(); say(ok ? 'Done. That change is undone.' : 'There is nothing to undo yet.', ok ? '방금 바꾼 걸 되돌렸어요.' : '되돌릴 변경이 아직 없어요.'); } continue;
    }

    // Rename the current mode: "rename this mode to Study", "call it Study"
    const rn = raw.match(/(?:rename|call)\s+(?:this|the|my)?\s*(?:focus |break )?(?:mode\s+)?(?:it\s+)?(?:to|as)?\s*["“']?([^"”']+?)["”']?\s*$/i) || raw.match(/(?:이름|모드 이름)(?:을|를)?\s*["“']?([^"”']+?)["”']?\s*(?:으로|로)\s*(?:바꿔|변경)/);
    if (rn && /rename|call it|call this|이름/.test(c)) {
      const kind = BREAK_WORD.test(c) || ctx.screen() === 'break' ? 'break' : 'work';
      const name = rn[1].trim().slice(0, 32);
      ctx.renameMode(kind, name);
      say(`Renamed it to "${name}".`, `이름을 "${name}"(으)로 바꿨어요.`); continue;
    }

    // Delete a mode by name, or the current one
    if (/\b(delete|remove)\b.*\bmode|모드.*(삭제|지워)/.test(c)) {
      const all = [...ctx.works().map(m => ['work', m]), ...ctx.breaks().map(m => ['break', m])];
      const hit = all.find(([, m]) => modeAliases(m).some(a => c.includes(a))) || (/(this|current)/.test(c) ? (BREAK_WORD.test(c) ? ['break', ctx.brk()] : ['work', ctx.work()]) : null);
      if (!hit) { say('Which mode? Say its name, like "delete mode Study".', '어떤 모드인지 이름을 말해주세요.'); continue; }
      const ok = ctx.deleteMode(hit[0], hit[1].id);
      say(ok ? `Deleted "${hit[1].name}".` : 'You need at least one mode, so I kept it.', ok ? `"${hit[1].name}" 모드를 지웠어요.` : '모드가 하나는 있어야 해서 남겨뒀어요.'); continue;
    }

    // "play a game" starts a game break right away
    if (/^(let'?s )?play|play (a )?game|game now|게임\s?(하자|할래|시작)/.test(c)) {
      if (ctx.brk().style !== 'game') ctx.patchBreak({ style: 'game' });
      ctx.startBreak(); say('Starting a game break.', '게임 휴식을 시작할게요.'); continue;
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
    // Hours and minutes: "1 hour", "an hour", "1.5 hours", "1h 30m", "hour and a half", "half an hour", "1시간 30분".
    let total = 0;
    const hr = c.match(/(\d+(?:\.\d+)?)\s*(시간|hours?|hrs?|h\b)/) || (/\b(an|one)\s+hour\b|^hour\b|\bhour\b/.test(c) && !/half an hour/.test(c) ? ['', '1'] : null);
    if (hr) total += Number(hr[1]) * 60;
    if (/half an hour|30분 정도|반시간/.test(c)) total += 30;
    if (/and a half|andahalf|반\b/.test(c) && hr) total += 30;
    const mm = c.match(/(\d+)\s*(분|min|mins|minutes?|m\b)/);
    if (mm) total += Number(mm[1]);
    const min = total ? [String(total), String(Math.round(total))] : null;
    if (min) {
      const n = Math.round(total);
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
        const nice = v >= 60 ? `${Math.floor(v / 60)} hour${v >= 120 ? 's' : ''}${v % 60 ? ` ${v % 60} min` : ''}` : `${v} min`;
        say(`Focus sessions are now ${nice}.`, `집중 시간을 ${v}분으로 바꿨어요.`);
      }
    }
    const count = c.match(/(\d+)\s*(개|가지|stretch(es)?|moves?|동작)/);
    if (count && !mm) {
      const v = clamp(Number(count[1]), 1, 5);
      ctx.patchBreak({ style: 'stretch', count: v });
      say(`Breaks now have ${v} stretch${v > 1 ? 'es' : ''}.`, `휴식 스트레칭을 ${v}개로 맞췄어요.`);
    }
    const sec = c.match(/(\d+)\s*(초|s\b|sec|secs|seconds?)/);
    if (sec) {
      const v = clamp(Number(sec[1]), 2, 30);
      ctx.patchWork({ delay: v });
      say(`I'll cue you after ${v} seconds of drifting.`, `자세가 ${v}초 이상 흐트러지면 알려드릴게요.`);
    }

    // When to notice (same words as Settings). Naming an option sets it directly.
    const NOTICE_SAY = { gentle: 'I’ll only notice big changes now.', balanced: 'I’ll notice clear slouches now.', firm: 'I’ll notice small shifts now.' };
    const NOTICE_KO = { gentle: '큰 변화만 알려드릴게요.', balanced: '확실히 구부정할 때 알려드릴게요.', firm: '작은 변화도 알려드릴게요.' };
    const named = /only big changes|big changes|큰 변화/.test(c) ? 'gentle' : /clear slouch/.test(c) ? 'balanced' : /small shifts|small changes|작은 변화/.test(c) ? 'firm' : null;
    const sensIdx = SENS_ORDER.indexOf(ctx.work().sensitivity);
    if (named) {
      ctx.patchWork({ sensitivity: named });
      say(NOTICE_SAY[named], NOTICE_KO[named]);
    } else if (/less sensitive|gentler|gentle|softer|relax|looser|less often|덜\s?민감|둔감|느슨|부드럽|덜\s?자주|살살|약하게/.test(c)) {
      const next = SENS_ORDER[Math.max(0, sensIdx - 1)];
      ctx.patchWork({ sensitivity: next });
      say(NOTICE_SAY[next], NOTICE_KO[next]);
    } else if (/more sensitive|stricter|strict|firm|tighter|more often|민감하게|더\s?민감|엄격|빡|자주|강하게|예민/.test(c)) {
      const next = SENS_ORDER[Math.min(2, sensIdx + 1)];
      ctx.patchWork({ sensitivity: next });
      say(NOTICE_SAY[next], NOTICE_KO[next]);
    }

    // Alert timing without a number
    if (!sec && /alert|cue|notify|warn|알림|경고|알려/.test(c)) {
      if (/faster|sooner|quicker|earlier|빨리|빠르게|바로|즉시/.test(c)) {
        const v = clamp(ctx.work().delay - 2, 2, 30); ctx.patchWork({ delay: v });
        say(`I'll cue you after ${v} seconds of drifting.`, `${v}초 뒤에 알려드릴게요.`);
      } else if (/later|slower|less often|늦게|천천히|여유/.test(c)) {
        const v = clamp(ctx.work().delay + 3, 2, 30); ctx.patchWork({ delay: v });
        say(`I'll cue you after ${v} seconds of drifting.`, `${v}초 뒤에 알려드릴게요.`);
      }
    }

    // Toggles
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
    const wantsStart = /(take|start|begin)\b.*\b(break|rest)|break now|rest now|쉬자|쉴래|쉬고\s?싶|휴식\s?(시작|하자|할래)|지금\s?쉬/.test(c) && !/auto|automatic|on their own|자동/.test(c);
    if (/breath|호흡|숨/.test(c) && ctx.brk().style !== 'breathe') {
      ctx.patchBreak({ style: 'breathe' }); say('Breaks are now breathing and eye rest.', '휴식을 호흡과 눈 휴식으로 바꿨어요.');
    } else if (/\bgame|bubble|play|게임|버블|놀이/.test(c) && !wantsStart && ctx.brk().style !== 'game') {
      ctx.patchBreak({ style: 'game' }); say('Breaks are now a movement game.', '휴식을 움직임 게임으로 바꿨어요.');
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
        'I can change focus length, when I notice a drift, break style, and your modes. Try "focus 1 hour" or "only big changes".',
        '집중 시간, 알림 시점, 휴식 방식, 모드를 바꿀 수 있어요. "집중 1시간" 이나 "큰 변화만" 처럼 말해보세요.'),
    };
  }
  return { changed: true, reply: out.join(' ') };
}
