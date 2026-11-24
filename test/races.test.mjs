import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';

import handler, {
  USER_FACING_MESSAGE,
  classifySourceFailure,
  createHandler,
  operationNameFromQuery,
  parseRaceNo,
  winPoolForRace
} from '../api/races.js';
import { RACE_MEETINGS_QUERY, WIN_POOL_QUERY } from '../api/officialQueries.js';

const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const MEETING_SHA = 'bbef8d3eb03bf9c59581e76140e8d3a7fed873b7e84a1a323b02b72f5ba736cb';
const POOL_SHA = 'c08a99ca7cb4f6115db4f23028c1e0fa9e19b2fed9afdf4c404e9c0fd40b2190';

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
      return typeof body === 'string' ? body : JSON.stringify(body);
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
  const wrapped = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return fetchImpl(url, init, calls);
  };
  const res = createRes();
  const run = createHandler({ fetch: wrapped });
  await run({ query }, res);
  return { res, calls, logs };
}

function assertNoUpstreamLeak(body, raw) {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(raw), false);
  assert.equal(body.message, USER_FACING_MESSAGE);
  assert.equal(body.success, false);
  assert.equal(body.data, undefined);
}

function meetingFixture({ date, venueCode, raceCount, id }) {
  return {
    id: id || `MTG_${date}_${venueCode}`,
    date,
    venueCode,
    status: 'DEFINED',
    totalNumberOfRace: raceCount,
    races: Array.from({ length: raceCount }, (_, index) => ({
      no: index + 1,
      raceName_ch: `賽事${index + 1}`,
      raceName_en: `RACE ${index + 1}`,
      postTime: `${date}T12:00:00+08:00`,
      distance: 1200 + index,
      status: 'DECLARED',
      runners: [
        {
          no: 1,
          name_ch: '測試馬',
          name_en: 'TEST HORSE',
          barrierDrawNumber: 4,
          handicapWeight: '126',
          status: 'Declared',
          jockey: { code: 'J1', name_ch: '騎師甲', name_en: 'Jockey A' },
          trainer: { code: 'T1', name_ch: '練馬師乙', name_en: 'Trainer B' }
        }
      ]
    }))
  };
}

function winPool(raceNo, nodes) {
  return {
    id: `POOL_WIN_${raceNo}`,
    oddsType: 'WIN',
    status: 'START_SELL',
    leg: { number: raceNo, races: [raceNo] },
    oddsNodes: nodes
  };
}

