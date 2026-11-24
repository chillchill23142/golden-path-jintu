import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import handler, {
  USER_FACING_MESSAGE,
  classifySourceFailure,
  createHandler,
  getPastDates,
  hongKongDate,
  operationNameFromQuery
} from '../api/races.js';

const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const EARLY_HKT = new Date('2026-11-21T17:30:00.000Z'); // 2026-11-22 01:30 Asia/Hong_Kong
const UTC_DATE = '2026-11-21';
const HK_DATE = '2026-11-22';

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

async function invoke(t, query, { fetchImpl, now = () => EARLY_HKT } = {}) {
  const logs = captureLogs(t);
  const calls = [];
  const wrapped = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return fetchImpl(url, init, calls);
  };
  const res = createRes();
  const run = createHandler({ fetch: wrapped, now });
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

test('hongKongDate is the Hong Kong calendar day during 00:00–07:59', () => {
  assert.equal(EARLY_HKT.toISOString().slice(0, 10), UTC_DATE);
  assert.equal(hongKongDate(new Date('2026-11-21T15:59:59.000Z')), '2026-11-21');
  assert.equal(hongKongDate(new Date('2026-11-21T16:00:00.000Z')), HK_DATE);
  assert.equal(hongKongDate(EARLY_HKT), HK_DATE);
  assert.equal(hongKongDate(new Date('2026-11-21T23:59:59.000Z')), HK_DATE);
  assert.equal(hongKongDate(new Date('2026-11-22T00:00:00.000Z')), HK_DATE);
});

test('getPastDates steps back on the Hong Kong calendar, including month and leap day', () => {
  assert.deepEqual(getPastDates(3, new Date('2026-02-28T16:30:00.000Z')), ['2026-03-01', '2026-02-28', '2026-02-27']);
  assert.deepEqual(getPastDates(2, new Date('2024-02-29T16:30:00.000Z')), ['2024-03-01', '2024-02-29']);
  assert.deepEqual(getPastDates(2, EARLY_HKT), [HK_DATE, UTC_DATE]);
});

test('operationName follows the query document or is omitted', () => {
  const odds = fs.readFileSync(new URL('../api/races.js', import.meta.url), 'utf8');
  assert.equal(operationNameFromQuery('query racing($date: String) { raceMeetings { id } }'), 'racing');
  assert.equal(operationNameFromQuery('query raceMeetings { id }'), 'raceMeetings');
  assert.equal(operationNameFromQuery('query { raceMeetings { id } }'), undefined);
  assert.match(odds, /query racing\(/);
  assert.match(odds, /query raceMeetings\(/);
  assert.doesNotMatch(odds, /operationName:\s*['"]raceMeetings['"]/);
  assert.doesNotMatch(odds, /toISOString\s*\(/);
});

test('WHITELIST_ERROR with empty data is success false, not an empty race list', async (t) => {
  const raw = 'ip 203.0.113.8 is not on the HKJC whitelist';
  const { res, calls, logs } = await invoke(t,
    { type: 'meetings' },
    {
      fetchImpl: async () => jsonResponse(200, {
        data: { activeMeetings: [], raceMeetings: [] },
        errors: [{ message: raw, extensions: { code: 'WHITELIST_ERROR' } }]
      })
    }
  );
  assert.equal(calls.length, 1);
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
    {
      fetchImpl: async () => jsonResponse(403, { message: raw })
    }
  );
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'SOURCE_WHITELIST');
  assertNoUpstreamLeak(res.body, raw);
});

test('INVALID_GRAPHQL on odds and predict keeps operationName racing', async (t) => {
  const raw = 'operationName raceMeetings does not match query racing';
  for (const type of ['odds', 'predict']) {
    const { res, calls } = await invoke(t,
      { type, race: '3', venue: 'HV' },
      {
        fetchImpl: async () => jsonResponse(200, {
          errors: [{ message: raw, extensions: { code: 'INVALID_GRAPHQL' } }]
        })
      }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GRAPHQL_URL);
    assert.equal(calls[0].body.operationName, 'racing');
    assert.match(calls[0].body.query, /^query racing\(/);
    assert.equal(calls[0].body.variables.date, HK_DATE);
    assert.equal(calls[0].body.variables.venueCode, 'HV');
    assert.equal(calls[0].body.variables.raceNo, 3);
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
    {
      fetchImpl: async () => jsonResponse(200, {
        errors: [{ message: raw, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }]
      })
    }
  );
  assert.equal(graphql.res.statusCode, 502);
  assert.equal(graphql.res.body.error, 'SOURCE_ERROR');
  assertNoUpstreamLeak(graphql.res.body, raw);

  const http = await invoke(t,
    { type: 'odds' },
    { fetchImpl: async () => jsonResponse(503, '<html>upstream unavailable secret-page</html>') }
  );
  assert.equal(http.res.body.error, 'SOURCE_HTTP');
  assertNoUpstreamLeak(http.res.body, 'secret-page');

  const network = await invoke(t,
    { type: 'predict' },
    { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND info.cld.hkjc.com'); } }
  );
  assert.equal(network.res.statusCode, 502);
  assert.equal(network.res.body.error, 'SOURCE_ERROR');
  assertNoUpstreamLeak(network.res.body, 'ENOTFOUND');
  assert.equal(JSON.stringify(network.res.body).includes('info.cld.hkjc.com'), false);
});

test('an actually empty upstream list is still success true', async (t) => {
  const { res, calls } = await invoke(t,
    { type: 'races', date: '2026-11-22', venue: 'ST' },
    { fetchImpl: async () => jsonResponse(200, { data: { raceMeetings: [] } }) }
  );
  assert.equal(calls.length, 1);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, data: [], date: '2026-11-22', venue: 'ST' });
});

test('meetings with no live card search recent Hong Kong dates and can be empty', async (t) => {
  const { res, calls } = await invoke(t,
    { type: 'meetings' },
    {
      fetchImpl: async (_url, _init, recorded) => {
        if (recorded.length === 1) return jsonResponse(200, { data: { activeMeetings: [] } });
        return jsonResponse(200, { data: { raceMeetings: [] } });
      }
    }
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, data: [], note: '目前沒有進行中的賽事' });
  const dated = calls.slice(1).map((call) => call.body.variables.date);
  assert.deepEqual(dated, [
    HK_DATE, HK_DATE,
    UTC_DATE, UTC_DATE,
    '2026-11-20', '2026-11-20',
    '2026-11-19', '2026-11-19',
    '2026-11-18', '2026-11-18'
  ]);
  assert.deepEqual(calls.slice(1).map((call) => call.body.variables.venueCode), ['ST', 'HV', 'ST', 'HV', 'ST', 'HV', 'ST', 'HV', 'ST', 'HV']);
  assert.ok(calls.every((call) => call.body.operationName === 'raceMeetings'));
});

test('a whitelist error during the past-date search does not become an empty success', async (t) => {
  const { res, calls } = await invoke(t,
    { type: 'meetings' },
    {
      fetchImpl: async (_url, _init, recorded) => {
        if (recorded.length === 1) return jsonResponse(200, { data: { activeMeetings: [] } });
        return jsonResponse(200, { errors: [{ extensions: { code: 'WHITELIST_ERROR' }, message: 'blocked' }] });
      }
    }
  );
  assert.equal(calls.length, 2);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'SOURCE_WHITELIST');
  assert.equal(res.body.success, false);
});

test('omitted race dates use Hong Kong and explicit dates pass through', async (t) => {
  for (const type of ['races', 'odds', 'predict']) {
    const omitted = await invoke(t,
      { type, venue: 'ST' },
      { fetchImpl: async () => jsonResponse(200, { data: { raceMeetings: [] } }) }
    );
    assert.equal(omitted.calls[0].body.variables.date, HK_DATE);
    if (type === 'races') assert.equal(omitted.res.body.date, HK_DATE);

    const explicit = await invoke(t,
      { type, date: '2026-01-15', venue: 'HV' },
      {
        now: () => new Date('2026-11-22T12:00:00.000Z'),
        fetchImpl: async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [] }] } })
      }
    );
    assert.equal(explicit.calls[0].body.variables.date, '2026-01-15');
    assert.equal(explicit.calls[0].body.variables.venueCode, 'HV');
  }
});

