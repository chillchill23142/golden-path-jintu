import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RACE_MEETINGS_QUERY, WIN_POOL_QUERY } from '../api/officialQueries.js';
import {
  PACK_S_DEFAULTS,
  PACK_S_MODEL,
  horseNumber,
  isPackSEnabled,
  jockeyTrainerPair,
  packSAdjustment,
  predictWithPackS,
  readableGear
} from '../api/packS.js';
import {
  USER_FACING_MESSAGE,
  createHandler,
  currentMeetingRace,
  predictFromNodes
} from '../api/races.js';

const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const MEETING_SHA = 'bbef8d3eb03bf9c59581e76140e8d3a7fed873b7e84a1a323b02b72f5ba736cb';
const POOL_SHA = 'c08a99ca7cb4f6115db4f23028c1e0fa9e19b2fed9afdf4c404e9c0fd40b2190';
const PACK_SOURCE = fs.readFileSync(new URL('../api/packS.js', import.meta.url), 'utf8');
const RACES_SOURCE = fs.readFileSync(new URL('../api/races.js', import.meta.url), 'utf8');

const SECTION_5 = [
  'penetrometerReadings',
  'hammerReadings',
  'currentRating',
  'internationalRating',
  'last6run',
  'allowance',
  'trainerPreference',
  'winOdds',
  'hotFavourite',
  'oddsDropValue',
  'bankerOdds',
  'changeHistories'
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

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

async function invoke(query, fetchImpl, env = process.env) {
  const calls = [];
  const wrapped = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : undefined });
    return fetchImpl(url, init, calls);
  };
  const res = createRes();
  await createHandler({ fetch: wrapped, env })({ query }, res);
  return { res, calls };
}

function oddsShape(rows) {
  return rows.map((row) => ({
    horse: row.horse,
    odds: row.odds,
    winProb: row.winProb,
    confidence: row.confidence
  }));
}

function node(combString, oddsValue, extra = {}) {
  return { combString, oddsValue, ...extra };
}

test('GP_PACK_S is on only for the exact string 1', () => {
  assert.equal(isPackSEnabled({}), false);
  assert.equal(isPackSEnabled({ GP_PACK_S: undefined }), false);
  for (const value of ['', '0', 'false', 'true', '2', '01', '1 ', ' 1', '1\n', 'yes', 'on', '1.0']) {
    assert.equal(isPackSEnabled({ GP_PACK_S: value }), false, value);
  }
  assert.equal(isPackSEnabled({ GP_PACK_S: '1' }), true);
  assert.match(PACK_SOURCE, /GP_PACK_S === '1'/);
  assert.doesNotMatch(PACK_SOURCE, /GP_PACK_S\s*=\s*['"]1['"]/);
  assert.match(RACES_SOURCE, /model: 'Odds-based probability model'/);
  assert.match(RACES_SOURCE, /parseFloat\(n\.oddsValue\) \|\| 99/);
  assert.match(RACES_SOURCE, /100 \/ oddsVal \* 1\.2/);
});

test('predictFromNodes keeps the odds-only baseline, clamp, rounding, confidence, and top 5', () => {
  const nodes = [
    node('06', '1.0', { hotFavourite: false }),
    node('01', '3.5'),
    node('04', '4'),
    node('05', '8'),
    node('07', '9'),
    node('02', '0'),
    node('03', 'nope'),
    node('08', '')
  ];
  assert.deepEqual(predictFromNodes(nodes), [
    { horse: '06', odds: 1, winProb: 95, confidence: '高' },
    { horse: '01', odds: 3.5, winProb: 34.3, confidence: '高' },
    { horse: '04', odds: 4, winProb: 30, confidence: '中' },
    { horse: '05', odds: 8, winProb: 15, confidence: '低' },
    { horse: '07', odds: 9, winProb: 13.3, confidence: '低' }
  ]);
  assert.equal(predictFromNodes([node('02', '0')])[0].odds, 99);
  assert.equal(predictFromNodes([node('03', 'nope')])[0].winProb, 5);
  assert.equal(predictFromNodes([node('09', '1.2')])[0].winProb, 95);
  assert.equal(predictFromNodes([node('04', '4')])[0].confidence, '中');
  assert.equal(predictFromNodes([node('05', '8')])[0].confidence, '低');
  assert.equal(predictFromNodes([node('10', '3.9')])[0].confidence, '高');
  assert.equal(predictFromNodes([node('11', '7.9')])[0].confidence, '中');
});

test('flag off, unset, empty, 0, and other values match predictFromNodes for the same oddsNodes', async () => {
  const nodes = [
    node('07', '9.0', { hotFavourite: true, oddsDropValue: '4', bankerOdds: [{ combString: '07', oddsValue: '1.1' }] }),
    node('01', '3.5'),
    node('02', '0'),
    node('04', '4'),
    node('05', '8')
  ];
  const today = predictFromNodes(nodes);
  const environments = [{}, { GP_PACK_S: undefined }];
  for (const value of ['', '0', 'false', 'true', '2', '01', '1 ', ' 1', 'yes']) {
    environments.push({ GP_PACK_S: value });
  }
  const card = {
    races: [{
      no: 4,
      distance: 1200,
      go_ch: '好地',
      runners: [{ no: 1, barrierDrawNumber: 1, handicapWeight: '110', currentWeight: '1000', gearInfo: 'B' }]
    }]
  };
  for (const env of environments) {
    const { res, calls } = await invoke(
      { type: 'predict', race: '4', date: '2099-01-01', venue: 'HV' },
      async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [{ oddsType: 'WIN', leg: { races: [4] }, oddsNodes: nodes }], races: card.races }] } }),
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
  assert.deepEqual(oddsShape(predictWithPackS(nodes, null)), today);
});

