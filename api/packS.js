// Size S adjustments on top of the WIN odds baseline.
// GP_PACK_S is off unless the environment value is exactly the string "1".
// The numbers below are unmeasured implementation defaults. They are not
// fitted to results, not win rates, and not approval to enable the flag.
// 未量度的實作預設，不是勝率表，亦不是上線核准。

export const PACK_S_DEFAULTS = Object.freeze({
  barrierPointsPerDraw: 0.15,
  barrierReferenceDraw: 7,
  barrierMaxAbs: 1.5,
  handicapPointsPerPound: 0.02,
  handicapReferencePounds: 126,
  handicapMaxAbs: 1.5,
  weightPointsPerPound: 0.01,
  weightReferencePounds: 1150,
  weightMaxAbs: 1,
  totalMaxAbs: 3
});

export const PACK_S_MODEL = 'Odds baseline plus unmeasured Size S adjustments';

const BARRIER_PER = Math.round(PACK_S_DEFAULTS.barrierPointsPerDraw * 100);
const BARRIER_MAX = Math.round(PACK_S_DEFAULTS.barrierMaxAbs * 100);
const HANDICAP_PER = Math.round(PACK_S_DEFAULTS.handicapPointsPerPound * 100);
const HANDICAP_MAX = Math.round(PACK_S_DEFAULTS.handicapMaxAbs * 100);
const WEIGHT_PER = Math.round(PACK_S_DEFAULTS.weightPointsPerPound * 100);
const WEIGHT_MAX = Math.round(PACK_S_DEFAULTS.weightMaxAbs * 100);
const TOTAL_MAX = Math.round(PACK_S_DEFAULTS.totalMaxAbs * 100);

export function isPackSEnabled(env = process.env) {
  return !!env && env.GP_PACK_S === '1';
}

