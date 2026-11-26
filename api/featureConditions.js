// Feature-condition index for the current meeting. Not an odds model.
// GP_FEATURE_CONDITIONS is off unless the environment value is exactly the string "1".
// The numbers below are unmeasured implementation defaults. They are not fitted
// to results, not a calibration, and not approval to enable the flag.
// 未經量度的實作預設，不是校準結果，亦不是上線核准。
// WIN and PLA odds are not a condition and not a baseline. A missing feature adds nothing.
// Running style stays missing until a pre-race official class exists. In-running
// text is not stored as that class and is not turned into one.

import { parseRaceCalendarDate, parseVenueCode } from './officialResults.js';

export const FEATURE_CONDITION_DEFAULTS = Object.freeze({
  neutralIndex: 16,
  barrierPointsPerDraw: 0.08,
  barrierReferenceDraw: 9,
  barrierMaxAbs: 0.8,
  handicapPointsPerPound: 0.03,
  handicapReferencePounds: 118,
  handicapMaxAbs: 0.9,
  totalMaxAbs: 1.2,
  trackPoints: 0,
  distancePoints: 0,
  goingPoints: 0,
  morningWorkPoints: 0,
  trialPoints: 0,
  gearPoints: 0,
  injuryPoints: 0,
  runningStylePoints: 0,
  pairingPoints: 0,
  weightPoints: 0
});

export const FEATURE_CONDITIONS_MODEL = 'Unmeasured feature conditions (no odds baseline)';
export const FEATURE_CONDITION_COEFFICIENT_BASIS = 'unmeasured-defaults';

const BARRIER_PER = Math.round(FEATURE_CONDITION_DEFAULTS.barrierPointsPerDraw * 100);
const BARRIER_MAX = Math.round(FEATURE_CONDITION_DEFAULTS.barrierMaxAbs * 100);
const HANDICAP_PER = Math.round(FEATURE_CONDITION_DEFAULTS.handicapPointsPerPound * 100);
const HANDICAP_MAX = Math.round(FEATURE_CONDITION_DEFAULTS.handicapMaxAbs * 100);
const TOTAL_MAX = Math.round(FEATURE_CONDITION_DEFAULTS.totalMaxAbs * 100);
const NEUTRAL = Math.round(FEATURE_CONDITION_DEFAULTS.neutralIndex * 100);

const ORIGIN = 'https://racing.hkjc.com';
const HTML_HEADERS = Object.freeze({
  Accept: 'text/html',
  'User-Agent': 'Mozilla/5.0'
});

const HISTORY_KINDS = new Set([
  '快操',
  '踱步',
  '游水',
  '游泳',
  '跑步機',
  '馬匹跑步機',
  '水中步行機',
  '馬匹水中步行機',
  '休歇'
]);

const IDENTITY_KEYS = ['racedate', 'Racecourse', 'RaceNo', 'Date', 'horseid'];

export function isFeatureConditionsEnabled(env = process.env) {
  return !!env && env.GP_FEATURE_CONDITIONS === '1';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function ymd(year, month, day) {
  return parseRaceCalendarDate(`${year}-${pad2(month)}-${pad2(day)}`);
}

function venueLabelToCode(label) {
  if (label === '沙田') return 'ST';
  if (label === '跑馬地') return 'HV';
  return null;
}

export function meetingCalendarDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const pure = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (pure) return parseRaceCalendarDate(text);
  const slash = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (slash) return parseRaceCalendarDate(`${slash[1]}-${slash[2]}-${slash[3]}`);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const instant = Date.parse(text);
  if (Number.isNaN(instant)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(instant));
  const get = (type) => {
    const part = parts.find((item) => item.type === type);
    return part ? part.value : '';
  };
  return parseRaceCalendarDate(`${get('year')}-${get('month')}-${get('day')}`);
}

export function currentMeetingKey(meeting) {
  if (!meeting || typeof meeting !== 'object') return null;
  const date = meetingCalendarDate(meeting.date);
  const venue = parseVenueCode(meeting.venueCode);
  if (!date || !venue) return null;
  return { date, venue };
}

function positiveInteger(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) return null;
    return value;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function positiveFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readableText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function readableGear(value) {
  const text = readableText(value);
  return text === '' ? null : text;
}

