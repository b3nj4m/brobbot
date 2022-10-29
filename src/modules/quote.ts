// Description:
//   Remember messages and quote them back
//
// Configuration:
//   BROBBOT_QUOTE_CACHE_SIZE=N - Cache the last N messages for each user for potential remembrance (default 25).
//   BROBBOT_QUOTE_STORE_SIZE=N - Remember at most N messages for each user (default 100).
//   BROBBOT_QUOTE_INIT_TIMEOUT=N - wait for N milliseconds for brain data to load from redis. (default 10000).
//   BROBBOT_QUOTE_SUBSTRING_MATCHING=true|false - whether to include substring matches when searching for quotes (default true).

import Robot, { Message, User } from "../robot/robot";
import {random} from 'lodash';

var STORE_SIZE = process.env.BROBBOT_QUOTE_STORE_SIZE ? parseInt(process.env.BROBBOT_QUOTE_STORE_SIZE) : 500;

const userNotFoundTmpls = [
  (username: string) => `I don't know any ${username}`,
  (username: string) => `${username} is lame.`,
  () => 'Who?'
];

const notFoundTmpls = [
  (text: string) => `I don't know anything about ${text}.`,
  () => "Wat.",
  () => "Huh?"
];

function randomItem(list: any[]) {
  return list[random(list.length - 1)];
}

//get random subset of items (mutates original list)
function randomItems(list: any[], limit: number) {
  var messages = new Array(Math.min(list.length, limit));

  for (var i = 0; i < messages.length; i++) {
    messages[i] = list.splice(random(list.length - 1), 1)[0];
  }

  return messages;
}

function userNotFoundMessage(username: string) {
  return randomItem(userNotFoundTmpls)({username: username});
}

function notFoundMessage(text: string) {
  return randomItem(notFoundTmpls)({text: text});
}

function emptyStoreMessage() {
  return "I don't remember any quotes...";
}

function isWords(text: string) {
  return /\b[\w]{2,}\b/.test(text);
}

var regexTest = new RegExp("^/.+/$");
var regexExtract = new RegExp("^/(.*)/$");

function isRegex(text: string) {
  return regexTest.test(text);
}

function regexMatches(text: string, message: Message) {
  var regex;
  try {
    regex = new RegExp(text.replace(regexExtract, '$1'), 'i');
    return regex.test(message.text || '');
  }
  catch (err) {
    return false;
  }
}

