import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FEATURE_CONDITION_COEFFICIENT_BASIS,
  FEATURE_CONDITION_DEFAULTS,
  FEATURE_CONDITIONS_MODEL,
  brandFromHorseCode,
  citedTrialDates,
  currentMeetingKey,
  declaredInjuryUrl,
  featureAdjustment,
  injuryDatabaseUrl,
  isFeatureConditionsEnabled,
  jockeyTrainerPair,
  loadFeatureSources,
  meetingCalendarDate,
  parseDeclaredInjuriesHtml,
  parseInjuryDatabaseHtml,
  parseTrackworkHtml,
  parseTrialHtml,
  parseTrialMenuDates,
  predictFromFeatureConditions,
  trackworkHistoryUrl,
  trackworkMeetingUrl,
  trialDateUrl,
  trialMenuUrl,
  veterinaryRecordUrl
} from '../api/featureConditions.js';
import { RACE_MEETINGS_QUERY, WIN_POOL_QUERY } from '../api/officialQueries.js';
import { isPackSEnabled, PACK_S_MODEL } from '../api/packS.js';
import { USER_FACING_MESSAGE, createHandler, predictFromNodes } from '../api/races.js';

const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const MEETING_SHA = 'bbef8d3eb03bf9c59581e76140e8d3a7fed873b7e84a1a323b02b72f5ba736cb';
const POOL_SHA = 'c08a99ca7cb4f6115db4f23028c1e0fa9e19b2fed9afdf4c404e9c0fd40b2190';
const SOURCE = fs.readFileSync(new URL('../api/featureConditions.js', import.meta.url), 'utf8');
const RACES_SOURCE = fs.readFileSync(new URL('../api/races.js', import.meta.url), 'utf8');
const OFF_VALUES = ['', '0', 'false', 'true', 'yes', 'on', '2', '01', '1 ', ' 1', '1\n', '1.0'];

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function htmlResponse(status, html, url) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async text() {
      return html;
    }
  };
}

async function invoke(query, fetchImpl, env = process.env) {
  const calls = [];
  const wrapped = async (url, init) => {
    calls.push({
      url,
      method: init && init.method,
      headers: init && init.headers,
      credentials: init && init.credentials,
      body: init && init.body ? JSON.parse(init.body) : undefined
    });
    return fetchImpl(url, init, calls);
  };
  const res = createRes();
  await createHandler({ fetch: wrapped, env })({ query }, res);
  return { res, calls };
}

function silence(t) {
  t.mock.method(console, 'error', () => {});
}

function raceShell({ date = '2026-11-25', venue = 'HV', raceNo = 1, body = '' }) {
  const [year, month, day] = date.split('-');
  const label = venue === 'HV' ? '跑馬地' : '沙田';
  return `<div class="date_title"><a class="blueBtn1">${Number(month)}月${Number(day)}日 - ${label}</a></div>
    <span class="font_wb" />第 ${raceNo} 場 - 測試賽</span><br>${year}年${Number(month)}月${Number(day)}日, 星期三, ${label}, 18:40<br>
    ${body}`;
}

function workRow({ no, horseId, trial = '', gallop = '', trot = '' }) {
  return `<tr>
    <td>${no}</td>
    <td><a href="/zh-hk/local/information/horse?horseid=${horseId}">馬名</a><br><span>10/12/13/9/11/12</span></td>
    <td class="BarrierTrial">${trial}</td>
    <td class="Gallop">${gallop}</td>
    <td class="Trotting">${trot}</td>
    <td class="Swimming"></td>
    <td class="Treadmill"></td>
    <td class="AquaWalker"></td>
    <td class="Spelling"></td>
  </tr>`;
}

function trackworkPage(rows) {
  return raceShell({
    body: `<table class="table_bd"><tr><td>編號</td><td>馬名</td><td>試閘</td><td>快操</td><td>踱步</td><td>游泳</td><td>跑步機</td><td>水中步行機</td><td>休歇</td></tr>${rows}</table>`
  });
}

function veterinaryPage(rows) {
  return raceShell({
    body: `<table id="OVR1"><tr><td>馬號</td><td>馬名</td><td>日期</td><td>詳情</td><td>通過日期</td></tr>${rows}</table>`
  });
}

function declaredPage({ date = '2026-11-25', venue = 'HV', rows }) {
  const [year, month, day] = date.split('-');
  const label = venue === 'HV' ? '跑馬地' : '沙田';
  return `<div class="date_title"><a class="blueBtn1">${Number(month)}月${Number(day)}日 - ${label}</a></div>
    <span>${year}年${Number(month)}月${Number(day)}日 星期三 宣佈出賽馬匹傷患紀錄</span>
    <table class="list"><tr><td>場次</td><td>馬號</td><td>馬名</td><td>烙印編號</td><td>日期</td><td>詳情</td><td>通過日期</td></tr>${rows}</table>`;
}

function databasePage(asOf, rows) {
  const [year, month, day] = asOf.split('-');
  return `<table class="list"><tr><td colspan="5">傷患紀錄 (截至 ${year}年${Number(month)}月${Number(day)}日 星期三)</td></tr>
    <tr><td>烙印編號</td><td>馬名</td><td>日期</td><td>詳情</td><td>通過日期</td></tr>${rows}</table>`;
}