test('flag on keeps the oddsValue baseline and does not impute a missing feature', () => {
  const oddsOnly = node('01', '5');
  const baseline = predictFromNodes([oddsOnly])[0];
  const missing = predictWithPackS([oddsOnly], {
    no: 1,
    runners: [{ no: 1, name_ch: '測試', name_en: 'TEST' }]
  });
  assert.equal(missing.length, 1);
  assert.deepEqual(oddsShape(missing), [baseline]);
  assert.equal(missing[0].baselineWinProb, baseline.winProb);
  assert.equal(missing[0].adjustment, 0);
  assert.equal(missing[0].packS.barrierDraw, null);
  assert.equal(missing[0].packS.handicap, null);
  assert.equal(missing[0].packS.weight, null);
  assert.equal(missing[0].packS.gear, null);
  assert.equal(missing[0].horse, '01');

  const weights = [
    { no: 1, currentWeight: '1000' },
    { no: 2, currentWeight: '1100' },
    { no: 3 }
  ];
  const rows = predictWithPackS([
    node('01', '5'),
    node('02', '5'),
    node('03', '5')
  ], { runners: weights });
  const byHorse = Object.fromEntries(rows.map((row) => [row.horse, row]));
  assert.equal(byHorse['01'].packS.weightPoints, 1);
  assert.equal(byHorse['02'].packS.weightPoints, 0.5);
  assert.equal(byHorse['03'].packS.weight, null);
  assert.equal(byHorse['03'].packS.weightPoints, 0);
  assert.equal(byHorse['03'].winProb, 24);
  assert.notEqual(byHorse['03'].winProb, byHorse['02'].winProb);

  const zeroWeight = predictWithPackS([node('01', '5')], { runners: [{ no: 1, currentWeight: 0, handicapWeight: '' }] });
  assert.equal(zeroWeight[0].packS.weight, null);
  assert.equal(zeroWeight[0].packS.handicap, null);
  assert.equal(zeroWeight[0].adjustment, 0);
  assert.equal(zeroWeight[0].winProb, 24);

  const handicapOnly = predictWithPackS([node('01', '5')], { runners: [{ no: 1, handicapWeight: '126' }] });
  const weightOnly = predictWithPackS([node('01', '5')], { runners: [{ no: 1, currentWeight: '126' }] });
  assert.equal(handicapOnly[0].packS.weight, null);
  assert.equal(handicapOnly[0].packS.weightPoints, 0);
  assert.equal(handicapOnly[0].adjustment, 0);
  assert.equal(weightOnly[0].packS.handicap, null);
  assert.equal(weightOnly[0].packS.weightPoints, 1);
  assert.equal(weightOnly[0].winProb, 25);

  const presentDraw = packSAdjustment({ barrierDrawNumber: 7 });
  const absentDraw = packSAdjustment({});
  assert.equal(presentDraw.barrierDraw, 7);
  assert.equal(presentDraw.barrierPoints, 0);
  assert.equal(absentDraw.barrierDraw, null);
  assert.equal(absentDraw.barrierPoints, 0);
});