function trimmedCode(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

export function horseCode(runner) {
  const code = runner && runner.horse && typeof runner.horse === 'object' ? runner.horse.code : undefined;
  const text = trimmedCode(code);
  if (text == null || !/^HK_\d{4}_[A-Z0-9]+$/.test(text)) return null;
  return text;
}

export function brandFromHorseCode(code) {
  const text = trimmedCode(code);
  if (text == null) return null;
  const match = /^HK_\d{4}_([A-Z]\d{3})$/.exec(text);
  return match ? match[1] : null;
}

export function jockeyTrainerPair(jockey, trainer) {
  const jockeyCode = trimmedCode(jockey && typeof jockey === 'object' ? jockey.code : undefined);
  const trainerCode = trimmedCode(trainer && typeof trainer === 'object' ? trainer.code : undefined);
  if (jockeyCode == null || trainerCode == null) return null;
  const text = jockeyCode.includes('|') || trainerCode.includes('|') ? null : `${jockeyCode}|${trainerCode}`;
  return { jockeyCode, trainerCode, text };
}

function decodeEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function cellText(html) {
  return decodeEntities(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linesFromHtml(html) {
  const raw = decodeEntities(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? lines : null;
}

function observationText(html) {
  const withoutClips = String(html).replace(/<a\b[^>]*videoplayer[^>]*>[\s\S]*?<\/a>/gi, '');
  return cellText(withoutClips);
}

function rowHtmlList(tableHtml) {
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = re.exec(tableHtml))) rows.push(match[1]);
  return rows;
}

function rowCells(rowHtml) {
  const cells = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = re.exec(rowHtml))) cells.push({ attrs: match[1], html: match[2] });
  return cells;
}

function classTokens(attrs) {
  const match = /class="([^"]*)"/.exec(attrs || '');
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

function cellByClass(cells, token) {
  return cells.find((cell) => classTokens(cell.attrs).includes(token)) || null;
}

function extractBalanced(html, start) {
  const re = /<\/?table\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  return '';
}

function tablesContaining(html, marker) {
  const found = [];
  const source = String(html ?? '');
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(marker, from);
    if (at < 0) break;
    const start = source.lastIndexOf('<table', at);
    if (start < 0) {
      from = at + marker.length;
      continue;
    }
    const table = extractBalanced(source, start);
    if (!table) break;
    if (!found.some((item) => item.start === start)) found.push({ start, html: table });
    from = start + table.length;
  }
  return found;
}

function horseIdFrom(html) {
  const match = /horseid=(HK_\d{4}_[A-Z0-9]+)/.exec(String(html));
  return match ? match[1] : null;
}

function brandFromText(text) {
  const match = /^[A-Z]\d{3}$/.exec(String(text || '').trim());
  return match ? match[0] : null;
}

function passedDate(text) {
  const value = String(text || '').trim();
  if (value === '' || value === '-') return null;
  return value;
}

function rowIsBold(rowHtml) {
  return /<b\b|<strong\b|font-weight:\s*bold/i.test(rowHtml);
}

function readRacePageIdentity(html) {
  const source = String(html ?? '');
  const header = /(\d{4})年(\d{1,2})月(\d{1,2})日,\s*星期[一二三四五六日],\s*(沙田|跑馬地)/.exec(source);
  if (!header) return null;
  const date = ymd(header[1], header[2], header[3]);
  const venue = venueLabelToCode(header[4]);
  if (!date || !venue) return null;
  const title = /class="blueBtn1">\s*(\d{1,2})月(\d{1,2})日\s*-\s*(沙田|跑馬地)/.exec(source);
  if (title) {
    const titleVenue = venueLabelToCode(title[3]);
    const month = Number(date.slice(5, 7));
    const day = Number(date.slice(8, 10));
    if (titleVenue !== venue || Number(title[1]) !== month || Number(title[2]) !== day) {
      return { conflict: true, date, venue, titleVenue };
    }
  }
  const before = source.slice(Math.max(0, header.index - 180), header.index);
  const races = [...before.matchAll(/第\s*(\d+)\s*場/g)];
  if (!races.length) return null;
  const raceNo = Number(races[races.length - 1][1]);
  if (!Number.isInteger(raceNo) || raceNo < 1) return null;
  return { date, venue, raceNo };
}

function requireRacePage(html, expected) {
  const identity = readRacePageIdentity(html);
  if (!identity) return { ok: false, reason: 'unrecognized' };
  if (identity.conflict) return { ok: false, reason: 'date-mismatch', pageDate: identity.date || '', pageVenue: identity.venue || '' };
  if (identity.date !== expected.date) return { ok: false, reason: 'date-mismatch', pageDate: identity.date, pageVenue: identity.venue };
  if (identity.venue !== expected.venue) return { ok: false, reason: 'venue-mismatch', pageDate: identity.date, pageVenue: identity.venue };
  if (identity.raceNo !== expected.raceNo) return { ok: false, reason: 'race-mismatch', pageDate: identity.date, pageVenue: identity.venue };
  return { ok: true, identity };
}