function historyPage(horseId, rows) {
  return `<p>${horseId}</p><table><tr><td>日期</td><td>晨操類別</td><td>馬場/跑道</td><td>操練詳情</td><td>配備</td></tr>${rows}</table>`;
}

function trialPage(displayDate, body) {
  return `<div class="divFLeft">試閘日期:${displayDate}</div>${body}`;
}

const TRIAL_BODY = `<table><tr><td>第&nbsp;6&nbsp;組 - 從化草地 - 1200米</td></tr>
  <tr><td>場地狀況: 好地</td><td>時間: 1.11.27</td></tr>
  <tr><td>分段時間: 24.5 23.1 23.6</td></tr></table>
  <table class="bigborder">
    <tr><td>馬名</td><td>騎師</td><td>練馬師</td><td>排位</td><td>配備</td><td>頭馬距離</td><td>沿途走位</td><td>完成時間</td><td>結果</td><td>沿途走勢評述</td></tr>
    <tr>
      <td><a href="/zh-hk/local/information/horse?horseid=HK_2024_K569">良言一句</a> (K569)</td>
      <td>田泰安</td><td>廖康銘</td><td>02</td><td>B</td><td></td><td>8 6 1</td><td>1.11.27</td><td>及格</td><td>前置逐步追上</td>
    </tr>
    <tr>
      <td><a href="/zh-hk/local/information/horse?horseid=HK_2022_H117">飛鷹翱翔</a> (H117)</td>
      <td></td><td>伍鵬志</td><td>12</td><td></td><td></td><td>退出</td><td></td><td></td><td>居中後上</td>
    </tr>
  </table>`;

function meetingCard(runners, extra = {}) {
  return {
    data: {
      raceMeetings: [{
        id: 'MTG',
        date: '2026-11-25',
        venueCode: 'HV',
        races: [{
          no: 1,
          distance: 1650,
          go_ch: '好地',
          go_en: 'GOOD',
          venueCode: 'ST',
          raceTrack: { description_ch: '草地', description_en: 'TURF' },
          raceCourse: { description_ch: '跑馬地草地', description_en: 'HV TURF', displayCode: 'C+3' },
          runners
        }]
      }],
      ...extra
    }
  };
}

function sampleRunners() {
  return [
    {
      no: 1,
      horse: { code: 'HK_2024_K569' },
      barrierDrawNumber: 1,
      handicapWeight: '108',
      currentWeight: '1100',
      gearInfo: 'B',
      last6run: '10/12/13',
      winOdds: 3.2,
      finalPosition: 1,
      actualWeight: '108',
      barrier: 12,
      jockey: { code: 'PZ', name_ch: '某人' },
      trainer: { code: 'SC', name_ch: '練馬師' }
    },
    {
      no: 2,
      horse: { code: 'HK_2024_K435' },
      currentWeight: '900',
      gearInfo: '',
      jockey: { name_ch: '只有姓名' },
      trainer: { code: 'T', name_en: 'Trainer' }
    },
    {
      no: 3,
      horse: { code: 'HK_2020_Z999' },
      name_ch: '同名馬',
      barrierDrawNumber: 14,
      handicapWeight: '140',
      runningStyle: '後上',
      jockey: { code: 'A|B' },
      trainer: { code: 'C' }
    }
  ];
}

