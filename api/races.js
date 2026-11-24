// /api/races.js
const GRAPHQL_URL = 'https://info.cld.hkjc.com/graphql/base/';
const HEADERS = { 'Content-Type': 'application/json', 'Accept': '*/*', 'Origin': 'https://bet.hkjc.com', 'Referer': 'https://bet.hkjc.com/', 'User-Agent': 'Mozilla/5.0' };

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

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ operationName: 'raceMeetings', query, variables })
  });
  const json = await res.json();
  return json.data || {};
}

function getPastDates(days = 7) {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { type = 'meetings', race = '1', odds = 'WIN', date, venue = 'ST' } = req.query;

    if (type === 'meetings') {
      const data = await gql(RACE_MEETINGS_QUERY, {});
      const active = data.activeMeetings || [];
      if (active.length) {
        return res.status(200).json({ success: true, data: active, isLive: true });
      }
      const pastDates = getPastDates(5);
      for (const d of pastDates) {
        for (const v of ['ST', 'HV']) {
          const past = await gql(RACE_MEETINGS_QUERY, { date: d, venueCode: v });
          const meetings = past.raceMeetings || [];
          if (meetings.length && meetings[0].races?.length) {
            return res.status(200).json({ success: true, data: meetings, isLive: false, note: `顯示最近賽事 (${d})` });
          }
        }
      }
      return res.status(200).json({ success: true, data: [], note: '目前沒有進行中的賽事' });
    }

    if (type === 'races') {
      const today = date || new Date().toISOString().slice(0, 10);
      const data = await gql(RACE_MEETINGS_QUERY, { date: today, venueCode: venue });
      return res.status(200).json({ success: true, data: data.raceMeetings || [], date: today, venue });
    }

    if (type === 'odds') {
      const today = date || new Date().toISOString().slice(0, 10);
      const data = await gql(ODDS_QUERY, { date: today, venueCode: venue, oddsTypes: odds.split(','), raceNo: parseInt(race) });
      return res.status(200).json({ success: true, data: data.raceMeetings?.[0]?.pmPools || [] });
    }

    if (type === 'predict') {
      const today = date || new Date().toISOString().slice(0, 10);
      const oddsData = await gql(ODDS_QUERY, { date: today, venueCode: venue, oddsTypes: ['WIN'], raceNo: parseInt(race) });
      const nodes = oddsData.raceMeetings?.[0]?.pmPools?.[0]?.oddsNodes || [];
      const predictions = nodes.map(n => {
        const oddsVal = parseFloat(n.oddsValue) || 99;
        const prob = Math.min(95, Math.max(5, 100 / oddsVal * 1.2));
        return { horse: n.combString, odds: oddsVal, winProb: Math.round(prob * 10) / 10, confidence: oddsVal < 4 ? '高' : oddsVal < 8 ? '中' : '低' };
      }).sort((a, b) => b.winProb - a.winProb).slice(0, 5);
      return res.status(200).json({ success: true, race: parseInt(race), predictions, model: 'Odds-based probability model' });
    }

    return res.status(400).json({ success: false, error: 'Invalid type' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, note: 'HKJC API 暫時無法取得數據' });
  }
}
