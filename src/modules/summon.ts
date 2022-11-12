import fetch from "node-fetch";
import Robot from "../robot/robot";

const API_URL = process.env.SUMMON_API_URL || '';
const API_KEY = process.env.SUMMON_API_KEY || '';
const TIMEOUT = Number(process.env.SUMMON_TIMEOUT || 120);

const get = async (url: string, opts = {}) => {
  const response = await fetch(`${API_URL}${url}`, {
    ...opts,
    headers: {
      'x-api-key': API_KEY
    }
  });
  return (await response.json()) as any;
};

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sleep = async (seconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

const summon = (robot: Robot) => {
  robot.robotMessage(/^summon\s+(.+)/i, async ({say, match}) => {
    const query = match[1];
    const {id} = await get("/prod/images", {
      method: 'post',
      body: JSON.stringify({prompt: query}),
    });

    say(`:smiling_imp: performing the dark ritual...`);

    const startTime = new Date().valueOf();
    const endTime = startTime + TIMEOUT * 1000;

    while (new Date().valueOf() < endTime) {
      const {status, message, imageUrl} = await get(`/prod/images/${id}`);

      console.log(`summon status: ${query}, ${status}, ${message}`);

      if (status === 'complete') {
        say(`:smiling_imp: a <${imageUrl}|${escape(query)}> appears before you!`);
        return;
      }

      await sleep(3);
    }
    console.warn(`summon timed out for: ${query}`);
  });
};

export default summon;