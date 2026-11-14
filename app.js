'use strict';
/* Interview Prep app. All progress lives in localStorage on this device; each finished session is also
   queued and posted to a Google Sheet (if a sync address is set) so a parent can follow progress. */
const APP_VERSION = '1.0.0';
const KEY = 'nip_state_v1';
const INTERVALS = [1, 2, 4, 7, 12];           // days until next review, by box 0..4
const READY_BOX = 3;                           // a card counts as secure at box 3+
const TYPE = {R:'Recall', W:'Why', P:'Pushback', S:'Your statement', N:'Number'};
const UNITS = window.UNITS, CARDS = window.CARDS, PROBLEMS = window.PROBLEMS;
const UNIT = Object.fromEntries(UNITS.map(u => [u.id, u]));
const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));

/* ---------- state ---------- */
function blank(){ return {v:1, cards:{}, units:{}, probs:{}, iwtse:[], sessions:[], queue:[],
  cfg:{sync:'', key:'', interview:'2026-12-11', device:''}}; }
let S = blank(), storageOK = true;
function load(){
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(blank(), JSON.parse(raw)); S.cfg = Object.assign(blank().cfg, S.cfg); }
  catch(e){ storageOK = false; }
}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){ storageOK = false; } }

/* ---------- dates ---------- */
function dstr(d){ const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function today(){ return dstr(new Date()); }
function addDays(s, n){ const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+n); return dstr(d); }
function daysBetween(a, b){ return Math.round((new Date(b+'T12:00:00') - new Date(a+'T12:00:00'))/864e5); }
function daysLeft(){ return daysBetween(today(), S.cfg.interview); }

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const view = $('view');
function show(html){ view.innerHTML = html; window.scrollTo(0,0); }
function on(id, fn){ const el = $(id); if (el) el.addEventListener('click', fn); }
function fmtClock(sec){ sec = Math.max(0, Math.round(sec)); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* ---------- spaced repetition ---------- */
function cs(id){ return S.cards[id]; }
function grade(id, frac){
  const t = today(), c = S.cards[id] || {box:0, seen:0, miss:0};
  c.seen++; c.last = t; c.frac = frac;
  if (frac >= 0.999) c.box = Math.min((c.seen === 1 ? 0 : c.box) + 1, INTERVALS.length-1);
  else if (frac < 0.5){ c.box = 0; c.miss = (c.miss||0) + 1; }
  let gap = frac >= 0.999 ? INTERVALS[c.box] : 1;
  let due = addDays(t, gap);
  const last = addDays(S.cfg.interview, -1);           // never schedule a review past the day before interview
  if (daysBetween(t, last) > 0 && due > last) due = last;
  c.due = due; S.cards[id] = c; save();
}
function cardMastery(id){ const c = cs(id); return c ? Math.min(c.box/READY_BOX, 1) : 0; }
function unitCards(uid){ return CARDS.filter(c => c.u === uid); }
function unitMastery(uid){ const cc = unitCards(uid); return cc.length ? cc.reduce((s,c) => s + cardMastery(c.id), 0)/cc.length : 0; }
function unitReady(uid){ return unitMastery(uid) >= 0.85 && !!S.units[uid]; }
function overall(){ return CARDS.reduce((s,c) => s + cardMastery(c.id), 0)/CARDS.length; }
function dueCards(){ const t = today(); return CARDS.filter(c => cs(c.id) && cs(c.id).due <= t); }
function newCards(){ return CARDS.filter(c => !cs(c.id)); }
function buildQueue(n, unitId){
  const pool = unitId ? unitCards(unitId) : CARDS, t = today();
  const due = pool.filter(c => cs(c.id) && cs(c.id).due <= t).sort((a,b) => cs(a.id).box - cs(b.id).box || a.tier - b.tier);
  let fresh = pool.filter(c => !cs(c.id));
  if (!unitId){ const t1 = shuffle(fresh.filter(c => c.tier === 1)), t2 = shuffle(fresh.filter(c => c.tier !== 1)); fresh = t1.concat(t2); }
  const nNew = Math.max(2, n - due.length);
  let q = due.slice(0, Math.max(0, n - Math.min(nNew, fresh.length))).concat(fresh.slice(0, nNew)).slice(0, n);
  if (q.length < n){                                     // nothing due and nothing new: bring forward the weakest
    const rest = pool.filter(c => !q.includes(c)).sort((a,b) => cs(a.id).box - cs(b.id).box || (cs(a.id).due < cs(b.id).due ? -1 : 1));
    q = q.concat(rest.slice(0, n - q.length));
  }
  return q.map(c => c.id);
}

/* ---------- sessions and sync ---------- */
function streak(){
  const days = new Set(S.sessions.map(s => s.date)); let n = 0, d = today();
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)){ n++; d = addDays(d, -1); }
  return n;
}
function minsOn(date){ return Math.round(S.sessions.filter(s => s.date === date).reduce((a,s) => a + s.mins, 0)); }
function logSession(mode, startedAt, items, score, detail){
  const mins = Math.min(45, Math.max(0.5, Math.round((Date.now() - startedAt)/6000)/10));
  const rec = {ts:new Date().toISOString(), date:today(), mode, mins, items, score:Math.round(score*100), detail:detail||''};
  S.sessions.push(rec);
  S.queue.push(Object.assign({key:S.cfg.key, device:S.cfg.device, overall:Math.round(overall()*100),
    ready:UNITS.filter(u => unitReady(u.id)).length, units:UNITS.length, streak:streak(), daysLeft:daysLeft(), app:APP_VERSION}, rec));
  save(); flush();
  return rec;
}
let flushing = false;
async function flush(){
  if (flushing || !S.cfg.sync || !S.queue.length || !navigator.onLine) return;
  flushing = true;
  try {
    while (S.queue.length){
      // text/plain + no-cors: a "simple" request the Google script accepts without a preflight.
      await fetch(S.cfg.sync, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(S.queue[0])});
      S.queue.shift(); save();
    }
  } catch(e){ /* offline or blocked: keep the queue and try again later */ }
  flushing = false;
}
window.addEventListener('online', flush);