function samplePages() {
  const track = trackworkPage([
    workRow({
      no: 1,
      horseId: 'HK_2024_K569',
      trial: '19/11: 第6組 1200 從化 全天候 2/8(陳嘉熙) 24.5 23.1 23.6 (1.11.27)',
      gallop: '<b>08/11:</b> 從化 全天候 31.1 26.9 (58.0) (助手)',
      trot: '<b>24/11:</b> 沙田 飛機場 踱步 (助手)'
    }),
    workRow({ no: 2, horseId: 'HK_2024_K435' })
  ].join(''));
  const vet = veterinaryPage([
    '<tr><td>1</td><td><a href="/zh-hk/local/information/horse?horseid=HK_2024_K569">良言一句</a></td><td>30/01/2026</td><td>右邊骨盆受傷</td><td>-</td></tr>',
    '<tr><td></td><td></td><td>06/05/2026</td><td><b>表現難以接受</b></td><td>21/05/2026</td></tr>'
  ].join(''));
  const declared = declaredPage({
    rows: [
      '<tr><td colspan="7">第 2 場</td></tr>',
      '<tr><td></td><td>1</td><td>良言一句</td><td>K569</td><td>01/01/2026</td><td>不應配到第1場</td><td>02/01/2026</td></tr>',
      '<tr><td colspan="7">第 1 場</td></tr>',
      '<tr><td></td><td>2</td><td>真叻仔</td><td>K435</td><td>19/03/2025</td><td>接受閹割手術</td><td></td></tr>'
    ].join('')
  });
  const database = databasePage('2026-11-25', [
    '<tr><td>K569</td><td>良言一句</td><td>30/01/2026</td><td>右邊骨盆受傷</td><td>-</td></tr>',
    '<tr><td></td><td></td><td>18/11/2026</td><td>食慾不振</td><td>03/02/2026</td></tr>',
    '<tr><td>K111</td><td>良言一句</td><td>01/02/2026</td><td>同名不同烙號</td><td>02/02/2026</td></tr>'
  ].join(''));
  const historyOne = historyPage('HK_2024_K569', [
    '<tr><td>25/11/2026</td><td>出賽</td><td>跑馬地 草地</td><td><a href="/contentAsset/videoplayer_v4/video-player-iframe_v4.html">1650M (奧爾民)</a></td><td>TT</td></tr>',
    '<tr><td>24/11/2026</td><td>踱步</td><td>沙田 飛機場</td><td>飛機場 踱步 (助手)</td><td>H</td></tr>',
    '<tr><td>19/11/2026</td><td>試閘</td><td>從化</td><td>試閘片段 前置</td><td></td></tr>'
  ].join(''));
  const historyTwo = historyPage('HK_2024_K435', [
    '<tr><td>12/11/2026</td><td>快操</td><td>沙田 全天候</td><td>25.5 (25.5) (助手)</td><td></td></tr>'
  ].join(''));
  const menu = '<select><option value="24/11/2026">24/11/2026</option><option value="19/11/2026">19/11/2026</option></select><div>試閘日期:24/11/2026</div><p>沿途走勢評述 前置居中後上</p>';
  const trial = trialPage('19/11/2026', TRIAL_BODY);
  return {
    [trackworkMeetingUrl('2026-11-25', 'HV', 1)]: track,
    [veterinaryRecordUrl('2026-11-25', 'HV', 1)]: vet,
    [declaredInjuryUrl()]: declared,
    [injuryDatabaseUrl()]: database,
    [trackworkHistoryUrl('HK_2024_K569')]: historyOne,
    [trackworkHistoryUrl('HK_2024_K435')]: historyTwo,
    [trialMenuUrl()]: menu,
    [trialDateUrl('2026-11-19')]: trial
  };
}