export function citedTrialDates(lines, meetingDate) {
  const meeting = parseRaceCalendarDate(meetingDate);
  if (!meeting || !Array.isArray(lines)) return [];
  const year = Number(meeting.slice(0, 4));
  const month = Number(meeting.slice(5, 7));
  const day = Number(meeting.slice(8, 10));
  const dates = [];
  for (const line of lines) {
    const match = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*:/.exec(String(line));
    if (!match) continue;
    const citedDay = Number(match[1]);
    const citedMonth = Number(match[2]);
    let citedYear = match[3] ? Number(match[3]) : year;
    if (!match[3] && (citedMonth > month || (citedMonth === month && citedDay > day))) citedYear -= 1;
    const date = ymd(citedYear, citedMonth, citedDay);
    if (date && !dates.includes(date)) dates.push(date);
  }
  return dates;
}

function publicWork(horse) {
  return {
    gallop: horse.gallop,
    trot: horse.trot,
    swim: horse.swim,
    treadmill: horse.treadmill,
    aquaWalker: horse.aquaWalker,
    spelling: horse.spelling
  };
}

export function parseTrackworkHtml(html, expected) {
  const check = requireRacePage(html, expected);
  if (!check.ok) return check;
  const tables = tablesContaining(html, '快操').filter((table) => table.html.includes('踱步') && table.html.includes('休歇'));
  if (!tables.length) return { ok: false, reason: 'unrecognized' };
  const horses = [];
  const trialCitations = [];
  for (const table of tables) {
    const standby = table.html.includes('後備馬匹');
    for (const rowHtml of rowHtmlList(table.html)) {
      const cells = rowCells(rowHtml);
      const gallop = cellByClass(cells, 'Gallop');
      if (!gallop) continue;
      const number = positiveInteger(cellText(cells[0] ? cells[0].html : ''));
      const nameHtml = cells[1] ? cells[1].html : '';
      const horseId = horseIdFrom(nameHtml);
      const trialLines = linesFromHtml(cellByClass(cells, 'BarrierTrial') ? cellByClass(cells, 'BarrierTrial').html : '');
      horses.push({
        horseId,
        number,
        standby,
        gallop: linesFromHtml(gallop.html),
        trot: linesFromHtml((cellByClass(cells, 'Trotting') || {}).html || ''),
        swim: linesFromHtml((cellByClass(cells, 'Swimming') || {}).html || ''),
        treadmill: linesFromHtml((cellByClass(cells, 'Treadmill') || {}).html || ''),
        aquaWalker: linesFromHtml((cellByClass(cells, 'AquaWalker') || {}).html || ''),
        spelling: linesFromHtml((cellByClass(cells, 'Spelling') || {}).html || '')
      });
      const dates = citedTrialDates(trialLines || [], expected.date);
      if (dates.length) trialCitations.push({ horseId, number, standby, dates });
    }
  }
  return { ok: true, horses, trialCitations };
}

export function parseTrackworkHistoryHtml(html, horseId) {
  if (!/^HK_\d{4}_[A-Z0-9]+$/.test(horseId || '')) return { ok: false, reason: 'unrecognized' };
  if (!String(html ?? '').includes(horseId)) return { ok: false, reason: 'horse-mismatch' };
  const tables = tablesContaining(html, '晨操類別');
  if (!tables.length) return { ok: false, reason: 'unrecognized' };
  const rows = [];
  for (const rowHtml of rowHtmlList(tables[0].html)) {
    const cells = rowCells(rowHtml);
    if (cells.length < 5) continue;
    const kind = cellText(cells[1].html);
    if (kind === '晨操類別' || !HISTORY_KINDS.has(kind)) continue;
    const detail = observationText(cells[3].html);
    rows.push({
      date: cellText(cells[0].html) || null,
      kind,
      place: cellText(cells[2].html) || null,
      detail,
      gear: cellText(cells[4].html)
    });
  }
  return { ok: true, horseId, rows };
}

function injuryRecord(date, detail, passed, rowHtml) {
  return {
    date: date || null,
    detail: detail || null,
    passedDate: passedDate(passed),
    sinceLastStart: rowIsBold(rowHtml)
  };
}

export function parseVeterinaryHtml(html, expected) {
  const check = requireRacePage(html, expected);
  if (!check.ok) return check;
  const tables = tablesContaining(html, 'id="OVR');
  if (!tables.length) return { ok: false, reason: 'unrecognized' };
  const horses = [];
  for (const table of tables) {
    const standby = table.html.includes('後備馬匹');
    let current = null;
    for (const rowHtml of rowHtmlList(table.html)) {
      const cells = rowCells(rowHtml);
      if (cells.length < 5) continue;
      const labels = cells.map((cell) => cellText(cell.html));
      if (labels[0] === '馬號' || labels[0] === '編號') continue;
      const number = positiveInteger(labels[0]);
      const id = horseIdFrom(cells[1].html);
      if (number != null || id) {
        current = { horseId: id, number, standby, records: [] };
        horses.push(current);
      }
      if (!current) continue;
      if (!labels[2] && !labels[3]) continue;
      current.records.push(injuryRecord(labels[2], labels[3], labels[4], rowHtml));
    }
  }
  return { ok: true, horses };
}

