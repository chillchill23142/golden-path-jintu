import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { USER_FACING_MESSAGE, createHandler } from '../api/races.js';
import { RACE_MEETINGS_QUERY, WIN_POOL_QUERY } from '../api/officialQueries.js';
import {
  loadOfficialResults,
  officialResultsUrl,
  parseOfficialResultsHtml,
  parseRaceCalendarDate,
  parseVenueCode
} from '../api/officialResults.js';

const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const ST_RESULTS_URL = 'https://racing.hkjc.com/zh-hk/local/information/resultsall?Racecourse=ST&racedate=2026/11/22';
const FIXTURE_URL = new URL('./fixtures/official-results-2026-11-22-st.html', import.meta.url);
const ST_FIXTURE = fs.readFileSync(FIXTURE_URL, 'utf8');

const ST_RACE_NAMES = [
  '中銀香港跨境服務讓賽',
  '中銀香港中小企理財讓賽',
  '中銀人壽讓賽',
  '中銀香港「理財TRENDYTOO」讓賽',
  '中銀香港中銀理財讓賽',
  '中銀信用卡讓賽',
  '中銀香港私人銀行馬會短途錦標',
  '中銀香港私人財富馬會一哩錦標',
  '中銀香港馬會盃',
  '中銀香港BOC PAY+ 讓賽',
  '中銀香港FAMILYMAX讓賽'
];

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

function textResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    }
  };
}