test('feature flag is on only for the exact string 1, and Size S is unchanged', () => {
  assert.equal(isFeatureConditionsEnabled({}), false);
  assert.equal(isFeatureConditionsEnabled({ GP_FEATURE_CONDITIONS: undefined }), false);
  assert.equal(isFeatureConditionsEnabled(null), false);
  for (const value of OFF_VALUES) {
    assert.equal(isFeatureConditionsEnabled({ GP_FEATURE_CONDITIONS: value }), false, JSON.stringify(value));
    assert.equal(isPackSEnabled({ GP_PACK_S: value, GP_FEATURE_CONDITIONS: '1' }), false, JSON.stringify(value));
  }
  assert.equal(isFeatureConditionsEnabled({ GP_FEATURE_CONDITIONS: '1' }), true);
  assert.equal(isFeatureConditionsEnabled({ GP_FEATURE_CONDITIONS: '1', GP_PACK_S: '0' }), true);
  assert.equal(isPackSEnabled({ GP_PACK_S: '1', GP_FEATURE_CONDITIONS: '0' }), true);
  assert.equal(isPackSEnabled({ GP_FEATURE_CONDITIONS: '1' }), false);
  assert.match(SOURCE, /GP_FEATURE_CONDITIONS === '1'/);
  assert.doesNotMatch(SOURCE, /GP_FEATURE_CONDITIONS\s*=\s*['"]1['"]/);
  assert.match(RACES_SOURCE, /model: 'Odds-based probability model'/);
  assert.match(RACES_SOURCE, /parseFloat\(n\.oddsValue\) \|\| 99/);
  const previous = process.env.GP_FEATURE_CONDITIONS;
  delete process.env.GP_FEATURE_CONDITIONS;
  try {
    assert.equal(isFeatureConditionsEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.GP_FEATURE_CONDITIONS;
    else process.env.GP_FEATURE_CONDITIONS = previous;
  }
});

test('meeting dates stay on the Hong Kong calendar', () => {
  assert.equal(meetingCalendarDate('2026-11-25'), '2026-11-25');
  assert.equal(meetingCalendarDate(' 2026/11/25 '), '2026-11-25');
  assert.equal(meetingCalendarDate('2026-11-24T16:00:00.000Z'), '2026-11-25');
  assert.equal(meetingCalendarDate('2026-11-25T00:00:00+08:00'), '2026-11-25');
  assert.equal(meetingCalendarDate('2026-02-31'), null);
  assert.equal(meetingCalendarDate(''), null);
  assert.equal(meetingCalendarDate(null), null);
  assert.deepEqual(currentMeetingKey({ date: '2026-11-24T16:00:00.000Z', venueCode: 'hv' }), {
    date: '2026-11-25',
    venue: 'HV'
  });
  assert.equal(currentMeetingKey({ date: '2026-11-25' }), null);
  assert.equal(currentMeetingKey({ venueCode: 'ST' }), null);
});

test('trial citations use the line date only, and pairing uses codes', () => {
  assert.deepEqual(citedTrialDates(['19/11: 第6組 1200 從化 2/8(陳嘉熙)'], '2026-11-25'), ['2026-11-19']);
  assert.deepEqual(citedTrialDates(['28/12: 沙田'], '2026-01-05'), ['2025-12-28']);
  assert.deepEqual(citedTrialDates(['28/12/2024: 沙田'], '2026-11-25'), ['2024-12-28']);
  assert.deepEqual(citedTrialDates(['2/8(陳嘉熙)', '31/02: 不成立'], '2026-11-25'), []);
  assert.equal(jockeyTrainerPair({ name_ch: '騎師' }, { code: 'T', name_en: 'Trainer' }), null);
  assert.deepEqual(jockeyTrainerPair({ code: ' PZ ' }, { code: 'SC' }), {
    jockeyCode: 'PZ',
    trainerCode: 'SC',
    text: 'PZ|SC'
  });
  assert.deepEqual(jockeyTrainerPair({ code: 'A|B' }, { code: 'C' }), {
    jockeyCode: 'A|B',
    trainerCode: 'C',
    text: null
  });
  assert.equal(brandFromHorseCode(' HK_2024_K569 '), 'K569');
  assert.equal(brandFromHorseCode('hk_2024_k569'), null);
});

test('unmeasured defaults do not impute, infer a running style, or use odds', () => {
  assert.notEqual(FEATURE_CONDITION_DEFAULTS.barrierPointsPerDraw, 0.15);
  assert.notEqual(FEATURE_CONDITION_DEFAULTS.barrierReferenceDraw, 7);
  assert.notEqual(FEATURE_CONDITION_DEFAULTS.handicapPointsPerPound, 0.02);
  assert.notEqual(FEATURE_CONDITION_DEFAULTS.handicapReferencePounds, 126);
  assert.equal(FEATURE_CONDITION_DEFAULTS.gearPoints, 0);
  assert.equal(FEATURE_CONDITION_DEFAULTS.injuryPoints, 0);
  assert.equal(FEATURE_CONDITION_DEFAULTS.runningStylePoints, 0);
  assert.equal(FEATURE_CONDITION_DEFAULTS.pairingPoints, 0);
  assert.equal(FEATURE_CONDITION_DEFAULTS.morningWorkPoints, 0);
  assert.equal(FEATURE_CONDITION_DEFAULTS.trialPoints, 0);
  assert.equal(FEATURE_CONDITION_DEFAULTS.weightPoints, 0);
  assert.equal(FEATURE_CONDITION_COEFFICIENT_BASIS, 'unmeasured-defaults');

  const missing = featureAdjustment({
    barrierDrawNumber: null,
    barrier: 1,
    handicapWeight: '',
    currentWeight: '108',
    actualWeight: '108',
    winOdds: 2,
    oddsValue: '3.5',
    runningStyle: '前置',
    comment: '居中後上',
    positions: '1 1 1',
    venueCode: 'ST',
    last6run: '1/1/1',
    gearInfo: '',
    jockey: { name_ch: '姓名' },
    trainer: { name_ch: '姓名' }
  });
  assert.equal(missing.winProb, 16);
  assert.equal(missing.adjustment, 0);
  assert.equal(missing.features.barrier.value, null);
  assert.equal(missing.features.barrier.points, 0);
  assert.equal(missing.features.handicap.value, null);
  assert.equal(missing.features.handicap.points, 0);
  assert.equal(missing.features.weight.value, 108);
  assert.equal(missing.features.weight.points, 0);
  assert.equal(missing.features.gear.value, null);
  assert.equal(missing.features.runningStyle.value, null);
  assert.equal(missing.features.runningStyle.points, 0);
  assert.equal(missing.features.pairing.text, null);
  assert.equal(missing.features.track.descriptions, null);
  assert.equal(missing.features.distance.value, null);
  assert.equal(JSON.stringify(missing).includes('前置'), false);
  assert.equal(JSON.stringify(missing).includes('odds'), false);
  assert.equal(Object.hasOwn(missing, 'odds'), false);

  const present = featureAdjustment({
    barrierDrawNumber: 1,
    handicapWeight: '108',
    gearInfo: 'B',
    currentWeight: '900'
  });
  const sameWithoutGear = featureAdjustment({ barrierDrawNumber: 1, handicapWeight: '108' });
  assert.equal(present.features.barrier.points, 0.64);
  assert.equal(present.features.handicap.points, 0.3);
  assert.equal(present.adjustment, 0.94);
  assert.equal(present.winProb, 16.9);
  assert.equal(present.features.gear.value, 'B');
  assert.equal(present.features.gear.points, 0);
  assert.equal(sameWithoutGear.winProb, present.winProb);
  assert.equal(featureAdjustment({ barrierDrawNumber: '01' }).features.barrier.value, null);
  assert.equal(featureAdjustment({ barrierDrawNumber: 0 }).features.barrier.value, null);
  assert.equal(featureAdjustment({ barrierDrawNumber: 1.5 }).features.barrier.value, null);
  assert.equal(featureAdjustment({ handicapWeight: 0 }).features.handicap.value, null);

  const capped = featureAdjustment({ barrierDrawNumber: 1, handicapWeight: '20' });
  assert.equal(capped.features.barrier.points, 0.64);
  assert.equal(capped.features.handicap.points, 0.9);
  assert.equal(capped.adjustment, 1.2);
  assert.equal(capped.winProb, 17.2);

  const withComment = featureAdjustment({
    trials: [{ result: '及格', positions: '1 1 1', comment: '前置', runningStyle: '居中' }],
    injuries: { veterinary: [{ detail: '後上', passedDate: '-' }] },
    morningWork: { gallop: null, history: [{ kind: '快操', detail: '31.1' }] }
  });
  assert.equal(withComment.features.runningStyle.value, null);
  assert.equal(withComment.features.trials.points, 0);
  assert.equal(withComment.features.trials.entries[0].result, '及格');
  assert.equal(Object.hasOwn(withComment.features.trials.entries[0], 'comment'), false);
  assert.equal(withComment.features.morningWork.gallop, null);
  assert.equal(withComment.features.morningWork.history[0].detail, '31.1');
  assert.equal(withComment.features.morningWork.points, 0);
  assert.equal(withComment.features.injuries.points, 0);
  assert.equal(withComment.adjustment, 0);
  assert.equal(JSON.stringify(withComment).includes('前置'), false);
});

test('trial and meeting parsers keep blank cells blank and drop in-running comments', () => {
  const parsed = parseTrialHtml(trialPage('19/11/2026', TRIAL_BODY), '2026-11-19');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].result, '及格');
  assert.equal(parsed.entries[0].overallTime, '1.11.27');
  assert.equal(parsed.entries[0].sectionals, '24.5 23.1 23.6');
  assert.equal(parsed.entries[0].distance, 1200);
  assert.equal(parsed.entries[0].going, '好地');
  assert.equal(parsed.entries[0].course, '從化草地');
  assert.equal(parsed.entries[0].horseId, 'HK_2024_K569');
  assert.equal(parsed.entries[0].brand, 'K569');
  assert.equal(parsed.entries[1].positions, '退出');
  assert.equal(parsed.entries[1].result, '');
  assert.equal(JSON.stringify(parsed.entries).includes('前置'), false);
  assert.equal(JSON.stringify(parsed.entries).includes('居中'), false);
  assert.equal(parseTrialHtml(trialPage('20/11/2026', TRIAL_BODY), '2026-11-19').ok, false);
  assert.deepEqual(parseTrialMenuDates('<option value="19/11/2026"></option><div>試閘日期:24/11/2026 前置</div>'), ['2026-11-19']);

  const track = parseTrackworkHtml(trackworkPage(workRow({
    no: 1,
    horseId: 'HK_2024_K569',
    trial: '19/11: 第6組 2/8(陳嘉熙)',
    gallop: ''
  })), { date: '2026-11-25', venue: 'HV', raceNo: 1 });
  assert.equal(track.ok, true);
  assert.equal(track.horses[0].gallop, null);
  assert.equal(JSON.stringify(track.horses).includes('10/12/13'), false);
  assert.equal(JSON.stringify(track.horses).includes('第6組'), false);
  assert.deepEqual(track.trialCitations[0].dates, ['2026-11-19']);
  assert.equal(parseTrackworkHtml(trackworkPage(''), { date: '2026-11-25', venue: 'ST', raceNo: 1 }).reason, 'venue-mismatch');
  assert.equal(parseTrackworkHtml(trackworkPage(''), { date: '2026-11-22', venue: 'HV', raceNo: 1 }).reason, 'date-mismatch');
  assert.equal(parseTrackworkHtml(trackworkPage(''), { date: '2026-11-25', venue: 'HV', raceNo: 2 }).reason, 'race-mismatch');

  const declared = parseDeclaredInjuriesHtml(declaredPage({
    rows: '<tr><td colspan="7">第 1 場</td></tr><tr><td></td><td>2</td><td>真叻仔</td><td>K435</td><td>19/03/2025</td><td>接受閹割手術</td><td>-</td></tr>'
  }), { date: '2026-11-25', venue: 'HV' });
  assert.equal(declared.ok, true);
  assert.equal(declared.records[0].passedDate, null);
  assert.equal(parseDeclaredInjuriesHtml(declaredPage({ venue: 'ST', rows: '' }), { date: '2026-11-25', venue: 'HV' }).reason, 'venue-mismatch');

  const database = parseInjuryDatabaseHtml(databasePage('2026-11-24', '<tr><td>K569</td><td>良言一句</td><td>01/01/2026</td><td>記錄</td><td>-</td></tr>'));
  assert.equal(database.ok, true);
  assert.equal(database.asOf, '2026-11-24');
  assert.equal(database.horses[0].records[0].passedDate, null);
  assert.equal(parseInjuryDatabaseHtml('<p>沒有截至日期</p>').ok, false);
});

test('flag off matches predictFromNodes and does not fetch the new pages', async () => {
  const nodes = [
    { combString: '01', oddsValue: '3.5', hotFavourite: true, oddsDropValue: '4' },
    { combString: '07', oddsValue: '9.0' },
    { combString: '02', oddsValue: '0' },
    { combString: '04', oddsValue: '4' },
    { combString: '05', oddsValue: '8' }
  ];
  const today = predictFromNodes(nodes);
  const environments = [{}, { GP_FEATURE_CONDITIONS: undefined, GP_PACK_S: undefined }];
  for (const value of OFF_VALUES) environments.push({ GP_FEATURE_CONDITIONS: value });
  for (const env of environments) {
    const { res, calls } = await invoke(
      { type: 'predict', race: '4', date: '2099-01-01', venue: 'HV' },
      async (url) => {
        assert.equal(String(url).includes('racing.hkjc.com'), false);
        return jsonResponse(200, {
          data: { raceMeetings: [{ pmPools: [{ oddsType: 'WIN', leg: { races: [4] }, oddsNodes: nodes }] }] }
        });
      },
      env
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPHQL_URL);
    assert.equal(calls[0].body.operationName, 'sp4e_racing_pmPool');
    assert.equal(calls[0].body.query, WIN_POOL_QUERY);
    assert.deepEqual(calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 4 });
    assert.deepEqual(res.body, {
      success: true,
      currentMeeting: true,
      race: 4,
      predictions: today,
      model: 'Odds-based probability model'
    });
  }
});

