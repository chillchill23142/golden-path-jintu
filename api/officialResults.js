// Read-only fetch of the public official results page. This is not the
// allowlisted GraphQL client and must not replace current-meeting data.
const RESULTS_PAGE = 'https://racing.hkjc.com/zh-hk/local/information/resultsall';

const RESULTS_HEADERS = {
  Accept: 'text/html',
  'User-Agent': 'Mozilla/5.0'
};

const VENUE_LABEL = {
  ST: '沙田',
  HV: '跑馬地'
};

const LOCAL_RACE_RE = /<div class="bg_blue color_w f_fs13 font_wb">\s*第\s*(\d+)\s*場\s*<\/div>\s*<div>([\s\S]*?)<\/div>/g;

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
}

// Calendar date of a Hong Kong race meeting, YYYY-MM-DD. Not a UTC instant.
export function parseRaceCalendarDate(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return text;
}

export function parseVenueCode(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'ST' || text === 'HV') return text;
  return null;
}

export function officialResultsUrl(date, venue) {
  const calendar = parseRaceCalendarDate(date);
  const code = parseVenueCode(venue);
  if (!calendar || !code) return null;
  const racedate = calendar.replace(/-/g, '/');
  return `${RESULTS_PAGE}?Racecourse=${code}&racedate=${racedate}`;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function cellText(html) {
  const stripped = String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

function extractTable(html, className) {
  const marker = `class="${className}"`;
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const tableStart = html.lastIndexOf('<table', at);
  const tableEnd = html.indexOf('</table>', at);
  if (tableStart < 0 || tableEnd < 0) return '';
  return html.slice(tableStart, tableEnd + '</table>'.length);
}

function tableRows(tableHtml) {
  const bodyMatch = /<tbody>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  const scope = bodyMatch ? bodyMatch[1] : tableHtml;
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(scope))) {
    const cells = [];
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cell;
    while ((cell = cellRe.exec(row[1]))) cells.push(cellText(cell[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseDescription(html) {
  const detail = cellText(html);
  const parts = detail.split(' - ').map((part) => part.trim()).filter(Boolean);
  const raceName = parts.length ? parts[parts.length - 1] : detail;
  const distancePart = parts.find((part) => /^\d+米$/.test(part));
  const distance = distancePart ? Number(distancePart.slice(0, -1)) : null;
  const raceClass = parts.length > 1 ? parts[0] : '';
  return {
    raceName_ch: raceName,
    distance,
    raceClass_ch: raceClass,
    detail
  };
}

function parseRunners(tableHtml) {
  const runners = [];
  for (const cells of tableRows(tableHtml)) {
    if (cells.length < 7) continue;
    const no = /^[1-9]\d*$/.test(cells[1]) ? Number(cells[1]) : null;
    runners.push({
      position: cells[0],
      no,
      name_ch: cells[2],
      jockey_ch: cells[3],
      trainer_ch: cells[4],
      actualWeight: cells[5],
      barrier: cells[6]
    });
  }
  return runners;
}

function parseDividends(tableHtml) {
  const dividends = [];
  let pool = '';
  for (const cells of tableRows(tableHtml)) {
    if (cells[0] === '彩池' || cells.includes('勝出組合')) continue;
    let combination = '';
    let dividend = '';
    if (cells.length >= 3) {
      pool = cells[0];
      combination = cells[1];
      dividend = cells[2];
    } else if (cells.length === 2 && pool) {
      combination = cells[0];
      dividend = cells[1];
    } else {
      continue;
    }
    if (!pool || pool === '彩池') continue;
    dividends.push({ pool, combination, dividend });
  }
  return dividends;
}

export function pageMeetingDate(html) {
  const match = /賽事日期:?(?:\s|&nbsp;)*(\d{2})\/(\d{2})\/(\d{4})/.exec(String(html));
  if (!match) return null;
  const calendar = `${match[3]}-${match[2]}-${match[1]}`;
  return parseRaceCalendarDate(calendar);
}

export function pageVenueCode(html) {
  const source = String(html);
  const nav = /class="racingNum[\s\S]*?<\/table>/i.exec(source);
  const scope = nav ? nav[0] : '';
  if (!scope) return null;
  const hasShaTin = />\s*沙田\s*:/.test(scope);
  const hasHappyValley = />\s*跑馬地\s*:/.test(scope);
  if (hasShaTin && !hasHappyValley) return 'ST';
  if (hasHappyValley && !hasShaTin) return 'HV';
  return null;
}

function localRaceSlices(html) {
  const marks = [];
  const re = new RegExp(LOCAL_RACE_RE.source, 'g');
  let match;
  while ((match = re.exec(html))) {
    marks.push({ no: Number(match[1]), detailHtml: match[2], index: match.index, end: re.lastIndex });
  }
  return marks.map((mark, index) => {
    const nextAt = index + 1 < marks.length ? marks[index + 1].index : html.length;
    const overseasAt = html.indexOf('海外賽事', mark.end);
    const sliceEnd = overseasAt >= 0 && overseasAt < nextAt ? overseasAt : nextAt;
    return {
      no: mark.no,
      detailHtml: mark.detailHtml,
      slice: html.slice(mark.end, sliceEnd)
    };
  });
}

export function parseOfficialResultsHtml(html, { date, venue } = {}) {
  const calendar = parseRaceCalendarDate(date);
  const code = parseVenueCode(venue);
  const source = String(html ?? '');
  if (!calendar || !code) return { ok: false, reason: 'invalid-request' };

  const slices = localRaceSlices(source).filter((race) => Number.isInteger(race.no) && race.no > 0);
  if (!slices.length) {
    if (source.includes('沒有相關資料')) {
      return {
        ok: true,
        meeting: {
          date: calendar,
          venueCode: code,
          races: []
        }
      };
    }
    return { ok: false, reason: 'unrecognized' };
  }

  const pageDate = pageMeetingDate(source);
  const pageVenue = pageVenueCode(source);
  if (pageDate !== calendar) {
    return { ok: false, reason: 'date-mismatch', pageDate, pageVenue };
  }
  if (pageVenue !== code) {
    return { ok: false, reason: 'venue-mismatch', pageDate, pageVenue };
  }

  const races = slices.map((race) => {
    const described = parseDescription(race.detailHtml);
    const resultTable = extractTable(race.slice, 'f_fs13 f_tac result');
    const dividendTable = extractTable(race.slice, 'f_fs13 f_tac dividends');
    return {
      no: race.no,
      raceName_ch: described.raceName_ch,
      raceClass_ch: described.raceClass_ch,
      distance: described.distance,
      detail: described.detail,
      runners: parseRunners(resultTable),
      dividends: parseDividends(dividendTable)
    };
  });

  return {
    ok: true,
    meeting: {
      date: calendar,
      venueCode: code,
      venueLabel: VENUE_LABEL[code],
      races
    }
  };
}

export async function loadOfficialResults({ date, venue, fetch: doFetch = globalThis.fetch }) {
  const url = officialResultsUrl(date, venue);
  if (!url) return { ok: false, code: 'SOURCE_ERROR' };

  let response;
  try {
    response = await doFetch(url, { method: 'GET', headers: RESULTS_HEADERS });
  } catch (error) {
    console.error('[official-results] network failure', error);
    return { ok: false, code: 'SOURCE_ERROR' };
  }

  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    console.error('[official-results] unreadable body', response.status, error);
    return { ok: false, code: 'SOURCE_ERROR' };
  }

  if (!(response.status >= 200 && response.status < 300)) {
    const detail = String(text || '').slice(0, 500);
    console.error('[official-results] http', response.status, detail);
    return { ok: false, code: 'SOURCE_HTTP' };
  }

  const parsed = parseOfficialResultsHtml(text, { date, venue });
  if (!parsed.ok) {
    console.error('[official-results] parse', parsed.reason || 'unrecognized', 'requested', date, venue, 'page', parsed.pageDate || '', parsed.pageVenue || '');
    return { ok: false, code: 'SOURCE_ERROR' };
  }
  return { ok: true, meeting: parsed.meeting };
}