/* ---------- reusable card widget ---------- */
// Renders one card into #cardhost. Calls done(frac) when she presses Next.
function runCard(id, done, label){
  const c = CARD[id], u = UNIT[c.u]; let ticks = c.pts.map(() => false), revealed = false, numOK = null;
  const host = $('cardhost');
  function draw(){
    let h = `<div class="card"><span class="chip">${esc(TYPE[c.type])}</span><span class="chip g">${esc(u.title.split(':')[0])}</span>
      <div class="q">${esc(c.q)}</div>`;
    if (!revealed){
      if (c.type === 'N') h += `<label for="num">Your answer${c.num.unit ? ' ('+esc(c.num.unit)+')' : ''}</label>
        <input id="num" inputmode="decimal" autocomplete="off" placeholder="Work it out, then type the number">
        <p><button class="primary wide" id="check">Check</button></p><button class="ghost wide" id="giveup">I can't get it: show me</button>`;
      else h += `<p class="muted small">Answer it in your head (or out loud) first.</p><button class="primary wide" id="reveal">Show answer</button>`;
    } else {
      if (c.type === 'N') h += `<p class="${numOK ? 'ok' : 'bad'}">${numOK ? 'Correct.' : 'Not this time.'} Answer: ${esc(String(c.num.ans))} ${esc(c.num.unit||'')}</p>`;
      h += `<div class="ans">${esc(c.a)}</div>`;
      if (c.type !== 'N'){
        h += `<h3>Tick what you actually said</h3>` + c.pts.map((p,i) =>
          `<button class="pt" data-i="${i}" aria-pressed="${ticks[i]}"><span class="box">✓</span><span>${esc(p)}</span></button>`).join('');
      }
      h += `<p><button class="primary wide" id="next">${esc(label || 'Next')}</button></p>`;
    }
    host.innerHTML = h + '</div>';
    on('reveal', () => { revealed = true; draw(); });
    on('giveup', () => { revealed = true; numOK = false; draw(); });
    on('check', () => {
      const v = parseFloat(String($('num').value).replace(/,/g,'').replace(/[^0-9eE.+-]/g,''));
      if (isNaN(v)){ $('num').focus(); return; }
      numOK = Math.abs(v - c.num.ans) <= Math.abs(c.num.ans)*c.num.tol; revealed = true; draw();
    });
    host.querySelectorAll('.pt').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.i; ticks[i] = !ticks[i]; b.setAttribute('aria-pressed', ticks[i]); }));
    on('next', () => { const frac = c.type === 'N' ? (numOK ? 1 : 0) : ticks.filter(Boolean).length/ticks.length; grade(id, frac); done(frac); });
    const f = $('num'); if (f) f.addEventListener('keydown', e => { if (e.key === 'Enter') $('check').click(); });
  }
  draw();
}
function sessionTop(title){ return `<div class="top"><button id="quit" aria-label="End session">✕</button><div class="bar"><i id="pbar" style="width:0%"></i></div><div class="t" id="clock"></div></div><p class="muted small">${esc(title)}</p>`; }
let tick = null;
function startClock(limitSec, startedAt){
  clearInterval(tick);
  const draw = () => { const el = $('clock'); if (!el) return clearInterval(tick); const left = limitSec - (Date.now()-startedAt)/1000; el.textContent = left >= 0 ? fmtClock(left) : '+'+fmtClock(-left); };
  draw(); tick = setInterval(draw, 1000);
}
function setBar(f){ const b = $('pbar'); if (b) b.style.width = Math.round(f*100)+'%'; }
function endSession(){ clearInterval(tick); location.hash = '#today'; route(); }
function summary(title, rec, extra){
  clearInterval(tick);
  show(`<h1>${esc(title)}</h1><div class="hero"><div class="stat"><b>${rec.mins}</b><span>minutes</span></div>
    <div class="stat"><b>${rec.items}</b><span>items</span></div><div class="stat"><b>${rec.score}%</b><span>key points hit</span></div></div>
    ${extra||''}<p class="muted small">${syncLine()}</p><p><button class="primary wide" id="home">Done</button></p>`);
  on('home', endSession);
}
function syncLine(){
  if (!S.cfg.sync) return 'Saved on this phone. Sharing with a parent is not set up yet.';
  return S.queue.length ? `Saved on this phone. ${S.queue.length} session(s) waiting to send when you are online.` : 'Saved and sent.';
}

