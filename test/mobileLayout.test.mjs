import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function pureApi() {
  const start = html.indexOf('// pure-start');
  const end = html.indexOf('// pure-end');
  assert.ok(start >= 0 && end > start);
  const block = html.slice(start, end);
  return new Function(`${block}
    return {
      EMPTY_MEETING_TEXT,
      LOADING_TEXT,
      SOURCE_ERROR_TEXT,
      PREDICTION_READY_TEXT,
      PREDICTION_CALCULATING_TEXT,
      OFFICIAL_LOOKBACK_DAYS,
      shiftCalendarDate,
      normalizeOfficialDateInput,
      officialDateHint,
      hongKongCalendarDate,
      meetingPanelState,
      meetingStatusHtml,
      predictionView,
      predictionHorseName,
      renderRunners,
      renderHorseDetails,
      renderSingleRace,
      renderDashboardEmpty,
      dashboardMode,
      officialFallbackQueries,
      summarizeOfficialFallback,
      collectLatestOfficial,
      renderOfficialMeeting,
      currentMeetingHeading,
      headingHtml,
      renderMeetingCard
    };
  `)();
}

const pure = pureApi();

function section(id, nextId) {
  const start = html.indexOf('<section id="' + id + '"');
  const end = html.indexOf('<section id="' + nextId + '"');
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

function fnSource(name, nextName) {
  const start = html.indexOf('async function ' + name);
  const end = html.indexOf(nextName);
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}

test('narrow navigation is a six-button bottom bar with 44px targets', () => {
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  assert.deepEqual(nav.match(/<button/g).map(() => 1), [1, 1, 1, 1, 1, 1]);
  for (const label of ['總覽', '單場分析', '當前排位', '官方賽果', '預測模型', '馬匹詳情']) {
    assert.equal(nav.includes(label), true);
  }
  assert.equal(html.includes('歷史賽果'), false);
  const narrow = html.slice(html.indexOf('@media (max-width: 720px)'));
  assert.match(narrow, /\.header \.nav\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/);
  assert.match(narrow, /grid-template-columns:\s*repeat\(6,/);
  assert.match(narrow, /\.header \.nav button\s*\{[^}]*min-height:\s*44px/);
  assert.match(narrow, /\.horse-table\s*\{\s*display:\s*none/);
  assert.match(narrow, /\.horse-cards\s*\{\s*display:\s*grid/);
  assert.match(html, /@media \(min-width: 721px\)\s*\{\s*\.nav\s*\{\s*position:\s*static/);
  assert.equal(/\.nav\s*\{\s*display:\s*none/.test(html), false);
});

test('dense runner tables also render one card per horse', () => {
  const runners = renderSampleRunners();
  const odds = [{ combString: '01', oddsValue: '3.5' }, { combString: '02', oddsValue: '8.8' }];
  const raceHtml = pure.renderRunners({ runners }, odds);
  assert.match(raceHtml, /class="horse-table table-scroll"/);
  assert.match(raceHtml, /class="horse-cards"/);
  assert.match(raceHtml, /class="horse-name">金鎗六十/);
  assert.match(raceHtml, /馬名/);
  assert.match(raceHtml, /檔位/);
  assert.match(raceHtml, /獨贏/);
  assert.match(raceHtml, />3\.5</);
  assert.equal(raceHtml.includes('爆熱'), true);
  const columns = ['馬號', '馬名', '騎師', '練馬師', '檔位', '負磅', '獨贏', '狀態'];
  for (const label of columns) assert.equal(raceHtml.includes(label), true);

  const detail = pure.renderHorseDetails(runners.map((ru, index) => Object.assign({}, ru, {
    currentWeight: index === 0 ? '1120' : '1095',
    currentRating: '40',
    last6run: '2/1/3',
    gearInfo: 'B'
  })));
  for (const label of ['體重', '評分', '近績', '配備']) assert.equal(detail.includes(label), true);
  assert.match(detail, /class="horse-card"/);
  assert.match(detail, /金鎗六十/);
  assert.match(html, /word-break:\s*keep-all/);
  assert.equal(html.includes('word-break:break-all'), false);
  assert.equal(html.includes('word-break: break-all'), false);
});

test('單場分析 puts the trend chart before the odds and barrier group', () => {
  const race = section('race', 'results');
  assert.ok(race.indexOf('id="odds-chart-block"') < race.indexOf('id="odds-barrier-heading"'));
  assert.ok(race.indexOf('id="oddsChart"') < race.indexOf('id="odds-table"'));
  assert.match(race, /獨贏走勢/);
  assert.match(race, /賠率及檔位/);
});

test('當前排位 renders one race and does not repeat the meeting title', () => {
  const results = section('results', 'official');
  assert.match(results, /id="card-race"/);
  assert.equal((results.match(/<h3/g) || []).length, 1);
  const body = pure.renderSingleRace({
    no: 2,
    raceName_ch: '測試賽事乙',
    distance: 1650,
    postTime: '2026-12-20T04:40:00Z',
    runners: renderSampleRunners()
  }, [{ combString: '1', oddsValue: '4.2' }]);
  assert.match(body, /第2場 測試賽事乙/);
  assert.match(body, /金鎗六十/);
  assert.match(body, /1650米/);
  assert.match(body, /12:40/);
  assert.equal(body.includes('第1場'), false);
  assert.equal(body.includes('當前會議'), false);
  assert.match(body, /horse-cards/);
  const source = fnSource('loadRaceCard', 'function onPredictionRaceChange');
  assert.match(source, /renderSingleRace/);
  assert.match(source, /card-heading/);
  assert.equal(source.includes('<h3>'), false);
  assert.equal(source.includes('forEach'), false);
});

test('official results date is year-month-day and the form stacks', () => {
  const official = section('official', 'prediction');
  assert.equal(/type="date"/.test(official), false);
  assert.equal(/mm\/dd\/yyyy/i.test(official), false);
  assert.match(official, /type="text"/);
  assert.match(official, /年-月-日/);
  assert.match(official, /YYYY-MM-DD/);
  assert.match(official, /class="official-form"/);
  assert.match(html, /\.official-form\s*\{[^}]*flex-direction:\s*column/);
  assert.match(html, /\.official-form \.field\s*\{[^}]*flex-direction:\s*column/);
  assert.equal(pure.normalizeOfficialDateInput('2026-11-22'), '2026-11-22');
  assert.equal(pure.normalizeOfficialDateInput('2026/11/22'), '2026-11-22');
  assert.equal(pure.normalizeOfficialDateInput('2026年11月22日'), '2026-11-22');
  assert.equal(pure.normalizeOfficialDateInput('2026年1月2日'), '2026-01-02');
  assert.equal(pure.normalizeOfficialDateInput('11/22/2026'), '');
  assert.equal(pure.normalizeOfficialDateInput('22/11/2026'), '');
  assert.equal(pure.normalizeOfficialDateInput('2026-02-29'), '');
  assert.equal(pure.normalizeOfficialDateInput('2024-02-29'), '2024-02-29');
  assert.equal(pure.normalizeOfficialDateInput('2026-11-22T16:00:00.000Z'), '');
  assert.equal(html.includes('toISOString'), false);
  const shown = pure.headingHtml('當前會議 · 沙田 · 2026-12-20 · 11 場');
  assert.equal(shown, '<span class="nowrap">當前會議 ·</span> <span class="nowrap">沙田 ·</span> <span class="nowrap">2026&#8209;12&#8209;20 · 11 場</span>');
  assert.equal(shown.includes('2026-12-20'), false);
  assert.equal(shown.includes('<wbr>'), false);
  assert.equal(pure.currentMeetingHeading({ date: '2026-12-20', venueCode: 'ST', races: [{ no: 1 }] }), '當前會議 · 沙田 · 2026-12-20 · 1 場');
  const hint = pure.officialDateHint('2026-12-20');
  assert.match(hint, /YYYY-MM-DD/);
  assert.match(hint, /年-月-日/);
  assert.match(hint, /2026-12-20/);
  assert.equal(/mm\/dd\/yyyy/i.test(hint), false);
  assert.equal(pure.shiftCalendarDate('2026-11-25', -3), '2026-11-22');
  assert.equal(pure.shiftCalendarDate('2026-03-01', -1), '2026-02-28');
  assert.equal(pure.shiftCalendarDate('2024-03-01', -1), '2024-02-29');
  assert.equal(pure.shiftCalendarDate('2026-01-01', -1), '2025-12-31');
  assert.equal(pure.hongKongCalendarDate('2026-11-22T15:59:00Z'), '2026-11-22');
  assert.equal(pure.hongKongCalendarDate('2026-11-22T16:00:00Z'), '2026-11-23');
});

test('prediction keeps horse names and does not leave the empty-meeting line after a successful load', () => {
  assert.equal(pure.predictionHorseName([{ no: 1, name_ch: '金鎗六十' }, { no: 7, name_en: 'ROMANTIC WARRIOR' }], '01'), '金鎗六十');
  assert.equal(pure.predictionHorseName([{ no: 7, name_ch: '浪漫勇士' }], '7'), '浪漫勇士');
  assert.equal(pure.predictionHorseName([{ no: 7, name_ch: '浪漫勇士' }], '8'), '');
  assert.notEqual(pure.LOADING_TEXT, pure.EMPTY_MEETING_TEXT);
  assert.notEqual(pure.SOURCE_ERROR_TEXT, pure.EMPTY_MEETING_TEXT);
  assert.notEqual(pure.PREDICTION_READY_TEXT, pure.EMPTY_MEETING_TEXT);
  assert.notEqual(pure.PREDICTION_CALCULATING_TEXT, pure.LOADING_TEXT);

  const ready = pure.meetingPanelState({ phase: 'loaded', hasRaceOptions: true });
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.text, '選擇場次後執行預測');
  assert.equal(ready.text.includes('目前沒有當前會議'), false);
  assert.equal(pure.meetingPanelState({ phase: 'loaded', hasRaceOptions: false }).text, '目前沒有當前會議');
  assert.equal(pure.meetingPanelState({ phase: 'loading', hasRaceOptions: true }).text, '載入中...');
  assert.equal(pure.meetingPanelState({ phase: 'calculating', hasRaceOptions: true }).text, '計算中...');
  assert.equal(pure.meetingPanelState({ phase: 'error', hasRaceOptions: true }).kind, 'error');
  assert.equal(pure.meetingStatusHtml('loaded', true), '');

  const afterLoad = pure.predictionView({ phase: 'loaded', hasRaceOptions: true });
  assert.equal(afterLoad, '<p>選擇場次後執行預測</p>');
  assert.equal(afterLoad.includes('目前沒有當前會議'), false);
  assert.match(pure.predictionView({ phase: 'loading', hasRaceOptions: true }), /載入中\.\.\./);
  assert.match(pure.predictionView({ phase: 'calculating', hasRaceOptions: true }), /計算中\.\.\./);
  assert.match(pure.predictionView({ phase: 'error', hasRaceOptions: true }), /暫時無法取得賽事資料/);
  assert.match(pure.predictionView({ phase: 'loaded', hasRaceOptions: false }), /目前沒有當前會議/);
  assert.match(pure.predictionView({ phase: 'results', hasRaceOptions: true, predictions: [], runners: [], raceNo: 1 }), /暫無足夠數據/);

  const results = pure.predictionView({
    phase: 'results',
    hasRaceOptions: true,
    raceNo: 3,
    predictions: [
      { horse: '01', odds: 3.5, winProb: 34.3, confidence: '高' },
      { horse: '02', odds: 8.8, winProb: 13.6, confidence: '低' }
    ],
    runners: renderSampleRunners()
  });
  assert.match(results, /馬名/);
  assert.match(results, /金鎗六十/);
  assert.match(results, /爆熱/);
  assert.match(results, /34\.3%/);
  assert.match(results, /horse-cards/);
  assert.match(results, /當前會議 · 第3場 · 獨贏/);
  assert.match(results, /<th>勝出概率<\/th>/);
  assert.match(results, /<th>賠率<\/th>/);
  assert.match(results, /<th>信心<\/th>/);
  assert.equal(results.includes('特徵指數'), false);
  assert.equal(results.includes('特徵條件'), false);
  assert.equal(results.includes('目前沒有當前會議'), false);

  const prepare = fnSource('preparePrediction', 'async function loadPrediction');
  const predict = fnSource('loadPrediction', 'function prepareOfficialResults');
  assert.match(prepare, /predictionPanel/);
  assert.equal(prepare.includes('目前沒有當前會議'), false);
  assert.match(predict, /predictionPanel/);
  assert.match(predict, /model: r\.model/);
  assert.match(predict, /coefficientBasis: r\.coefficientBasis/);
  assert.equal(predict.includes('目前沒有當前會議'), false);
});

test('overview falls back to official results only when the current meeting is empty', async () => {
  assert.equal(pure.dashboardMode({ success: false, error: 'SOURCE_ERROR' }), 'error');
  assert.equal(pure.dashboardMode({ success: true, currentMeeting: true, data: [] }), 'official-fallback');
  assert.equal(pure.dashboardMode({ success: true, data: [{ id: 'MTG' }] }), 'current');

  const queries = pure.officialFallbackQueries('2026-11-25', 4);
  assert.deepEqual(queries.map((query) => query.type), [
    'official-results', 'official-results', 'official-results', 'official-results',
    'official-results', 'official-results', 'official-results', 'official-results'
  ]);
  assert.deepEqual(queries.map((query) => query.date + ' ' + query.venue), [
    '2026-11-25 ST', '2026-11-25 HV',
    '2026-11-24 ST', '2026-11-24 HV',
    '2026-11-23 ST', '2026-11-23 HV',
    '2026-11-22 ST', '2026-11-22 HV'
  ]);
  assert.equal(queries.some((query) => query.type !== 'official-results'), false);

  const meeting = {
    date: '2026-11-22',
    venueCode: 'ST',
    races: [{
      no: 1,
      raceName_ch: '中銀香港跨境服務讓賽',
      runners: [{ position: '1', no: 6, name_ch: '三強', jockey_ch: '潘頓', trainer_ch: '鄭俊偉', actualWeight: '131', barrier: '6' }],
      dividends: [{ pool: '獨贏', combination: '6', dividend: '131.00' }]
    }]
  };
  const calls = [];
  const found = await pure.collectLatestOfficial('2026-11-25', async (query) => {
    calls.push(query);
    assert.equal(query.type, 'official-results');
    if (query.date === '2026-11-22' && query.venue === 'ST') {
      return { success: true, officialResults: true, currentMeeting: false, date: query.date, venue: query.venue, data: meeting };
    }
    return { success: true, officialResults: true, currentMeeting: false, date: query.date, venue: query.venue, data: { date: query.date, venueCode: query.venue, races: [] } };
  }, pure.OFFICIAL_LOOKBACK_DAYS);
  assert.equal(found.summary.kind, 'results');
  assert.equal(found.summary.date, '2026-11-22');
  assert.deepEqual(found.summary.venues, ['ST']);
  assert.equal(calls.length, 14);
  assert.equal(calls.some((query) => query.date === '2026-11-22'), true);
  assert.equal(calls.some((query) => query.date === '2026-11-18'), false);
  assert.equal(calls.some((query) => query.type !== 'official-results'), false);

  const shell = {
    date: '2026-11-25',
    venueCode: 'HV',
    races: [{ no: 1, raceName_ch: '紅松鼠讓賽', runners: [], dividends: [] }]
  };
  const skippedShell = await pure.collectLatestOfficial('2026-11-25', async (query) => {
    if (query.date === '2026-11-25' && query.venue === 'HV') {
      return { success: true, officialResults: true, currentMeeting: false, date: query.date, venue: query.venue, data: shell };
    }
    if (query.date === '2026-11-22' && query.venue === 'ST') {
      return { success: true, officialResults: true, currentMeeting: false, date: query.date, venue: query.venue, data: meeting };
    }
    return { success: true, officialResults: true, currentMeeting: false, date: query.date, venue: query.venue, data: { date: query.date, venueCode: query.venue, races: [] } };
  }, 7);
  assert.equal(skippedShell.summary.kind, 'results');
  assert.equal(skippedShell.summary.date, '2026-11-22');
  assert.equal(skippedShell.summary.meetings[0].races[0].runners[0].name_ch, '三強');
  assert.equal(pure.renderDashboardEmpty(skippedShell.summary).includes('紅松鼠讓賽'), false);

  const view = pure.renderDashboardEmpty(found.summary);
  const current = view.slice(0, view.indexOf('data-source="official-results"'));
  assert.match(current, /目前沒有當前會議/);
  assert.equal(current.includes('三強'), false);
  assert.match(view, /data-source="official-results"/);
  assert.match(view, /三強/);
  assert.match(view, /不會篩選當前會議/);
  assert.match(view, /官方賽果網頁/);
  assert.match(view, /不是當前會議/);
  const graphqlShaped = await pure.collectLatestOfficial('2026-11-25', async () => ({
    success: true,
    currentMeeting: true,
    data: { races: [{ no: 1, raceName_ch: '不應顯示' }] }
  }), 2);
  assert.equal(graphqlShaped.summary.kind, 'error');
  assert.deepEqual(graphqlShaped.summary.meetings, []);
  assert.equal(pure.renderDashboardEmpty(graphqlShaped.summary).includes('不應顯示'), false);
  assert.match(pure.renderDashboardEmpty(graphqlShaped.summary), /暫時無法取得賽事資料/);
  assert.equal(pure.renderDashboardEmpty(graphqlShaped.summary).includes('近日沒有已刊出的官方賽果'), false);

  const none = await pure.collectLatestOfficial('2026-11-25', async (query) => ({
    success: true,
    officialResults: true,
    currentMeeting: false,
    date: query.date,
    venue: query.venue,
    data: { races: [] }
  }), 2);
  assert.equal(none.summary.kind, 'none');
  assert.match(pure.renderDashboardEmpty(none.summary), /近日沒有已刊出的官方賽果/);

  const failed = pure.summarizeOfficialFallback([
    { date: '2026-11-25', venue: 'ST', ok: false, raceCount: 0, meeting: null }
  ]);
  assert.equal(failed.kind, 'error');
  assert.deepEqual(failed.meetings, []);

  const dash = fnSource('loadDashboard', 'function initChart');
  assert.match(dash, /dashboardMode/);
  assert.match(dash, /collectLatestOfficial/);
  assert.match(dash, /fetchAPI\('official-results'/);
  assert.equal(/official-date/.test(dash), false);
  assert.equal(/official-venue/.test(dash), false);
  assert.equal(/fetchAPI\('meetings',\s*\{/.test(dash), false);
  assert.equal(/currentMeetings\s*=\s*[^;]*official/i.test(html), false);
});

test('headings keep the separator on the previous segment and the date with the race count', () => {
  const current = pure.headingHtml('當前會議 · 沙田 · 2026-11-29 · 11 場');
  assert.equal(current, '<span class="nowrap">當前會議 ·</span> <span class="nowrap">沙田 ·</span> <span class="nowrap">2026&#8209;11&#8209;29 · 11 場</span>');
  const happy = pure.headingHtml('當前會議 · 跑馬地 · 2026-11-28 · 3 場');
  assert.equal(happy, '<span class="nowrap">當前會議 ·</span> <span class="nowrap">跑馬地 ·</span> <span class="nowrap">2026&#8209;11&#8209;28 · 3 場</span>');
  const official = pure.headingHtml('官方賽果 · 已結束賽事 · 沙田 · 2026-11-22 · 9 場');
  assert.equal(official, '<span class="nowrap">官方賽果 ·</span> <span class="nowrap">已結束賽事 ·</span> <span class="nowrap">沙田 ·</span> <span class="nowrap">2026&#8209;11&#8209;22 · 9 場</span>');
  assert.equal(pure.headingHtml('當前會議'), '當前會議');
  const hint = pure.headingHtml('格式：YYYY-MM-DD（年-月-日）。今日（香港）：2026-12-20');
  assert.match(hint, /2026&#8209;12&#8209;20/);
  assert.equal(hint.includes('<span'), false);
  for (const value of [current, happy, official]) {
    assert.equal(value.includes('>·'), false);
    assert.equal(value.includes('> ·'), false);
    assert.equal(value.includes('<wbr>'), false);
    assert.equal(value.includes('-'), false);
  }
  assert.equal(html.includes('<wbr>'), false);
  assert.match(html, /\.nowrap\s*\{\s*white-space:\s*nowrap/);
  assert.equal(/h3[^{]*\{[^}]*white-space:\s*nowrap/.test(html), false);
});

test('narrow notes do not isolate Chinese punctuation', () => {
  const narrow = html.slice(html.indexOf('@media (max-width: 720px)'));
  assert.match(narrow, /\.note,\s*\.official-note\s*\{[^}]*line-break:\s*auto/);
  assert.match(html, /line-break:\s*strict/);
});

test('overview uses one limit note and compact race rows inside the scrolling container', () => {
  const meeting = {
    date: '2026-11-28',
    venueCode: 'ST',
    races: [
      { no: 1, raceName_ch: '第一班讓賽', distance: 1200, postTime: '2026-11-28T05:00:00Z' },
      { no: 2, raceName_ch: '第二班讓賽', distance: 1650, postTime: '2026-11-28T05:30:00Z' },
      { no: 3, raceName_ch: '第三班讓賽', distance: 1400, postTime: '2026-11-28T09:45:00Z' }
    ]
  };
  const card = pure.renderMeetingCard(meeting);
  assert.equal(card.includes('class="note"'), false);
  assert.equal(card.includes('只顯示馬會目前回傳的當前會議'), false);
  assert.equal(card.includes('horse-card'), false);
  assert.equal(card.includes('horse-cards'), false);
  assert.match(card, /class="race-rows"/);
  assert.equal((card.match(/class="race-row"/g) || []).length, 3);
  assert.match(card, /第1場 第一班讓賽/);
  assert.match(card, /class="race-row-meta nowrap">1200米 · 開跑 13:00/);
  assert.match(card, /開跑 17:45/);
  assert.match(card, /<span class="nowrap">2026&#8209;11&#8209;28 · 3 場<\/span>/);
  const nine = pure.renderMeetingCard({
    date: '2026-11-29',
    venueCode: 'HV',
    races: Array.from({ length: 9 }, (_, index) => ({
      no: index + 1,
      raceName_ch: '賽事' + (index + 1),
      distance: 1200,
      postTime: '2026-11-29T05:00:00Z'
    }))
  });
  assert.equal((nine.match(/class="race-row"/g) || []).length, 9);
  assert.equal(nine.includes('horse-card'), false);
  assert.match(html, /\.race-row\s*\{[^}]*border-bottom:\s*1px solid/);
  assert.match(html, /\.race-row:last-child\s*\{\s*border-bottom:\s*none/);

  const dash = fnSource('loadDashboard', 'function initChart');
  assert.equal((dash.match(/CURRENT_MEETING_LIMIT/g) || []).length, 1);
  assert.ok(dash.indexOf('class="note"') < dash.indexOf('renderMeetingCard'));

  const containerAt = html.indexOf('<div class="container">');
  const footerAt = html.indexOf('<footer>');
  const scriptAt = html.indexOf('<script>');
  const containerClose = html.lastIndexOf('</div>', scriptAt);
  assert.ok(containerAt < footerAt && footerAt < containerClose && containerClose < scriptAt);
  const narrow = html.slice(html.indexOf('@media (max-width: 720px)'));
  assert.equal(/footer\s*\{[^}]*flex:\s*none/.test(narrow), false);
  assert.match(narrow, /#dashboard \.card\s*\{[^}]*padding:\s*12px/);
  assert.match(narrow, /#dashboard \.card h3\s*\{[^}]*margin-bottom:\s*6px/);
  assert.match(narrow, /#dashboard \.note\s*\{[^}]*padding:\s*6px 10px/);
  const beforeNarrow = html.slice(0, html.indexOf('@media (max-width: 720px)'));
  assert.match(beforeNarrow, /\.card\s*\{[^}]*padding:\s*18px/);
  assert.match(beforeNarrow, /\.note\s*\{[^}]*padding:\s*8px 12px/);
  assert.match(narrow, /\.header \.nav\s*\{[^}]*position:\s*fixed/);
});

function renderSampleRunners() {
  return [
    {
      no: 1,
      name_ch: '金鎗六十',
      name_en: 'GOLDEN SIXTY',
      barrierDrawNumber: 4,
      handicapWeight: '126',
      status: 'Declared',
      jockey: { name_ch: '何澤堯' },
      trainer: { name_ch: '呂健威' }
    },
    {
      no: 2,
      name_ch: '爆熱',
      barrierDrawNumber: 5,
      handicapWeight: '125',
      status: 'Declared',
      jockey: { name_ch: '艾兆禮' },
      trainer: { name_ch: '告東尼' }
    }
  ];
}
