/* 損失額の計算・丸め・ルート判定（ブラウザと Node の両方で使う）
 * 正本：AMI_リード獲得診断ツール設計.md 4章／診断_ワークフロー詳細.md S15・S18
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShindanCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEEKS = 48;
  var ANNUAL_HOURS = 1920;
  var WELFARE = 1.15;
  var VOLUME = { low: 0.6, std: 1.0, high: 1.5 };
  var OVERTIME = { none: 0, some: 0.3, much: 0.6 };   // 残業で対応している割合
  var OVERTIME_PREMIUM = 0.25;                        // 残業の割増率
  var MONTH_HOURS = 160;
  var RATIO_CAP = 0.4;

  // v4.3：空いた時間の使い道 → 利益業務に回す割合 α と、その1時間が生む粗利の倍率 k（会社平均の粗利生産性に対して）
  // k の根拠：中小企業では粗利の大半を営業・開発の少人数が生む。30名で営業4名なら営業1時間の粗利生産性は平均の7倍を超えるが、控えめに2〜2.5倍に置く
  // v4.4：k は会社の実データから出す（営業は「粗利を営業が作っている」前提で 総人数÷営業人数。下限2.5・上限5.0）
  var FREED_USE = {
    sales: { alpha: 0.7, k: null, label: '営業・顧客開拓' },           // k は salesLeverage() で算出
    develop: { alpha: 0.7, k: 3.0, label: '製品・サービス開発' },
    training: { alpha: 0.6, k: 2.0, label: '社員の教育・育成' },
    cost: { alpha: 0.0, k: 1.0, label: '残業や外注の削減' },
    undecided: { alpha: 0.4, k: 2.0, label: '利益を生む仕事（使い道は未定）' }
  };
  var SALES_K_MIN = 2.5, SALES_K_MAX = 5.0, SALES_K_DEFAULT = 4.0;
  var EXEC_K = 5.0; // 経営者・役員の空いた時間は経営判断・トップ営業に回る前提

  // 営業1時間の粗利倍率 = 有効人数 ÷ 営業・顧客対応の人数（粗利は営業が生む前提。控えめに上限5倍）
  function salesLeverage(a, empEff, industry) {
    var n = a.area_headcount && a.area_headcount['CM-SAL'];
    if (!n && industry) { var sal = industry.areas.filter(function (x) { return x.id === 'CM-SAL'; })[0]; if (sal) n = defaultHeadcount(empEff, sal.ratio); }
    if (!n || !empEff) return SALES_K_DEFAULT;
    return Math.max(SALES_K_MIN, Math.min(SALES_K_MAX, empEff / Number(n)));
  }
  var REVENUE_BAND_REP = { '〜5千万': 30000000, '5千万〜1億': 75000000, '1-3億': 200000000, '3-10億': 500000000, '10億〜': 1500000000 };

  var REVENUE_1OKU_PLUS = ['1-3億', '3-10億', '10億〜'];

  function effectiveHeadcount(a) {
    var total = Number(a.emp_total) || 0;
    var part = a.emp_part === null || a.emp_part === undefined || a.emp_part === '' ? null : Number(a.emp_part);
    if (part === null || isNaN(part)) return total;
    return total - part + part * 0.5;
  }

  function defaultHeadcount(empEffective, ratio) {
    return Math.max(1, Math.round(empEffective * ratio));
  }

  function wageFromIncome(incomeMan) {
    return Math.round((Number(incomeMan) * 10000) / ANNUAL_HOURS * WELFARE);
  }

  // 丸め：1万円未満切捨て／100万円以上は10万円単位／1,000万円以上は50万円単位
  function roundYen(v) {
    v = Math.max(0, v);
    if (v < 1e6) return Math.floor(v / 1e4) * 1e4;
    if (v < 1e7) return Math.round(v / 1e5) * 1e5;
    return Math.round(v / 5e5) * 5e5;
  }

  function fmtMan(v) {
    return Math.round(v / 1e4).toLocaleString('ja-JP') + '万円';
  }

  function isAmiLayer(a) {
    return REVENUE_1OKU_PLUS.indexOf(a.revenue_band) >= 0 && effectiveHeadcount(a) >= 20;
  }

  function retentionRate(a) {
    var r = 100;
    if (a.f1 === 'unused') r -= 15;
    if (a.f2 === 'some') r -= 10;
    else if (a.f2 === 'strong') r -= 25;
    else if (a.f2 === 'unknown') r -= 10;
    if (a.lead === 'none') r -= 15;        // 推進を任せられる人がいない
    else if (a.lead === 'owner') r -= 5;   // 社長自身がやるしかない
    return Math.max(25, r);
  }

  /**
   * industry: master.industries[CODE]
   * a: answers（ワークフローD章のキー）
   */
  // 会社平均の粗利生産性（円/時間）＝ 年商 × 粗利率 ÷ 総労働時間
  function grossProfitPerHour(a, empEff) {
    var rev = Number(a.revenue) || REVENUE_BAND_REP[a.revenue_band] || 0;
    var gm = (a.gross_margin_rate === undefined || a.gross_margin_rate === null || a.gross_margin_rate === '') ? 0 : Number(a.gross_margin_rate);
    if (!rev || !gm || !empEff) return 0;
    return rev * gm / (empEff * ANNUAL_HOURS);
  }

  function compute(industry, a) {
    var empEff = effectiveHeadcount(a);
    var areasById = {};
    industry.areas.forEach(function (ar) { areasById[ar.id] = ar; });

    var useDef = FREED_USE[a.freed_use] || FREED_USE.cost;
    var use = { alpha: useDef.alpha, k: useDef.k === null ? salesLeverage(a, empEff, industry) : useDef.k, label: useDef.label };
    var gph = grossProfitPerHour(a, empEff);
    var byArea = [];
    var tot = { lo: 0, mid: 0, hi: 0, h_lo: 0, h_mid: 0, h_hi: 0, h_total: 0, c_lo: 0, c_mid: 0, c_hi: 0, o_lo: 0, o_mid: 0, o_hi: 0, e_lo: 0, e_mid: 0, e_hi: 0 };

    (a.areas || []).forEach(function (aid) {
      var ar = areasById[aid];
      if (!ar) return;
      var n, wage;
      if (ar.kind === 'exec') {
        n = Number(a.exec_count) || 0;
        wage = Number(a.exec_wage) || 0;
      } else {
        n = a.area_headcount && a.area_headcount[aid] !== undefined ? Number(a.area_headcount[aid]) : defaultHeadcount(empEff, ar.ratio);
        wage = a.wage_override && a.wage_override[aid] ? Number(a.wage_override[aid]) : Number(a.wage) || 0;
      }
      var rowArea = { id: aid, name: ar.name, headcount: n, wage: wage, lo: 0, mid: 0, hi: 0, h_lo: 0, h_mid: 0, h_hi: 0, h_total: 0, c_lo: 0, c_mid: 0, c_hi: 0, o_lo: 0, o_mid: 0, o_hi: 0, tasks: [] };
      var kArea = ar.kind === 'exec' ? EXEC_K : use.k;
      var oppPerHour = gph > 0 ? gph * kArea : 0;   // 利益業務に回した1時間が生む粗利（円）
      ar.tasks.forEach(function (t) {
        var ans = a.task_answers && a.task_answers[t.id];
        if (!ans) return;
        var status = Number(ans.status);
        var vol = typeof ans.volume === 'number' ? ans.volume : (VOLUME[ans.volume] || 1.0);
        // v4.2：業務ごとの人数・週時間・残業割合を聞く（未入力ならマスタ既定×領域人数）
        var hasN = ans.n !== undefined && ans.n !== null && ans.n !== '';
        var hasH = ans.hours !== undefined && ans.hours !== null && ans.hours !== '';
        var nT = hasN ? Number(ans.n) : n * t.involvement;
        var hT = hasH ? Number(ans.hours) : t.hours_per_week * vol;
        var ot = OVERTIME[ans.overtime] || 0;           // 残業で対応している割合
        var wageT = wage * (1 + OVERTIME_PREMIUM * ot);  // 残業分は割増賃金
        var H = nT * hT * WEEKS;
        var sLo = H * t.rate_low * status, sMid = H * t.rate_mid * status, sHi = H * t.rate_high * status;
        // 人件費分（空いた時間のうち利益業務に回さない (1−α)）と 利益機会分（回す α × 粗利/時間 × k）
        var alpha = oppPerHour > 0 ? use.alpha : 0;
        var cLo = Math.round(sLo * wageT * (1 - alpha)), cMid = Math.round(sMid * wageT * (1 - alpha)), cHi = Math.round(sHi * wageT * (1 - alpha));
        var oLo = Math.round(sLo * alpha * oppPerHour), oMid = Math.round(sMid * alpha * oppPerHour), oHi = Math.round(sHi * alpha * oppPerHour);
        var yLo = cLo + oLo, yMid = cMid + oMid, yHi = cHi + oHi;
        // 効率化だけで評価した場合（比較表示用）
        rowArea.e_lo = (rowArea.e_lo || 0) + Math.round(sLo * wageT); rowArea.e_mid = (rowArea.e_mid || 0) + Math.round(sMid * wageT); rowArea.e_hi = (rowArea.e_hi || 0) + Math.round(sHi * wageT);
        rowArea.tasks.push({ id: t.id, name: t.name, status: status, volume: vol, n: nT, hours: hT, overtime: ans.overtime || 'none', wage: wageT, hours_total: H, h_lo: sLo, h_mid: sMid, h_hi: sHi, lo: yLo, mid: yMid, hi: yHi, c_mid: cMid, o_mid: oMid,
          involvement: t.involvement, hours_per_week: t.hours_per_week, rate_low: t.rate_low, rate_mid: t.rate_mid, rate_high: t.rate_high, prescription: t.prescription });
        rowArea.lo += yLo; rowArea.mid += yMid; rowArea.hi += yHi;
        rowArea.c_lo += cLo; rowArea.c_mid += cMid; rowArea.c_hi += cHi; rowArea.o_lo += oLo; rowArea.o_mid += oMid; rowArea.o_hi += oHi;
        rowArea.h_lo += sLo; rowArea.h_mid += sMid; rowArea.h_hi += sHi; rowArea.h_total += H;
      });
      if (rowArea.tasks.length === 0) return;
      byArea.push(rowArea);
      ['lo', 'mid', 'hi', 'h_lo', 'h_mid', 'h_hi', 'h_total', 'c_lo', 'c_mid', 'c_hi', 'o_lo', 'o_mid', 'o_hi', 'e_lo', 'e_mid', 'e_hi'].forEach(function (k) { tot[k] += rowArea[k] || 0; });
    });

    var laborHours = Math.max(1, empEff * ANNUAL_HOURS);
    var ratio = tot.h_mid / laborHours;
    var capped = false;
    var hi = tot.hi, mid = tot.mid, lo = tot.lo;
    // 幅の上限は中央の2倍
    if (hi > mid * 2) { hi = mid * 2; capped = true; }
    // 総労働時間比40%で頭打ち
    var ratioHi = tot.h_hi / laborHours;
    var overRatio = ratio > RATIO_CAP;
    if (ratioHi > RATIO_CAP && tot.h_hi > 0) { hi = Math.min(hi, tot.hi * (RATIO_CAP / ratioHi)); }
    if (overRatio && tot.h_mid > 0) { mid = Math.min(mid, tot.mid * (RATIO_CAP / ratio)); lo = Math.min(lo, mid); }

    var ami = isAmiLayer(a);
    var ret = ami ? retentionRate(a) : null;

    // v4.2 追加ブロック（年間損失の本線には入れず、別枠で表示）
    var invest = Number(a.invest_amount) || 0;                                  // 過去3年のIT・AI投資額（円）
    var usedRate = (a.invest_used_rate === undefined || a.invest_used_rate === null || a.invest_used_rate === '') ? 1 : Number(a.invest_used_rate);
    var stranded = Math.round(invest * (1 - usedRate));                         // すでに宙に浮いている投資（一回限り）
    var vac = Number(a.vacancies) || 0;                                          // 埋まっていないポジション数
    var vacMonths = Math.min(12, Number(a.vacancy_months) || 0);                // 平均の未充足期間（月、上限12）
    var vacCost = Math.round(vac * (Number(a.wage) || 0) * MONTH_HOURS * vacMonths); // 穴埋めに払っているはずの人件費（参考）

    return {
      emp_effective: empEff,
      stranded_investment: stranded,
      vacancy_cost: vacCost,
      lo: lo, mid: mid, hi: hi,
      raw: { lo: tot.lo, mid: tot.mid, hi: tot.hi },
      cost_part: { lo: tot.c_lo, mid: tot.c_mid, hi: tot.c_hi },
      efficiency_only: { lo: tot.e_lo, mid: tot.e_mid, hi: tot.e_hi, display_mid: roundYen(tot.e_mid) },
      opportunity_part: { lo: tot.o_lo, mid: tot.o_mid, hi: tot.o_hi },
      freed_use: use.label, alpha: gph > 0 ? use.alpha : 0, k: use.k, gross_profit_per_hour: Math.round(gph),
      freed_hours_mid: tot.h_mid,
      hours: { lo: tot.h_lo, mid: tot.h_mid, hi: tot.h_hi, total: tot.h_total },
      ratio: ratio,
      over_ratio: overRatio,
      width_capped: capped,
      display: { lo: roundYen(lo), mid: roundYen(mid), hi: roundYen(hi), month: roundYen(mid / 12), y3: roundYen(mid * 3), ratio_pct: Math.round(ratio * 1000) / 10 },
      by_area: byArea,
      ami_layer: ami,
      retention_rate: ret,
      unrecovered_mid: ami ? Math.round(mid * (1 - ret / 100)) : null,
      constants: { weeks: WEEKS, annual_hours: ANNUAL_HOURS, welfare: WELFARE }
    };
  }

  // ルート判定（ワークフローS18。上から順に最初に当てはまったもの）
  function decideRoute(a) {
    var ami = isAmiLayer(a);
    var p1 = a.p1, p2 = a.p2; // p2: 'lt50' | '50-200' | '200-500' | 'gte500'
    var p2rank = { lt50: 0, '50-200': 1, '200-500': 2, gte500: 3 }[p2];
    if (ami && (p2 === 'gte500' || (p1 === 'company' && p2rank >= 2))) return 'A';
    if (ami && p2rank < 2) return 'B';
    if (p1 === 'owner') return 'C';
    if (p1 === 'managers' && p2rank >= 1) return 'C';
    return 'D';
  }

  // 研修の人数見積（1人単価 20万 → 助成金利用時 5万／対面 40万 → 10万）
  function trainingEstimate(a) {
    var n = Number(a.emp_total) || 0;
    return {
      headcount: n,
      elearning_total: n * 200000, elearning_self: n * 50000,
      onsite_per_person: 400000, onsite_self_per_person: 100000,
      camp: 400000
    };
  }

  function lossBand(mid) {
    if (mid < 1e6) return '〜100万';
    if (mid < 3e6) return '100〜300万';
    if (mid < 5e6) return '300〜500万';
    if (mid < 1e7) return '500〜1000万';
    return '1000万〜';
  }

  function sizeBand(n) {
    if (n <= 9) return '〜9'; if (n <= 19) return '10〜19'; if (n <= 49) return '20〜49'; if (n <= 99) return '50〜99'; return '100〜';
  }

  return {
    WEEKS: WEEKS, ANNUAL_HOURS: ANNUAL_HOURS, WELFARE: WELFARE, VOLUME: VOLUME, OVERTIME: OVERTIME, OVERTIME_PREMIUM: OVERTIME_PREMIUM, MONTH_HOURS: MONTH_HOURS,
    FREED_USE: FREED_USE, EXEC_K: EXEC_K, REVENUE_BAND_REP: REVENUE_BAND_REP, grossProfitPerHour: grossProfitPerHour, salesLeverage: salesLeverage,
    effectiveHeadcount: effectiveHeadcount, defaultHeadcount: defaultHeadcount, wageFromIncome: wageFromIncome,
    roundYen: roundYen, fmtMan: fmtMan, isAmiLayer: isAmiLayer, retentionRate: retentionRate,
    compute: compute, decideRoute: decideRoute, trainingEstimate: trainingEstimate, lossBand: lossBand, sizeBand: sizeBand
  };
});