/* ---------- Bus: 10-minute recall ---------- */
function startBus(count){
  const startedAt = Date.now(); let q = buildQueue(count || 8), i = 0, total = 0, done = 0; const again = new Set();
  show(sessionTop('Quick recall') + '<div id="cardhost"></div>');
  on('quit', () => finish()); startClock(600, startedAt);
  function step(){
    if (i >= q.length) return finish();
    setBar(i/q.length);
    runCard(q[i], frac => {
      total += frac; done++;
      if (frac < 0.5 && !again.has(q[i])){ again.add(q[i]); q.push(q[i]); }   // missed: see it once more before the end
      i++; step();
    }, i === q.length-1 ? 'Finish' : 'Next');
  }
  function finish(){
    if (!done) return endSession();
    const rec = logSession('bus', startedAt, done, total/done, again.size ? 'missed: '+[...again].join(' ') : '');
    summary('Recall done', rec, `<p>${again.size ? esc(again.size + ' to see again tomorrow.') : 'Nothing missed.'}</p><button class="wide" id="more">Five more</button>`);
    on('more', () => startBus(5));
  }
  step();
}

/* ---------- Between lessons: one derivation, 20 minutes ---------- */
function suggestUnit(){
  const withSteps = UNITS.filter(u => u.steps && u.steps.length);
  const never = withSteps.find(u => !S.units[u.id]); if (never) return never;
  return withSteps.slice().sort((a,b) => (unitMastery(a.id) - unitMastery(b.id)) || (S.units[a.id].last < S.units[b.id].last ? -1 : 1))[0];
}
function startGap(uid){
  const u = UNIT[uid], startedAt = Date.now(); let stepOK = 0, cardTotal = 0, cardN = 0;
  const stages = 2 + u.steps.length + 5; let pos = 0;
  const frame = body => { show(sessionTop(u.title) + body); on('quit', () => finish(true)); startClock(1200, startedAt); setBar(pos/stages); };
  function picture(){
    frame(`<div class="card"><span class="chip">Physical picture</span><div class="q">Before any maths: say the physical picture for "${esc(u.title)}".</div>
      <p class="muted small">What is going on, in plain words? Then check.</p><button class="primary wide" id="rv">Show the picture</button><div id="pic" class="hide">
      <div class="ans">${esc(u.picture)}</div>${u.img ? `<img class="fig" src="img/${u.img}.png" alt="Diagram for ${esc(u.title)}">` : ''}
      <p><button class="primary wide" id="go">Start the derivation</button></p></div></div>`);
    on('rv', () => { $('pic').classList.remove('hide'); $('rv').classList.add('hide'); });
    on('go', () => { pos++; derive(0); });
  }
  function derive(k){
    if (k >= u.steps.length) return quiz();
    const st = u.steps[k];
    frame(`<div class="card"><span class="chip">Step ${k+1} of ${u.steps.length}</span>
      ${u.steps.slice(0,k).map(s => `<div class="eq">${esc(s.eq)}</div>`).join('')}
      <div class="q">${esc(st.t)}</div><p class="muted small">Write or say the next line, then reveal.</p>
      <button class="primary wide" id="rv">Reveal</button><div id="sol" class="hide"><div class="eq">${esc(st.eq)}</div>
      <div class="row"><button id="yes">I had it</button><button id="no">Not quite</button></div></div></div>`);
    on('rv', () => { $('sol').classList.remove('hide'); $('rv').classList.add('hide'); });
    on('yes', () => { stepOK++; pos++; derive(k+1); });
    on('no', () => { pos++; derive(k+1); });
  }
  function quiz(){
    const pool = unitCards(uid); const pref = {P:0, S:1, W:2, N:3, R:4};
    const t = today();
    const q = pool.slice().sort((a,b) => {
      const da = !cs(a.id) || cs(a.id).due <= t ? 0 : 1, db = !cs(b.id) || cs(b.id).due <= t ? 0 : 1;
      return da - db || pref[a.type] - pref[b.type];
    }).slice(0,5).map(c => c.id);
    let i = 0;
    frame(`<h2>Result</h2><div class="ans">${esc(u.result)}</div><h3>Follow-up questions</h3><div id="cardhost"></div>`);
    (function step(){
      if (i >= q.length) return aloud();
      setBar((pos+i)/stages);
      runCard(q[i], frac => { cardTotal += frac; cardN++; i++; step(); });
    })();
  }
  function aloud(){
    pos = stages - 1; let ticks = u.say.map(() => false), t0 = 0, timer = null;
    frame(`<div class="card"><span class="chip a">60 seconds, out loud</span><div class="q">Explain "${esc(u.title)}" to an interviewer in one minute.</div>
      <p class="muted small">Out loud if you can; under your breath if not. Picture first, then the result.</p>
      <button class="primary wide" id="st">Start 60 s</button><div class="q hide" id="cd" aria-live="off"></div>
      <div id="chk" class="hide"><h3>Tick what you covered</h3>${u.say.map((p,i) => `<button class="pt" data-i="${i}" aria-pressed="false"><span class="box">✓</span><span>${esc(p)}</span></button>`).join('')}
      <p><button class="primary wide" id="fin">Finish</button></p></div><p><button class="ghost wide" id="skip">I've said it: go to the checklist</button></p></div>`);
    const reveal = () => { clearInterval(timer); $('cd').classList.add('hide'); $('st').classList.add('hide'); $('skip').classList.add('hide'); $('chk').classList.remove('hide'); };
    on('st', () => { t0 = Date.now(); $('st').classList.add('hide'); $('cd').classList.remove('hide');
      const d = () => { const left = 60 - (Date.now()-t0)/1000; if (!$('cd')) return clearInterval(timer); $('cd').textContent = fmtClock(left); if (left <= 0) reveal(); };
      d(); timer = setInterval(d, 250); });
    on('skip', reveal);
    view.querySelectorAll('#chk .pt').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.i; ticks[i] = !ticks[i]; b.setAttribute('aria-pressed', ticks[i]); }));
    on('fin', () => { clearInterval(timer); finish(false, ticks.filter(Boolean).length/ticks.length); });
  }
  function finish(early, sayFrac){
    const stepFrac = u.steps.length ? stepOK/u.steps.length : 0;
    if (early && !stepOK && !cardN) return endSession();
    if (!early) S.units[uid] = {last:today(), n:((S.units[uid]||{}).n||0)+1, steps:stepFrac, say:sayFrac};
    const parts = [stepFrac]; if (cardN) parts.push(cardTotal/cardN); if (sayFrac != null) parts.push(sayFrac);
    const rec = logSession('derivation', startedAt, u.steps.length + cardN + (sayFrac != null ? 1 : 0), parts.reduce((a,b) => a+b, 0)/parts.length,
      `${uid}: steps ${stepOK}/${u.steps.length}` + (early ? ' (ended early)' : ''));
    summary(early ? 'Session ended early' : 'Derivation done', rec, `<p>${esc(u.title)}: ${stepOK} of ${u.steps.length} steps predicted.</p>`);
  }
  picture();
}