// Same expression as predictFromNodes in api/races.js, including the clamp.
function oddsBaseline(node) {
  const oddsVal = parseFloat(node.oddsValue) || 99;
  const prob = Math.min(95, Math.max(5, 100 / oddsVal * 1.2));
  return {
    horse: node.combString,
    odds: oddsVal,
    winProb: Math.round(prob * 10) / 10,
    confidence: oddsVal < 4 ? '高' : oddsVal < 8 ? '中' : '低',
    unrounded: prob
  };
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

export function horseNumber(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) return null;
    return value;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function readableText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

// Empty or whitespace-only gear is not a code. Do not substitute one.
export function readableGear(value) {
  const text = readableText(value);
  return text === '' ? null : text;
}

function trimmedCode(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

// Logical pair only. Not a tally and not a win rate. Names are not a fallback.
// A string form exists only when neither code contains "|".
export function jockeyTrainerPair(jockey, trainer) {
  const jockeyCode = trimmedCode(jockey && typeof jockey === 'object' ? jockey.code : undefined);
  const trainerCode = trimmedCode(trainer && typeof trainer === 'object' ? trainer.code : undefined);
  if (jockeyCode == null || trainerCode == null) return null;
  const text = jockeyCode.includes('|') || trainerCode.includes('|') ? null : `${jockeyCode}|${trainerCode}`;
  return { jockeyCode, trainerCode, text };
}

function linearHundredths(value, reference, perUnit, maxAbs) {
  const raw = (reference - value) * perUnit;
  const rounded = Math.round(raw);
  if (rounded > maxAbs) return maxAbs;
  if (rounded < -maxAbs) return -maxAbs;
  return rounded;
}

function capHundredths(total) {
  if (total > TOTAL_MAX) return TOTAL_MAX;
  if (total < -TOTAL_MAX) return -TOTAL_MAX;
  return total;
}

function hundredthsToPoints(hundredths) {
  return hundredths / 100;
}

function trackContextFrom(source) {
  const track = source.raceTrack;
  const course = source.raceCourse;
  const texts = [
    readableText(track && track.description_ch),
    readableText(track && track.description_en),
    readableText(course && course.description_ch),
    readableText(course && course.description_en),
    readableText(course && course.displayCode)
  ];
  return texts.some((text) => text !== '');
}

function runnersByNumber(runners) {
  const map = new Map();
  if (!Array.isArray(runners)) return map;
  for (const runner of runners) {
    const number = horseNumber(runner && runner.no);
    if (number == null || map.has(number)) continue;
    map.set(number, runner);
  }
  return map;
}

// Race-level track, distance, and going are context only: coefficient 0.
// Gear is a category code only: coefficient 0. No going, track, or gear table.
// Barrier, declared handicap, and current weight are the only numeric nudges.
export function packSAdjustment(input) {
  const source = input && typeof input === 'object' ? input : {};
  const barrier = positiveInteger(source.barrierDrawNumber);
  const handicap = positiveFiniteNumber(source.handicapWeight);
  const weight = positiveFiniteNumber(source.currentWeight);
  const gear = readableGear(source.gearInfo);
  const distance = positiveFiniteNumber(source.distance);
  const goingContext = readableText(source.go_ch) !== '' || readableText(source.go_en) !== '';
  const trackContext = trackContextFrom(source);
  const barrierHundredths = barrier == null
    ? 0
    : linearHundredths(barrier, PACK_S_DEFAULTS.barrierReferenceDraw, BARRIER_PER, BARRIER_MAX);
  const handicapHundredths = handicap == null
    ? 0
    : linearHundredths(handicap, PACK_S_DEFAULTS.handicapReferencePounds, HANDICAP_PER, HANDICAP_MAX);
  const weightHundredths = weight == null
    ? 0
    : linearHundredths(weight, PACK_S_DEFAULTS.weightReferencePounds, WEIGHT_PER, WEIGHT_MAX);
  const points = hundredthsToPoints(capHundredths(barrierHundredths + handicapHundredths + weightHundredths));
  return {
    points,
    barrierDraw: barrier,
    barrierPoints: hundredthsToPoints(barrierHundredths),
    handicap,
    handicapPoints: hundredthsToPoints(handicapHundredths),
    weight,
    weightPoints: hundredthsToPoints(weightHundredths),
    gear,
    gearPoints: 0,
    trackContext,
    trackPoints: 0,
    distance,
    distancePoints: 0,
    goingContext,
    goingPoints: 0
  };
}

function adjustmentInput(race, runner) {
  return {
    distance: race && race.distance,
    go_ch: race && race.go_ch,
    go_en: race && race.go_en,
    raceTrack: race && race.raceTrack,
    raceCourse: race && race.raceCourse,
    barrierDrawNumber: runner && runner.barrierDrawNumber,
    handicapWeight: runner && runner.handicapWeight,
    currentWeight: runner && runner.currentWeight,
    gearInfo: runner && runner.gearInfo
  };
}

export function predictWithPackS(nodes, race) {
  const runners = runnersByNumber(race && race.runners);
  return nodes.map((node) => {
    const base = oddsBaseline(node);
    const number = horseNumber(node.combString);
    const runner = number == null ? null : (runners.get(number) || null);
    const adjustment = packSAdjustment(adjustmentInput(race, runner));
    const adjusted = Math.min(95, Math.max(5, base.unrounded + adjustment.points));
    return {
      horse: base.horse,
      odds: base.odds,
      winProb: Math.round(adjusted * 10) / 10,
      confidence: base.confidence,
      baselineWinProb: base.winProb,
      adjustment: adjustment.points,
      packS: {
        barrierDraw: adjustment.barrierDraw,
        barrierPoints: adjustment.barrierPoints,
        handicap: adjustment.handicap,
        handicapPoints: adjustment.handicapPoints,
        weight: adjustment.weight,
        weightPoints: adjustment.weightPoints,
        gear: adjustment.gear,
        gearPoints: adjustment.gearPoints,
        trackContext: adjustment.trackContext,
        trackPoints: adjustment.trackPoints,
        distance: adjustment.distance,
        distancePoints: adjustment.distancePoints,
        goingContext: adjustment.goingContext,
        goingPoints: adjustment.goingPoints,
        pairing: jockeyTrainerPair(runner && runner.jockey, runner && runner.trainer)
      }
    };
  }).sort((a, b) => b.winProb - a.winProb).slice(0, 5);
}