test('flag on adjustments stay inside the unmeasured caps and cannot replace the odds baseline', () => {
  assert.equal(PACK_S_DEFAULTS.barrierPointsPerDraw, 0.15);
  assert.equal(PACK_S_DEFAULTS.barrierReferenceDraw, 7);
  assert.equal(PACK_S_DEFAULTS.barrierMaxAbs, 1.5);
  assert.equal(PACK_S_DEFAULTS.handicapPointsPerPound, 0.02);
  assert.equal(PACK_S_DEFAULTS.handicapReferencePounds, 126);
  assert.equal(PACK_S_DEFAULTS.handicapMaxAbs, 1.5);
  assert.equal(PACK_S_DEFAULTS.weightPointsPerPound, 0.01);
  assert.equal(PACK_S_DEFAULTS.weightReferencePounds, 1150);
  assert.equal(PACK_S_DEFAULTS.weightMaxAbs, 1);
  assert.equal(PACK_S_DEFAULTS.totalMaxAbs, 3);

  const inside = predictWithPackS([node('01', '5')], { runners: [{ no: 1, barrierDrawNumber: 1 }] });
  assert.equal(inside[0].baselineWinProb, 24);
  assert.equal(inside[0].odds, 5);
  assert.equal(inside[0].packS.barrierPoints, 0.9);
  assert.equal(inside[0].adjustment, 0.9);
  assert.equal(inside[0].winProb, 24.9);
  assert.equal(inside[0].confidence, '中');

  const draw14 = predictWithPackS([node('02', '5')], { runners: [{ no: 2, barrierDrawNumber: '14' }] });
  assert.equal(draw14[0].packS.barrierPoints, -1.05);
  assert.equal(draw14[0].winProb, 23);
  assert.equal(predictWithPackS([node('02', '5')], { runners: [{ no: 2, barrierDrawNumber: 20 }] })[0].packS.barrierPoints, -1.5);
  assert.equal(predictWithPackS([node('02', '5')], { runners: [{ no: 2, barrierDrawNumber: '01' }] })[0].packS.barrierDraw, null);
  assert.equal(predictWithPackS([node('02', '5')], { runners: [{ no: 2, barrierDrawNumber: 0 }] })[0].adjustment, 0);
  assert.equal(predictWithPackS([node('02', '5')], { runners: [{ no: 2, barrierDrawNumber: 1.5 }] })[0].packS.barrierDraw, null);

  const capped = predictWithPackS([node('06', '5')], {
    runners: [{ no: 6, barrierDrawNumber: 1, handicapWeight: '50', currentWeight: '900' }]
  });
  assert.equal(capped[0].packS.barrierPoints, 0.9);
  assert.equal(capped[0].packS.handicapPoints, 1.5);
  assert.equal(capped[0].packS.weightPoints, 1);
  assert.equal(capped[0].adjustment, 3);
  assert.equal(capped[0].winProb, 27);

  const favorite = predictWithPackS([node('01', '2')], {
    runners: [{ no: 1, barrierDrawNumber: 20, handicapWeight: '250', currentWeight: '1400' }]
  });
  const longshot = predictWithPackS([node('02', '10')], {
    runners: [{ no: 2, barrierDrawNumber: 1, handicapWeight: '50', currentWeight: '900' }]
  });
  assert.equal(favorite[0].adjustment, -3);
  assert.equal(favorite[0].winProb, 57);
  assert.equal(favorite[0].confidence, '高');
  assert.equal(longshot[0].adjustment, 3);
  assert.equal(longshot[0].winProb, 15);
  assert.equal(longshot[0].confidence, '低');
  assert.ok(favorite[0].winProb > longshot[0].winProb);

  const floor = predictWithPackS([node('08', '0')], { runners: [{ no: 8, barrierDrawNumber: 1 }] });
  assert.equal(floor[0].odds, 99);
  assert.equal(floor[0].baselineWinProb, 5);
  assert.equal(floor[0].winProb, 5.9);
  const ceiling = predictWithPackS([node('09', '1.1')], {
    runners: [{ no: 9, barrierDrawNumber: 1, handicapWeight: '50', currentWeight: '900' }]
  });
  assert.equal(ceiling[0].baselineWinProb, 95);
  assert.equal(ceiling[0].adjustment, 3);
  assert.equal(ceiling[0].winProb, 95);

  const boundaries = predictWithPackS([
    node('04', '4'),
    node('05', '8')
  ], { runners: [{ no: 4, barrierDrawNumber: 1 }, { no: 5, barrierDrawNumber: 1 }] });
  assert.equal(boundaries.find((row) => row.horse === '04').confidence, '中');
  assert.equal(boundaries.find((row) => row.horse === '05').confidence, '低');

  const field = predictWithPackS([
    node('01', '5'),
    node('02', '5'),
    node('03', '5'),
    node('04', '5'),
    node('05', '5'),
    node('06', '5')
  ], {
    runners: [{ no: 6, barrierDrawNumber: 1, handicapWeight: '50', currentWeight: '900' }]
  });
  assert.deepEqual(field.map((row) => row.horse), ['06', '01', '02', '03', '04']);
  assert.equal(field[0].winProb, 27);
  assert.equal(field[4].winProb, 24);
});