/* ---------- Unseen problems ---------- */
function startProblem(pid){
  const p = PROBLEMS.find(x => x.id === pid), startedAt = Date.now(); let hints = 0, ticks = p.pts.map(() => false), solved = false;
  function draw(){
    show(sessionTop('Unseen problem · ' + p.topic) + `<div class="card"><span class="chip">${esc(p.topic)}</span><div class="q">${esc(p.q)}</div>
      <p class="muted small">Use paper. Talk through your reasoning as if a tutor is listening. Only take a hint when stuck for a minute.</p>
      ${p.hints.slice(0,hints).map((h,i) => `<div class="ans"><b>Hint ${i+1}.</b> ${esc(h)}</div>`).join('')}
      ${solved ? `<h3>Solution</h3><div class="ans">${esc(p.sol)}</div><h3>Tick what you got to yourself</h3>` +
        p.pts.map((t,i) => `<button class="pt" data-i="${i}" aria-pressed="${ticks[i]}"><span class="box">✓</span><span>${esc(t)}</span></button>`).join('') +
        `<p><button class="primary wide" id="fin">Finish</button></p>`
      : `<div class="row">${hints < p.hints.length ? `<button id="hint">Hint (${hints}/${p.hints.length})</button>` : ''}<button class="primary" id="sol">Show solution</button></div>`}</div>`);
    on('quit', endSession); startClock(1200, startedAt); setBar(solved ? 1 : hints/(p.hints.length+1));
    on('hint', () => { hints++; draw(); });
    on('sol', () => { solved = true; draw(); });
    view.querySelectorAll('.pt').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.i; ticks[i] = !ticks[i]; b.setAttribute('aria-pressed', ticks[i]); }));
    on('fin', () => {
      const frac = ticks.filter(Boolean).length/ticks.length;
      S.probs[pid] = {date:today(), hints, frac};
      const rec = logSession('problem', startedAt, 1, frac, `${pid}: ${hints} hint(s)`);
      summary('Problem done', rec, `<p>${esc(p.title)}: ${hints} hint(s) used.</p>`);
    });
  }
  draw();
}
function nextProblem(){ return PROBLEMS.find(p => !S.probs[p.id]) || PROBLEMS.slice().sort((a,b) => S.probs[a.id].frac - S.probs[b.id].frac)[0]; }