function readDeclaredIdentity(html) {
  const source = String(html ?? '');
  const header = /(\d{4})年(\d{1,2})月(\d{1,2})日\s*星期[一二三四五六日]\s*宣佈出賽馬匹傷患紀錄/.exec(source);
  const title = /class="blueBtn1">\s*(\d{1,2})月(\d{1,2})日\s*-\s*(沙田|跑馬地)/.exec(source);
  if (!header || !title) return null;
  const date = ymd(header[1], header[2], header[3]);
  const venue = venueLabelToCode(title[3]);
  if (!date || !venue) return null;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (Number(title[1]) !== month || Number(title[2]) !== day) return { conflict: true, date, venue };
  return { date, venue };
}

export function parseDeclaredInjuriesHtml(html, expected) {
  const identity = readDeclaredIdentity(html);
  if (!identity) return { ok: false, reason: 'unrecognized' };
  if (identity.conflict || identity.date !== expected.date) {
    return { ok: false, reason: 'date-mismatch', pageDate: identity.date || '', pageVenue: identity.venue || '' };
  }
  if (identity.venue !== expected.venue) {
    return { ok: false, reason: 'venue-mismatch', pageDate: identity.date, pageVenue: identity.venue };
  }
  const tables = tablesContaining(html, '烙印編號');
  if (!tables.length) return { ok: false, reason: 'unrecognized' };
  let raceNo = null;
  const records = [];
  for (const rowHtml of rowHtmlList(tables[0].html)) {
    const cells = rowCells(rowHtml);
    if (!cells.length) continue;
    const texts = cells.map((cell) => cellText(cell.html));
    const race = /第\s*(\d+)\s*場/.exec(texts.join(' '));
    if (race && texts.length < 7) {
      raceNo = Number(race[1]);
      continue;
    }
    if (texts[0] === '場次' || texts.includes('烙印編號')) continue;
    if (texts.length < 7 || raceNo == null) continue;
    const number = positiveInteger(texts[1]);
    const brand = brandFromText(texts[3]);
    if (number == null || !brand) continue;
    records.push({
      raceNo,
      number,
      brand,
      ...injuryRecord(texts[4], texts[5], texts[6], rowHtml)
    });
  }
  return { ok: true, records };
}

