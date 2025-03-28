// Description:
//   get the pollen count for a USA zip code
//
// Configuration:
//   BROBBOT_POLLEN_MAPBOX_KEY=mysecretkey - Secret key for the mapbox api

import fetch from 'node-fetch';
import Robot from '../robot/robot';
const MAPBOX_KEY = process.env.BROBBOT_POLLEN_MAPBOX_KEY || '';

async function get(url: string, opts?: any) {
  const response = await fetch(url, opts);
  return await response.json();
}

async function geoCode(query: string) {
  const cityResult = await get(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&access_token=${encodeURIComponent(MAPBOX_KEY)}&limit=1`) as any;
  const {coordinates} = cityResult.features[0].properties;
  const zipResult = await get(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${encodeURIComponent(coordinates.longitude)}&latitude=${encodeURIComponent(coordinates.latitude)}&types=postcode&access_token=${encodeURIComponent(MAPBOX_KEY)}&limit=1`)
  const {properties} = zipResult.features[0];
  return {zip: properties.name, text: `${properties.context.place.name}, ${properties.name}`};
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
  return periods.map((period: any) => `${period.Type}: ${forecastPeriod(period)}`).join('\n');
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
  robot.helpCommands('pollen', [["pollen [query]", "Get the pollen forecast for `query`"]]);

  robot.robotMessage(/^(pollen|cedar) (.+)/i, async ({say, message, match}) => {
    try {
      const {zip, text} = await geoCode(match[2]);
      const data = await forecast(zip);
      say(`Pollen forecast for ${text}:\n${forecastString(data)}`);
    }
    catch (err) {
      say(`No results for ${match[2]} :(`);
      console.error(`brobbot-pollen error: ${err}`);
    }
  });
};

export default pollen;