/* ---------- Log a problem done on i-want-to-study-engineering.org ---------- */
function logIwtse(){
  show(`<h1>Log an outside problem</h1><p class="muted">For problems from <a href="https://i-want-to-study-engineering.org/" target="_blank" rel="noopener">i-want-to-study-engineering.org</a>, Isaac Physics or a past paper. Do the problem there, then record it here so it counts.</p>
    <div class="card"><label for="it">Problem name or number</label><input id="it" autocomplete="off">
    <label for="tp">Topic</label><select id="tp">${window.IWTSE_TOPICS.map(t => `<option>${esc(t)}</option>`).join('')}</select>
    <label for="mn">Minutes spent</label><input id="mn" inputmode="numeric" value="10">
    <label for="oc">How did it go?</label><select id="oc"><option value="1">Solved it alone</option><option value="0.6">Solved it with hints</option><option value="0.2">Needed the solution</option></select>
    <label for="nt">What tripped you up? (optional)</label><input id="nt" autocomplete="off">
    <p><button class="primary wide" id="sv">Save</button></p><button class="ghost wide" id="cx">Cancel</button></div>
    <h3>Logged so far: ${S.iwtse.length}</h3>${S.iwtse.slice(-8).reverse().map(x => `<p class="small">${esc(x.date)} · ${esc(x.title)} · ${esc(x.topic)} · ${x.frac >= 1 ? 'alone' : x.frac >= 0.6 ? 'with hints' : 'needed solution'}</p>`).join('')}`);
  on('cx', endSession);
  on('sv', () => {
    const title = $('it').value.trim(); if (!title){ $('it').focus(); return; }
    const mins = Math.min(120, Math.max(1, parseFloat($('mn').value) || 10)), frac = parseFloat($('oc').value);
    const item = {date:today(), title, topic:$('tp').value, mins, frac, note:$('nt').value.trim()}; S.iwtse.push(item);
    const rec = logSession('outside', Date.now() - mins*60000, 1, frac, `${item.topic}: ${title}` + (item.note ? ' / ' + item.note : ''));
    summary('Logged', rec);
  });
}