test('official query documents stay byte-for-byte and name the right operations', () => {
  assert.equal(createHash('sha256').update(RACE_MEETINGS_QUERY).digest('hex'), MEETING_SHA);
  assert.equal(createHash('sha256').update(WIN_POOL_QUERY).digest('hex'), POOL_SHA);
  assert.equal(RACE_MEETINGS_QUERY.length, 4497);
  assert.equal(WIN_POOL_QUERY.length, 1005);
  assert.equal(operationNameFromQuery(RACE_MEETINGS_QUERY), 'raceMeetings');
  assert.equal(operationNameFromQuery(WIN_POOL_QUERY), 'sp4e_racing_pmPool');
  assert.match(RACE_MEETINGS_QUERY, /fragment raceFragment on Race/);
  assert.match(RACE_MEETINGS_QUERY, /barrierDrawNumber/);
  assert.match(RACE_MEETINGS_QUERY, /handicapWeight/);
  assert.match(WIN_POOL_QUERY, /oddsNodes/);
  const source = fs.readFileSync(new URL('../api/races.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /operationName:\s*['"]raceMeetings['"]/);
  assert.doesNotMatch(source, /2026-11-25/);
  assert.doesNotMatch(source, /紅松鼠/);
  assert.doesNotMatch(source, /getPastDates/);
  assert.doesNotMatch(source, /venue\s*=\s*['"](?:ST|HV)['"]/);
});

test('current meeting mapping follows the payload, not a requested or hardcoded date and venue', async (t) => {
  const card = meetingFixture({ date: '2026-12-20', venueCode: 'ST', raceCount: 11, id: 'MTG_FIXTURE_11' });
  for (const type of ['meetings', 'races']) {
    const { res, calls } = await invoke(t,
      { type, date: '2026-11-22', venue: 'HV' },
      async () => jsonResponse(200, { data: { raceMeetings: [card], activeMeetings: [{ id: 'OTHER', date: '1999-01-01', venueCode: 'HV' }] } })
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPHQL_URL);
    assert.equal(calls[0].body.operationName, 'raceMeetings');
    assert.equal(calls[0].body.query, RACE_MEETINGS_QUERY);
    assert.deepEqual(calls[0].body.variables, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.currentMeeting, true);
    assert.equal(res.body.note, '當前會議');
    assert.equal(res.body.date, undefined);
    assert.equal(res.body.venue, undefined);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, 'MTG_FIXTURE_11');
    assert.equal(res.body.data[0].date, '2026-12-20');
    assert.equal(res.body.data[0].venueCode, 'ST');
    assert.equal(res.body.data[0].races.length, 11);
    assert.deepEqual(res.body.data[0].races.map((race) => race.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const body = JSON.stringify(res.body);
    assert.equal(body.includes('2026-11-22'), false);
    assert.equal(body.includes('2026-11-25'), false);
    assert.equal(body.includes('紅松鼠'), false);
    assert.equal(body.includes('1999-01-01'), false);
  }
});

test('race count follows the races actually returned', async (t) => {
  const shortCard = meetingFixture({ date: '2024-01-03', venueCode: 'HV', raceCount: 2, id: 'MTG_SHORT' });
  const { res, calls } = await invoke(t,
    { type: 'meetings' },
    async () => jsonResponse(200, { data: { raceMeetings: [shortCard] } })
  );
  assert.equal(calls.length, 1);
  assert.equal(res.body.data[0].races.length, 2);
  assert.deepEqual(res.body.data[0].races.map((race) => race.no), [1, 2]);
  assert.equal(res.body.data[0].date, '2024-01-03');
  assert.equal(res.body.data[0].venueCode, 'HV');
  assert.notEqual(res.body.data[0].races.length, 5);
  assert.notEqual(res.body.data[0].races.length, 9);
});

test('an actually empty current meeting is success true and does not search other dates', async (t) => {
  const { res, calls } = await invoke(t,
    { type: 'races', date: '2026-11-22', venue: 'ST' },
    async () => jsonResponse(200, { data: { raceMeetings: [] } })
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.variables, {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, currentMeeting: true, data: [], note: '目前沒有當前會議' });

  const missing = await invoke(t,
    { type: 'meetings' },
    async () => jsonResponse(200, { data: { raceMeetings: null } })
  );
  assert.equal(missing.calls.length, 1);
  assert.equal(missing.res.body.success, true);
  assert.deepEqual(missing.res.body.data, []);
});

test('WIN odds are associated by raceNo and a different race is not reused', async (t) => {
  const raceOne = winPool(1, [{ combString: '01', oddsValue: '25' }]);
  const raceTwo = winPool(2, [{ combString: '02', oddsValue: '4.6' }, { combString: '01', oddsValue: '3.0' }]);
  const place = { id: 'PLA2', oddsType: 'PLA', leg: { number: 2, races: [2] }, oddsNodes: [{ combString: '01', oddsValue: '1.5' }] };
  const { res, calls } = await invoke(t,
    { type: 'odds', race: '2', date: '2026-11-22', venue: 'ST', odds: 'PLA' },
    async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [place, raceOne, raceTwo] }] } })
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.operationName, 'sp4e_racing_pmPool');
  assert.equal(calls[0].body.query, WIN_POOL_QUERY);
  assert.deepEqual(calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 2 });
  assert.equal(calls[0].body.variables.date, undefined);
  assert.equal(calls[0].body.variables.venueCode, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.currentMeeting, true);
  assert.equal(res.body.race, 2);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].id, 'POOL_WIN_2');
  assert.deepEqual(res.body.data[0].oddsNodes[0], { combString: '02', oddsValue: '4.6' });
  assert.equal(JSON.stringify(res.body).includes('2026-11-22'), false);
  assert.equal(JSON.stringify(res.body).includes('PLA2'), false);

  const mismatched = await invoke(t,
    { type: 'odds', race: '9' },
    async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [raceOne] }] } })
  );
  assert.equal(mismatched.calls[0].body.variables.raceNo, 9);
  assert.deepEqual(mismatched.res.body, { success: true, currentMeeting: true, race: 9, data: [] });

  const ninth = winPool(9, [{ combString: '01', oddsValue: '19' }]);
  const raceNine = await invoke(t,
    { type: 'odds', race: '9' },
    async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [ninth] }] } })
  );
  assert.equal(raceNine.res.body.data[0].id, 'POOL_WIN_9');
  assert.equal(raceNine.res.body.race, 9);
});

