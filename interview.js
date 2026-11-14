'use strict';
/* Spoken interview: the app asks, she answers aloud (speech-to-text) or types, and Claude marks the answer
   against the key points and asks a follow-up. Needs signal. The API key never touches this app: the
   Google Sheet script holds it and makes the call. */
const IV_QUESTIONS = 4, IV_FOLLOWUPS = 2;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function pickInterview(n){
  const t = today(), pref = {S:0, P:1, W:2, R:3};
  return CARDS.filter(c => c.type !== 'N').map(c => {
    const st = cs(c.id), fresh = !st || st.due <= t ? 0 : 1;
    return {c, k: fresh*10 + c.tier*3 + pref[c.type] + Math.random()*4};
  }).sort((a,b) => a.k - b.k).slice(0, n).map(x => x.c.id);
}
async function askGrader(payload){
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(S.cfg.sync, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, signal:ctl.signal,
      body:JSON.stringify(Object.assign({action:'grade', key:S.cfg.key, device:S.cfg.device, date:today()}, payload))});
    const j = JSON.parse(await r.text());
    return j && typeof j === 'object' ? j : {ok:false, error:'bad reply'};
  } catch(e){ return {ok:false, error: navigator.onLine ? 'unreachable' : 'offline'}; }
  finally { clearTimeout(timer); }
}
const IV_ERRORS = {
  offline:'You are offline. The spoken interview needs signal.',
  unreachable:'Could not reach the marking service. Check signal and try again.',
  cap:'Today\'s limit of marked answers has been reached. Mark this one yourself.',
  nokey:'Marking is not switched on yet (a parent needs to add the API key to the Google Sheet script).',
  'bad key':'The shared key in the Parent tab does not match the sheet.',
  'bad reply':'The marking service sent something unreadable. Try again.'
};