function captureLogs(t) {
  if (!t.logs) {
    t.logs = [];
    t.mock.method(console, 'error', (...args) => {
      t.logs.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  return t.logs;
}

async function invoke(t, query, fetchImpl) {
  const logs = captureLogs(t);
  const calls = [];
  const wrapped = async (url, init = {}) => {
    let body;
    if (init && init.body) body = JSON.parse(init.body);
    calls.push({ url, init, body });
    return fetchImpl(url, init, calls);
  };
  const res = createRes();
  await createHandler({ fetch: wrapped })({ query }, res);
  return { res, calls, logs };
}

function assertNoUpstreamLeak(body, raw) {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(raw), false);
  assert.equal(body.message, USER_FACING_MESSAGE);
  assert.equal(body.success, false);
  assert.equal(body.data, undefined);
}

function twoRacePage() {
  return [
    '<div class="racingNum"><table><tr><td><span>跑馬地: </span></td></tr></table></div>',
    '<span class="f_fl f_fs13">賽事日期:&nbsp; 03/01/2024</span>',
    '<div class="bg_blue color_w f_fs13 font_wb">第 8 場</div><div>第五班 - 1200米 - 草地 - 測試賽事甲</div>',
    '<div class="bg_blue color_w f_fs13 font_wb">第 9 場</div><div>第四班 - 1650米 - 草地 - 測試賽事乙</div>'
  ].join('');
}

test('calendar dates stay on the Hong Kong race date and are not ISO instants', () => {
  assert.equal(parseRaceCalendarDate('2026-11-22'), '2026-11-22');
  assert.equal(parseRaceCalendarDate('2024-02-29'), '2024-02-29');
  assert.equal(parseRaceCalendarDate('2026-02-29'), null);
  assert.equal(parseRaceCalendarDate('2026-02-31'), null);
  assert.equal(parseRaceCalendarDate('2026-11-22T16:00:00.000Z'), null);
  assert.equal(parseRaceCalendarDate('22/11/2026'), null);
  assert.equal(parseVenueCode('st'), 'ST');
  assert.equal(parseVenueCode('HV'), 'HV');
  assert.equal(parseVenueCode('S1'), null);
  assert.equal(officialResultsUrl('2026-11-22', 'ST'), ST_RESULTS_URL);
  assert.equal(officialResultsUrl('2026-11-22T00:00:00Z', 'ST'), null);
  assert.equal(ST_RESULTS_URL.includes('2026/11/22'), true);
});

test('2026-11-22 Sha Tin official results parse to 11 races and race 1 中銀香港跨境服務讓賽', () => {
  const parsed = parseOfficialResultsHtml(ST_FIXTURE, { date: '2026-11-22', venue: 'ST' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.meeting.date, '2026-11-22');
  assert.equal(parsed.meeting.venueCode, 'ST');
  assert.equal(parsed.meeting.venueLabel, '沙田');
  assert.equal(parsed.meeting.races.length, 11);
  assert.deepEqual(parsed.meeting.races.map((race) => race.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(parsed.meeting.races.map((race) => race.raceName_ch), ST_RACE_NAMES);
  const raceOne = parsed.meeting.races[0];
  assert.equal(raceOne.raceName_ch, '中銀香港跨境服務讓賽');
  assert.equal(raceOne.raceClass_ch, '第五班');
  assert.equal(raceOne.distance, 1200);
  assert.equal(raceOne.detail.includes('&quot;'), false);
  assert.deepEqual(raceOne.runners[0], {
    position: '1',
    no: 6,
    name_ch: '三強',
    jockey_ch: '潘頓',
    trainer_ch: '鄭俊偉',
    actualWeight: '131',
    barrier: '6'
  });
  assert.equal(raceOne.runners.length, 4);
  assert.deepEqual(raceOne.dividends[0], { pool: '獨贏', combination: '6', dividend: '131.00' });
  const serialized = JSON.stringify(parsed.meeting);
  assert.equal(serialized.includes('海外獨贏'), false);
  assert.equal(serialized.includes('海外賽事'), false);
  assert.notEqual(parsed.meeting.races.length, 5);
  assert.notEqual(parsed.meeting.races.length, 1);
});

test('race count follows the published meeting and a different date or venue is not reused', () => {
  const two = parseOfficialResultsHtml(twoRacePage(), { date: '2024-01-03', venue: 'HV' });
  assert.equal(two.ok, true);
  assert.equal(two.meeting.races.length, 2);
  assert.deepEqual(two.meeting.races.map((race) => race.no), [8, 9]);
  assert.equal(two.meeting.races[0].raceName_ch, '測試賽事甲');
  assert.equal(two.meeting.races[1].distance, 1650);
  assert.equal(two.meeting.races[1].raceName_ch, '測試賽事乙');

  const wrongVenue = parseOfficialResultsHtml(ST_FIXTURE, { date: '2026-11-22', venue: 'HV' });
  assert.equal(wrongVenue.ok, false);
  assert.equal(wrongVenue.reason, 'venue-mismatch');
  assert.equal(wrongVenue.meeting, undefined);

  const wrongDate = parseOfficialResultsHtml(ST_FIXTURE, { date: '2026-11-25', venue: 'ST' });
  assert.equal(wrongDate.ok, false);
  assert.equal(wrongDate.reason, 'date-mismatch');

  const empty = parseOfficialResultsHtml('<div id="errorContainer">沒有相關資料。</div>', { date: '2026-11-23', venue: 'ST' });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.meeting, { date: '2026-11-23', venueCode: 'ST', races: [] });

  const unrecognized = parseOfficialResultsHtml('<html>secret-unparsed-page</html>', { date: '2026-11-22', venue: 'ST' });
  assert.equal(unrecognized.ok, false);
  assert.equal(unrecognized.reason, 'unrecognized');
});

test('official results handler reads the public HTML page and does not call GraphQL', async (t) => {
  const { res, calls } = await invoke(t,
    { type: 'official-results', date: '2026-11-22', venue: 'ST' },
    async () => textResponse(200, ST_FIXTURE)
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ST_RESULTS_URL);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].init.headers.Cookie, undefined);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers.Origin, undefined);
  assert.equal(calls[0].init.headers.Referer, undefined);
  assert.equal(calls[0].url.includes('graphql'), false);
  assert.equal(calls[0].url.includes('bet.hkjc.com'), false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.officialResults, true);
  assert.equal(res.body.currentMeeting, false);
  assert.equal(res.body.date, '2026-11-22');
  assert.equal(res.body.venue, 'ST');
  assert.equal(res.body.note, '官方賽果');
  assert.equal(res.body.data.races.length, 11);
  assert.equal(res.body.data.races[0].raceName_ch, '中銀香港跨境服務讓賽');
  assert.equal(res.body.data.races[0].runners[0].name_ch, '三強');
  assert.equal(JSON.stringify(res.body).includes('raceMeetings'), false);
});

test('current meeting GraphQL still ignores date and venue when official results exist', async (t) => {
  const card = {
    id: 'MTG_LIVE',
    date: '2026-12-20',
    venueCode: 'HV',
    races: [{ no: 1, raceName_ch: '當前賽事' }, { no: 2, raceName_ch: '當前第二場' }]
  };
  const meetings = await invoke(t,
    { type: 'meetings', date: '2026-11-22', venue: 'ST' },
    async () => textResponse(200, JSON.stringify({ data: { raceMeetings: [card] } }))
  );
  assert.equal(meetings.calls.length, 1);
  assert.equal(meetings.calls[0].url, GRAPHQL_URL);
  assert.equal(meetings.calls[0].init.method, 'POST');
  assert.equal(meetings.calls[0].body.operationName, 'raceMeetings');
  assert.equal(meetings.calls[0].body.query, RACE_MEETINGS_QUERY);
  assert.deepEqual(meetings.calls[0].body.variables, {});
  assert.equal(meetings.res.body.currentMeeting, true);
  assert.equal(meetings.res.body.officialResults, undefined);
  assert.equal(meetings.res.body.data[0].id, 'MTG_LIVE');
  assert.equal(meetings.res.body.data[0].date, '2026-12-20');
  assert.equal(meetings.res.body.data[0].venueCode, 'HV');
  assert.equal(JSON.stringify(meetings.res.body).includes('2026-11-22'), false);
  assert.equal(JSON.stringify(meetings.res.body).includes('中銀香港跨境服務讓賽'), false);

  const odds = await invoke(t,
    { type: 'odds', race: '2', date: '2026-11-22', venue: 'ST' },
    async () => textResponse(200, JSON.stringify({
      data: {
        raceMeetings: [{
          pmPools: [{
            id: 'POOL_WIN_2',
            oddsType: 'WIN',
            leg: { number: 2, races: [2] },
            oddsNodes: [{ combString: '02', oddsValue: '4.6' }]
          }]
        }]
      }
    }))
  );
  assert.equal(odds.calls[0].url, GRAPHQL_URL);
  assert.equal(odds.calls[0].body.operationName, 'sp4e_racing_pmPool');
  assert.equal(odds.calls[0].body.query, WIN_POOL_QUERY);
  assert.deepEqual(odds.calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 2 });
  assert.equal(odds.res.body.currentMeeting, true);
  assert.equal(odds.res.body.data[0].id, 'POOL_WIN_2');
  assert.equal(odds.res.body.officialResults, undefined);
});