/* ---------- Today ---------- */
function vToday(){
  const due = dueCards().length, fresh = newCards().length, su = suggestUnit(), np = nextProblem(), dl = daysLeft(), t = today();
  show(`<p class="muted small">${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</p><h1>${dl > 0 ? dl + ' days to interview' : dl === 0 ? 'Interview day' : 'Interview prep'}</h1>
    <div class="hero"><div class="stat"><b>${minsOn(t)}</b><span>min today</span></div><div class="stat"><b>${streak()}</b><span>day streak</span></div><div class="stat"><b>${Math.round(overall()*100)}%</b><span>secure</span></div></div>
    <h3>Pick what fits the time you have</h3>
    <button class="mode" id="bus"><span class="ic">10</span><span><b>On the bus: quick recall</b><span>${due} due · ${fresh} new · 8 questions, silent</span></span></button>
    <button class="mode" id="gap"><span class="ic">20</span><span><b>Between lessons: one derivation</b><span>Next: ${esc(su.title)}</span></span></button>
    <button class="mode" id="prob"><span class="ic">20</span><span><b>Unseen problem</b><span>Next: ${esc(np.title)} · ${Object.keys(S.probs).length}/${PROBLEMS.length} done</span></span></button>
    <button class="mode" id="iw"><span class="ic">+</span><span><b>Log an outside problem</b><span>i-want-to-study-engineering.org and others · ${S.iwtse.length} logged</span></span></button>
    <p class="muted small">${syncLine()}${storageOK ? '' : ' Warning: this browser is not saving progress.'}</p>`);
  on('bus', () => startBus(8)); on('gap', () => startGap(su.id)); on('prob', () => startProblem(np.id)); on('iw', logIwtse);
}

/* ---------- Library ---------- */
function vLibrary(){
  const groups = [...new Set(UNITS.map(u => u.group))];
  show(`<h1>Library</h1><p class="muted">Everything in one place, to read or to choose a session yourself.</p>` +
    groups.map(g => `<h3>${esc(g)}</h3>` + UNITS.filter(u => u.group === g).map(u =>
      `<button class="liblink" data-u="${u.id}">${esc(u.title)}<br><span class="muted small">${unitCards(u.id).length} questions · ${Math.round(unitMastery(u.id)*100)}% secure${unitReady(u.id) ? ' · ready' : ''}</span></button>`).join('')).join('') +
    `<h3>Unseen problems</h3>` + PROBLEMS.map(p => `<button class="liblink" data-p="${p.id}">${esc(p.title)}<br><span class="muted small">${esc(p.topic)}${S.probs[p.id] ? ' · done, ' + S.probs[p.id].hints + ' hint(s)' : ''}</span></button>`).join(''));
  view.querySelectorAll('[data-u]').forEach(b => b.addEventListener('click', () => vUnit(b.dataset.u)));
  view.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => startProblem(b.dataset.p)));
}
function vUnit(uid){
  const u = UNIT[uid];
  show(`<p><button class="ghost" id="back">‹ Library</button></p><h1>${esc(u.title)}</h1>
    <h3>Physical picture</h3><p>${esc(u.picture)}</p>${u.img ? `<img class="fig" src="img/${u.img}.png" alt="Diagram for ${esc(u.title)}">` : ''}
    <h3>Derivation</h3>${u.steps.map((s,i) => `<div class="step"><b>Step ${i+1}.</b> ${esc(s.t)}<div class="eq">${esc(s.eq)}</div></div>`).join('')}
    <h3>Result</h3><div class="ans">${esc(u.result)}</div>
    <div class="row"><button class="primary" id="dr">Practise this derivation</button><button id="qs">Quiz these questions</button></div>
    <h3>Questions and answers (${unitCards(uid).length})</h3>
    ${unitCards(uid).map(c => `<details><summary>${esc(c.q)}</summary><p>${esc(c.a)}</p><p class="muted small">Key points: ${esc(c.pts.join(' · '))}</p></details>`).join('')}`);
  on('back', vLibrary); on('dr', () => startGap(uid));
  on('qs', () => { const startedAt = Date.now(); const q = buildQueue(8, uid); let i = 0, tot = 0;
    show(sessionTop(u.title) + '<div id="cardhost"></div>'); on('quit', endSession); startClock(600, startedAt);
    (function step(){ if (i >= q.length){ const rec = logSession('unit quiz', startedAt, q.length, tot/q.length, uid); return summary('Quiz done', rec); }
      setBar(i/q.length); runCard(q[i], f => { tot += f; i++; step(); }); })(); });
}

