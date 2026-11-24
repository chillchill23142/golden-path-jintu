// /api/races.js
import { RACE_MEETINGS_QUERY, WIN_POOL_QUERY } from './officialQueries.js';

const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const HEADERS = { 'Content-Type': 'application/json', 'Accept': '*/*', 'Origin': 'https://bet.hkjc.com', 'Referer': 'https://bet.hkjc.com/', 'User-Agent': 'Mozilla/5.0' };

// Stable client codes. Raw HKJC error text is written to server logs only.
// SOURCE_WHITELIST       — WHITELIST_ERROR / allowlist rejection
// SOURCE_INVALID_GRAPHQL — INVALID_GRAPHQL (document or operationName rejected)
// SOURCE_HTTP            — non-OK HTTP status without a more specific code
// SOURCE_ERROR           — other GraphQL errors, non-JSON bodies, or network failures
export const USER_FACING_MESSAGE = '暫時無法取得賽事資料';

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

function sendSourceFailure(res, code) {
  return res.status(502).json({
    success: false,
    error: code,
    message: USER_FACING_MESSAGE
  });
}

export function parseRaceNo(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) return null;
  return Number(text);
}

// WIN pools are kept only when the pool itself names this race.
// A pool for another raceNo is not reused.
export function winPoolForRace(pools, raceNo) {
  const target = parseRaceNo(raceNo);
  if (target == null) return null;
  const list = Array.isArray(pools) ? pools : [];
  for (const pool of list) {
    if (!pool || String(pool.oddsType || '').toUpperCase() !== 'WIN') continue;
    const races = pool.leg && pool.leg.races;
    if (Array.isArray(races) && races.length > 0) {
      if (races.some((n) => Number(n) === target)) return pool;
      continue;
    }
    if (pool.leg && pool.leg.number != null && pool.leg.number !== '' && Number(pool.leg.number) === target) {
      return pool;
    }
  }
  return null;
}

function meetingList(data) {
  const meetings = data && data.raceMeetings;
  return Array.isArray(meetings) ? meetings : [];
}

function sendCurrentMeetings(res, meetings) {
  return res.status(200).json({
    success: true,
    currentMeeting: true,
    data: meetings,
    note: meetings.length ? '當前會議' : '目前沒有當前會議'
  });
}

function predictFromNodes(nodes) {
  return nodes.map((n) => {
    const oddsVal = parseFloat(n.oddsValue) || 99;
    const prob = Math.min(95, Math.max(5, 100 / oddsVal * 1.2));
    return {
      horse: n.combString,
      odds: oddsVal,
      winProb: Math.round(prob * 10) / 10,
      confidence: oddsVal < 4 ? '高' : oddsVal < 8 ? '中' : '低'
    };
  }).sort((a, b) => b.winProb - a.winProb).slice(0, 5);
}

export function createHandler({ fetch: doFetch = globalThis.fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const { type = 'meetings', race = '1' } = req.query || {};

      // date and venue query params are intentionally ignored. The allowlisted
      // documents return the current meeting and do not filter by those values.
      if (type === 'meetings' || type === 'races') {
        const result = await gql(RACE_MEETINGS_QUERY, {}, doFetch);
        if (!result.ok) return sendSourceFailure(res, result.code);
        return sendCurrentMeetings(res, meetingList(result.data));
      }

      if (type === 'odds' || type === 'predict') {
        const raceNo = parseRaceNo(race);
        if (raceNo == null) return res.status(400).json({ success: false, error: 'Invalid race' });
        const result = await gql(WIN_POOL_QUERY, { oddsTypes: ['WIN'], raceNo }, doFetch);
        if (!result.ok) return sendSourceFailure(res, result.code);
        const pools = result.data?.raceMeetings?.[0]?.pmPools || [];
        const win = winPoolForRace(pools, raceNo);
        if (type === 'odds') {
          return res.status(200).json({
            success: true,
            currentMeeting: true,
            race: raceNo,
            data: win ? [win] : []
          });
        }
        const nodes = Array.isArray(win?.oddsNodes) ? win.oddsNodes : [];
        return res.status(200).json({
          success: true,
          currentMeeting: true,
          race: raceNo,
          predictions: predictFromNodes(nodes),
          model: 'Odds-based probability model'
        });
      }

      return res.status(400).json({ success: false, error: 'Invalid type' });
    } catch (error) {
      console.error('[api/races] unexpected', error);
      return res.status(500).json({ success: false, error: 'SOURCE_ERROR', message: USER_FACING_MESSAGE });
    }
  };
}

export default createHandler();