test('feature flag on scores the card and ingested pages without an odds baseline', async (t) => {
  silence(t);
  const pages = samplePages();
  const { res, calls } = await invoke(
    { type: 'predict', race: '1', date: '2099-01-01', venue: 'ST' },
    async (url, init) => {
      if (url === GRAPHQL_URL) return jsonResponse(200, meetingCard(sampleRunners()));
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(pages[url] == null, false, url);
      return htmlResponse(200, pages[url], url);
    },
    { GP_FEATURE_CONDITIONS: '1', GP_PACK_S: '1' }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.model, FEATURE_CONDITIONS_MODEL);
  assert.notEqual(res.body.model, 'Odds-based probability model');
  assert.notEqual(res.body.model, PACK_S_MODEL);
  assert.equal(res.body.coefficientBasis, FEATURE_CONDITION_COEFFICIENT_BASIS);
  const graphql = calls.filter((call) => call.url === GRAPHQL_URL);
  assert.equal(graphql.length, 1);
  assert.equal(graphql[0].body.query, RACE_MEETINGS_QUERY);
  assert.equal(graphql[0].body.operationName, 'raceMeetings');
  assert.deepEqual(graphql[0].body.variables, {});
  assert.equal(calls.some((call) => call.body && call.body.query === WIN_POOL_QUERY), false);
  const urls = calls.map((call) => call.url);
  assert.deepEqual(urls.filter((url) => url !== GRAPHQL_URL).sort(), Object.keys(pages).sort());
  assert.equal(urls.some((url) => /corunning|overoar|resultsall|speedpro|trackworksearch|\/horse\?/.test(url)), false);

  const rows = res.body.predictions;
  assert.deepEqual(rows.map((row) => row.horse), ['1', '2', '3']);
  assert.equal(rows[0].winProb, 16.9);
  assert.equal(rows[0].adjustment, 0.94);
  assert.equal(rows[0].confidence, '未量度');
  assert.equal(Object.hasOwn(rows[0], 'odds'), false);
  assert.equal(rows[0].features.barrier.value, 1);
  assert.equal(rows[0].features.handicap.value, 108);
  assert.equal(rows[0].features.gear.value, 'B');
  assert.equal(rows[0].features.gear.points, 0);
  assert.equal(rows[0].features.distance.value, 1650);
  assert.equal(rows[0].features.distance.points, 0);
  assert.deepEqual(rows[0].features.track.descriptions, ['草地', 'TURF', '跑馬地草地', 'HV TURF', 'C+3']);
  assert.equal(rows[0].features.going.go_ch, '好地');
  assert.equal(rows[0].features.pairing.text, 'PZ|SC');
  assert.equal(rows[0].features.pairing.points, 0);
  assert.deepEqual(rows[0].features.morningWork.gallop, ['08/11: 從化 全天候 31.1 26.9 (58.0) (助手)']);
  assert.equal(rows[0].features.morningWork.points, 0);
  assert.deepEqual(rows[0].features.morningWork.history.map((row) => row.kind), ['踱步']);
  assert.equal(rows[0].features.trials.entries.length, 1);
  assert.equal(rows[0].features.trials.entries[0].result, '及格');
  assert.equal(rows[0].features.trials.entries[0].positions, '8 6 1');
  assert.equal(rows[0].features.trials.points, 0);
  assert.equal(rows[0].features.runningStyle.value, null);
  assert.equal(rows[0].features.injuries.veterinary[0].passedDate, null);
  assert.equal(rows[0].features.injuries.veterinary[1].sinceLastStart, true);
  assert.equal(rows[0].features.injuries.declared, null);
  assert.equal(rows[0].features.injuries.database.length, 2);
  assert.equal(rows[0].features.injuries.databaseAsOf, '2026-11-25');
  assert.equal(rows[0].features.injuries.points, 0);
  assert.equal(JSON.stringify(rows[0]).includes('不應配到第1場'), false);
  assert.equal(JSON.stringify(rows[0]).includes('同名不同烙號'), false);
  assert.equal(JSON.stringify(rows[0]).includes('1650M'), false);
  assert.equal(JSON.stringify(rows[0]).includes('前置'), false);
  assert.equal(JSON.stringify(rows[0]).includes('10/12/13'), false);

  assert.equal(rows[1].winProb, 16);
  assert.equal(rows[1].features.barrier.value, null);
  assert.equal(rows[1].features.handicap.value, null);
  assert.equal(rows[1].features.weight.value, 900);
  assert.equal(rows[1].features.weight.points, 0);
  assert.equal(rows[1].features.morningWork.gallop, null);
  assert.equal(rows[1].features.morningWork.history[0].kind, '快操');
  assert.equal(rows[1].features.trials.entries, null);
  assert.equal(rows[1].features.pairing.jockeyCode, null);
  assert.equal(rows[1].features.injuries.declared[0].detail, '接受閹割手術');
  assert.equal(rows[1].features.injuries.declared[0].passedDate, null);
  assert.equal(rows[2].features.pairing.text, null);
  assert.equal(rows[2].features.pairing.jockeyCode, 'A|B');
  assert.equal(rows[2].features.runningStyle.value, null);
  assert.equal(rows[2].winProb, 14.9);
});