test('track, distance, going, and gear do not invent a rate table or fill gaps', () => {
  const base = packSAdjustment({ barrierDrawNumber: 1 });
  const contexts = [
    { go_ch: '好地', go_en: 'GOOD' },
    { go_ch: '黏地', go_en: '' },
    { go_ch: '  ', go_en: ' ' },
    { distance: 1000 },
    { distance: '2400' },
    { distance: 0 },
    { distance: '1200米' },
    { raceTrack: { description_ch: '草地', description_en: 'TURF' } },
    { raceCourse: { description_ch: '沙田', description_en: 'Sha Tin', displayCode: 'AWT' } },
    { raceCourse: { displayCode: ' AWT ' }, venueCode: 'HV' },
    { venueCode: 'ST' },
    { gearInfo: 'B' },
    { gearInfo: 'TT' },
    { gearInfo: 'b' },
    { gearInfo: '' },
    { gearInfo: '   ' },
    { detail: '1200米 草地' }
  ];
  for (const extra of contexts) {
    const row = packSAdjustment({ barrierDrawNumber: 1, ...extra });
    assert.equal(row.points, base.points);
    assert.equal(row.trackPoints, 0);
    assert.equal(row.distancePoints, 0);
    assert.equal(row.goingPoints, 0);
    assert.equal(row.gearPoints, 0);
  }
  assert.equal(packSAdjustment({ venueCode: 'ST' }).trackContext, false);
  assert.equal(packSAdjustment({ raceCourse: { displayCode: 'AWT' }, venueCode: 'HV' }).trackContext, true);
  assert.equal(packSAdjustment({ raceTrack: { description_ch: '', description_en: '' }, raceCourse: { description_ch: '', description_en: '', displayCode: '' } }).trackContext, false);
  assert.equal(packSAdjustment({ go_ch: '好地' }).goingContext, true);
  assert.equal(packSAdjustment({ go_ch: '', go_en: '', detail: '草地' }).goingContext, false);
  assert.equal(packSAdjustment({ distance: '1400' }).distance, 1400);
  assert.equal(packSAdjustment({ distance: '1200米', detail: '1200米' }).distance, null);
  assert.equal(readableGear(''), null);
  assert.equal(readableGear('   '), null);
  assert.equal(readableGear(' B '), 'B');
  assert.equal(readableGear(0), null);
  assert.equal(packSAdjustment({ gearInfo: '' }).gear, null);
  assert.equal(packSAdjustment({ gearInfo: 'TT' }).gear, 'TT');
  assert.doesNotMatch(PACK_SOURCE, /好地|草地|黏地|TURF|AWT|TT/);
});

