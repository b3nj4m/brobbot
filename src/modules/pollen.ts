// Description:
//   get the pollen count for a USA zip code
//
// Configuration:
//   BROBBOT_POLLEN_MAPBOX_KEY=mysecretkey - Secret key for the mapbox api

import https from 'https';
import Robot from '../robot/robot';
const MAPBOX_KEY = process.env.BROBBOT_POLLEN_MAPBOX_KEY || '';

function get(url: string, opts?: any) {
  return new Promise((resolve, reject) => {
    https.get(url, opts || {}, (res) => {
      const d: string[] = [];

      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status ${res.statusCode}`));
      }

      res.on('data', (chunk) => d.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d.join('')));
        }
        catch (err) {
          reject(err);
        }
      });
    });
  });
}

async function geoCode(query: string) {
  const data = await get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(MAPBOX_KEY)}&limit=1&types=poi`) as any;
  const {context, text} = data.features[0];
  const zip = context.find((c: any) => /^postcode\b/.test(c.id)).text;
  return {zip, text};
}

async function forecast(place: any) {
  const url = `https://www.pollen.com/api/forecast/current/pollen/${encodeURIComponent(place)}`;
  const opts = {
    headers: {
      'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_1_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36',
      'Referer': url,
    }
  };

  const {Location} = await get(url, opts) as any;
  return Location;
}

function forecastString(data: any) {
  const {periods} = data;
  const [yesterday, today, tomorrow] = periods;
  return `Today: ${forecastPeriod(today)}, Tomorrow: ${forecastPeriod(tomorrow)}`;
}

function forecastPeriod(period: any) {
  return `${period.Triggers.map((t: any) => `${t.Name} ${t.PlantType}`).join(', ')} ${period.Index} ${forecastIcon(period.Index)}`;
}

function forecastIcon(index: number) {
  if (index <= 2.4) {
    return ':smile:';
  }
  if (index <= 4.8) {
    return ':slightly_smiling_face:';
  }
  if (index <= 7.2) {
    return ':neutral_face:';
  }
  if (index <= 9.6) {
    return ':slightly_frowning_face:';
  }
  return ':persevere:';
}


const pollen = (robot: Robot) => {
  robot.helpCommand("brobbot pollen `query`", "Get the pollen forecast for `query`");

  robot.robotMessage(/^(pollen|cedar) (.+)/i, async ({say, message, match}) => {
    try {
      const {zip, text} = await geoCode(match[2]);
      const data = await forecast(zip);
      say(`Pollen forecast for ${text}: ${forecastString(data)}`);
    }
    catch (err) {
      say(`No results for ${match[2]} :(`);
      console.error(`brobbot-pollen error: ${err}`);
    }
  });
};

export default pollen;