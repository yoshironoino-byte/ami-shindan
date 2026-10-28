/* 設置時に書き換える設定値（URL・ID）。空のままでも診断は動く（連携だけ無効になる） */
window.SHINDAN_CONFIG = {
  LIFF_ID: '',                 // LINE Developers の LIFF ID。空ならブラウザ単体モード
  GAS_URL: '',                 // GAS Web app の URL（回答の記録・結果Flex・事前情報メール）
  BOOKING_URL: '#booking',     // 面談予約（UTAGEの予約ページ。実運用ではシナリオ内から配信するため、ここは案内用）
  DOC_URL: '#doc',             // 資料請求
  LINE_ADD_URL: '#line',       // 対象外業種のときに戻す友だち追加URL
  UTAGE_FORM_URL: '',          // 連携方式②：完了結果をURLパラメータで渡すUTAGEフォーム。空なら使わない
  UTAGE_FORM_PARAM_MAP: { route: 'f1', industry: 'f2', p2: 'f3', loss_band: 'f4', token: 'f5' },
  RESULT_BASE_URL: '',         // 結果URL（share token付き）のベース。空なら現在のURLを使う
  ENABLED_INDUSTRIES: null,    // null なら master.json の enabled_industries を使う
  MASTER_URL: 'data/master.json',
  CASES_URL: 'data/cases.json',
  TAXONOMY_URL: 'data/taxonomy.json',
  RESUME_HOURS: 24
};