test('a mismatched official page fails closed and the odds path is not a fallback', async (t) => {
  silence(t);
  const pages = samplePages();
  const trackUrl = trackworkMeetingUrl('2026-11-25', 'HV', 1);
  pages[trackUrl] = pages[trackUrl].replaceAll('跑馬地', '沙田');
  const mismatched = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      if (url === GRAPHQL_URL) return jsonResponse(200, meetingCard(sampleRunners()));
      return htmlResponse(200, pages[url] || '', url);
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(mismatched.res.statusCode, 502);
  assert.equal(mismatched.res.body.success, false);
  assert.equal(mismatched.res.body.error, 'SOURCE_ERROR');
  assert.equal(mismatched.res.body.message, USER_FACING_MESSAGE);
  assert.equal(mismatched.res.body.predictions, undefined);
  assert.equal(JSON.stringify(mismatched.res.body).includes('沙田'), false);

  const trialUrl = trialDateUrl('2026-11-19');
  const restored = samplePages();
  restored[trialUrl] = restored[trialUrl].replace('19/11/2026', '20/11/2026');
  const trialMismatch = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      if (url === GRAPHQL_URL) return jsonResponse(200, meetingCard(sampleRunners()));
      return htmlResponse(200, restored[url], url);
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(trialMismatch.res.body.error, 'SOURCE_ERROR');
  assert.equal(trialMismatch.res.body.predictions, undefined);

  const declaredUrl = declaredInjuryUrl();
  const declaredPages = samplePages();
  declaredPages[declaredUrl] = declaredPages[declaredUrl].replaceAll('2026年11月25日', '2026年11月22日').replaceAll('11月25日', '11月22日');
  const declaredMismatch = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      if (url === GRAPHQL_URL) return jsonResponse(200, meetingCard(sampleRunners()));
      return htmlResponse(200, declaredPages[url], url);
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(declaredMismatch.res.body.error, 'SOURCE_ERROR');

  const redirected = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      if (url === GRAPHQL_URL) return jsonResponse(200, meetingCard(sampleRunners()));
      if (url === trackUrl) return htmlResponse(200, samplePages()[url], url.replace('RaceNo=1', 'RaceNo=2'));
      return htmlResponse(200, samplePages()[url], url);
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(redirected.res.body.error, 'SOURCE_ERROR');

  const http = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      if (url === GRAPHQL_URL) return jsonResponse(200, meetingCard(sampleRunners()));
      if (url === veterinaryRecordUrl('2026-11-25', 'HV', 1)) return htmlResponse(503, 'upstream', url);
      return htmlResponse(200, samplePages()[url], url);
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(http.res.statusCode, 502);
  assert.equal(http.res.body.error, 'SOURCE_HTTP');
});