test('predict uses the WIN pool for the requested raceNo only', async (t) => {
  const { res, calls } = await invoke(t,
    { type: 'predict', race: '4', date: '2099-01-01', venue: 'XX' },
    async () => jsonResponse(200, {
      data: {
        raceMeetings: [{
          pmPools: [
            winPool(1, [{ combString: '01', oddsValue: '2.0' }]),
            winPool(4, [
              { combString: '07', oddsValue: '9.0' },
              { combString: '01', oddsValue: '3.5' }
            ])
          ]
        }]
      }
    })
  );
  assert.equal(calls[0].body.operationName, 'sp4e_racing_pmPool');
  assert.deepEqual(calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 4 });
  assert.equal(res.body.success, true);
  assert.equal(res.body.currentMeeting, true);
  assert.equal(res.body.race, 4);
  assert.equal(res.body.predictions.length, 2);
  assert.equal(res.body.predictions[0].horse, '01');
  assert.equal(res.body.predictions[0].odds, 3.5);

  const wrongRace = await invoke(t,
    { type: 'predict', race: '4' },
    async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [winPool(3, [{ combString: '01', oddsValue: '2.0' }])] }] } })
  );
  assert.deepEqual(wrongRace.res.body.predictions, []);
  assert.equal(wrongRace.res.body.success, true);
});

test('winPoolForRace matches leg.races, then leg.number, and ignores other pools', () => {
  const pools = [
    { oddsType: 'WIN', leg: { races: [1] }, id: 'r1' },
    { oddsType: 'PLA', leg: { races: [2] }, id: 'pla' },
    { oddsType: 'WIN', leg: { number: 8 }, id: 'by-number' },
    { oddsType: 'WIN', id: 'no-leg' }
  ];
  assert.equal(winPoolForRace(pools, 1).id, 'r1');
  assert.equal(winPoolForRace(pools, '2'), null);
  assert.equal(winPoolForRace(pools, 8).id, 'by-number');
  assert.equal(winPoolForRace(pools, 9), null);
  assert.equal(parseRaceNo('0'), null);
  assert.equal(parseRaceNo('1a'), null);
  assert.equal(parseRaceNo(3), 3);
});

test('WHITELIST_ERROR with empty data is success false, not an empty race list', async (t) => {
  const raw = 'ip 203.0.113.8 is not on the HKJC whitelist';
  const { res, calls, logs } = await invoke(t,
    { type: 'meetings' },
    async () => jsonResponse(200, {
      data: { activeMeetings: [], raceMeetings: [] },
      errors: [{ message: raw, extensions: { code: 'WHITELIST_ERROR' } }]
    })
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.query, RACE_MEETINGS_QUERY);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'SOURCE_WHITELIST');
  assert.notEqual(res.body.success, true);
  assertNoUpstreamLeak(res.body, raw);
  assert.equal(calls[0].body.operationName, 'raceMeetings');
  assert.match(logs.join('\n'), /203\.0\.113\.8/);
});

test('HTTP 403 whitelist body is SOURCE_WHITELIST and is not echoed', async (t) => {
  const raw = 'WHITELIST_ERROR: origin rejected by allowlist policy';
  const { res } = await invoke(t,
    { type: 'races', date: '2026-11-22', venue: 'ST' },
    async () => jsonResponse(403, { message: raw })
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'SOURCE_WHITELIST');
  assertNoUpstreamLeak(res.body, raw);
});

test('INVALID_GRAPHQL on odds and predict keeps operationName sp4e_racing_pmPool', async (t) => {
  const raw = 'operationName raceMeetings does not match query sp4e_racing_pmPool';
  for (const type of ['odds', 'predict']) {
    const { res, calls } = await invoke(t,
      { type, race: '3', venue: 'HV', date: '2026-11-22' },
      async () => jsonResponse(200, {
        errors: [{ message: raw, extensions: { code: 'INVALID_GRAPHQL' } }]
      })
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPHQL_URL);
    assert.equal(calls[0].body.operationName, 'sp4e_racing_pmPool');
    assert.equal(calls[0].body.query, WIN_POOL_QUERY);
    assert.deepEqual(calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 3 });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'SOURCE_INVALID_GRAPHQL');
    assertNoUpstreamLeak(res.body, raw);
    assert.equal(JSON.stringify(res.body).includes('raceMeetings'), false);
  }
});