test('live meetings, odds, and predict still return upstream data', async (t) => {
  const live = await invoke(t,
    { type: 'meetings' },
    {
      fetchImpl: async () => jsonResponse(200, {
        data: { activeMeetings: [{ id: 'm1', venueCode: 'ST', date: HK_DATE, races: [{ no: 1 }] }] }
      })
    }
  );
  assert.equal(live.res.statusCode, 200);
  assert.equal(live.res.body.success, true);
  assert.equal(live.res.body.isLive, true);
  assert.equal(live.res.body.data[0].id, 'm1');

  const odds = await invoke(t,
    { type: 'odds', race: '1' },
    {
      fetchImpl: async () => jsonResponse(200, {
        data: { raceMeetings: [{ pmPools: [{ id: 'win', oddsNodes: [{ combString: '4', oddsValue: '2.5' }] }] }] }
      })
    }
  );
  assert.equal(odds.calls[0].body.operationName, 'racing');
  assert.deepEqual(odds.res.body.data[0].oddsNodes[0], { combString: '4', oddsValue: '2.5' });

  const predict = await invoke(t,
    { type: 'predict', race: '2' },
    {
      fetchImpl: async () => jsonResponse(200, {
        data: {
          raceMeetings: [{
            pmPools: [{
              oddsNodes: [
                { combString: '1', oddsValue: '3.5' },
                { combString: '7', oddsValue: '9.0' }
              ]
            }]
          }]
        }
      })
    }
  );
  assert.equal(predict.calls[0].body.operationName, 'racing');
  assert.equal(predict.res.body.success, true);
  assert.equal(predict.res.body.predictions.length, 2);
  assert.equal(predict.res.body.predictions[0].horse, '1');
});

test('invalid type does not call the source', async () => {
  let called = false;
  const res = createRes();
  await createHandler({
    fetch: async () => { called = true; return jsonResponse(200, { data: {} }); }
  })({ query: { type: 'nope' } }, res);
  assert.equal(called, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { success: false, error: 'Invalid type' });
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

test('frontend uses the Hong Kong calendar and separates source failures from empty lists', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /toISOString\s*\(/);
  assert.doesNotMatch(html, /!r\.success\s*\|\|/);
  assert.match(html, /timeZone:\s*'Asia\/Hong_Kong'/);
  assert.match(html, /hongKongDate\(\)/);
  assert.match(html, /sourceFailureHtml/);

  const match = html.match(/function hongKongDate\(date = new Date\(\)\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'frontend hongKongDate missing');
  const frontendHongKongDate = new Function(`${match[0]}; return hongKongDate;`)();
  for (const instant of ['2026-11-21T15:59:59.000Z', '2026-11-21T16:00:00.000Z', '2026-11-21T17:30:00.000Z', '2026-11-21T23:59:59.000Z', '2026-02-28T16:30:00.000Z']) {
    const date = new Date(instant);
    assert.equal(frontendHongKongDate(date), hongKongDate(date));
  }
});