test('feature path does not fetch HTML when the card cannot name a meeting', async (t) => {
  silence(t);
  const empty = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      assert.equal(url, GRAPHQL_URL);
      return jsonResponse(200, { data: { raceMeetings: [] } });
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.deepEqual(empty.res.body, {
    success: true,
    currentMeeting: true,
    race: 1,
    predictions: [],
    model: FEATURE_CONDITIONS_MODEL,
    coefficientBasis: FEATURE_CONDITION_COEFFICIENT_BASIS
  });

  let htmlFetches = 0;
  const undated = await invoke(
    { type: 'predict', race: '1' },
    async (url) => {
      if (url !== GRAPHQL_URL) htmlFetches += 1;
      return jsonResponse(200, {
        data: { raceMeetings: [{ venueCode: 'HV', races: [{ no: 1, runners: [{ no: 1 }] }] }] }
      });
    },
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(htmlFetches, 0);
  assert.equal(undated.res.body.error, 'SOURCE_ERROR');

  const whitelist = await invoke(
    { type: 'predict', race: '1' },
    async () => jsonResponse(200, { errors: [{ extensions: { code: 'WHITELIST_ERROR' } }] }),
    { GP_FEATURE_CONDITIONS: '1' }
  );
  assert.equal(whitelist.calls.length, 1);
  assert.equal(whitelist.res.body.error, 'SOURCE_WHITELIST');
});

test('odds requests stay on the WIN pool when the feature flag is on', async () => {
  const { res, calls } = await invoke(
    { type: 'odds', race: '3' },
    async (url) => {
      assert.equal(String(url).includes('racing.hkjc.com'), false);
      return jsonResponse(200, { data: { raceMeetings: [{ pmPools: [] }] } });
    },
    { GP_FEATURE_CONDITIONS: '1', GP_PACK_S: '1' }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.query, WIN_POOL_QUERY);
  assert.deepEqual(calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 3 });
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, []);
});

