// Configuration:
//   BROBBOT_WEATHER_MAPBOX_KEY=mysecretkey - Secret key for the mapbox api
//   BROBBOT_WEATHER_DARKSKY_KEY=mysecretkey - Secret key for the darksky api

import fetch from 'node-fetch';
import Robot from '../robot/robot';

const BROBBOT_WEATHER_MAPBOX_KEY = process.env.BROBBOT_WEATHER_MAPBOX_KEY || '';
const BROBBOT_WEATHER_DARKSKY_KEY = process.env.BROBBOT_WEATHER_DARKSKY_KEY || '';

async function get(url: string) {
  const response = await fetch(url);
  return await response.json();
}

function geoCode(query: string) {
  return Promise.resolve().then(() => {
    return get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(BROBBOT_WEATHER_MAPBOX_KEY)}&limit=1`)
      .then((data: any) => {
        const {center, text} = data.features[0];
        return {center: center.reverse(), text};
      });
  });
}

function forecast(place: any) {
  return Promise.resolve().then(() => {
    return get(`https://api.darksky.net/forecast/${encodeURIComponent(BROBBOT_WEATHER_DARKSKY_KEY)}/${encodeURIComponent(place.center.join(','))}`)
      .then((forecast) => {
        return {place, forecast};
      });
  });
}

function forecastString(data: any) {
  const {currently, daily} = data.forecast;
  return `currently ${currently.summary} ${emojiName(currently.icon)} ${currently.temperature}°F; expected high ${daily.data[0].temperatureHigh}°F; ${daily.summary} ${emojiName(daily.icon)}`;
}

const emojiIcons: Record<string, string> = {
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

function emojiName(iconName: string) {
  return emojiIcons[iconName] ? `:${emojiIcons[iconName]}:` : '';
}

const weather = async (robot: Robot) => {
  robot.helpCommands('weather', [["weather `query`", "Get the weather forecast for `query`"]]);

  robot.robotMessage(/^(weather|forecast) (.+)/i, async ({say, match}) => {
    try {
      const geo = await geoCode(match[2]);
      const fc = await forecast(geo);
      await say(`Weather for ${fc.place.text}: ${forecastString(fc)}`);
    }
    catch (err) {
      console.error(`brobbot-weather error: ${err}`);
      await say(`No results for ${match[2]} :(`);
    }
  });
};

export default weather;