// /api/races.js
const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const HEADERS = { 'Content-Type': 'application/json', 'Accept': '*/*', 'Origin': 'https://bet.hkjc.com', 'Referer': 'https://bet.hkjc.com/', 'User-Agent': 'Mozilla/5.0' };

// Stable client codes. Raw HKJC error text is written to server logs only.
// SOURCE_WHITELIST       — WHITELIST_ERROR / allowlist rejection
// SOURCE_INVALID_GRAPHQL — INVALID_GRAPHQL (document or operationName rejected)
// SOURCE_HTTP            — non-OK HTTP status without a more specific code
// SOURCE_ERROR           — other GraphQL errors, non-JSON bodies, or network failures
export const USER_FACING_MESSAGE = '暫時無法取得賽事資料';

const RACE_MEETINGS_QUERY = `query raceMeetings($date: String, $venueCode: String) {
  timeOffset { rc }
  activeMeetings: raceMeetings {
    id venueCode date status
    races { no postTime status wageringFieldSize }
  }
  raceMeetings(date: $date, venueCode: $venueCode) {
    id status venueCode date totalNumberOfRace
    races {
      no status postTime distance
      runners {
        id no status name_ch name_en
        barrierDrawNumber handicapWeight currentRating last6run winOdds
        jockey { code name_ch name_en }
        trainer { code name_ch name_en }
      }
    }
  }
}`;

const ODDS_QUERY = `query racing($date: String, $venueCode: String, $oddsTypes: [OddsType], $raceNo: Int) {
  raceMeetings(date: $date, venueCode: $venueCode) {
    pmPools(oddsTypes: $oddsTypes, raceNo: $raceNo) {
      id oddsType status
      oddsNodes { combString oddsValue hotFavourite }
    }
  }
}`;

export function operationNameFromQuery(query) {
  const match = /(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/.exec(String(query));
  return match ? match[1] : undefined;
}

function normalizeToken(value) {
  return String(value).toUpperCase().replace(/[\s-]+/g, '_');
}

function graphqlErrors(json) {
  if (!json || json.errors == null) return [];
  return Array.isArray(json.errors) ? json.errors : [json.errors];
}

function pushToken(tokens, value) {
  if (typeof value === 'string' || typeof value === 'number') tokens.push(String(value));
}

function collectErrorTokens(json) {
  const tokens = [];
  if (!json || typeof json !== 'object') return tokens;
  for (const err of graphqlErrors(json)) {
    if (err == null) continue;
    if (typeof err === 'string' || typeof err === 'number') {
      pushToken(tokens, err);
      continue;
    }
    if (typeof err !== 'object') continue;
    pushToken(tokens, err.message);
    pushToken(tokens, err.code);
    pushToken(tokens, err.errorCode);
    const ext = err.extensions;
    if (ext && typeof ext === 'object') {
      pushToken(tokens, ext.code);
      pushToken(tokens, ext.errorCode);
      pushToken(tokens, ext.classification);
    }
  }
  pushToken(tokens, json.code);
  pushToken(tokens, json.message);
  if (typeof json.error === 'string' || typeof json.error === 'number') pushToken(tokens, json.error);
  else if (json.error && typeof json.error === 'object') {
    pushToken(tokens, json.error.code);
    pushToken(tokens, json.error.message);
    pushToken(tokens, json.error.errorCode);
  }
  return tokens;
}

export function classifySourceFailure(status, json) {
  const normalized = collectErrorTokens(json).map(normalizeToken);
  if (normalized.some((token) => token.includes('WHITELIST'))) return 'SOURCE_WHITELIST';
  if (normalized.some((token) => token.includes('INVALID_GRAPHQL'))) return 'SOURCE_INVALID_GRAPHQL';
  if (!(status >= 200 && status < 300)) return 'SOURCE_HTTP';
  return 'SOURCE_ERROR';
}

function isSourceFailure(status, json) {
  if (!(status >= 200 && status < 300)) return true;
  if (!json || typeof json !== 'object') return true;
  if (graphqlErrors(json).length > 0) return true;
  if (json.error != null) return true;
  if (json.data == null) return true;
  if (typeof json.code === 'string' && /WHITELIST|INVALID_GRAPHQL/i.test(json.code)) return true;
  return false;
}

function logSourceFailure(code, status, json) {
  const payload = json && typeof json === 'object' ? (json.errors ?? json.error ?? json.message ?? json.code ?? null) : json;
  let detail = '';
  try {
    detail = JSON.stringify(payload);
  } catch {
    detail = '[unserializable]';
  }
  if (detail.length > 800) detail = detail.slice(0, 800);
  console.error('[gql] source failure', code, 'http', status, detail);
}

function sourceFailure(code) {
  return { ok: false, code };
}

async function gql(query, variables = {}, doFetch = globalThis.fetch) {
  const operationName = operationNameFromQuery(query);
  const payload = { query, variables };
  if (operationName) payload.operationName = operationName;

  let response;
  try {
    response = await doFetch(GRAPHQL_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('[gql] network failure', error);
    return sourceFailure('SOURCE_ERROR');
  }

  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    console.error('[gql] unreadable body', response.status, error);
    return sourceFailure('SOURCE_ERROR');
  }

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      console.error('[gql] non-json body', response.status, text.slice(0, 500));
      return sourceFailure(response.ok ? 'SOURCE_ERROR' : 'SOURCE_HTTP');
    }
  }

  if (!isSourceFailure(response.status, json)) {
    return { ok: true, data: json.data };
  }

  const code = classifySourceFailure(response.status, json);
  logSourceFailure(code, response.status, json);
  return sourceFailure(code);
}

