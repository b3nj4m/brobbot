import fetch from 'node-fetch';
import Robot from '../robot/robot';
import { find } from 'geo-tz';
import {TZDate, tzName} from '@date-fns/tz'
import {format} from 'date-fns'

const BROBBOT_WEATHER_MAPBOX_KEY = process.env.BROBBOT_WEATHER_MAPBOX_KEY || '';

async function get(url: string) {
  const response = await fetch(url);

  console.log(`response code: ${response.status}`);

  return await response.json();
}

async function geoCode(query: string) {
  const data = await get(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&access_token=${encodeURIComponent(BROBBOT_WEATHER_MAPBOX_KEY)}&limit=1`);
  const {properties} = data.features[0];
  const {coordinates, name} = properties;
  return {center: [coordinates.latitude, coordinates.longitude] as const, text: name};
}

function getLocalTime(lat: number, lng: number) {
  const [timezoneId] = find(lat, lng)
  if (!timezoneId) {
    console.error('unable to find timezone for lat/lng', lat, lng)
    return null
  }
  const localTime = new TZDate(new Date(), timezoneId)
  return {localTime, timezoneId}
}

const time = async (robot: Robot) => {
  robot.helpCommands('time', [["time [query]", "Get the current time for location `query`"]]);

  robot.robotMessage(/^(time) (.+)/i, async ({say, match}) => {
    try {
      const geo = await geoCode(match[2]);
      const localTimeResult = getLocalTime(...geo.center);
      if (localTimeResult && localTimeResult.localTime.timeZone) {
        const {localTime} = localTimeResult
        await say(`The local time for ${geo.text} is currently: ${format(localTime, 'PPPPpppp')} (${tzName(localTime.timeZone!, localTime, 'long')})`);
      }
      else {
        await say(`No results for ${match[2]} :(`);
      }
    }
    catch (err) {
      console.error(`brobbot-time error: ${err}`);
      await say(`No results for ${match[2]} :(`);
    }
  });
};

export default time;