test('other GraphQL and HTTP failures use stable codes without raw text', async (t) => {
  const raw = 'Cannot query field secretInternal on type Race';
  const graphql = await invoke(t,
    { type: 'races' },
    async () => jsonResponse(200, {
      errors: [{ message: raw, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }]
    })
  );
  assert.equal(graphql.res.statusCode, 502);
  assert.equal(graphql.res.body.error, 'SOURCE_ERROR');
  assertNoUpstreamLeak(graphql.res.body, raw);

  const http = await invoke(t,
    { type: 'odds' },
    async () => jsonResponse(503, '<html>upstream unavailable secret-page</html>')
  );
  assert.equal(http.res.body.error, 'SOURCE_HTTP');
  assertNoUpstreamLeak(http.res.body, 'secret-page');

  const network = await invoke(t,
    { type: 'predict' },
    async () => { throw new Error('getaddrinfo ENOTFOUND info.cld.hkjc.com'); }
  );
  assert.equal(network.res.statusCode, 502);
  assert.equal(network.res.body.error, 'SOURCE_ERROR');
  assertNoUpstreamLeak(network.res.body, 'ENOTFOUND');
  assert.equal(JSON.stringify(network.res.body).includes('info.cld.hkjc.com'), false);
});

test('invalid type or race does not call the source', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse(200, { data: {} }); };
  const res = createRes();
  await createHandler({ fetch: fetchImpl })({ query: { type: 'nope' } }, res);
  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { success: false, error: 'Invalid type' });

  const race = createRes();
  await createHandler({ fetch: fetchImpl })({ query: { type: 'odds', race: '0' } }, race);
  assert.equal(called, false);
  assert.equal(race.statusCode, 400);
  assert.deepEqual(race.body, { success: false, error: 'Invalid race' });
});

test('classifySourceFailure prefers specific codes over HTTP status', () => {
  assert.equal(classifySourceFailure(403, { errors: [{ message: 'Invalid GraphQL operation' }] }), 'SOURCE_INVALID_GRAPHQL');
  assert.equal(classifySourceFailure(200, { error: { code: 'whitelist_error' } }), 'SOURCE_WHITELIST');
  assert.equal(classifySourceFailure(500, { message: 'bad gateway' }), 'SOURCE_HTTP');
  assert.equal(classifySourceFailure(200, { data: null }), 'SOURCE_ERROR');
});

test('default handler is the Vercel function', () => {
  assert.equal(typeof handler, 'function');
});

test('frontend presents the current meeting, dynamic race numbers, and source failures', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /toISOString\s*\(/);
  assert.doesNotMatch(html, /!r\.success\s*\|\|/);
  assert.doesNotMatch(html, /<option value="1">/);
  assert.doesNotMatch(html, /type="date"/);
  assert.doesNotMatch(html, /歷史賽果/);
  assert.doesNotMatch(html, /2026-11-25/);
  assert.doesNotMatch(html, /紅松鼠/);
  assert.match(html, /當前會議/);
  assert.match(html, /不能按日期或馬場查詢其他賽事/);
  assert.match(html, /獨贏/);
  assert.match(html, /sourceFailureHtml/);
  assert.match(html, /timeZone:\s*'Asia\/Hong_Kong'/);
  assert.match(html, /raceOptionValues/);

  const block = html.slice(html.indexOf('// pure-start'), html.indexOf('// pure-end'));
  const pure = new Function(`${block}; return { raceOptionValues, currentMeetingHeading, formatHongKongTime, oddsForRunner };`)();
  const eleven = Array.from({ length: 11 }, (_, index) => ({ no: index + 1 }));
  assert.deepEqual(pure.raceOptionValues({ totalNumberOfRace: 9, races: [] }), []);
  assert.deepEqual(pure.raceOptionValues({ totalNumberOfRace: 5 }), []);
  assert.equal(pure.raceOptionValues({ races: eleven }).length, 11);
  assert.deepEqual(pure.raceOptionValues({ races: [{ no: 1 }, { no: 2 }] }), ['1', '2']);
  assert.equal(
    pure.currentMeetingHeading({ date: '2026-12-20', venueCode: 'ST', races: eleven }),
    '當前會議 · 沙田 · 2026-12-20 · 11 場'
  );
  assert.equal(
    pure.currentMeetingHeading({ date: '2024-01-03', venueCode: 'HV', races: [{ no: 1 }, { no: 2 }] }),
    '當前會議 · 跑馬地 · 2024-01-03 · 2 場'
  );
  assert.equal(pure.currentMeetingHeading(null), '當前會議');
  assert.equal(pure.currentMeetingHeading({ date: '2026-12-20', venueCode: 'ST', races: eleven }).includes('2026-11-25'), false);
  assert.equal(pure.formatHongKongTime('2026-11-25T18:40:00+08:00'), '18:40');
  assert.equal(pure.formatHongKongTime('2026-11-25T10:40:00Z'), '18:40');
  assert.equal(pure.oddsForRunner([{ combString: '01', oddsValue: '25' }, { combString: '02', oddsValue: '8.8' }], 1), '25');
  assert.equal(pure.oddsForRunner([{ combString: '01', oddsValue: '25' }], 2), '');
});
