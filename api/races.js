// /api/races.js
// Vercel Serverless Function using hkjc-api

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  try {
    const { HorseRacingAPI } = await import('hkjc-api');
    const api = new HorseRacingAPI();

    const { type = 'meetings', race = '1', odds = 'WIN,PLA' } = req.query;

    if (type === 'meetings') {
      const meetings = await api.getActiveMeetings();
      return res.status(200).json({ success: true, data: meetings });
    }

    if (type === 'races') {
      const races = await api.getAllRaces();
      return res.status(200).json({ success: true, data: races });
    }

    if (type === 'odds') {
      const oddsTypes = odds.split(',');
      const raceOdds = await api.getRaceOdds(parseInt(race), oddsTypes);
      return res.status(200).json({ success: true, data: raceOdds });
    }

    return res.status(400).json({ success: false, error: 'Invalid type' });
  } catch (error) {
    console.error('HKJC API Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      note: '可能目前沒有進行中的賽事，或 API 暫時不可用'
    });
  }
}
