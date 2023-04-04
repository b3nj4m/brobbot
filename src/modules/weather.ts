import fetch from 'node-fetch';
import Robot from '../robot/robot';
import * as jose from 'jose';

const BROBBOT_WEATHER_APPLE_PRIVATE_KEY = process.env.BROBBOT_WEATHER_APPLE_PRIVATE_KEY || '';
const BROBBOT_WEATHER_APPLE_TEAM_ID = process.env.BROBBOT_WEATHER_APPLE_TEAM_ID || '';
const BROBBOT_WEATHER_APPLE_SERVICE_ID = process.env.BROBBOT_WEATHER_APPLE_SERVICE_ID || '';
const BROBBOT_WEATHER_APPLE_KEY_ID = process.env.BROBBOT_WEATHER_APPLE_KEY_ID || '';

async function get(url: string, authToken: string) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${authToken}`
    }
  });
  return await response.json();
}

async function geoCode(query: string, authToken: string) {
  const mapsToken = await generateMapsToken(authToken);

  const data = await get(`https://maps-api.apple.com/v1/geocode?q=${encodeURIComponent(query)}&lang=en-US`, mapsToken);

  console.log(`location: ${JSON.stringify(data)}`);
  return data.results[0];
}

async function forecast(place: any, authToken: string) {
    const forecast = await get(`https://weatherkit.apple.com/api/v1/weather/en-US/${encodeURIComponent(place.coordinate.latitude)}/${place.coordinate.longitude}?country=${place.countryCode}&dataSets=currentWeather,forecastDaily,weatherAlerts`, authToken);

    console.log(`forecast: ${JSON.stringify(forecast)}`);
    return {place, forecast};
}

function forecastString(data: any) {
  const {currentWeather, forecastDaily} = data.forecast;
  return `currently ${condition(currentWeather.conditionCode)} ${currentWeather.temperature}°C\nexpected high ${forecastDaily.days[0].temperatureMax}°C\n${condition(forecastDaily.days[0].conditionCode)}`;
}

const emojiIcons: Record<string, {description: string; icon: string}> = {
  BlowingDust: { description: 'Blowing dust', icon: 'wind_blowing_face' },
  Clear: { description: 'Clear', icon: 'sun_with_face' },
  Cloudy: { description: 'Cloudy', icon: 'cloud' },
  Foggy: { description: 'Fog', icon: 'fog' },
  Haze: { description: 'Haze', icon: 'fog' },
  MostlyClear: { description: 'Mostly clear', icon: 'partly_sunny' },
  MostlyCloudy: { description: 'Mostly cloudy', icon: 'partly_sunny' },
  PartlyCloudy: { description: 'Partly cloudy', icon: 'partly_sunny' },
  Smoky: { description: 'Smokey', icon: 'fog' },
  Breezy: { description: 'Breezy', icon: 'wind_blowing_face' },
  Windy: { description: 'Windy', icon: 'wind_blowing_face' },
  Drizzle: { description: 'Drizzle', icon: 'rain_cloud' },
  HeavyRain: { description: 'Heavy rain', icon: 'rain_cloud' },
  IsolatedThunderstorms: { description: 'Isolated thunderstorms', icon: 'lightning_cloud_and_rain' },
  Rain: { description: 'Rain', icon: 'rain_cloud' },
  SunShowers: { description: 'Rain with visible sun', icon: 'partly_sunny' },
  ScatteredThunderstorms: { description: 'Numerous thunderstorms spread across up to 50% of the forecast area', icon: 'lightning_cloud_and_rain' },
  StrongStorms: { description: 'Severe thunderstorms', icon: 'lightning_cloud_and_rain' },
  Thunderstorms: { description: 'Thunderstorms', icon: 'lightning_cloud_and_rain' },
  Frigid: { description: 'Frigid conditions, low temperatures, or ice crystals', icon: 'ice_cube' },
  Hail: { description: 'Hail', icon: 'snow_cloud' },
  Hot: { description: 'Hot', icon: 'fire' },
  Flurries: { description: 'Flurries', icon: 'snowman' },
  Sleet: { description: 'Sleet', icon: 'snow_cloud' },
  Snow: { description: 'Snow', icon: 'snowman' },
  SunFlurries: { description: 'Snow flurries with visible sun', icon: 'partly_sunny' },
  WintryMix: { description: 'Wintry mix', icon: 'snow_cloud' },
  Blizzard: { description: 'Blizzard', icon: 'snow_cloud' },
  BlowingSnow: { description: 'Blowing or drifting snow', icon: 'snow_cloud' },
  FreezingDrizzle: { description: 'Freezing drizzle', icon: 'snow_cloud' },
  FreezingRain: { description: 'Freezing rain', icon: 'snow_cloud' },
  HeavySnow: { description: 'Heavy snow', icon: 'snow_cloud' },
  Hurricane: { description: 'Hurricane', icon: 'cyclone' },
  TropicalStorm: { description: 'Tropical storm', icon: 'lightning_cloud_and_rain' },
};

function emojiName(iconName: string) {
  return emojiIcons[iconName] ? `:${emojiIcons[iconName].icon}:` : '';
}

function condition(conditionCode: string) {
  return emojiIcons[conditionCode] ? emojiIcons[conditionCode].description : '';
}

async function generateMapsToken(authToken: string) {
  const response = await fetch('https://maps-api.apple.com/v1/token', {
    headers: {
      'Authorization': `Bearer ${authToken}`
    }
  });

  const json = await response.json();

  console.log(`maps token: ${JSON.stringify(json)}`);

  return json.accessToken;
}

async function generateToken() {
  const alg = 'ES256';

  const privateKey = await jose.importPKCS8(BROBBOT_WEATHER_APPLE_PRIVATE_KEY, alg);

  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({
      alg,
      kid: BROBBOT_WEATHER_APPLE_KEY_ID,
      id: `${BROBBOT_WEATHER_APPLE_TEAM_ID}.${BROBBOT_WEATHER_APPLE_SERVICE_ID}`
    })
    .setIssuedAt()
    .setIssuer(BROBBOT_WEATHER_APPLE_TEAM_ID)
    .setSubject(BROBBOT_WEATHER_APPLE_SERVICE_ID)
    .setExpirationTime('24h')
    .sign(privateKey);

  console.log(`jwt: ${jwt}`);

  return jwt;
}

const weather = async (robot: Robot) => {
  const authToken = await generateToken();

  robot.helpCommands('weather', [["weather [query]", "Get the weather forecast for `query`"]]);

  robot.robotMessage(/^(weather|forecast) (.+)/i, async ({say, match}) => {
    try {
      const geo = await geoCode(match[2], authToken);
      const fc = await forecast(geo, authToken);
      await say(`Weather for ${fc.place.name}: ${forecastString(fc)}`);
    }
    catch (err) {
      console.error(`brobbot-weather error: ${err}`);
      await say(`No results for ${match[2]} :(`);
    }
  });
};

export default weather;