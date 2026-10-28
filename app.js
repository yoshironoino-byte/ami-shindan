/* 診断本体（LIFF／ブラウザ単体の両対応）
 * 正本：診断_ワークフロー詳細.md（画面S01〜S19）、AMI_リード獲得診断ツール設計.md（v4.1）
 */
(function () {
  'use strict';
  var CFG = window.SHINDAN_CONFIG || {};
  var C = window.ShindanCalc;
  var $main = document.getElementById('main');
  var master = null, cases = null, taxonomy = null;
  var liffReady = false, liffUserId = '';

  // ---------- 状態 ----------
  var S = {
    token: '', started_at: '', src: {}, screen: 0, screenId: 'S01',
    a: { // 回答（ワークフローD章のキー）
      industry: '', industry_group: '', industry_sub: '', emp_total: null, emp_part: null, wage: null, wage_default: null, wage_source: 'default', annual_income: null,
      role: '', revenue_band: '', revenue: null, gross_margin_rate: '', freed_use: '', areas: [], area_headcount: {}, area_headcount_source: {}, exec_count: 1, exec_wage: 5000,
      tasks: [], task_answers: {}, invest_amount: '', invest_used_rate: '', vacancies: null, vacancy_months: '', lead: '',
      f1: '', f2: '', f3: '', p1: '', p2: '', wage_override: {},
      assumptions_opened: false, wage_slider_used: false, cta: ''
    },
    screen_times: {}, result: null, route: '', completed_at: ''
  };

  var LABELS = {
    role: { owner: '社長・役員', manager: '管理職', staff: '担当者' },
    revenue: ['〜5千万', '5千万〜1億', '1-3億', '3-10億', '10億〜'],
    revenueLabel: { '〜5千万': '〜5千万円', '5千万〜1億': '5千万〜1億円', '1-3億': '1〜3億円', '3-10億': '3〜10億円', '10億〜': '10億円〜' },
    f1: { none: '誰も使っていない', personal: '社長や一部が個人で使っている', unused: '会社で入れたが使われていない', active: '会社として活用できている' },
    f2: { positive: '前向き', some: '一部が反発しそう', strong: '古参や幹部が強く反発しそう', unknown: 'わからない' },
    f3: { '3m': '3ヶ月以内', '6m': '半年以内', '1y': '1年以内', info: 'まずは情報収集' },
    p1: { owner: '社長自身', managers: '幹部・管理職', staff: '現場の社員', company: '会社全体の仕組みとして' },
    p2: { lt50: '〜50万円', '50-200': '50〜200万円', '200-500': '200〜500万円', gte500: '500万円以上' },
    volume: { low: '少ない', std: '標準', high: '多い' },
    overtime: { none: '残業にはなっていない', some: '一部は残業で対応している', much: '残業や休日出勤で回している' },
    invest: { '0': '投資していない', '500000': '〜100万円', '3000000': '100〜500万円', '12500000': '500〜2,000万円', '30000000': '2,000万円以上' },
    used: { '0.9': 'ほぼ全部使われている', '0.5': '半分くらい', '0.2': '一部だけ', '0.05': 'ほとんど使われていない' },
    vacmonths: { '2': '3ヶ月未満', '6': '半年くらい', '12': '1年以上' },
    lead: { exists: '任せられる人がいる', owner: '社長自身がやるしかない', none: '誰もいない' },
    freed: { sales: '営業・顧客開拓に回す', develop: '製品・サービス開発に回す', training: '社員の教育・育成に回す', cost: '残業や外注を減らす', undecided: 'まだ決めていない' },
    gmDefault: { MFG: 0.35, CON: 0.25, LOG: 0.25, WHS: 0.2, MED: 0.6, PRO: 0.7, FNB: 0.6, RTL: 0.3, RES: 0.4, HTL: 0.6, CAR: 0.8, EDU: 0.7, AUT: 0.4, BEA: 0.7, PRN: 0.35, ICT: 0.5, SVC: 0.3, OTH: 0.4 },
    route: { A: 'AMI（経営×AIの6ヶ月伴走）', B: '研修パッケージ（全社）＋経営者合宿', C: '対面2days研修・経営者合宿', D: '従業員向け0→1 eラーニング研修' }
  };

  // ---------- ユーティリティ ----------
  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function hRow(html) { var t = document.createElement('table'); t.innerHTML = '<tbody>' + html.trim() + '</tbody>'; return t.querySelector('tr'); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toHalf(s) { return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[^0-9]/g, ''); }
  function num(s) { var t = toHalf(s); return t === '' ? null : parseInt(t, 10); }
  function man(v) { return C.fmtMan(v); }
  function yen(v) { return Math.round(v).toLocaleString('ja-JP') + '円'; }
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(function () { t.style.display = 'none'; }, 2500); }
  function genToken() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function save() { try { localStorage.setItem('shindan_v4', JSON.stringify({ S: S, at: Date.now() })); } catch (e) {} }
  function loadSaved() { try { var j = JSON.parse(localStorage.getItem('shindan_v4') || 'null'); if (j && Date.now() - j.at < (CFG.RESUME_HOURS || 24) * 3600e3 && j.S && j.S.screenId !== 'S19') return j.S; } catch (e) {} return null; }
  function ga(ev, params) { try { if (window.gtag) window.gtag('event', ev, params || {}); } catch (e) {} console.debug('[ga]', ev, params || ''); }
  function industry() { return master.industries[S.a.industry]; }
  function enabledList() { return CFG.ENABLED_INDUSTRIES || master.enabled_industries; }
  function empEff() { return C.effectiveHeadcount(S.a); }
  function areaById(id) { var ind = industry(); if (!ind) return null; for (var i = 0; i < ind.areas.length; i++) if (ind.areas[i].id === id) return ind.areas[i]; return null; }
  function taskById(id) { var ind = industry(); if (!ind) return null; for (var i = 0; i < ind.areas.length; i++) for (var j = 0; j < ind.areas[i].tasks.length; j++) if (ind.areas[i].tasks[j].id === id) return ind.areas[i].tasks[j]; return null; }
  function casesFor(code, exclude) {
    if (!cases) return [];
    var list = (cases[code] && cases[code].length ? cases[code] : cases._shared) || [];
    return list.filter(function (c) { return exclude.indexOf(c) < 0; });
  }

  // ---------- 画面列の生成 ----------
  function buildScreens() {
    var a = S.a, list = [];
    list.push({ id: 'S01', type: 'intro' });
    if (!a.industry_preset) {
      list.push({ id: 'S02', type: 'industry' });            // 大分類
      var grp = taxonomy && taxonomy.groups.filter(function (g) { return g.id === a.industry_group; })[0];
      if (grp && grp.subs.length > 1) list.push({ id: 'S02s', type: 'subindustry', group: grp });  // 小分類
    }
    if (a.industry && (enabledList().indexOf(a.industry) < 0 || !master.industries[a.industry])) { list.push({ id: 'S02b', type: 'notready' }); return list; }
    if (!a.industry) return list;
    list.push({ id: 'S03', type: 'emp' });
    list.push({ id: 'S04', type: 'wage' });
    list.push({ id: 'S05', type: 'single', key: 'role', q: 'あなたの立場を教えてください', opts: LABELS.role });
    list.push({ id: 'S06', type: 'revenue' });
    list.push({ id: 'S06b', type: 'margin' });
    list.push({ id: 'S07', type: 'areas' });
    var cs = [];
    (a.areas || []).forEach(function (aid) {
      var ar = areaById(aid); if (!ar) return;
      list.push({ id: 'S09a-' + aid, type: ar.kind === 'exec' ? 'exechead' : 'head', area: ar });
      list.push({ id: 'S09b-' + aid, type: 'tasks', area: ar });
      ar.tasks.forEach(function (t) { if (a.tasks.indexOf(t.id) >= 0) { list.push({ id: 'S10a-' + t.id, type: 'taskq', task: t, area: ar }); list.push({ id: 'S10b-' + t.id, type: 'taskh', task: t, area: ar }); } });
    });
    // v4.4 空いた時間の使い道（業務の直後。ここまでで空く時間を見せてから聞く）
    if (a.tasks.length) list.push({ id: 'S10f', type: 'freed' });
    // v4.2 踏み込んだ質問（過去の投資・人手不足・推進体制）
    list.push({ id: 'S10c1', type: 'single', key: 'invest_amount', q: 'この3年で、ITやAIにいくら投資しましたか（ソフト・システム・コンサル・研修を含む）', opts: LABELS.invest });
    if (a.invest_amount && a.invest_amount !== '0') list.push({ id: 'S10c2', type: 'single', key: 'invest_used_rate', q: 'その投資は、いま現場でどれくらい使われていますか', opts: LABELS.used });
    list.push({ id: 'S10c3', type: 'vacancy' });
    if (a.vacancies) list.push({ id: 'S10c4', type: 'single', key: 'vacancy_months', q: 'そのポジションは、どれくらい埋まっていませんか（平均）', opts: LABELS.vacmonths });
    list.push({ id: 'S15', type: 'result' });
    list.push({ id: 'S16', type: 'single', key: 'p1', q: 'AIを使えるようになってほしいのは、誰ですか', opts: LABELS.p1 });
    list.push({ id: 'S17', type: 'single', key: 'p2', q: '投資に見合った効果が得られると分かれば、どれぐらいまで投資できますか（年間）', opts: LABELS.p2 });
    list.push({ id: 'S18', type: 'prescription' });
    list.push({ id: 'S19', type: 'exit' });
    return list;
  }
  var screens = [];

  function go(delta, toId) {
    screens = buildScreens();
    var idx;
    if (toId) idx = screens.findIndex(function (s) { return s.id === toId; });
    else { var cur = screens.findIndex(function (s) { return s.id === S.screenId; }); idx = Math.max(0, Math.min(screens.length - 1, cur + delta)); }
    if (idx < 0) idx = 0;
    S.screen = idx; S.screenId = screens[idx].id; S.screen_times[S.screenId] = new Date().toISOString();
    save(); render(); window.scrollTo(0, 0);
  }
  function next() { go(1); }
  function back() { go(-1); }

  function updateProgress() {
    var cur = screens.findIndex(function (s) { return s.id === S.screenId; });
    var resultIdx = screens.findIndex(function (s) { return s.type === 'result'; });
    var left = document.getElementById('progress-left'), pct = document.getElementById('progress-pct'), fill = document.getElementById('progress-fill');
    if (cur <= 0 || resultIdx < 0) { left.textContent = ''; pct.textContent = ''; fill.style.width = '0%'; return; }
    if (cur < resultIdx) {
      var remain = resultIdx - cur; left.textContent = 'あと' + remain + '問';
      var p = Math.round((cur / resultIdx) * 100); pct.textContent = p + '%'; fill.style.width = p + '%';
    } else { left.textContent = cur < screens.length - 1 ? '診断結果まであと少し' : '完了'; pct.textContent = '100%'; fill.style.width = '100%'; }
  }

  // ---------- 描画 ----------
  function render() {
    var sc = screens.find(function (s) { return s.id === S.screenId; }) || screens[0];
    $main.innerHTML = '';
    var el = ({ intro: rIntro, industry: rIndustry, subindustry: rSubIndustry, notready: rNotReady, emp: rEmp, wage: rWage, single: rSingle, areas: rAreas, case: rCase, head: rHead, exechead: rExecHead, tasks: rTasks, taskq: rTaskQ, taskh: rTaskH, vacancy: rVacancy, revenue: rRevenue, margin: rMargin, freed: rFreed, result: rResult, prescription: rPrescription, exit: rExit })[sc.type](sc);
    el.classList.add('screen'); $main.appendChild(el); updateProgress();
  }

  function navBar(nextLabel, enabled, onNext, hideBack) {
    var n = h('<div class="nav">' + (hideBack ? '' : '<button class="btn ghost" data-act="back">戻る</button>') + '<button class="btn primary" data-act="next">' + esc(nextLabel || '次へ') + '</button></div>');
    var nb = n.querySelector('[data-act=next]'); nb.disabled = !enabled;
    if (!hideBack) n.querySelector('[data-act=back]').onclick = back;
    nb.onclick = function () { if (onNext) { if (onNext() === false) return; } next(); };
    return n;
  }

  function rIntro() {
    var el = h('<div><div class="hero-img"><img src="img/hero_liff.jpg?v=63" alt="10分AI経営ドック 現場を知り尽くした公認会計士が徹底診断"></div>' +
      '</div>');
    var saved = loadSaved();
    if (saved && saved.a && saved.a.industry) {
      var b = h('<button class="btn navy">前回の続きから</button>'); b.onclick = function () { S = saved; go(0, saved.screenId); }; el.appendChild(b);
    }
    var btn = h('<button class="btn primary">診断を始める</button>');
    btn.onclick = function () { if (!S.token) { S.token = genToken(); S.started_at = new Date().toISOString(); } ga('diag_start', { src: S.src.src }); next(); };
    el.appendChild(btn); return el;
  }

  function setIndustry(code, groupName, subName) {
    if (S.a.industry !== code) { S.a.areas = []; S.a.tasks = []; S.a.task_answers = {}; S.a.area_headcount = {}; S.a.area_headcount_source = {}; S.a.wage_override = {}; S.a.wage = null; S.a.wage_source = 'default'; S.a.gross_margin_rate = ''; S.a.gross_margin_source = ''; S.a.areas_touched = false; }
    S.a.industry = code; S.a.industry_group = groupName; S.a.industry_sub = subName;
  }

  // S02：大分類（日本標準産業分類をAMI向けに整理した12区分）
  function rIndustry() {
    var el = h('<div><h2>御社の業種に一番近いものを選んでください</h2><div class="choices"></div></div>');
    var box = el.querySelector('.choices');
    taxonomy.groups.forEach(function (g) {
      var b = h('<button class="choice' + (S.a.industry_group === g.id ? ' selected' : '') + '">' + esc(g.name) + '<span class="desc">' + esc(g.hint) + '</span></button>');
      b.onclick = function () {
        if (g.subs.length === 1) setIndustry(g.subs[0].code, g.id, g.subs[0].name);
        else { if (S.a.industry_group !== g.id) { setIndustry('', g.id, ''); } S.a.industry_group = g.id; }
        next();
      };
      box.appendChild(b);
    });
    el.appendChild(navBar('次へ', !!S.a.industry_group));
    return el;
  }

  // S02s：小分類（業務マスタの業種コードに対応）
  function rSubIndustry(sc) {
    var g = sc.group, en = enabledList();
    var el = h('<div><p class="sub">' + esc(g.name) + '</p><h2>その中で、一番近いものはどれですか</h2><div class="choices"></div></div>');
    var box = el.querySelector('.choices');
    g.subs.forEach(function (s) {
      var off = en.indexOf(s.code) < 0;
      var b = h('<button class="choice' + (S.a.industry_sub === s.name ? ' selected' : '') + (off ? ' disabled' : '') + '">' + esc(s.name) + (off ? '<span class="desc">準備中</span>' : '') + '</button>');
      b.onclick = function () { setIndustry(s.code, g.id, s.name); next(); };
      box.appendChild(b);
    });
    el.appendChild(navBar('次へ', !!S.a.industry));
    return el;
  }

  function rNotReady() {
    var ind = industry() || { name: S.a.industry_sub || 'この業種' };
    var el = h('<div><h2>' + esc(ind.name) + 'は準備中です</h2><p>近日中に対応します。準備ができたらLINEでお知らせしますので、少しお待ちください。</p></div>');
    var b = h('<a class="btn navy" href="' + esc(CFG.LINE_ADD_URL || '#') + '">LINEに戻る</a>'); el.appendChild(b);
    var bb = h('<button class="btn ghost">業種を選び直す</button>'); bb.onclick = back; el.appendChild(bb);
    sendMessageText('【診断_準備中】' + ind.name, true);
    return el;
  }

  function rEmp() {
    var el = h('<div><h2>従業員は何名ですか（役員を除く）</h2>' +
      '<div class="field"><label>従業員数（役員を除く）</label><div class="unit"><input type="text" inputmode="numeric" id="emp" placeholder="例：30" value="' + (S.a.emp_total || '') + '"><span>名</span></div><div class="warn" id="emp-warn"></div></div>' +
      '<div class="field"><label>うちパート・アルバイト（任意）</label><div class="unit"><input type="text" inputmode="numeric" id="part" placeholder="空欄でも結構です" value="' + (S.a.emp_part === null ? '' : S.a.emp_part) + '"><span>名</span></div><div class="warn" id="part-warn"></div></div>' +
      '<div class="echo" id="emp-echo"></div></div>');
    var ie = el.querySelector('#emp'), ip = el.querySelector('#part'), echo = el.querySelector('#emp-echo'), w1 = el.querySelector('#emp-warn'), w2 = el.querySelector('#part-warn');
    var nav = navBar('次へ', false, function () {
      var e = num(ie.value), p = num(ip.value);
      if (S.a.emp_total !== e) { S.a.area_headcount = {}; S.a.area_headcount_source = {}; }
      S.a.emp_total = e; S.a.emp_part = p; return true;
    });
    function check() {
      var e = num(ie.value), p = num(ip.value), ok = true;
      ie.value = toHalf(ie.value); ip.value = toHalf(ip.value);
      w1.textContent = ''; w2.textContent = '';
      if (e === null || e < 1 || e > 9999) { ok = false; if (ie.value !== '') w1.textContent = '1〜9,999の範囲で入力してください'; }
      if (p !== null && e !== null && p > e) { w2.textContent = 'パート数が従業員数を超えています'; ok = false; }
      echo.textContent = ok ? '従業員 ' + e + '名（役員除く）' + (p ? '・うちパート ' + p + '名' : '') + 'で進めます' : '';
      nav.querySelector('[data-act=next]').disabled = !ok;
    }
    ie.oninput = check; ip.oninput = check; check();
    el.appendChild(nav); return el;
  }

  function rWage() {
    var ind = industry(); var def = ind.default_wage;
    if (S.a.wage === null) { S.a.wage = def; S.a.wage_default = def; S.a.wage_source = 'default'; }
    var el = h('<div><h2>社員1人あたりの平均の時給（概算）を教えてください</h2>' +
      '<div class="field"><label>平均時給（円）</label><div class="unit"><input type="text" inputmode="numeric" id="wage" value="' + S.a.wage + '"><span>円</span></div><div class="warn" id="wage-warn"></div></div>' +
      '<button class="link" id="annual-toggle">年収から計算する</button>' +
      '<div class="field" id="annual-box" style="display:none"><label>社員の平均年収（万円）</label><div class="unit"><input type="text" inputmode="numeric" id="annual" placeholder="例：400"><span>万円</span></div><p class="small" id="annual-calc"></p><button class="btn ghost" id="annual-use" disabled>この時給を使う</button></div>' +
      '<div class="echo" id="wage-echo"></div></div>');
    var iw = el.querySelector('#wage'), warn = el.querySelector('#wage-warn'), echo = el.querySelector('#wage-echo');
    var nav = navBar(S.a.wage === def ? 'この金額で進む' : '次へ', true, function () {
      var w = num(iw.value); S.a.wage = w; S.a.wage_source = (w === def) ? 'default' : (S.a.wage_source === 'annual' ? 'annual' : 'manual'); return true;
    });
    function check() {
      iw.value = toHalf(iw.value); var w = num(iw.value); warn.textContent = '';
      var ok = w !== null && w >= 500 && w <= 20000;
      if (!ok && iw.value !== '') warn.textContent = '500〜20,000円の範囲で入力してください';
      nav.querySelector('[data-act=next]').disabled = !ok;
      nav.querySelector('[data-act=next]').textContent = (w === def) ? 'この金額で進む' : '次へ';
      echo.textContent = ok ? '従業員 ' + S.a.emp_total + '名・時給 ' + w.toLocaleString() + '円で進めます' : '';
      if (ok && S.a.wage_source === 'annual' && w !== S.a.wage) S.a.wage_source = 'manual';
    }
    iw.oninput = check; check();
    el.querySelector('#annual-toggle').onclick = function () { var b = el.querySelector('#annual-box'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; };
    var ia = el.querySelector('#annual'), ac = el.querySelector('#annual-calc'), au = el.querySelector('#annual-use');
    ia.oninput = function () { ia.value = toHalf(ia.value); var v = num(ia.value); if (v && v >= 100 && v <= 5000) { var w = C.wageFromIncome(v); ac.textContent = '年収' + v + '万円 ÷ 1,920時間 × 1.15（法定福利費）= 時給 約' + w.toLocaleString() + '円'; au.disabled = false; au.dataset.w = w; } else { ac.textContent = ''; au.disabled = true; } };
    au.onclick = function () { iw.value = au.dataset.w; S.a.annual_income = num(ia.value); S.a.wage_source = 'annual'; check(); };
    el.appendChild(nav); return el;
  }

  // S06：年商（数字・万円）。帯は自動で判定
  function bandOf(yen) { if (yen < 5e7) return '〜5千万'; if (yen < 1e8) return '5千万〜1億'; if (yen < 3e8) return '1-3億'; if (yen < 1e9) return '3-10億'; return '10億〜'; }
  function fmtOku(yen) { return yen >= 1e8 ? (Math.round(yen / 1e7) / 10) + '億円' : Math.round(yen / 1e4).toLocaleString() + '万円'; }
  function rRevenue() {
    var el = h('<div><h2>年商（直近1年の売上高）はいくらですか</h2>' +
      '<div class="field"><div class="unit"><input type="text" inputmode="numeric" id="rev" placeholder="例：30000" value="' + (S.a.revenue ? Math.round(S.a.revenue / 1e4) : '') + '"><span>万円</span></div><div class="warn" id="rev-warn"></div></div><div class="echo" id="rev-echo"></div></div>');
    var ir = el.querySelector('#rev'), warn = el.querySelector('#rev-warn'), echo = el.querySelector('#rev-echo');
    var nav = navBar('次へ', false, function () { var v = num(ir.value) * 1e4; S.a.revenue = v; S.a.revenue_band = bandOf(v); return true; });
    function check() { ir.value = toHalf(ir.value); var v = num(ir.value); var ok = v !== null && v >= 100 && v <= 10000000; warn.textContent = ok ? '' : (ir.value === '' ? '' : '100〜10,000,000万円の範囲で入力してください'); echo.textContent = ok ? '年商 ' + fmtOku(v * 1e4) + 'で進めます' : ''; nav.querySelector('[data-act=next]').disabled = !ok; }
    ir.oninput = check; check(); el.appendChild(nav); return el;
  }

  // S06b：粗利率（業種の目安を初期選択）
  function rMargin() {
    var def = LABELS.gmDefault[S.a.industry] || 0.4;
    var cur = (S.a.gross_margin_rate === '' || S.a.gross_margin_rate === null || S.a.gross_margin_source === 'default') ? '' : Math.round(Number(S.a.gross_margin_rate) * 100);
    var el = h('<div><h2>粗利率（売上総利益 ÷ 売上高）はおよそ何%ですか</h2>' +
      '<div class="field"><div class="unit"><input type="text" inputmode="numeric" id="gm" placeholder="例：35" value="' + cur + '"><span>%</span></div><div class="warn" id="gm-warn"></div></div></div>');
    var ig = el.querySelector('#gm'), warn = el.querySelector('#gm-warn');
    var nav = navBar('次へ', false, function () { S.a.gross_margin_rate = num(ig.value) / 100; S.a.gross_margin_source = 'manual'; return true; });
    function check() { ig.value = toHalf(ig.value); var v = num(ig.value); var ok = v !== null && v >= 1 && v <= 99; warn.textContent = ok ? '' : (ig.value === '' ? '' : '1〜99の範囲で入力してください'); nav.querySelector('[data-act=next]').disabled = !ok; }
    ig.oninput = check; check();
    var unk = h('<button class="btn ghost">わからない（' + esc(industry().name) + 'の目安 ' + Math.round(def * 100) + '% で進む）</button>');
    unk.onclick = function () { S.a.gross_margin_rate = def; S.a.gross_margin_source = 'default'; next(); };
    el.appendChild(nav); el.appendChild(unk); return el;
  }

  function rSingle(sc) {
    var el = h('<div><h2>' + esc(sc.q) + '</h2>' + (sc.note ? '<p class="sub">' + esc(sc.note) + '</p>' : '') + '<div class="choices"></div></div>');
    var box = el.querySelector('.choices');
    Object.keys(sc.opts).forEach(function (k) {
      var b = h('<button class="choice' + (S.a[sc.key] === k ? ' selected' : '') + '">' + esc(sc.opts[k]) + '</button>');
      b.onclick = function () { S.a[sc.key] = k; if (sc.key === 'f3') ga('diag_answers_done'); next(); };
      box.appendChild(b);
    });
    el.appendChild(navBar(sc.nextLabel || '次へ', !!S.a[sc.key])); return el;
  }

  function rAreas() {
    var ind = industry();
    if (!S.a.areas_touched) { S.a.areas = ind.areas.map(function (ar) { return ar.id; }); S.a.areas_touched = true; }
    var el = h('<div><h2>次の仕事のうち、御社で誰かがやっているものを残してください（専任でなくても可）</h2><div class="choices"></div><div class="warn" id="area-warn"></div></div>');
    var box = el.querySelector('.choices');
    var nav = navBar('次へ', S.a.areas.length > 0, function () {
      // 外した領域の配下の回答を破棄
      S.a.tasks = S.a.tasks.filter(function (tid) { var t = taskById(tid); return t && S.a.areas.some(function (aid) { return areaById(aid).tasks.indexOf(t) >= 0; }); });
      Object.keys(S.a.task_answers).forEach(function (tid) { if (S.a.tasks.indexOf(tid) < 0) delete S.a.task_answers[tid]; });
      return true;
    });
    ind.areas.forEach(function (ar) {
      var sel = S.a.areas.indexOf(ar.id) >= 0;
      var b = h('<button class="choice' + (sel ? ' selected' : '') + '">' + esc(ar.name) + '<span class="desc">' + esc(ar.who) + '</span></button>');
      b.onclick = function () {
        var i = S.a.areas.indexOf(ar.id);
        if (i >= 0) S.a.areas.splice(i, 1); else S.a.areas.push(ar.id);
        // マスタの順序に揃える
        S.a.areas.sort(function (x, y) { return ind.areas.findIndex(function (q) { return q.id === x; }) - ind.areas.findIndex(function (q) { return q.id === y; }); });
        b.classList.toggle('selected'); nav.querySelector('[data-act=next]').disabled = S.a.areas.length === 0; save();
      };
      box.appendChild(b);
    });
    el.appendChild(nav); return el;
  }

  function caseHtml(c) {
    var head = [c.industry, c.size].filter(Boolean).join('・');
    return '<div class="case"><div class="n">' + esc(head) + '</div><div>' + esc(c.what) + '</div><div class="n">' + esc(c.number) + (c.when ? '（' + esc(c.when) + '）' : '') + '</div></div>';
  }
  function rCase(sc) {
    var el = h('<div><h2>同業は、もう動いています</h2>' + caseHtml(sc.item) + '</div>');
    el.appendChild(navBar('次へ', true)); return el;
  }

  function rHead(sc) {
    var ar = sc.area, def = C.defaultHeadcount(empEff(), ar.ratio);
    var cur = S.a.area_headcount[ar.id] !== undefined ? S.a.area_headcount[ar.id] : def;
    var el = h('<div><h2>' + esc(ar.name) + 'の仕事に関わっている人は何名ですか（兼務を含む）</h2><p class="sub">' + esc(ar.who) + '</p><div class="big" id="hc-big">' + cur + '名</div>' +
      '<div class="field"><label>人数を直す</label><div class="unit"><input type="text" inputmode="numeric" id="hc" value="' + cur + '"><span>名</span></div><div class="warn" id="hc-warn"></div></div></div>');
    var ih = el.querySelector('#hc'), big = el.querySelector('#hc-big'), warn = el.querySelector('#hc-warn');
    var nav = navBar(cur === def ? 'この人数で進む' : '次へ', true, function () {
      var v = num(ih.value); S.a.area_headcount[ar.id] = v; S.a.area_headcount_source[ar.id] = (v === def ? 'default' : 'manual'); return true;
    });
    function check() {
      ih.value = toHalf(ih.value); var v = num(ih.value); var ok = v !== null && v >= 1 && v <= Math.max(1, Math.ceil(empEff()));
      warn.textContent = ok ? '' : (ih.value === '' ? '' : '1〜' + Math.ceil(empEff()) + 'の範囲で入力してください');
      if (ok) { big.textContent = v + '名'; var sum = 0; S.a.areas.forEach(function (aid) { if (aid === 'CM-EXE') return; sum += (aid === ar.id ? v : (S.a.area_headcount[aid] !== undefined ? S.a.area_headcount[aid] : C.defaultHeadcount(empEff(), areaById(aid).ratio))); });
        if (sum > empEff()) warn.textContent = '部門の合計が従業員数を超えています（兼務なら問題ありません）'; }
      nav.querySelector('[data-act=next]').disabled = !ok; nav.querySelector('[data-act=next]').textContent = (v === def ? 'この人数で進む' : '次へ');
    }
    ih.oninput = check; check(); el.appendChild(nav); return el;
  }

  function rExecHead() {
    var el = h('<div><h2>経営者・役員は何名ですか</h2>' +
      '<div class="field"><label>経営者・役員の人数</label><div class="unit"><input type="text" inputmode="numeric" id="ec" value="' + S.a.exec_count + '"><span>名</span></div></div>' +
      '<div class="field"><label>役員の平均時給（概算）</label><div class="unit"><input type="text" inputmode="numeric" id="ew" value="' + S.a.exec_wage + '"><span>円</span></div></div><div class="warn" id="ex-warn"></div></div>');
    var ic = el.querySelector('#ec'), iw = el.querySelector('#ew'), warn = el.querySelector('#ex-warn');
    var nav = navBar('次へ', true, function () { S.a.exec_count = num(ic.value); S.a.exec_wage = num(iw.value); return true; });
    function check() { ic.value = toHalf(ic.value); iw.value = toHalf(iw.value); var c = num(ic.value), w = num(iw.value); var ok = c !== null && c >= 1 && c <= 50 && w !== null && w >= 1000 && w <= 50000; warn.textContent = ok ? '' : '人数は1〜50、時給は1,000〜50,000円で入力してください'; nav.querySelector('[data-act=next]').disabled = !ok; }
    ic.oninput = check; iw.oninput = check; check(); el.appendChild(nav); return el;
  }

  function rTasks(sc) {
    var ar = sc.area;
    var el = h('<div><h2>' + esc(ar.name) + 'で、いまも人の手で時間がかかっている業務にチェック</h2><div class="choices"></div></div>');
    var box = el.querySelector('.choices');
    ar.tasks.forEach(function (t) {
      var sel = S.a.tasks.indexOf(t.id) >= 0;
      var b = h('<button class="choice' + (sel ? ' selected' : '') + '">' + esc(t.name) + '</button>');
      b.onclick = function () { var i = S.a.tasks.indexOf(t.id); if (i >= 0) { S.a.tasks.splice(i, 1); delete S.a.task_answers[t.id]; } else S.a.tasks.push(t.id); b.classList.toggle('selected'); save(); };
      box.appendChild(b);
    });
    el.appendChild(navBar('次へ', true, function () {
      if (!ar.tasks.some(function (t) { return S.a.tasks.indexOf(t.id) >= 0; })) toast('この部門はAIで減らせる業務が少ないようです。次の部門へ進みます');
      return true;
    }));
    return el;
  }

  function areaHeadcount(ar) {
    if (ar.kind === 'exec') return Number(S.a.exec_count) || 1;
    return S.a.area_headcount[ar.id] !== undefined ? Number(S.a.area_headcount[ar.id]) : C.defaultHeadcount(empEff(), ar.ratio);
  }
  function taskAns(t) { if (!S.a.task_answers[t.id]) S.a.task_answers[t.id] = { status: null, volume: 'std', n: null, hours: null, overtime: 'none' }; return S.a.task_answers[t.id]; }

  // S10a：現状3択 ＋ この業務をしている人数
  function rTaskQ(sc) {
    var t = sc.task, ans = taskAns(t), nArea = areaHeadcount(sc.area);
    var defN = Math.max(1, Math.min(nArea, Math.round(nArea * t.involvement)));
    if (ans.n === null || ans.n === undefined) ans.n = defN;
    var el = h('<div><p class="sub">' + esc(sc.area.name) + '（' + nArea + '名）</p><h2>' + esc(t.question) + '</h2>' +
      '<h3>いまの状態は？</h3><div class="choices" id="st"></div>' +
      '<h3>この業務をしている人は何名ですか</h3><div class="field"><div class="unit"><input type="text" inputmode="numeric" id="tn" value="' + ans.n + '"><span>名</span></div><div class="warn" id="tn-warn"></div></div></div>');
    var st = el.querySelector('#st'), tn = el.querySelector('#tn'), warn = el.querySelector('#tn-warn');
    var nav = navBar('次へ', false, function () { ans.n = num(tn.value); return true; });
    function check() { tn.value = toHalf(tn.value); var v = num(tn.value); var ok = v !== null && v >= 1 && v <= nArea; warn.textContent = ok ? '' : (tn.value === '' ? '' : '1〜' + nArea + 'の範囲で入力してください'); nav.querySelector('[data-act=next]').disabled = !(ok && ans.status !== null); }
    [1.0, 0.5, 0.0].forEach(function (v, i) {
      var b = h('<button class="choice' + (ans.status === v ? ' selected' : '') + '">' + esc(t.status_labels[i] || ['全て手作業', '一部ツール化', 'AI活用済み'][i]) + '</button>');
      b.onclick = function () { ans.status = v; st.querySelectorAll('.choice').forEach(function (x) { x.classList.remove('selected'); }); b.classList.add('selected'); check(); save(); };
      st.appendChild(b);
    });
    tn.oninput = check; check(); el.appendChild(nav); return el;
  }

  // S10b：1人が週に使う時間（数字）＋ 残業で対応している割合
  function rTaskH(sc) {
    var t = sc.task, ans = taskAns(t), def = t.hours_per_week;
    if (ans.hours === null || ans.hours === undefined) ans.hours = def;
    var el = h('<div><p class="sub">' + esc(sc.area.name) + '／' + esc(t.name) + '</p><h2>この業務に、1人が1週間に使う時間はどれくらいですか</h2>' +
      '<div class="field"><div class="unit"><input type="text" inputmode="decimal" id="th" value="' + ans.hours + '"><span>時間／週</span></div><div class="warn" id="th-warn"></div></div>' +
      '<div class="chips" id="hq"></div>' +
      '<h3>この業務は、残業になっていますか</h3><div class="choices" id="ot"></div></div>');
    var th = el.querySelector('#th'), warn = el.querySelector('#th-warn'), hq = el.querySelector('#hq'), ot = el.querySelector('#ot');
    var nav = navBar('次へ', true, function () { ans.hours = parseFloat(th.value); return true; });
    function check() { th.value = String(th.value).replace(/[０-９．]/g, function (c) { return c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[^0-9.]/g, ''); var v = parseFloat(th.value); var ok = !isNaN(v) && v >= 0.1 && v <= 40; warn.textContent = ok ? '' : (th.value === '' ? '' : '0.1〜40時間の範囲で入力してください'); nav.querySelector('[data-act=next]').disabled = !ok; }
    [['半分くらい', 0.5], ['目安どおり', 1], ['1.5倍', 1.5], ['2倍', 2]].forEach(function (p) {
      var c = h('<button class="chip">' + p[0] + '<br><span class="small">' + (Math.round(def * p[1] * 10) / 10) + 'h</span></button>');
      c.onclick = function () { th.value = String(Math.round(def * p[1] * 10) / 10); check(); save(); };
      hq.appendChild(c);
    });
    ['none', 'some', 'much'].forEach(function (k) {
      var b = h('<button class="choice' + (ans.overtime === k ? ' selected' : '') + '">' + LABELS.overtime[k] + '</button>');
      b.onclick = function () { ans.overtime = k; ot.querySelectorAll('.choice').forEach(function (x) { x.classList.remove('selected'); }); b.classList.add('selected'); save(); };
      ot.appendChild(b);
    });
    th.oninput = check; check(); el.appendChild(nav); return el;
  }

  // S10f：ここまでで空く時間を見せてから、使い道を聞く
  function rFreed() {
    var pre = C.compute(industry(), Object.assign({}, S.a, { freed_use: 'cost' }));
    var fh = Math.round(pre.hours.mid), perWeek = Math.round(fh / 48 / Math.max(1, empEff()) * 10) / 10;
    var k = C.salesLeverage(S.a, empEff(), industry());
    var el = h('<div><p class="sub">ここまでの回答で</p><h2>AIで、年間 約' + fh.toLocaleString() + '時間が空く計算です</h2>' +
      '<h3>空いた時間を、何に使いますか</h3><div class="choices"></div>' +
      '</div>');
    var box = el.querySelector('.choices');
    Object.keys(LABELS.freed).forEach(function (kk) {
      var b = h('<button class="choice' + (S.a.freed_use === kk ? ' selected' : '') + '">' + esc(LABELS.freed[kk]) + '</button>');
      b.onclick = function () { S.a.freed_use = kk; next(); };
      box.appendChild(b);
    });
    el.appendChild(navBar('次へ', !!S.a.freed_use)); return el;
  }

  // S10c3：埋まっていないポジション数
  function rVacancy() {
    var el = h('<div><h2>いま、採用したいのに埋まっていないポジションは何名分ありますか</h2>' +
      '<div class="field"><div class="unit"><input type="text" inputmode="numeric" id="vc" value="' + (S.a.vacancies === null ? '' : S.a.vacancies) + '" placeholder="例：2"><span>名分</span></div><div class="warn" id="vc-warn"></div></div></div>');
    var vc = el.querySelector('#vc'), warn = el.querySelector('#vc-warn');
    var nav = navBar('次へ', false, function () { S.a.vacancies = num(vc.value) || 0; if (!S.a.vacancies) S.a.vacancy_months = ''; ga('diag_answers_done'); return true; });
    function check() { vc.value = toHalf(vc.value); var v = num(vc.value); var ok = v !== null && v >= 0 && v <= 500; warn.textContent = ok ? '' : (vc.value === '' ? '' : '0〜500の範囲で入力してください'); nav.querySelector('[data-act=next]').disabled = !ok; }
    vc.oninput = check; check(); el.appendChild(nav); return el;
  }

  // ---------- 結果 ----------
  function computeNow() { S.result = C.compute(industry(), S.a); return S.result; }

  function rResult() {
    var r = computeNow(); var a = S.a; var d = r.display;
    var el = h('<div><div class="hero-img"><img src="img/header_result.jpg?v=63" alt="診断結果"></div></div>');
    var zero = r.raw.mid < 10000;
    var hero = zero ?
      '<div class="hero"><div class="lead">診断結果</div><div class="amount">すでにAIを活用できています</div><div class="range">選んだ業務はいずれも「AI活用済み」でした。次は定着と横展開です。</div></div>' :
      '<div class="hero"><div class="lead">御社はいま、年間で</div><div class="amount">約' + man(d.mid) + '</div><div class="range">（' + man(d.lo) + '〜' + man(d.hi) + '）を捨てている計算になります</div>' +
      (r.opportunity_part.mid > 0 ? '<div class="range" style="margin-top:6px">効率化だけなら約' + man(r.efficiency_only.display_mid) + '。空いた時間を「' + esc(r.freed_use) + '」に回すと、ここまで増えます</div>' : '') +
      '<div class="meta"><span>月 約' + man(d.month) + '</span><span>空く時間 年' + Math.round(r.freed_hours_mid).toLocaleString() + 'h（総労働時間の' + d.ratio_pct + '%）</span></div></div>';
    el.appendChild(h(hero));
    if (r.over_ratio) el.appendChild(h('<p class="warn">推計が大きく出ています。面談で実態を確認します（上限を総労働時間の40%で頭打ちにしています）。</p>'));
    // v4.3：内訳＝人件費のムダ＋利益に変えられたはずの分
    if (!zero) {
      var fh = Math.round(r.freed_hours_mid);
      var brk = '<div class="card"><h3 style="margin-top:0">この損失の中身</h3>' +
        '<div class="meter"><div class="box"><div class="small">払い続けている人件費</div><div class="v">約' + man(C.roundYen(r.cost_part.mid)) + '</div></div>' +
        '<div class="box"><div class="small">利益に変えられたはずの分</div><div class="v">約' + man(C.roundYen(r.opportunity_part.mid)) + '</div></div></div>';
      brk += '</div>'; el.appendChild(h(brk));
    }
    // 内訳
    if (!zero) {
      var card = h('<div class="card"><h3 style="margin-top:0">部門別の内訳（年間・中央値）</h3></div>');
      var maxMid = Math.max.apply(null, r.by_area.map(function (x) { return x.mid; }).concat([1]));
      r.by_area.forEach(function (ar) {
        var row = h('<div class="bar-row"><div class="label"><span>' + esc(ar.name) + '（' + ar.headcount + '名）</span><span>' + Math.round(ar.h_mid).toLocaleString() + '時間・約' + man(ar.mid) + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round(ar.mid / maxMid * 100) + '%"></div></div><div class="task-detail"></div></div>');
        var det = row.querySelector('.task-detail');
        ar.tasks.forEach(function (t) { det.appendChild(h('<div>' + esc(t.name) + '：' + t.n + '名×週' + t.hours + 'h＝年間' + Math.round(t.hours_total).toLocaleString() + '時間のうち ' + Math.round(t.h_mid).toLocaleString() + '時間（約' + man(t.mid) + (t.overtime !== 'none' ? '・残業割増込み' : '') + '）</div>')); });
        row.onclick = function () { row.classList.toggle('open'); };
        card.appendChild(row);
      });
      el.appendChild(card);
      el.appendChild(h('<div class="card"><h3 style="margin-top:0">先延ばしのコスト</h3><div class="meter"><div class="box"><div class="small">1年後</div><div class="v">＋' + man(d.mid) + '</div></div><div class="box"><div class="small">3年後の累積</div><div class="v">' + man(d.y3) + '</div></div></div></div>'));
    }
    // v4.2：年間損失とは別枠の2つ
    if (r.stranded_investment > 0 || r.vacancy_cost > 0) {
      var extra = '<div class="card"><h3 style="margin-top:0">さらに、見えにくい損失</h3>';
      if (r.stranded_investment > 0) extra += '<p>この3年の投資のうち、現場で使われていない分：<span class="danger">約' + man(C.roundYen(r.stranded_investment)) + '</span></p>';
      if (r.vacancy_cost > 0) extra += '<p>埋まらないポジションの穴：<span class="danger">年 約' + man(C.roundYen(r.vacancy_cost)) + '</span>分の仕事を、誰かが背負っています</p>';
      extra += '</div>'; el.appendChild(h(extra));
    }
    // 同業の実例
    var used = []; screens.forEach(function (s) { if (s.type === 'case') used.push(s.item); });
    var cs = casesFor(a.industry, used); if (!cs.length) cs = casesFor(a.industry, []);
    if (cs.length) el.appendChild(h('<div class="card"><h3 style="margin-top:0">同業は、もう動いています</h3>' + caseHtml(cs[0]) + (zero ? '' : '<p class="sub">その会社との差は、毎年この額ずつ開きます。</p>') + '</div>'));
    el.appendChild(h('<p class="pardon">悪いのは社長ではありません。何から始めるかを、誰も順番で教えてくれなかっただけです。</p>'));
    if (false) el.appendChild(h('<div class="card"><h3 style="margin-top:0">入れて終わりだと、戻らない分</h3><p>いまの現場の状態から推計した定着率は <b>' + r.retention_rate + '%</b>。このまま入れると、約<span class="danger">' + man(C.roundYen(r.unrecovered_mid)) + '</span>分は現場で使われずに戻らない可能性があります。</p></div>'));
    var nav = navBar('診断結果を見る', true, function () { ga('diag_result_next'); return true; }); el.appendChild(nav);
    // 前提
    var det = h('<details class="assump"><summary>この計算の前提（すべて開示）</summary></details>');
    det.addEventListener('toggle', function () { if (det.open) { S.a.assumptions_opened = true; save(); ga('diag_assumptions_open'); } });
    det.appendChild(h('<p>有効人数 ' + r.emp_effective + '名（従業員' + a.emp_total + '名' + (a.emp_part ? '、パート' + a.emp_part + '名を0.5人換算' : '') + '）。年間稼働 48週、1人あたり年間労働 1,920時間。業務ごとの年間時間 ＝ 入力した人数 × 入力した週時間 × 48週。削減率は業務ごとに下限・中央・上限の幅で推計。時給は入力値をそのまま使用し、残業で対応している分だけ割増（一部 +7.5%、残業で回している +15%）。空いた時間のうち利益業務に回す割合 α＝' + Math.round(r.alpha * 100) + '%、その1時間の価値＝年商' + fmtOku(Number(a.revenue) || 0) + '×粗利率' + Math.round(Number(a.gross_margin_rate) * 100) + '%÷総労働時間＝' + r.gross_profit_per_hour.toLocaleString() + '円 × 倍率' + r.k + '（営業・開発の時間は会社平均より多くの粗利を生む前提。控えめに置いた値）。残り(1−α)は時給で評価。</p>'));
    var tbl = h('<table><tbody><tr><th>部門</th><th>人数</th><th>時給</th></tr></tbody></table>');
    r.by_area.forEach(function (ar) {
      var tr = hRow('<tr><td>' + esc(ar.name) + '</td><td>' + ar.headcount + '名</td><td><input type="range" min="500" max="20000" step="100" value="' + ar.wage + '" data-area="' + ar.id + '"><div class="small"><span class="wv">' + ar.wage.toLocaleString() + '</span>円</div></td></tr>');
      var rg = tr.querySelector('input');
      rg.oninput = function () { tr.querySelector('.wv').textContent = Number(rg.value).toLocaleString(); if (ar.id === 'CM-EXE') S.a.exec_wage = Number(rg.value); else S.a.wage_override[ar.id] = Number(rg.value); S.a.wage_slider_used = true; save(); ga('diag_wage_slider'); render(); document.querySelector('details.assump').open = true; };
      tbl.querySelector('tbody').appendChild(tr);
    });
    det.appendChild(tbl);
    var t2 = h('<table><tbody><tr><th>業務</th><th>人数</th><th>週h/人（目安）</th><th>削減率</th><th>現状</th><th>残業</th></tr></tbody></table>');
    r.by_area.forEach(function (ar) { ar.tasks.forEach(function (t) { t2.querySelector('tbody').appendChild(hRow('<tr><td>' + esc(t.name) + '</td><td>' + t.n + '</td><td>' + t.hours + '（' + t.hours_per_week + '）</td><td>' + t.rate_low + '/' + t.rate_mid + '/' + t.rate_high + '</td><td>' + t.status + '</td><td>' + (LABELS.overtime[t.overtime] || '').slice(0, 6) + '</td></tr>')); }); });
    det.appendChild(t2);
    det.appendChild(h('<p class="small">推計です。面談で実態に合わせて直します。既定値の根拠：業種別ロードマップ・支援実績・一般的な生成AI活用事例（マスタ ' + esc(master.version) + '）。</p>'));
    el.appendChild(det);
    return el;
  }

  function rPrescription() {
    var a = S.a, r = S.result || computeNow();
    var route = C.decideRoute(a); S.route = route;
    var el = h('<div><div class="hero-img"><img src="img/header_presc.jpg?v=63" alt="御社の診断結果"></div><p class="presc-lead">AIと経営の現場を知り尽くした公認会計士の</p><h2>無料相談（オンライン60分）</h2></div>');
    el.appendChild(h('<img class="card-img" src="img/card_meeting.jpg?v=63" alt="AIと経営の現場を知り尽くした公認会計士の無料個別相談">'));
    var b1 = h('<button class="btn primary">無料相談を予約する</button>');
    b1.onclick = function () { a.cta = 'book'; ga('diag_cta_book', { route: route }); go(0, 'S19'); };
    el.appendChild(b1);
    if (a.role === 'manager') { var b3 = h('<button class="btn navy">社長に転送する</button>'); b3.onclick = function () { a.cta = 'share'; shareResult(); }; el.appendChild(b3); }
    var back = h('<button class="btn ghost">戻る</button>'); back.onclick = function () { go(-1); }; el.appendChild(back);
    return el;
  }

  function resultUrl() { var base = CFG.RESULT_BASE_URL || (location.origin + location.pathname); return base + '?r=' + encodeURIComponent(S.token); }
  function shareResult() {
    var text = '【10分AI経営ドックの結果】年間 約' + man(S.result.display.mid) + '（' + man(S.result.display.lo) + '〜' + man(S.result.display.hi) + '）を捨てている計算になりました。\n' + resultUrl();
    if (liffReady && window.liff && liff.isApiAvailable && liff.isApiAvailable('shareTargetPicker')) { liff.shareTargetPicker([{ type: 'text', text: text }]).then(function () { toast('転送しました'); }).catch(function () { copy(text); }); }
    else copy(text);
    function copy(t) { try { navigator.clipboard.writeText(t); toast('結果の文章をコピーしました'); } catch (e) { toast(t); } }
  }

  function completionText() {
    var r = S.result; return '【診断完了】' + S.route + '／' + (S.a.industry_sub || industry().name) + '／' + (LABELS.p2[S.a.p2] || '') + '／' + C.lossBand(r.mid) + (S.a.cta === 'doc' ? '／資料希望' : '');
  }

  function rExit() {
    S.completed_at = new Date().toISOString();
    var txt = completionText();
    var el = h('<div><h2>診断が完了しました</h2></div>');
    var b = h('<button class="btn primary">LINEに戻る</button>');
    b.onclick = function () { finish(txt); };
    el.appendChild(b);
    if (CFG.BOOKING_URL && S.a.cta === 'book') el.appendChild(h('<a class="btn navy" href="' + esc(CFG.BOOKING_URL) + '">予約ページを開く（案内用）</a>'));
    postToGas('complete');
    ga('diag_complete', { route: S.route, loss_band: C.lossBand(S.result.mid) });
    return el;
  }

  function finish(txt) {
    sendMessageText(txt, false).then(function () {
      if (CFG.UTAGE_FORM_URL) { var m = CFG.UTAGE_FORM_PARAM_MAP, q = {}; q[m.route] = S.route; q[m.industry] = industry().name; q[m.p2] = LABELS.p2[S.a.p2]; q[m.loss_band] = C.lossBand(S.result.mid); q[m.token] = S.token;
        location.href = CFG.UTAGE_FORM_URL + (CFG.UTAGE_FORM_URL.indexOf('?') >= 0 ? '&' : '?') + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'); return; }
      try { localStorage.removeItem('shindan_v4'); } catch (e) {}
      if (liffReady && liff.isInClient && liff.isInClient()) liff.closeWindow(); else toast('ブラウザ単体モード：LINEへの送信内容はコンソールに出力しました');
    });
  }

  function sendMessageText(text, silent) {
    if (liffReady && window.liff && liff.isInClient && liff.isInClient()) {
      return liff.sendMessages([{ type: 'text', text: text }]).then(function () { if (!silent) toast('送信しました'); }).catch(function (e) { console.warn('sendMessages失敗', e); postToGas('fallback_tag', { text: text }); });
    }
    console.log('[LINE送信（ブラウザ単体モード）]', text); postToGas('fallback_tag', { text: text });
    return Promise.resolve();
  }

  function postToGas(kind, extra) {
    if (!CFG.GAS_URL) { console.debug('[GAS未設定]', kind, payload()); return; }
    try { fetch(CFG.GAS_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(Object.assign({ kind: kind }, payload(), extra || {})) }); } catch (e) { console.warn(e); }
  }
  function payload() {
    var r = S.result || {};
    return { share_token: S.token, line_user_id: liffUserId, src: S.src, started_at: S.started_at, completed_at: S.completed_at, answers: S.a, industry_name: industry() ? industry().name : '',
      result: r.display ? { lo: r.lo, mid: r.mid, hi: r.hi, display: r.display, hours: r.hours, ratio: r.ratio, by_area: r.by_area, retention_rate: r.retention_rate, unrecovered_mid: r.unrecovered_mid, ami_layer: r.ami_layer } : null,
      route: S.route, training_estimate: S.route ? C.trainingEstimate(S.a) : null, loss_band: r.mid !== undefined ? C.lossBand(r.mid) : '', size_band: C.sizeBand(S.a.emp_total || 0), screen_times: S.screen_times, master_version: master ? master.version : '', result_url: resultUrl(), completion_text: S.route ? completionText() : '' };
  }

  // 開発・検証用：状態を初期化して最初から（本番でも害はない）
  window.__shindanReset = function () {
    S = { token: '', started_at: '', src: S.src, screen: 0, screenId: 'S01', a: { industry: '', industry_group: '', industry_sub: '', emp_total: null, emp_part: null, wage: null, wage_default: null, wage_source: 'default', annual_income: null, role: '', revenue_band: '', revenue: null, gross_margin_rate: '', freed_use: '', areas: [], area_headcount: {}, area_headcount_source: {}, exec_count: 1, exec_wage: 5000, tasks: [], task_answers: {}, invest_amount: '', invest_used_rate: '', vacancies: null, vacancy_months: '', lead: '', f1: '', f2: '', f3: '', p1: '', p2: '', wage_override: {}, assumptions_opened: false, wage_slider_used: false, cta: '' }, screen_times: {}, result: null, route: '', completed_at: '' };
    try { localStorage.removeItem('shindan_v4'); } catch (e) {}
    screens = buildScreens(); render();
  };
  window.__shindanState = function () { return JSON.parse(JSON.stringify(S)); };

  // ---------- 起動 ----------
  function parseSrc() { var q = {}; location.search.replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); return q; }

  function initLiff() {
    if (!CFG.LIFF_ID || !window.liff) return Promise.resolve();
    return liff.init({ liffId: CFG.LIFF_ID }).then(function () { liffReady = true; if (liff.isLoggedIn()) return liff.getProfile().then(function (p) { liffUserId = p.userId; }); }).catch(function (e) { console.warn('LIFF init失敗。ブラウザ単体で続行', e); });
  }

  function fresh(u) { return u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(); }  // JSONはキャッシュさせない
  Promise.all([fetch(fresh(CFG.MASTER_URL)).then(function (r) { return r.json(); }), fetch(fresh(CFG.CASES_URL)).then(function (r) { return r.json(); }).catch(function () { return {}; }), fetch(fresh(CFG.TAXONOMY_URL)).then(function (r) { return r.json(); }), initLiff()])
    .then(function (res) {
      master = res[0]; cases = res[1]; taxonomy = res[2];
      var q = parseSrc(); S.src = { src: q.src || '', ch: q.ch || '', cp: q.cp || '', ref: q.ref || '', prev: q.prev || '', ind: q.ind || '' };
      // LINE側で業種を選んだ人は ?ind=<業種コード> で来るので、業種の2画面を飛ばす
      if (q.ind && master.industries[q.ind] && enabledList().indexOf(q.ind) >= 0) {
        var found = null;
        taxonomy.groups.forEach(function (g) { g.subs.forEach(function (sub) { if (!found && sub.code === q.ind) found = { g: g, sub: sub }; }); });
        setIndustry(q.ind, found ? found.g.id : '', master.industries[q.ind].name);  // LINE側は大分類で選ぶので、小分類名ではなく業種名を使う
        S.a.industry_preset = true;
      }
      screens = buildScreens(); S.screenId = 'S01'; render();
    })
    .catch(function (e) { $main.innerHTML = '<p class="warn">読み込みに失敗しました。通信環境を確認して開き直してください。</p>'; console.error(e); });
})();