test('jockey-trainer key uses trimmed codes only and is not a win rate', () => {
  assert.deepEqual(jockeyTrainerPair(
    { code: '  PZ ', name_ch: '潘頓', name_en: 'Zac' },
    { code: 'SC', name_ch: '蔡約翰', name_en: 'Size' }
  ), { jockeyCode: 'PZ', trainerCode: 'SC', text: 'PZ|SC' });
  assert.deepEqual(jockeyTrainerPair({ code: 'Pz' }, { code: 'Sc' }), {
    jockeyCode: 'Pz',
    trainerCode: 'Sc',
    text: 'Pz|Sc'
  });
  assert.deepEqual(jockeyTrainerPair({ code: 'ＰＺ' }, { code: 'ＳＣ' }), {
    jockeyCode: 'ＰＺ',
    trainerCode: 'ＳＣ',
    text: 'ＰＺ|ＳＣ'
  });
  assert.deepEqual(jockeyTrainerPair({ code: ' P Z ' }, { code: 'T1' }), {
    jockeyCode: 'P Z',
    trainerCode: 'T1',
    text: 'P Z|T1'
  });
  assert.deepEqual(jockeyTrainerPair({ code: ' A|B ' }, { code: 'C' }), {
    jockeyCode: 'A|B',
    trainerCode: 'C',
    text: null
  });
  assert.equal(jockeyTrainerPair({ code: 'J1', name_ch: '甲' }, { name_ch: '乙', name_en: 'Bee' }), null);
  assert.equal(jockeyTrainerPair({ name_ch: '潘頓', name_en: 'Zac' }, { code: 'SC' }), null);
  assert.equal(jockeyTrainerPair({ code: '   ' }, { code: 'SC' }), null);
  assert.equal(jockeyTrainerPair({ code: 12 }, { code: 'SC' }), null);
  assert.equal(jockeyTrainerPair(null, { code: 'SC' }), null);
  assert.equal(jockeyTrainerPair({ code: 'J1', trainerPreference: '1' }, { jockey_ch: '甲', trainer_ch: '乙' }), null);
  assert.deepEqual(Object.keys(jockeyTrainerPair({ code: 'J1' }, { code: 'T1' })), ['jockeyCode', 'trainerCode', 'text']);

  const named = predictWithPackS([node('01', '5'), node('02', '5')], {
    runners: [
      { no: 1, barrierDrawNumber: 1, jockey: { code: 'J1', name_ch: '甲' }, trainer: { code: 'T1', name_ch: '乙' } },
      { no: 2, barrierDrawNumber: 1, jockey: { name_ch: '甲', name_en: 'A' }, trainer: { name_ch: '乙', trainer_ch: '乙' } }
    ]
  });
  const first = named.find((row) => row.horse === '01');
  const second = named.find((row) => row.horse === '02');
  assert.deepEqual(first.packS.pairing, { jockeyCode: 'J1', trainerCode: 'T1', text: 'J1|T1' });
  assert.equal(second.packS.pairing, null);
  assert.equal(first.winProb, second.winProb);
  assert.equal(first.adjustment, second.adjustment);
  assert.equal(packSAdjustment({ barrierDrawNumber: 1, jockeyCode: 'J1', trainerCode: 'T1' }).points, packSAdjustment({ barrierDrawNumber: 1 }).points);
});