test('Size S still runs when the feature flag is off', async () => {
  const nodes = [{ combString: '01', oddsValue: '5' }];
  const { res, calls } = await invoke(
    { type: 'predict', race: '1' },
    async () => jsonResponse(200, {
      data: {
        raceMeetings: [{
          pmPools: [{ oddsType: 'WIN', leg: { races: [1] }, oddsNodes: nodes }],
          races: [{ no: 1, runners: [{ no: 1, barrierDrawNumber: 1 }] }]
        }]
      }
    }),
    { GP_FEATURE_CONDITIONS: '0', GP_PACK_S: '1' }
  );
  assert.equal(calls.some((call) => String(call.url).includes('racing.hkjc.com')), false);
  assert.equal(res.body.model, PACK_S_MODEL);
  assert.equal(res.body.predictions[0].baselineWinProb, 24);
  assert.equal(res.body.predictions[0].odds, 5);
});

test('ranking uses the feature index, keeps the first five, and ignores duplicate numbers', () => {
  const runners = [1, 2, 3, 4, 5, 6].map((no) => ({ no, barrierDrawNumber: no }));
  const ranked = predictFromFeatureConditions({ runners }, {});
  assert.deepEqual(ranked.map((row) => row.horse), ['1', '2', '3', '4', '5']);
  assert.equal(ranked[0].winProb > ranked[4].winProb, true);
  const tied = predictFromFeatureConditions({
    runners: [{ no: 5, barrierDrawNumber: 9 }, { no: 2, barrierDrawNumber: 9 }]
  }, {});
  assert.deepEqual(tied.map((row) => row.horse), ['2', '5']);
  assert.equal(tied[0].winProb, 16);
  const duplicate = predictFromFeatureConditions({
    runners: [{ no: 1, barrierDrawNumber: 1 }, { no: 1, barrierDrawNumber: 14 }]
  }, {});
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].features.barrier.value, 1);
});

test('locked queries are unchanged and neither flag is enabled in the repo', () => {
  assert.equal(createHash('sha256').update(RACE_MEETINGS_QUERY).digest('hex'), MEETING_SHA);
  assert.equal(createHash('sha256').update(WIN_POOL_QUERY).digest('hex'), POOL_SHA);
  assert.equal(RACE_MEETINGS_QUERY.length, 4497);
  assert.equal(WIN_POOL_QUERY.length, 1005);
  assert.equal(SOURCE.includes('predictFromNodes'), false);
  assert.equal(SOURCE.includes('oddsValue'), false);
  assert.equal(SOURCE.includes('oddsTypes'), false);
  assert.equal(SOURCE.includes('resultsall'), false);
  assert.equal(SOURCE.includes('corunning'), false);
  assert.equal(SOURCE.includes('overoar'), false);
  assert.equal(SOURCE.includes('speedpro'), false);
  assert.equal(SOURCE.includes('trackworksearch'), false);
  assert.equal(SOURCE.includes('/horse?'), false);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  assert.equal(files.some((file) => path.basename(file).startsWith('.env')), false);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /GP_FEATURE_CONDITIONS\s*=\s*['"]?1['"]?/, file);
    assert.doesNotMatch(text, /GP_PACK_S\s*=\s*['"]?1['"]?/, file);
  }
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /預測只根據當前會議的獨贏賠率，不能按日期或馬場查詢其他賽事。/);
  assert.match(html, /頁面沒有改為讀取晨操、試閘或傷患。/);
  assert.doesNotMatch(html, /localtrackwork|btresult|veterinaryrecord|overecord|ovedatabase/);
});

test('loader rejects a history page for a different horse', async (t) => {
  silence(t);
  const pages = samplePages();
  pages[trackworkHistoryUrl('HK_2024_K569')] = historyPage('HK_2020_OTHER', '');
  const loaded = await loadFeatureSources({
    date: '2026-11-25',
    venue: 'HV',
    raceNo: 1,
    fetch: async (url) => htmlResponse(200, pages[url] || '', url)
  });
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, 'SOURCE_ERROR');
});
