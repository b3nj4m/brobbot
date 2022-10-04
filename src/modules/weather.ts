// Configuration:
//   BROBBOT_WEATHER_MAPBOX_KEY=mysecretkey - Secret key for the mapbox api
//   BROBBOT_WEATHER_DARKSKY_KEY=mysecretkey - Secret key for the darksky api

import { App } from '@slack/bolt';
import https from 'https';
import Robot from '../robot/robot';

const BROBBOT_WEATHER_MAPBOX_KEY = process.env.BROBBOT_WEATHER_MAPBOX_KEY || '';
const BROBBOT_WEATHER_DARKSKY_KEY = process.env.BROBBOT_WEATHER_DARKSKY_KEY || '';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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

function geoCode(query) {
  return Promise.resolve().then(() => {
    return get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(BROBBOT_WEATHER_MAPBOX_KEY)}&limit=1`)
      .then((data: any) => {
        const {center, text} = data.features[0];
        return {center: center.reverse(), text};
      });
  });
}

function forecast(place) {
  return Promise.resolve().then(() => {
    return get(`https://api.darksky.net/forecast/${encodeURIComponent(BROBBOT_WEATHER_DARKSKY_KEY)}/${encodeURIComponent(place.center.join(','))}`)
      .then((forecast) => {
        return {place, forecast};
      });
  });
}

function forecastString(data) {
  const {currently, daily} = data.forecast;
  return `currently ${currently.summary} ${emojiName(currently.icon)} ${currently.temperature}°F; expected high ${daily.data[0].temperatureHigh}°F; ${daily.summary} ${emojiName(daily.icon)}`;
}

const emojiIcons = {
  'clear-day': 'sun_with_face',
  'clear-night': 'full_moon_with_face',
  'rain': 'rain_cloud',
  'snow': 'snowman',
  'sleet': 'snow_cloud',
  'wind': 'wind_blowing_face',
  'fog': 'fog',
  'cloudy': 'cloud',
  'partly-cloudy-day': 'partly_sunny',
  'partly-cloudy-night': 'partly_sunny',
  'tornado': 'tornado',
  'thunderstorm': 'lightning_cloud_and_rain',
  'hail': 'snow_cloud'
};
function emojiName(iconName) {
  return emojiIcons[iconName] ? `:${emojiIcons[iconName]}:` : '';
}


//TODO params of app, robot(storage, helpCommand, etc.)
const weather = (robot: Robot) => {
  robot.helpCommand("brobbot weather `query`", "Get the weather forecast for `query`");

  robot.app.message(/^(weather|forecast) (.+)/i, async ({message, say, body}) => {
    if (message.subtype === undefined) {
      const match = message.text?.match(/^(weather|forecast) (.+)/i);
      if (!match) {
        return;
      }
      try {
        const geo = await geoCode(match[2]);
        const fc = await forecast(geo);
        await say(`Weather for ${fc.place.text}: ${forecastString(fc)}`);
      }
      catch (err) {
        console.error(`brobbot-weather error: ${err}`);
        await say(`No results for ${match[2]} :(`);
      }
    }
  });
};

export default weather;