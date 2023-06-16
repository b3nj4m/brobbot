import fetch from 'node-fetch';
import Robot from '../robot/robot';

const BROBBOT_WEATHER_MAPBOX_KEY = process.env.BROBBOT_WEATHER_MAPBOX_KEY || '';
const BROBBOT_WEATHER_OW_API_KEY = process.env.BROBBOT_WEATHER_OW_API_KEY || '';

async function get(url: string) {
  const response = await fetch(url);

  console.log(`response code: ${response.status}`);

  return await response.json();
}

async function geoCode(query: string) {
  const data = await get(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(BROBBOT_WEATHER_MAPBOX_KEY)}&limit=1`);

  console.log(`location: ${JSON.stringify(data)}`);

  const {center, text} = data.features[0];
  return {center: center.reverse(), text};
}

async function forecast(place: any) {
    const forecast = await get(`https://api.openweathermap.org/data/3.0/onecall?units=imperial&lat=${place.center[0]}&lon=${place.center[1]}&appid=${BROBBOT_WEATHER_OW_API_KEY}`);

    console.log(`forecast: ${JSON.stringify(forecast)}`);

    return {place, forecast};
}

function forecastString(fc: any, geo: any) {
  const {current, daily} = fc.forecast;
  const {text} = geo;
  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Weather for ${text}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Currently*: ${emojiName(current.weather[0].icon)} ${current.weather[0].description} ${current.temp}°F.`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Today*: ${emojiName(current.weather[0].icon)} ${daily[0].summary}. High: ${daily[0].temp.max}°F, Low: ${daily[0].temp.min}°F.`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Tomorrow*: ${emojiName(daily[1].weather[0].icon)} ${daily[1].summary}. High: ${daily[1].temp.max}°F, Low: ${daily[1].temp.min}°F.`
        }
      }

    ]
  };
}

const emojiIcons: Record<string, string> = {
  '01d': 'sun_with_face',
  '01n': 'moon_with_face',
  '02d': 'partly_sunny',
  '02n': 'partly_sunny',
  '03d': 'partly_sunny',
  '03n': 'partly_sunny',
  '04d': 'partly_sunny',
  '04n': 'partly_sunny',
  '09d': 'rain_cloud',
  '09n': 'rain_cloud',
  '10d': 'rain_cloud',
  '10n': 'rain_cloud',
  '11d': 'lightning_cloud_and_rain',
  '11n': 'lightning_cloud_and_rain',
  '13d': 'snow_cloud',
  '13n': 'snow_cloud',
  '50d': 'fog',
  '50n': 'fog',
};

function emojiName(iconName: string) {
  return emojiIcons[iconName] ? `:${emojiIcons[iconName]}:` : '';
}

const weather = async (robot: Robot) => {
  robot.helpCommands('weather', [["weather [query]", "Get the weather forecast for `query`"]]);

  robot.robotMessage(/^(weather|forecast) (.+)/i, async ({say, match}) => {
    try {
      const geo = await geoCode(match[2]);
      const fc = await forecast(geo);
      await say(forecastString(fc, geo));
    }
    catch (err) {
      console.error(`brobbot-weather error: ${err}`);
      await say(`No results for ${match[2]} :(`);
    }
  });
};

export default weather;