test('runners map by horse number, and section 5 fields do not enter the model', () => {
  assert.equal(horseNumber('01'), 1);
  assert.equal(horseNumber('10'), 10);
  assert.equal(horseNumber('0'), null);
  assert.equal(horseNumber('1a'), null);

  const mapped = predictWithPackS([
    node('2', '5'),
    node('01', '5'),
    node('03', '5')
  ], {
    runners: [
      { no: 1, name_ch: '2', barrierDrawNumber: 1, horse: { code: 'H1' } },
      { no: '02', name_ch: '1', barrierDrawNumber: 14 },
      { no: null, standbyNo: 3, barrierDrawNumber: 1 },
      { no: 3, barrier: 1, actualWeight: '120', jockey_ch: '潘頓', trainer_ch: '蔡約翰', name_ch: '金槍六十' }
    ]
  });
  const byHorse = Object.fromEntries(mapped.map((row) => [row.horse, row]));
  assert.equal(byHorse['01'].packS.barrierDraw, 1);
  assert.equal(byHorse['01'].winProb, 24.9);
  assert.equal(byHorse['2'].packS.barrierDraw, 14);
  assert.equal(byHorse['2'].winProb, 23);
  assert.equal(byHorse['03'].packS.barrierDraw, null);
  assert.equal(byHorse['03'].packS.pairing, null);
  assert.equal(byHorse['03'].winProb, 24);
  assert.equal(byHorse['03'].horse, '03');

  const clean = {
    no: 1,
    distance: 1400,
    go_ch: '好地',
    go_en: 'GOOD',
    raceTrack: { description_ch: '草地', description_en: 'TURF' },
    raceCourse: { displayCode: 'AWT' },
    runners: [{
      no: 1,
      barrierDrawNumber: 4,
      handicapWeight: '120',
      currentWeight: '1100',
      gearInfo: 'B',
      jockey: { code: 'PZ' },
      trainer: { code: 'SC' }
    }]
  };
  const dirtyRunner = {
    ...clean.runners[0],
    currentRating: 140,
    internationalRating: 99,
    last6run: '1/1/1/1/1/1',
    allowance: 10,
    trainerPreference: '1',
    winOdds: 1.2,
    name_ch: '別的馬',
    name_en: 'OTHER',
    barrier: 14,
    actualWeight: '100'
  };
  const dirty = {
    ...clean,
    runners: [dirtyRunner],
    penetrometerReadings: [{ reading: 9 }],
    hammerReadings: [{ reading: 1 }],
    changeHistories: [{ handicapWeight: '100', runnerNo: 1 }],
    wageringFieldSize: 14,
    venueCode: 'HV',
    detail: '1000米 草地'
  };
  const dirtyNode = node('01', '5', {
    hotFavourite: true,
    oddsDropValue: '30',
    bankerOdds: [{ combString: '01', oddsValue: '1.01' }],
    winOdds: 1.5
  });
  assert.deepEqual(predictWithPackS([dirtyNode], dirty), predictWithPackS([node('01', '5')], clean));
  const row = predictWithPackS([dirtyNode], dirty)[0];
  assert.equal(row.odds, 5);
  assert.equal(row.baselineWinProb, 24);
  assert.equal(row.packS.barrierPoints, 0.45);
  assert.equal(row.packS.handicapPoints, 0.12);
  assert.equal(row.packS.weightPoints, 0.5);
  assert.equal(row.adjustment, 1.07);
  assert.equal(row.winProb, 25.1);
  assert.equal(row.packS.gear, 'B');
  assert.equal(row.packS.gearPoints, 0);
  assert.equal(row.packS.distance, 1400);
  assert.equal(row.packS.distancePoints, 0);
  assert.equal(row.packS.trackPoints, 0);
  assert.equal(row.packS.goingPoints, 0);
  assert.deepEqual(row.packS.pairing, { jockeyCode: 'PZ', trainerCode: 'SC', text: 'PZ|SC' });

  const allowedRunner = new Set(['no', 'barrierDrawNumber', 'handicapWeight', 'currentWeight', 'gearInfo', 'jockey', 'trainer']);
  const guard = (value, allowed) => new Proxy(value, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      if (!allowed.has(prop)) throw new Error(`unexpected read ${prop}`);
      return target[prop];
    }
  });
  const guardedRace = guard({
    distance: 1400,
    go_ch: '好地',
    go_en: 'GOOD',
    raceTrack: guard({ description_ch: '草地', description_en: 'TURF' }, new Set(['description_ch', 'description_en'])),
    raceCourse: guard({ description_ch: '沙田', description_en: 'Sha Tin', displayCode: 'AWT', venueCode: 'ST' }, new Set(['description_ch', 'description_en', 'displayCode'])),
    runners: [guard({
      no: 1,
      barrierDrawNumber: 4,
      handicapWeight: '120',
      currentWeight: '1100',
      gearInfo: 'B',
      jockey: guard({ code: 'PZ', name_ch: '潘頓', name_en: 'Zac' }, new Set(['code'])),
      trainer: guard({ code: 'SC', name_ch: '蔡約翰', name_en: 'Size' }, new Set(['code'])),
      name_ch: '金槍六十',
      winOdds: 1.1,
      currentRating: 130,
      last6run: '1',
      trainerPreference: '1',
      horse: { code: 'G160' }
    }, allowedRunner)],
    venueCode: 'ST',
    penetrometerReadings: [{ reading: 2.8 }],
    changeHistories: [{ handicapWeight: '90' }],
    wageringFieldSize: 12,
    detail: '1200米 草地'
  }, new Set(['distance', 'go_ch', 'go_en', 'raceTrack', 'raceCourse', 'runners']));
  assert.equal(predictWithPackS([node('01', '5')], guardedRace)[0].winProb, 25.1);

  for (const name of SECTION_5) {
    assert.equal(PACK_SOURCE.includes(name), false, name);
    assert.equal(RACES_SOURCE.includes(name), false, name);
  }
  assert.doesNotMatch(PACK_SOURCE, /\bactualWeight\b|\bjockey_ch\b|\btrainer_ch\b|\bname_ch\b|\bname_en\b|\bvenueCode\b|\bwageringFieldSize\b|\.horse\.code\b/);
  assert.doesNotMatch(PACK_SOURCE, /officialResults|resultsall|racing\.hkjc|bet\.hkjc|toISOString|fetch\(|winRate|\bstarts\b|\bwins\b/);
  assert.doesNotMatch(PACK_SOURCE, /^import /m);
});