const quote = async (robot: Robot) => {
  robot.helpCommand('remember `user` `text`', 'remember most recent message from `user` containing `text`');
  robot.helpCommand('forget `user` `text`', 'forget most recent remembered message from `user` containing `text`');
  robot.helpCommand('quote [`user`] [`text`]', 'quote a random remembered message that is from `user` and/or contains `text`');
  robot.helpCommand('quotemash [`user`] [`text`]', 'quote some random remembered messages that are from `user` and/or contain `text`');
  robot.helpCommand('`user`mash', 'quote some random remembered messages that are from `user`');
  robot.helpCommand('`text`mash', 'quote some random remembered messages that contain `text`');
  robot.helpCommand('/ `regex` /mash', 'quote some random remembered messages that matches `regex`');

  const tableName = robot.storage.tableName('quotes');
  const sql = robot.storage.pg;

  await sql`
    CREATE TABLE IF NOT EXISTS
      ${sql(tableName)}
    (
      id BIGSERIAL PRIMARY KEY,
      text_raw text,
      text_searchable tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text_raw, '')) STORED,
      user_id varchar(50),
      created_at datetime,
      last_quoted_at datetime,
      is_stored boolean
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS text_searchable_idx ON ${sql(tableName)} USING GIN (text_searchable)`;
  await sql`CREATE INDEX IF NOT EXISTS created_at_idx ON ${sql(tableName)} (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS last_quoted_at_idx ON ${sql(tableName)} (last_quoted_at)`;
  await sql`CREATE INDEX IF NOT EXISTS is_stored_idx ON ${sql(tableName)} (is_stored)`;

  const messageTmpl = async (message: Message) => {
    const user = await robot.userForId(message.user);
    return `${user.first_name}: ${message.text}`;
  };

  const cacheMessage = async (message: Message) => {
    return await sql.begin(async (sql) => {
      const size = await sql`
        SELECT
          count(*) AS size
        FROM
          ${sql(tableName)}
        WHERE
          is_stored = 0
          AND user_id = ${message.user}
        GROUP BY
          is_stored
      `;
      if (size[0].size >= STORE_SIZE) {
        const oldest = await sql`
          SELECT
            id
          FROM
            ${sql(tableName)}
          WHERE
            is_stored = 0
            AND user_id = ${message.user}
          ORDER BY
            created_at ASC
          LIMIT 1
        `;

        await sql`
          DELETE FROM
            ${sql(tableName)}
          WHERE
            id = ${oldest[0].id}
        `;
      }

      return await sql`
        INSERT INTO
          ${sql(tableName)}
        ${sql({
          text: message.text,
          user_id: message.user,
          is_stored: 0,
          created_at: new Date().toISOString()
        })}
      `;
    });
  };

  const storeMessage = async (username: string, text: string, is_stored: boolean) => {
    //TODO need fancier user matching?
    const user = robot.userForName(username);

    if (!user) {
      console.warn(`couldn't find user ${username}`);
      return null;
    }

    return await sql.begin(async (sql) => {
      const result = await sql`
        SELECT
          *
        FROM
          ${sql(tableName)}
        WHERE
          text_searchable @@ to_tsquery(${text})
          AND user_id = ${user.id}
          AND is_stored = ${!is_stored}
        ORDER BY
          created_at DESC
        LIMIT 1
      `;

      const message = result[0];
      if (!message) {
        console.warn(`couldn't find message matching ${text}`);
        return null;
      }

      await sql`
        UPDATE
          ${sql(tableName)}
        SET
          is_stored = ${is_stored}
        WHERE
          id = ${message.id}
      `;

      return message as Message;
    });
  };

  const searchStoredMessages = async (username: string, text: string, limit: number = 20) => {
    const user = robot.userForName(username);

    return (await sql`
      SELECT
        *
      FROM
        ${sql(tableName)}
      WHERE
        is_stored = 1
        ${text ? sql`AND text_searchable @@ to_tsvector(${user ? text : `${username} ${text}`}` : ''})
        ${user ? sql`AND user_id = ${user.id}` : ''}
      LIMIT ${limit}
    `) as Message[];
  }

  const updateLastQuotedAt = async (messages: Message | Message[]) => {
    return await sql`
      UPDATE
        ${sql(tableName)}
      SET
        last_quoted_at = ${new Date().toISOString()}
      WHERE
        id IN (${Array.isArray(messages) ? sql(messages.map(message => message.id)) : messages.id})
    `;
  };

  robot.robotMessage(/^remember ([^\s]+) (.*)/i, async ({say, match}) => {
    const username = match[1] || '';
    const text = match[2] || '';

    const message = await storeMessage(username, text, true);
    if (message) {
      const messageString = await messageTmpl(message);
      say(`remembering ${messageString}`);
    }
    else {
      say('no.');
    }
  });

  robot.robotMessage(/^forget ([^\s]+) (.*)/i, async ({say, match}) => {
    const username = match[1] || '';
    const text = match[2] || '';

    const message = await storeMessage(username, text, false);
    if (message) {
      const messageString = await messageTmpl(message);
      say(`forgot: ${messageString}`);
    }
    else {
      say('nope.');
    }
  });

  //TODO handle regex search text
  robot.robotMessage(/^quote($| )([^\s]*)?( (.*))?/i, async ({say, match}) => {
    const username = match[2] || '';
    const text = match[4] || '';

    const messages = await searchStoredMessages(username, text);
    if (messages && messages.length > 0) {
      const message = randomItem(messages);
      const messageString = await messageTmpl(message);
      say(messageString);
      updateLastQuotedAt(message);
    }
    else {
      say('nah.');
    }
  });

  robot.robotMessage(/^(quotemash( ([^\s]*))?( (.*))?)|((([^\s]+))mash)/i, async ({say, match}) => {
    const username = match[3] || match[8] || '';
    const text = match[5] || '';
    const limit = 10;

    const messages = await searchStoredMessages(username, text, limit * 3);
    if (messages && messages.length > 0) {
      const messageStrings = await Promise.all(randomItems(messages, limit).map(async (message) => await messageTmpl(message)));
      say(messageStrings.join('\n'));
    }
    else {
      say('いいえ。');
    }
  });

  robot.message(/.*/, async ({message}) => {
    cacheMessage({id: 0, ...message} as Message);
  });
}

export default quote;