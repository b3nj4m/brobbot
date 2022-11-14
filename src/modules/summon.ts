import { sample } from "lodash";
import fetch from "node-fetch";
import Robot from "../robot/robot";

const API_URL = process.env.SUMMON_API_URL || '';
const API_KEY = process.env.SUMMON_API_KEY || '';
const TIMEOUT = Number(process.env.SUMMON_TIMEOUT || 120);

const initMessages = [
  'plagiarizing pixels',
  'appropriating artworks',
  'copying canvases',
  'inscribing images',
  'vectorizing visuals',
  'diffusing drawings',
  'fracturing figures',
  'generating graphics',
  'locating likenesses',
  'coalescing collages',
  'synthesizing sketches',
  'disintegrating doodles',
  'creating caricatures',
  'hyperscaling hieroglyphs'
];

const get = async (url: string, opts = {}) => {
  const response = await fetch(`${API_URL}${url}`, {
    ...opts,
    headers: {
      'x-api-key': API_KEY
    }
  });
  return (await response.json()) as any;
};

const sleep = async (seconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

const summon = (robot: Robot) => {
  robot.helpCommands('summon', [['summon [prompt]', 'generate an image based on `prompt`']]);

  robot.robotMessage(/^summon\s+(.+)/i, async ({say, match}) => {
    const query = match[1];
    const {id} = await get('/prod/images', {
      method: 'post',
      body: JSON.stringify({prompt: query}),
    });

    if (!id) {
      say('non.');
      console.error(`summon failed to start for: ${query}`);
      return;
    }

    say(`${sample(initMessages)}...`);

    const startTime = new Date().valueOf();
    const endTime = startTime + TIMEOUT * 1000;

    while (new Date().valueOf() < endTime) {
      const {status, message, imageUrl} = await get(`/prod/images/${id}`);

      console.log(`summon status: ${query}, ${status}, ${message}`);

      if (status === 'complete') {
        say(`voilà! <${imageUrl}|${query}>`);
        return;
      }
      else if (status !== 'initialized') {
        console.warn(`summon failed for: ${query} with status ${status}, ${message}`);
        return;
      }

      await sleep(3);
    }
    console.warn(`summon timed out for: ${query}`);
  });
};

export default summon;