test('locked query documents keep their SHA-256 and length', () => {
  assert.equal(createHash('sha256').update(RACE_MEETINGS_QUERY).digest('hex'), MEETING_SHA);
  assert.equal(createHash('sha256').update(WIN_POOL_QUERY).digest('hex'), POOL_SHA);
  assert.equal(RACE_MEETINGS_QUERY.length, 4497);
  assert.equal(WIN_POOL_QUERY.length, 1005);
  const queries = fs.readFileSync(new URL('../api/officialQueries.js', import.meta.url), 'utf8');
  assert.match(queries, /barrierDrawNumber/);
  assert.match(queries, /handicapWeight/);
  assert.match(queries, /currentWeight/);
  assert.match(queries, /gearInfo/);
  assert.match(queries, /go_ch/);
  assert.match(queries, /go_en/);
  assert.match(queries, /raceTrack/);
  assert.match(queries, /displayCode/);
  assert.doesNotMatch(queries, /GP_PACK_S/);
});

test('no committed environment file turns the flag on', () => {
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
    assert.doesNotMatch(text, /GP_PACK_S\s*=\s*['"]?1['"]?/, file);
  }
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /預測只根據當前會議的獨贏賠率，不能按日期或馬場查詢其他賽事。/);
});

test('flag on reads the current meeting card and does not filter it by date or venue', async () => {
  const nodes = [node('01', '5', { hotFavourite: true, oddsDropValue: '8', winOdds: 1.4 })];
  const first = {
    id: 'FIRST',
    venueCode: 'ST',
    date: '2020-01-01',
    changeHistories: [{ handicapWeight: '100', runnerNo: 1 }],
    races: [{
      no: 1,
      distance: 1400,
      go_ch: '好地',
      go_en: 'GOOD',
      raceTrack: { description_ch: '草地', description_en: 'TURF' },
      runners: [{ no: 1, barrierDrawNumber: 4, handicapWeight: '120', currentWeight: '1100', gearInfo: 'B', jockey: { code: 'PZ' }, trainer: { code: 'SC' }, winOdds: 2 }]
    }]
  };
  const second = {
    id: 'SECOND',
    venueCode: 'HV',
    date: '2099-01-01',
    races: [{ no: 1, runners: [{ no: 1, barrierDrawNumber: 1, handicapWeight: '50' }] }]
  };
  const active = { races: [{ no: 1, runners: [{ no: 1, barrierDrawNumber: 1 }] }] };
  const { res, calls } = await invoke(
    { type: 'predict', race: '1', date: '2099-01-01', venue: 'HV' },
    async (_url, _init, seen) => {
      const operation = seen.at(-1).body.operationName;
      if (operation === 'sp4e_racing_pmPool') {
        return jsonResponse(200, { data: { raceMeetings: [{ pmPools: [{ oddsType: 'WIN', leg: { number: 1, races: [1] }, oddsNodes: nodes }] }] } });
      }
      if (operation === 'raceMeetings') {
        return jsonResponse(200, { data: { activeMeetings: [active], raceMeetings: [first, second] } });
      }
      throw new Error(`unexpected ${operation}`);
    },
    { GP_PACK_S: '1' }
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, GRAPHQL_URL);
  assert.equal(calls[1].url, GRAPHQL_URL);
  assert.equal(calls[0].body.query, WIN_POOL_QUERY);
  assert.deepEqual(calls[0].body.variables, { oddsTypes: ['WIN'], raceNo: 1 });
  assert.equal(calls[0].body.variables.date, undefined);
  assert.equal(calls[0].body.variables.venueCode, undefined);
  assert.equal(calls[1].body.query, RACE_MEETINGS_QUERY);
  assert.equal(createHash('sha256').update(calls[1].body.query).digest('hex'), MEETING_SHA);
  assert.deepEqual(calls[1].body.variables, {});
  assert.equal(calls.some((call) => String(call.url).includes('racing.hkjc.com')), false);
  assert.equal(calls.some((call) => String(call.url).includes('resultsall')), false);
  assert.equal(calls.some((call) => String(call.url).includes('bet.hkjc.com')), false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.currentMeeting, true);
  assert.equal(res.body.race, 1);
  assert.equal(res.body.date, undefined);
  assert.equal(res.body.venue, undefined);
  assert.equal(res.body.model, PACK_S_MODEL);
  assert.notEqual(res.body.model, 'Odds-based probability model');
  const race = currentMeetingRace({ activeMeetings: [active], raceMeetings: [first, second] }, 1);
  assert.equal(race.runners[0].barrierDrawNumber, 4);
  assert.equal(currentMeetingRace({ raceMeetings: [first, second] }, '2'), null);
  assert.deepEqual(res.body.predictions, predictWithPackS(nodes, race));
  assert.equal(res.body.predictions[0].odds, 5);
  assert.equal(res.body.predictions[0].winProb, 25.1);
  assert.equal(JSON.stringify(res.body).includes('2099-01-01'), false);
  assert.equal(JSON.stringify(res.body).includes('resultsall'), false);

  const odds = await invoke(
    { type: 'odds', race: '1', date: '2099-01-01', venue: 'HV' },
    async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [{ id: 'POOL', oddsType: 'WIN', leg: { races: [1] }, oddsNodes: nodes }] }] } }),
    { GP_PACK_S: '1' }
  );
  assert.equal(odds.calls.length, 1);
  assert.equal(odds.calls[0].body.operationName, 'sp4e_racing_pmPool');
  assert.equal(odds.res.body.model, undefined);
  assert.equal(odds.res.body.data[0].id, 'POOL');

  const meetings = await invoke(
    { type: 'meetings', date: '2099-01-01', venue: 'HV' },
    async () => jsonResponse(200, { data: { raceMeetings: [first] } }),
    { GP_PACK_S: '1' }
  );
  assert.equal(meetings.calls.length, 1);
  assert.deepEqual(meetings.calls[0].body.variables, {});
  assert.equal(meetings.res.body.data[0].id, 'FIRST');
});