export function parseInjuryDatabaseHtml(html) {
  const asOfMatch = /截至\s*(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(String(html ?? ''));
  const asOf = asOfMatch ? ymd(asOfMatch[1], asOfMatch[2], asOfMatch[3]) : null;
  if (!asOf) return { ok: false, reason: 'unrecognized' };
  const table = tablesContaining(html, '烙印編號').find((item) => item.html.includes('截至'));
  if (!table) return { ok: false, reason: 'unrecognized' };
  const horses = [];
  let current = null;
  for (const rowHtml of rowHtmlList(table.html)) {
    const cells = rowCells(rowHtml);
    if (cells.length < 5) continue;
    const texts = cells.map((cell) => cellText(cell.html));
    if (texts[0] === '烙印編號' || texts[0].includes('傷患紀錄')) continue;
    const brand = brandFromText(texts[0]);
    if (brand) {
      current = { brand, records: [] };
      horses.push(current);
    }
    if (!current) continue;
    if (!texts[2] && !texts[3]) continue;
    current.records.push(injuryRecord(texts[2], texts[3], texts[4], rowHtml));
  }
  return { ok: true, asOf, horses };
}

export function parseTrialMenuDates(html) {
  const dates = [];
  const re = /<option\b[^>]*\bvalue="(\d{2})\/(\d{2})\/(\d{4})"/gi;
  let match;
  while ((match = re.exec(String(html ?? '')))) {
    const date = ymd(match[3], match[2], match[1]);
    if (date && !dates.includes(date)) dates.push(date);
  }
  return dates;
}

function readTrialDate(html) {
  const matches = [...String(html ?? '').matchAll(/試閘日期:\s*(\d{2})\/(\d{2})\/(\d{4})/g)];
  if (!matches.length) return null;
  const dates = matches.map((match) => ymd(match[3], match[2], match[1]));
  if (dates.some((date) => !date || date !== dates[0])) return { conflict: true };
  return dates[0];
}

function parseTrialName(html) {
  const text = cellText(html);
  const brandMatch = /\(([A-Z]\d{3})\)\s*$/.exec(text);
  return { horseId: horseIdFrom(html), brand: brandMatch ? brandMatch[1] : null };
}

export function parseTrialHtml(html, expectedDate) {
  const calendar = parseRaceCalendarDate(expectedDate);
  if (!calendar) return { ok: false, reason: 'unrecognized' };
  const pageDate = readTrialDate(html);
  if (!pageDate || pageDate.conflict || pageDate !== calendar) {
    return { ok: false, reason: 'date-mismatch', pageDate: pageDate && pageDate.conflict ? '' : (pageDate || '') };
  }
  const source = String(html ?? '');
  const entries = [];
  const re = /<table\b[^>]*\bbigborder\b[^>]*>/gi;
  let tables = 0;
  let parsed = 0;
  let match;
  while ((match = re.exec(source))) {
    const table = extractBalanced(source, match.index);
    if (!table) break;
    tables += 1;
    const lookback = source.slice(Math.max(0, match.index - 1500), match.index);
    const groups = [...lookback.matchAll(/第(?:&nbsp;|\s)*(\d+)(?:&nbsp;|\s)*組\s*-\s*([^<]+?)\s*-\s*(\d+)\s*米/g)];
    if (!groups.length) {
      re.lastIndex = match.index + table.length;
      continue;
    }
    const group = groups[groups.length - 1];
    const going = [...lookback.matchAll(/場地狀況:\s*([^<&\n]+)/g)].pop();
    const overall = [...lookback.matchAll(/(?<!段)時間:\s*([^<&\s]+)/g)].pop();
    const sectionals = [...lookback.matchAll(/分段時間:\s*([^<]+)/g)].pop();
    const distance = Number(group[3]);
    const horses = [];
    for (const rowHtml of rowHtmlList(table)) {
      if (rowHtml.includes('馬名') && rowHtml.includes('沿途走勢評述')) continue;
      const cells = rowCells(rowHtml);
      if (cells.length < 10) continue;
      const name = parseTrialName(cells[0].html);
      horses.push({
        date: calendar,
        group: Number(group[1]),
        course: cellText(group[2]),
        distance: Number.isInteger(distance) && distance > 0 ? distance : null,
        going: going ? going[1].trim() || null : null,
        overallTime: overall ? overall[1].trim() || null : null,
        sectionals: sectionals ? sectionals[1].replace(/\s+/g, ' ').trim() || null : null,
        horseId: name.horseId,
        brand: name.brand,
        jockeyName: cellText(cells[1].html) || null,
        trainerName: cellText(cells[2].html) || null,
        draw: cellText(cells[3].html) || null,
        gear: cellText(cells[4].html),
        margin: cellText(cells[5].html),
        positions: cellText(cells[6].html) || null,
        finishTime: cellText(cells[7].html) || null,
        result: cellText(cells[8].html)
      });
    }
    if (horses.length) {
      parsed += 1;
      entries.push(...horses);
    }
    re.lastIndex = match.index + table.length;
  }
  if (tables > 0 && parsed === 0) return { ok: false, reason: 'unrecognized' };
  return { ok: true, date: calendar, entries };
}

function racedayQuery(date, venue, raceNo) {
  const calendar = parseRaceCalendarDate(date);
  const code = parseVenueCode(venue);
  const race = positiveInteger(raceNo);
  if (!calendar || !code || race == null) return null;
  return `racedate=${calendar.replace(/-/g, '/')}&Racecourse=${code}&RaceNo=${race}`;
}

export function trackworkMeetingUrl(date, venue, raceNo) {
  const query = racedayQuery(date, venue, raceNo);
  return query ? `${ORIGIN}/zh-hk/local/information/localtrackwork?${query}` : null;
}

export function veterinaryRecordUrl(date, venue, raceNo) {
  const query = racedayQuery(date, venue, raceNo);
  return query ? `${ORIGIN}/zh-hk/local/information/veterinaryrecord?${query}` : null;
}

export function trackworkHistoryUrl(id) {
  if (!/^HK_\d{4}_[A-Z0-9]+$/.test(id || '')) return null;
  return `${ORIGIN}/zh-hk/local/information/trackworkresult?horseid=${id}`;
}

export function trialMenuUrl() {
  return `${ORIGIN}/zh-hk/local/information/btresult`;
}

export function trialDateUrl(date) {
  const calendar = parseRaceCalendarDate(date);
  if (!calendar) return null;
  return `${ORIGIN}/zh-hk/local/information/btresult?Date=${calendar.replace(/-/g, '/')}`;
}

export function declaredInjuryUrl() {
  return `${ORIGIN}/zh-hk/local/information/overecord`;
}

export function injuryDatabaseUrl() {
  return `${ORIGIN}/zh-hk/local/information/ovedatabase`;
}

function responseIdentityOk(requestedUrl, responseUrl) {
  if (!responseUrl) return true;
  let requested;
  let actual;
  try {
    requested = new URL(requestedUrl);
    actual = new URL(responseUrl);
  } catch {
    return false;
  }
  if (actual.origin !== requested.origin || actual.pathname !== requested.pathname) return false;
  return IDENTITY_KEYS.every((key) => requested.searchParams.get(key) === actual.searchParams.get(key));
}

async function fetchHtml(url, doFetch) {
  if (!url) return { ok: false, code: 'SOURCE_ERROR' };
  let response;
  try {
    response = await doFetch(url, { method: 'GET', headers: HTML_HEADERS, credentials: 'omit' });
  } catch (error) {
    console.error('[feature-conditions] network failure', error);
    return { ok: false, code: 'SOURCE_ERROR' };
  }
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    console.error('[feature-conditions] unreadable body', response && response.status, error);
    return { ok: false, code: 'SOURCE_ERROR' };
  }
  if (!responseIdentityOk(url, response && response.url)) {
    console.error('[feature-conditions] page identity', response && response.status);
    return { ok: false, code: 'SOURCE_ERROR' };
  }
  if (!(response.status >= 200 && response.status < 300)) {
    console.error('[feature-conditions] http', response.status);
    return { ok: false, code: 'SOURCE_HTTP' };
  }
  if (!text) return { ok: false, code: 'SOURCE_ERROR' };
  return { ok: true, html: text };
}