/* ---------- Progress ---------- */
function vProgress(){
  const t = today(), days = []; for (let i = 13; i >= 0; i--) days.push(addDays(t, -i));
  const mins = days.map(minsOn), mx = Math.max(30, ...mins), total = Math.round(S.sessions.reduce((a,s) => a + s.mins, 0));
  const weak = CARDS.filter(c => cs(c.id) && (cs(c.id).miss||0) > 0 && cs(c.id).box < READY_BOX).sort((a,b) => cs(b.id).miss - cs(a.id).miss).slice(0,6);
  const seen = CARDS.filter(c => cs(c.id)).length, secure = CARDS.filter(c => cs(c.id) && cs(c.id).box >= READY_BOX).length, dl = daysLeft();
  show(`<h1>Progress</h1><div class="hero"><div class="stat"><b>${dl > 0 ? dl : 0}</b><span>days left</span></div><div class="stat"><b>${streak()}</b><span>day streak</span></div><div class="stat"><b>${total}</b><span>total min</span></div></div>
    <div class="card"><b>Minutes per day, last two weeks</b><div class="days" role="img" aria-label="Minutes per day for the last 14 days: ${mins.join(', ')}">${mins.map(m => `<div class="${m ? '' : 'zero'}" style="height:${Math.max(2, m/mx*100)}%" title="${m} min"></div>`).join('')}</div>
      <div class="daylab">${days.map(d => `<span>${+d.slice(8)}</span>`).join('')}</div></div>
    <div class="card"><b>Questions</b><p class="small muted">${seen} of ${CARDS.length} seen · ${secure} secure (answered fully on three spaced occasions) · ${dueCards().length} due today</p>
      <div class="bar"><i style="width:${Math.round(secure/CARDS.length*100)}%"></i></div>
      <p class="small muted">Unseen problems: ${Object.keys(S.probs).length}/${PROBLEMS.length} · Outside problems logged: ${S.iwtse.length}</p></div>
    <div class="card"><b>Topics</b><p class="small muted">"Ready" = questions secure and the derivation practised at least once. ${UNITS.filter(u => unitReady(u.id)).length} of ${UNITS.length} ready.</p>
      ${UNITS.map(u => { const m = unitMastery(u.id); return `<div class="urow"><div class="n small">${esc(u.title)}${unitReady(u.id) ? ' <span class="chip g">ready</span>' : ''}</div><div class="bar"><i style="width:${Math.round(m*100)}%"></i></div><div class="pc">${Math.round(m*100)}%</div></div>`; }).join('')}</div>
    <div class="card"><b>Weakest questions</b>${weak.length ? weak.map(c => `<details><summary>${esc(c.q)} <span class="chip r">missed ${cs(c.id).miss}×</span></summary><p>${esc(c.a)}</p></details>`).join('') : '<p class="small muted">Nothing missed yet.</p>'}</div>`);
}