test('flag on reports source failures and does not fall back to official results', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  });
  const raw = 'ip 203.0.113.9 is not on the HKJC whitelist';
  const cardFailure = await invoke(
    { type: 'predict', race: '3', date: '2026-11-22', venue: 'ST' },
    async (_url, _init, seen) => {
      if (seen.at(-1).body.operationName === 'sp4e_racing_pmPool') {
        return jsonResponse(200, { data: { raceMeetings: [{ pmPools: [{ oddsType: 'WIN', leg: { races: [3] }, oddsNodes: [node('01', '5')] }] }] } });
      }
      return jsonResponse(200, { errors: [{ message: raw, extensions: { code: 'WHITELIST_ERROR' } }] });
    },
    { GP_PACK_S: '1' }
  );
  assert.equal(cardFailure.calls.length, 2);
  assert.equal(cardFailure.calls[1].body.query, RACE_MEETINGS_QUERY);
  assert.equal(cardFailure.res.statusCode, 502);
  assert.equal(cardFailure.res.body.success, false);
  assert.equal(cardFailure.res.body.error, 'SOURCE_WHITELIST');
  assert.equal(cardFailure.res.body.message, USER_FACING_MESSAGE);
  assert.equal(cardFailure.res.body.predictions, undefined);
  assert.equal(JSON.stringify(cardFailure.res.body).includes(raw), false);
  assert.match(logs.join('\n'), /203\.0\.113\.9/);

  const oddsFailure = await invoke(
    { type: 'predict', race: '3' },
    async () => jsonResponse(200, { errors: [{ message: 'INVALID_GRAPHQL document rejected', extensions: { code: 'INVALID_GRAPHQL' } }] }),
    { GP_PACK_S: '1' }
  );
  assert.equal(oddsFailure.calls.length, 1);
  assert.equal(oddsFailure.calls[0].body.operationName, 'sp4e_racing_pmPool');
  assert.equal(oddsFailure.res.body.error, 'SOURCE_INVALID_GRAPHQL');
  assert.equal(oddsFailure.res.body.success, false);

  const invalid = await invoke(
    { type: 'predict', race: '0', date: '2026-11-22', venue: 'ST' },
    async () => { throw new Error('should not fetch'); },
    { GP_PACK_S: '1' }
  );
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.res.statusCode, 400);
  assert.deepEqual(invalid.res.body, { success: false, error: 'Invalid race' });

  const previous = process.env.GP_PACK_S;
  process.env.GP_PACK_S = '0';
  try {
    const off = await invoke(
      { type: 'predict', race: '1' },
      async () => jsonResponse(200, { data: { raceMeetings: [{ pmPools: [{ oddsType: 'WIN', leg: { races: [1] }, oddsNodes: [node('01', '3.5')] }] }] } })
    );
    assert.equal(off.calls.length, 1);
    assert.equal(off.res.body.model, 'Odds-based probability model');
    assert.deepEqual(off.res.body.predictions, predictFromNodes([node('01', '3.5')]));
  } finally {
    if (previous === undefined) delete process.env.GP_PACK_S;
    else process.env.GP_PACK_S = previous;
  }
});