function parseFailure(reason) {
  console.error('[feature-conditions] parse', reason || 'unrecognized');
  return { ok: false, code: 'SOURCE_ERROR' };
}

function indexHorses(horses, records) {
  const byId = new Map();
  const byNumber = new Map();
  for (const horse of horses) {
    const value = records ? horse.records : publicWork(horse);
    if (horse.horseId && !byId.has(horse.horseId)) byId.set(horse.horseId, value);
    if (!horse.standby && horse.number != null && !byNumber.has(horse.number)) byNumber.set(horse.number, value);
  }
  return { byId, byNumber };
}

export async function loadFeatureSources({ date, venue, raceNo, fetch: doFetch = globalThis.fetch } = {}) {
  const calendar = parseRaceCalendarDate(date);
  const code = parseVenueCode(venue);
  const race = positiveInteger(raceNo);
  if (!calendar || !code || race == null) return { ok: false, code: 'SOURCE_ERROR' };
  const expected = { date: calendar, venue: code, raceNo: race };
  const [trackPage, vetPage, declaredPage, databasePage] = await Promise.all([
    fetchHtml(trackworkMeetingUrl(calendar, code, race), doFetch),
    fetchHtml(veterinaryRecordUrl(calendar, code, race), doFetch),
    fetchHtml(declaredInjuryUrl(), doFetch),
    fetchHtml(injuryDatabaseUrl(), doFetch)
  ]);
  for (const page of [trackPage, vetPage, declaredPage, databasePage]) {
    if (!page.ok) return { ok: false, code: page.code };
  }
  const track = parseTrackworkHtml(trackPage.html, expected);
  if (!track.ok) return parseFailure(track.reason);
  const veterinary = parseVeterinaryHtml(vetPage.html, expected);
  if (!veterinary.ok) return parseFailure(veterinary.reason);
  const declared = parseDeclaredInjuriesHtml(declaredPage.html, expected);
  if (!declared.ok) return parseFailure(declared.reason);
  const database = parseInjuryDatabaseHtml(databasePage.html);
  if (!database.ok) return parseFailure(database.reason);

  const ids = [];
  for (const horse of track.horses) {
    if (horse.horseId && !ids.includes(horse.horseId)) ids.push(horse.horseId);
  }
  const wanted = [];
  for (const citation of track.trialCitations) {
    for (const cited of citation.dates) {
      if (!wanted.includes(cited)) wanted.push(cited);
    }
  }
  const [historyItems, menuPage] = await Promise.all([
    Promise.all(ids.map(async (id) => ({ id, page: await fetchHtml(trackworkHistoryUrl(id), doFetch) }))),
    wanted.length ? fetchHtml(trialMenuUrl(), doFetch) : Promise.resolve(null)
  ]);
  const historyById = new Map();
  for (const item of historyItems) {
    if (!item.page.ok) return { ok: false, code: item.page.code };
    const parsed = parseTrackworkHistoryHtml(item.page.html, item.id);
    if (!parsed.ok) return parseFailure(parsed.reason);
    historyById.set(item.id, parsed.rows);
  }
  let trials = [];
  if (wanted.length) {
    if (!menuPage.ok) return { ok: false, code: menuPage.code };
    const menuDates = parseTrialMenuDates(menuPage.html);
    const selected = wanted.filter((item) => menuDates.includes(item));
    const dated = await Promise.all(selected.map(async (item) => ({
      date: item,
      page: await fetchHtml(trialDateUrl(item), doFetch)
    })));
    for (const item of dated) {
      if (!item.page.ok) return { ok: false, code: item.page.code };
      const parsed = parseTrialHtml(item.page.html, item.date);
      if (!parsed.ok) return parseFailure(parsed.reason);
      trials = trials.concat(parsed.entries);
    }
  }

  const work = indexHorses(track.horses, false);
  const vet = indexHorses(veterinary.horses, true);
  const declaredByBrand = new Map();
  for (const record of declared.records) {
    if (record.raceNo !== race) continue;
    const list = declaredByBrand.get(record.brand) || [];
    list.push(injuryRecord(record.date, record.detail, record.passedDate, record.sinceLastStart ? '<b>' : ''));
    declaredByBrand.set(record.brand, list);
  }
  const databaseByBrand = new Map();
  for (const horse of database.horses) {
    databaseByBrand.set(horse.brand, horse.records);
  }
  return {
    ok: true,
    sources: {
      workById: work.byId,
      workByNumber: work.byNumber,
      historyById,
      trials,
      vetById: vet.byId,
      vetByNumber: vet.byNumber,
      declaredByBrand,
      databaseByBrand,
      databaseAsOf: database.asOf
    }
  };
}