// Asia/Hong_Kong calendar day. A UTC date is still the previous day during 00:00–07:59 HKT.
export function hongKongDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) throw new Error('Unable to format Asia/Hong_Kong date');
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(isoDate, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error('Invalid calendar date');
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPastDates(days = 7, now = new Date()) {
  const today = hongKongDate(now);
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(shiftIsoDate(today, -i));
  return dates;
}

function raceCalendarDate(requested, now) {
  if (typeof requested === 'string' && requested.trim()) return requested.trim();
  return hongKongDate(now);
}

function sendSourceFailure(res, code) {
  return res.status(502).json({
    success: false,
    error: code,
    message: USER_FACING_MESSAGE
  });
}

export function createHandler({ fetch: doFetch = globalThis.fetch, now = () => new Date() } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const { type = 'meetings', race = '1', odds = 'WIN', date, venue = 'ST' } = req.query || {};

      if (type === 'meetings') {
        const activeResult = await gql(RACE_MEETINGS_QUERY, {}, doFetch);
        if (!activeResult.ok) return sendSourceFailure(res, activeResult.code);
        const active = activeResult.data.activeMeetings || [];
        if (active.length) {
          return res.status(200).json({ success: true, data: active, isLive: true });
        }
        const pastDates = getPastDates(5, now());
        for (const d of pastDates) {
          for (const v of ['ST', 'HV']) {
            const past = await gql(RACE_MEETINGS_QUERY, { date: d, venueCode: v }, doFetch);
            if (!past.ok) return sendSourceFailure(res, past.code);
            const meetings = past.data.raceMeetings || [];
            if (meetings.length && meetings[0].races?.length) {
              return res.status(200).json({ success: true, data: meetings, isLive: false, note: `顯示最近賽事 (${d})` });
            }
          }
        }
        return res.status(200).json({ success: true, data: [], note: '目前沒有進行中的賽事' });
      }

      if (type === 'races') {
        const today = raceCalendarDate(date, now());
        const result = await gql(RACE_MEETINGS_QUERY, { date: today, venueCode: venue }, doFetch);
        if (!result.ok) return sendSourceFailure(res, result.code);
        return res.status(200).json({ success: true, data: result.data.raceMeetings || [], date: today, venue });
      }

      if (type === 'odds') {
        const today = raceCalendarDate(date, now());
        const result = await gql(ODDS_QUERY, { date: today, venueCode: venue, oddsTypes: odds.split(','), raceNo: parseInt(race) }, doFetch);
        if (!result.ok) return sendSourceFailure(res, result.code);
        return res.status(200).json({ success: true, data: result.data.raceMeetings?.[0]?.pmPools || [] });
      }

      if (type === 'predict') {
        const today = raceCalendarDate(date, now());
        const oddsData = await gql(ODDS_QUERY, { date: today, venueCode: venue, oddsTypes: ['WIN'], raceNo: parseInt(race) }, doFetch);
        if (!oddsData.ok) return sendSourceFailure(res, oddsData.code);
        const nodes = oddsData.data.raceMeetings?.[0]?.pmPools?.[0]?.oddsNodes || [];
        const predictions = nodes.map(n => {
          const oddsVal = parseFloat(n.oddsValue) || 99;
          const prob = Math.min(95, Math.max(5, 100 / oddsVal * 1.2));
          return { horse: n.combString, odds: oddsVal, winProb: Math.round(prob * 10) / 10, confidence: oddsVal < 4 ? '高' : oddsVal < 8 ? '中' : '低' };
        }).sort((a, b) => b.winProb - a.winProb).slice(0, 5);
        return res.status(200).json({ success: true, race: parseInt(race), predictions, model: 'Odds-based probability model' });
      }

      return res.status(400).json({ success: false, error: 'Invalid type' });
    } catch (error) {
      console.error('[api/races] unexpected', error);
      return res.status(500).json({ success: false, error: 'SOURCE_ERROR', message: USER_FACING_MESSAGE });
    }
  };
}

export default createHandler();