function startInterview(){
  if (!S.cfg.sync){
    show(`<h1>Spoken interview</h1><div class="card"><p>This mode needs the Google Sheet link, which is not set up on this phone yet. Ask a parent to open the setup link, or fill in the Parent tab.</p><button class="primary wide" id="home">Back</button></div>`);
    return on('home', endSession);
  }
  const startedAt = Date.now(), ids = pickInterview(IV_QUESTIONS); let qi = 0; const marks = [];
  let rec = null, listening = false;
  function stopMic(){ listening = false; if (rec){ try { rec.onend = null; rec.stop(); } catch(e){} rec = null; } }
  function speak(text){ try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = 0.98; speechSynthesis.speak(u); } catch(e){} }

  function ask(question, turn, history, first){
    const c = CARD[ids[qi]];
    show(sessionTop(`Spoken interview · question ${qi+1} of ${ids.length}`) + `<div class="card">
      <span class="chip">${turn ? 'Follow-up ' + turn : esc(TYPE[c.type])}</span><span class="chip g">${esc(UNIT[c.u].title.split(':')[0])}</span>
      <div class="q" id="ivq">${esc(question)}</div>
      <div class="row"><button id="say">Hear it</button>${SR ? '<button id="mic" aria-pressed="false">Start speaking</button>' : ''}</div>
      <label for="tx">${SR ? 'Your answer appears here. Fix any words it misheard, or type instead.' : 'Type your answer, or use the microphone key on your keyboard.'}</label>
      <textarea id="tx" rows="6" autocomplete="off"></textarea>
      <p class="small muted" id="ivs" role="status"></p>
      <p><button class="primary wide" id="sub">Submit answer</button></p><button class="ghost wide" id="self">Skip marking: show me the answer</button></div>`);
    on('quit', () => { stopMic(); if (first) marks.push(first); finish(); }); startClock(900, startedAt); setBar((qi + turn/(IV_FOLLOWUPS+1))/ids.length);
    on('say', () => speak(question));
    on('mic', () => {
      const b = $('mic');
      if (listening){ stopMic(); b.textContent = 'Start speaking'; b.setAttribute('aria-pressed','false'); $('ivs').textContent = ''; return; }
      listening = true; b.textContent = 'Stop'; b.setAttribute('aria-pressed','true'); $('ivs').textContent = 'Listening…';
      // One short recognition at a time, restarted until she presses Stop: the reliable pattern on Android Chrome.
      (function listen(){
        rec = new SR(); rec.lang = 'en-GB'; rec.continuous = false; rec.interimResults = false;
        rec.onresult = e => { const tx = $('tx'); if (!tx) return; const said = e.results[0][0].transcript.trim(); if (said) tx.value = (tx.value ? tx.value.replace(/\s+$/,'') + ' ' : '') + said; };
        rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed'){ stopMic(); if ($('ivs')) $('ivs').textContent = 'Microphone is blocked for this site. Allow it in Chrome, or type your answer.'; if ($('mic')){ $('mic').textContent = 'Start speaking'; $('mic').setAttribute('aria-pressed','false'); } } };
        rec.onend = () => { if (listening && $('tx')) listen(); };
        try { rec.start(); } catch(e){}
      })();
    });
    on('self', () => { stopMic(); selfMark(); });
    on('sub', async () => {
      const answer = $('tx').value.trim(); if (answer.length < 3){ $('ivs').textContent = 'Say or type an answer first.'; return; }
      stopMic(); $('sub').disabled = true; $('ivs').textContent = 'Marking…';
      const res = await askGrader({id:c.id, topic:UNIT[c.u].title, context:UNIT[c.u].picture + ' ' + UNIT[c.u].result, q:c.q, model:c.a, pts:c.pts, history, question, answer, last:turn >= IV_FOLLOWUPS});
      if (!res.ok){
        if ($('ivs')) $('ivs').textContent = IV_ERRORS[res.error] || ('Marking failed: ' + String(res.error || 'unknown').slice(0,120));
        if ($('sub')) $('sub').disabled = false; return;
      }
      result(res, question, answer, turn, history, first);
    });
    if (turn === 0 && qi === 0) return;       // do not speak unprompted before she has tapped anything
    speak(question);
  }
  function result(res, question, answer, turn, history, first){
    const c = CARD[ids[qi]], n5 = v => Math.max(0, Math.min(5, Math.round(+v || 0)));
    const sc = {physics:n5(res.physics), reasoning:n5(res.reasoning), clarity:n5(res.clarity)};
    const pts = c.pts.map((p,i) => !!(res.points && res.points[i]));
    if (turn === 0){ first = {sc:[sc], pts}; grade(c.id, pts.filter(Boolean).length/pts.length); } else first.sc.push(sc);
    const hist = history.concat([{q:question, a:answer}]);
    const follow = turn < IV_FOLLOWUPS && typeof res.followup === 'string' && res.followup.trim().length > 8 ? res.followup.trim() : '';
    show(sessionTop(`Spoken interview · question ${qi+1} of ${ids.length}`) + `<div class="card"><span class="chip">${turn ? 'Follow-up ' + turn : 'First answer'}</span>
      <div class="hero"><div class="stat"><b>${sc.physics}/5</b><span>physics</span></div><div class="stat"><b>${sc.reasoning}/5</b><span>reasoning</span></div><div class="stat"><b>${sc.clarity}/5</b><span>clarity</span></div></div>
      <div class="ans">${esc(String(res.feedback || '').slice(0,600))}</div>
      ${turn === 0 ? '<h3>Key points you made</h3>' + c.pts.map((p,i) => `<div class="pt" aria-pressed="${pts[i]}"><span class="box">✓</span><span>${esc(p)}</span></div>`).join('') : ''}
      <details><summary>Model answer</summary><p>${esc(c.a)}</p></details><details><summary>What it heard</summary><p class="small">${esc(answer)}</p></details>
      ${follow ? `<h3>The interviewer follows up</h3><div class="q">${esc(follow)}</div><p><button class="primary wide" id="fu">Answer the follow-up</button></p><button class="ghost wide" id="nx">Skip to the next question</button>`
               : `<p><button class="primary wide" id="nx">${qi === ids.length-1 ? 'Finish' : 'Next question'}</button></p>`}</div>`);
    on('quit', () => { marks.push(first); finish(); }); startClock(900, startedAt); setBar((qi + (turn+1)/(IV_FOLLOWUPS+1))/ids.length);
    on('fu', () => ask(follow, turn+1, hist, first));
    on('nx', () => { marks.push(first); next(); });
  }
  function selfMark(){
    show(sessionTop(`Spoken interview · question ${qi+1} of ${ids.length}`) + '<div id="cardhost"></div>'); on('quit', finish); startClock(900, startedAt);
    runCard(ids[qi], frac => { marks.push({sc:[], pts:[], self:frac}); next(); }, qi === ids.length-1 ? 'Finish' : 'Next question');
    const rv = $('reveal'); if (rv) rv.click();
  }
  function next(){ qi++; if (qi >= ids.length) return finish(); ask(CARD[ids[qi]].q, 0, [], null); }
  function finish(){
    try { speechSynthesis.cancel(); } catch(e){}
    const done = marks.filter(Boolean); if (!done.length) return endSession();
    const all = done.flatMap(m => m.sc), avg = k => all.length ? all.reduce((a,s) => a + s[k], 0)/all.length : 0;
    const score = all.length ? (avg('physics') + avg('reasoning') + avg('clarity'))/15 : done.reduce((a,m) => a + (m.self||0), 0)/done.length;
    const r = logSession('interview', startedAt, done.length, score,
      all.length ? `physics ${avg('physics').toFixed(1)} reasoning ${avg('reasoning').toFixed(1)} clarity ${avg('clarity').toFixed(1)} · ${ids.slice(0,done.length).join(' ')}` : 'self-marked');
    summary('Interview done', r, all.length ? `<p>Average out of 5: physics ${avg('physics').toFixed(1)}, reasoning ${avg('reasoning').toFixed(1)}, clarity ${avg('clarity').toFixed(1)}.</p>` : '');
  }
  ask(CARD[ids[0]].q, 0, [], null);
}