function lookupWork(runner, sources) {
  const code = horseCode(runner);
  let horse = null;
  if (code && sources && sources.workById) horse = sources.workById.get(code) || null;
  else if (!code && sources && sources.workByNumber) {
    const number = positiveInteger(runner && runner.no);
    horse = number == null ? null : (sources.workByNumber.get(number) || null);
  }
  const history = code && sources && sources.historyById && sources.historyById.has(code)
    ? sources.historyById.get(code)
    : null;
  if (!horse && history == null) return null;
  return {
    gallop: horse ? horse.gallop : null,
    trot: horse ? horse.trot : null,
    swim: horse ? horse.swim : null,
    treadmill: horse ? horse.treadmill : null,
    aquaWalker: horse ? horse.aquaWalker : null,
    spelling: horse ? horse.spelling : null,
    history
  };
}

function publicTrial(entry) {
  return {
    date: entry.date,
    group: entry.group,
    course: entry.course,
    distance: entry.distance,
    going: entry.going,
    overallTime: entry.overallTime,
    sectionals: entry.sectionals,
    horseId: entry.horseId,
    brand: entry.brand,
    jockeyName: entry.jockeyName,
    trainerName: entry.trainerName,
    draw: entry.draw,
    gear: entry.gear,
    margin: entry.margin,
    positions: entry.positions,
    finishTime: entry.finishTime,
    result: entry.result
  };
}

function lookupTrials(runner, sources) {
  const list = sources && Array.isArray(sources.trials) ? sources.trials : [];
  const code = horseCode(runner);
  const brand = brandFromHorseCode(code);
  const found = [];
  for (const trial of list) {
    if (code && trial.horseId) {
      if (trial.horseId === code) found.push(publicTrial(trial));
      continue;
    }
    if (brand && trial.brand === brand && (!trial.horseId || trial.horseId === code)) found.push(publicTrial(trial));
  }
  return found.length ? found : null;
}

function lookupVeterinary(runner, sources) {
  const code = horseCode(runner);
  if (code && sources && sources.vetById && sources.vetById.has(code)) return sources.vetById.get(code);
  if (code) return null;
  const number = positiveInteger(runner && runner.no);
  if (number == null || !sources || !sources.vetByNumber || !sources.vetByNumber.has(number)) return null;
  return sources.vetByNumber.get(number);
}

function lookupBrand(runner, map) {
  const brand = brandFromHorseCode(horseCode(runner));
  if (!brand || !map || !map.has(brand)) return null;
  return map.get(brand);
}

function trackDescriptions(source) {
  const track = source.raceTrack;
  const course = source.raceCourse;
  const texts = [
    readableText(track && track.description_ch),
    readableText(track && track.description_en),
    readableText(course && course.description_ch),
    readableText(course && course.description_en),
    readableText(course && course.displayCode)
  ].filter(Boolean);
  return texts.length ? texts : null;
}

function linearHundredths(value, reference, perUnit, maxAbs) {
  const rounded = Math.round((reference - value) * perUnit);
  if (rounded > maxAbs) return maxAbs;
  if (rounded < -maxAbs) return -maxAbs;
  return rounded;
}

function capHundredths(total) {
  if (total > TOTAL_MAX) return TOTAL_MAX;
  if (total < -TOTAL_MAX) return -TOTAL_MAX;
  return total;
}

function presentWork(work) {
  if (!work) {
    return {
      gallop: null,
      trot: null,
      swim: null,
      treadmill: null,
      aquaWalker: null,
      spelling: null,
      history: null,
      points: FEATURE_CONDITION_DEFAULTS.morningWorkPoints
    };
  }
  return {
    gallop: work.gallop || null,
    trot: work.trot || null,
    swim: work.swim || null,
    treadmill: work.treadmill || null,
    aquaWalker: work.aquaWalker || null,
    spelling: work.spelling || null,
    history: Array.isArray(work.history) && work.history.length ? work.history : null,
    points: FEATURE_CONDITION_DEFAULTS.morningWorkPoints
  };
}

function listedRecords(value) {
  return Array.isArray(value) && value.length ? value : null;
}