test('official results failures stay success false and do not become an empty meeting', async (t) => {
  const raw = 'upstream results page secret-marker WHITELIST_ERROR';
  const http = await invoke(t,
    { type: 'official-results', date: '2026-11-22', venue: 'ST' },
    async () => textResponse(503, raw)
  );
  assert.equal(http.res.statusCode, 502);
  assert.equal(http.res.body.error, 'SOURCE_HTTP');
  assertNoUpstreamLeak(http.res.body, 'secret-marker');
  assert.match(http.logs.join('\n'), /secret-marker/);

  const network = await invoke(t,
    { type: 'official-results', date: '2026-11-22', venue: 'HV' },
    async () => { throw new Error('ECONNREFUSED racing.hkjc.com hidden-fault'); }
  );
  assert.equal(network.res.statusCode, 502);
  assert.equal(network.res.body.error, 'SOURCE_ERROR');
  assertNoUpstreamLeak(network.res.body, 'hidden-fault');

  const unrecognized = await invoke(t,
    { type: 'official-results', date: '2026-11-22', venue: 'ST' },
    async () => textResponse(200, '<html>secret-unparsed-page</html>')
  );
  assert.equal(unrecognized.res.statusCode, 502);
  assert.equal(unrecognized.res.body.error, 'SOURCE_ERROR');
  assertNoUpstreamLeak(unrecognized.res.body, 'secret-unparsed-page');
  assert.notDeepEqual(unrecognized.res.body.data, []);

  const mismatch = await invoke(t,
    { type: 'official-results', date: '2026-11-25', venue: 'HV' },
    async () => textResponse(200, ST_FIXTURE)
  );
  assert.equal(mismatch.res.statusCode, 502);
  assert.equal(mismatch.res.body.error, 'SOURCE_ERROR');
  assert.equal(mismatch.res.body.success, false);
  assert.equal(mismatch.res.body.data, undefined);
  assert.equal(JSON.stringify(mismatch.res.body).includes('中銀香港跨境服務讓賽'), false);
  assert.match(mismatch.logs.join('\n'), /date-mismatch/);

  const empty = await invoke(t,
    { type: 'official-results', date: '2026-11-23', venue: 'ST' },
    async () => textResponse(200, '<div>沒有相關資料。</div>')
  );
  assert.equal(empty.res.statusCode, 200);
  assert.equal(empty.res.body.success, true);
  assert.equal(empty.res.body.officialResults, true);
  assert.equal(empty.res.body.currentMeeting, false);
  assert.deepEqual(empty.res.body.data.races, []);
  assert.equal(empty.res.body.note, '此日期及馬場沒有已刊出的官方賽果');
});

test('invalid official results date or venue does not fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return textResponse(200, ST_FIXTURE); };
  const run = createHandler({ fetch: fetchImpl });
  const date = createRes();
  await run({ query: { type: 'official-results', date: '2026-02-31', venue: 'ST' } }, date);
  assert.equal(called, false);
  assert.equal(date.statusCode, 400);
  assert.deepEqual(date.body, { success: false, error: 'Invalid date' });

  const venue = createRes();
  await run({ query: { type: 'official-results', date: '2026-11-22', venue: 'S1' } }, venue);
  assert.equal(called, false);
  assert.equal(venue.statusCode, 400);
  assert.deepEqual(venue.body, { success: false, error: 'Invalid venue' });
});

test('loadOfficialResults returns the parsed meeting from the injected fetch', async () => {
  const result = await loadOfficialResults({
    date: '2026-11-22',
    venue: 'st',
    fetch: async (url, init) => {
      assert.equal(url, ST_RESULTS_URL);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Cookie, undefined);
      return textResponse(200, ST_FIXTURE);
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.meeting.races.length, 11);
  assert.equal(result.meeting.races[0].raceName_ch, '中銀香港跨境服務讓賽');
});