/* ---------- Parent ---------- */
function vParent(){
  show(`<h1>Parent</h1><p class="muted">Run a spoken mock interview, and set up progress sharing.</p>
    <h3>Mock interview script</h3><div class="card"><p class="small">Pick a topic. Ask each question aloud, let her talk, push with the follow-ups, and tick the points she makes without prompting.</p>
      <label for="mu">Topic</label><select id="mu">${UNITS.map(u => `<option value="${u.id}">${esc(u.title)}</option>`).join('')}</select><p><button class="primary wide" id="mock">Open script</button></p></div>
    <h3>Progress sharing (Google Sheet)</h3><div class="card"><p class="small">Paste the web-app address of the Google Sheet script and the shared key, on HER phone. Each finished session is then added to the sheet. ${S.queue.length} waiting to send.</p>
      <label for="su">Script address</label><input id="su" value="${esc(S.cfg.sync)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off">
      <label for="sk">Shared key</label><input id="sk" value="${esc(S.cfg.key)}" autocomplete="off" autocapitalize="off">
      <label for="dv">Device label (optional)</label><input id="dv" value="${esc(S.cfg.device)}" placeholder="phone" autocomplete="off">
      <label for="iv">Interview date</label><input id="iv" type="date" value="${esc(S.cfg.interview)}">
      <p><button class="primary wide" id="ss">Save and send a test row</button></p><p class="small muted" id="sm" role="status"></p></div>
    <h3>Backup</h3><div class="card"><p class="small">Progress lives on this phone. Copy this text somewhere safe to back it up, or paste a backup here to restore (for example on a new phone).</p>
      <textarea id="bk" rows="4" aria-label="Backup text"></textarea><div class="row"><button id="ex">Show backup</button><button id="im">Restore from text</button></div><p class="small muted" id="bm" role="status"></p></div>
    <p class="muted small">Version ${APP_VERSION} · ${CARDS.length} questions · ${UNITS.length} topics · ${PROBLEMS.length} unseen problems</p>`);
  on('mock', () => vMock($('mu').value));
  on('ss', () => {
    S.cfg.sync = $('su').value.trim(); S.cfg.key = $('sk').value.trim(); S.cfg.device = $('dv').value.trim(); if ($('iv').value) S.cfg.interview = $('iv').value; save();
    if (!S.cfg.sync){ $('sm').textContent = 'Saved. No address set, so nothing is sent.'; return; }
    S.queue.push({key:S.cfg.key, device:S.cfg.device, ts:new Date().toISOString(), date:today(), mode:'test', mins:0, items:0, score:0, detail:'test row from the app',
      overall:Math.round(overall()*100), ready:UNITS.filter(u => unitReady(u.id)).length, units:UNITS.length, streak:streak(), daysLeft:daysLeft(), app:APP_VERSION});
    save(); $('sm').textContent = 'Sending…';
    flush().then(() => { $('sm').textContent = S.queue.length ? 'Could not send yet (offline?). It will retry.' : 'Sent. Check the sheet for a row marked "test". If none appears, the address or key is wrong.'; });
  });
  on('ex', () => { $('bk').value = JSON.stringify(S); $('bk').select(); $('bm').textContent = 'Select all and copy.'; });
  on('im', () => { try { const o = JSON.parse($('bk').value); if (!o || !o.cards || !o.cfg) throw 0; S = Object.assign(blank(), o); save(); $('bm').textContent = 'Restored.'; } catch(e){ $('bm').textContent = 'That text is not a valid backup.'; } });
}
function vMock(uid){
  const u = UNIT[uid], startedAt = Date.now(); const order = {S:0, P:1, W:2, R:3, N:4};
  const qs = unitCards(uid).filter(c => c.type !== 'N').sort((a,b) => a.tier - b.tier || order[a.type] - order[b.type]).slice(0,8);
  const ticks = qs.map(c => c.pts.map(() => false));
  show(`<p><button class="ghost" id="back">‹ Parent</button></p><h1>Mock: ${esc(u.title)}</h1>
    <p class="muted small">Ask, wait, then push. "Why?", "What are you assuming?" and "What if that were doubled?" work on any answer. Don't rescue her quickly: a pause is fine.</p>
    <div class="card"><b>Open with</b><div class="q">"Tell me about ${esc(u.title.split(':')[0].toLowerCase())}. What is physically going on?"</div><p class="small muted">Listen for: ${esc(u.say.join(' · '))}</p></div>
    ${qs.map((c,k) => `<div class="card"><span class="chip">${esc(TYPE[c.type])}</span><div class="q">${esc(c.q)}</div><div class="ans small">${esc(c.a)}</div>
      ${c.pts.map((p,i) => `<button class="pt" data-k="${k}" data-i="${i}" aria-pressed="false"><span class="box">✓</span><span>${esc(p)}</span></button>`).join('')}</div>`).join('')}
    <label for="mn">Note for the sheet (optional)</label><input id="mn" autocomplete="off"><p><button class="primary wide" id="sv">Save mock result</button></p>`);
  on('back', vParent);
  view.querySelectorAll('.pt').forEach(b => b.addEventListener('click', () => { const k = +b.dataset.k, i = +b.dataset.i; ticks[k][i] = !ticks[k][i]; b.setAttribute('aria-pressed', ticks[k][i]); }));
  on('sv', () => { const all = ticks.flat(); const rec = logSession('mock', startedAt, qs.length, all.filter(Boolean).length/all.length, uid + ($('mn').value ? ' / ' + $('mn').value.trim() : '')); summary('Mock saved', rec); });
}

/* ---------- routing ---------- */
const ROUTES = {today:vToday, library:vLibrary, progress:vProgress, parent:vParent};
function route(){
  clearInterval(tick);
  let h = (location.hash || '#today').slice(1);
  if (h.startsWith('setup=')){                       // one-tap setup link: #setup=<address>|<key>
    try { const [a,k] = decodeURIComponent(h.slice(6)).split('|'); if (/^https:\/\/script\.google\.com\//.test(a)){ S.cfg.sync = a; S.cfg.key = k || ''; save(); } } catch(e){}
    history.replaceState(null, '', location.pathname + '#today'); h = 'today';
  }
  if (!ROUTES[h]) h = 'today';
  document.querySelectorAll('#nav a').forEach(a => a.getAttribute('href') === '#'+h ? a.setAttribute('aria-current','page') : a.removeAttribute('aria-current'));
  ROUTES[h]();
}
window.addEventListener('hashchange', route);
load(); route(); flush();
if ('serviceWorker' in navigator && ((location.protocol === 'https:' || location.hostname === 'localhost'))) navigator.serviceWorker.register('sw.js').catch(() => {});