export function featureAdjustment(input) {
  const source = input && typeof input === 'object' ? input : {};
  const barrier = positiveInteger(source.barrierDrawNumber);
  const handicap = positiveFiniteNumber(source.handicapWeight);
  const weight = positiveFiniteNumber(source.currentWeight);
  const gear = readableGear(source.gearInfo);
  const distance = positiveFiniteNumber(source.distance);
  const goingCh = readableText(source.go_ch) || null;
  const goingEn = readableText(source.go_en) || null;
  const track = trackDescriptions(source);
  const pair = jockeyTrainerPair(source.jockey, source.trainer);
  const morningWork = presentWork(source.morningWork);
  const trialEntries = Array.isArray(source.trials) && source.trials.length ? source.trials.map(publicTrial) : null;
  const injuries = source.injuries && typeof source.injuries === 'object' ? source.injuries : {};
  const barrierHundredths = barrier == null
    ? 0
    : linearHundredths(barrier, FEATURE_CONDITION_DEFAULTS.barrierReferenceDraw, BARRIER_PER, BARRIER_MAX);
  const handicapHundredths = handicap == null
    ? 0
    : linearHundredths(handicap, FEATURE_CONDITION_DEFAULTS.handicapReferencePounds, HANDICAP_PER, HANDICAP_MAX);
  const adjustmentHundredths = capHundredths(barrierHundredths + handicapHundredths);
  const winProb = Math.round((NEUTRAL + adjustmentHundredths) / 10) / 10;
  return {
    winProb,
    adjustment: adjustmentHundredths / 100,
    features: {
      track: { descriptions: track, points: FEATURE_CONDITION_DEFAULTS.trackPoints },
      distance: { value: distance, points: FEATURE_CONDITION_DEFAULTS.distancePoints },
      going: { go_ch: goingCh, go_en: goingEn, points: FEATURE_CONDITION_DEFAULTS.goingPoints },
      morningWork,
      trials: { entries: trialEntries, points: FEATURE_CONDITION_DEFAULTS.trialPoints },
      gear: { value: gear, points: FEATURE_CONDITION_DEFAULTS.gearPoints },
      injuries: {
        veterinary: listedRecords(injuries.veterinary),
        declared: listedRecords(injuries.declared),
        database: listedRecords(injuries.database),
        databaseAsOf: injuries.databaseAsOf || null,
        points: FEATURE_CONDITION_DEFAULTS.injuryPoints
      },
      runningStyle: { value: null, points: FEATURE_CONDITION_DEFAULTS.runningStylePoints },
      barrier: { value: barrier, points: barrierHundredths / 100 },
      pairing: pair
        ? { jockeyCode: pair.jockeyCode, trainerCode: pair.trainerCode, text: pair.text, points: FEATURE_CONDITION_DEFAULTS.pairingPoints }
        : { jockeyCode: null, trainerCode: null, text: null, points: FEATURE_CONDITION_DEFAULTS.pairingPoints },
      handicap: { value: handicap, points: handicapHundredths / 100 },
      weight: { value: weight, points: FEATURE_CONDITION_DEFAULTS.weightPoints }
    }
  };
}

function runnerView(race, runner, sources) {
  const code = horseCode(runner);
  return {
    distance: race && race.distance,
    go_ch: race && race.go_ch,
    go_en: race && race.go_en,
    raceTrack: race && race.raceTrack,
    raceCourse: race && race.raceCourse,
    barrierDrawNumber: runner && runner.barrierDrawNumber,
    handicapWeight: runner && runner.handicapWeight,
    currentWeight: runner && runner.currentWeight,
    gearInfo: runner && runner.gearInfo,
    jockey: runner && runner.jockey,
    trainer: runner && runner.trainer,
    morningWork: lookupWork(runner, sources),
    trials: lookupTrials(runner, sources),
    injuries: {
      veterinary: lookupVeterinary(runner, sources),
      declared: lookupBrand(runner, sources && sources.declaredByBrand),
      database: lookupBrand(runner, sources && sources.databaseByBrand),
      databaseAsOf: sources ? sources.databaseAsOf : null
    },
    horseCode: code
  };
}

export function predictFromFeatureConditions(race, sources) {
  const runners = Array.isArray(race && race.runners) ? race.runners : [];
  const seen = new Set();
  const rows = [];
  for (const runner of runners) {
    const number = positiveInteger(runner && runner.no);
    if (number == null || seen.has(number)) continue;
    seen.add(number);
    const scored = featureAdjustment(runnerView(race, runner, sources));
    rows.push({
      horse: String(number),
      no: number,
      winProb: scored.winProb,
      confidence: '未量度',
      adjustment: scored.adjustment,
      features: scored.features
    });
  }
  rows.sort((left, right) => right.winProb - left.winProb || left.no - right.no);
  return rows.slice(0, 5).map((row) => ({
    horse: row.horse,
    winProb: row.winProb,
    confidence: row.confidence,
    adjustment: row.adjustment,
    features: row.features
  }));
}
