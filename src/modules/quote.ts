// Description:
//   Remember messages and quote them back
//
// Configuration:
//   BROBBOT_QUOTE_CACHE_SIZE=N - Cache the last N messages for each user for potential remembrance (default 25).

import Robot, { Message, User } from "../robot/robot";

var CACHE_SIZE = process.env.BROBBOT_QUOTE_CACHE_SIZE ? parseInt(process.env.BROBBOT_QUOTE_CACHE_SIZE) : 25;

var regexTest = new RegExp("^/.+/$");
var regexExtract = new RegExp("^/(.*)/$");

function isRegex(text: string) {
  return regexTest.test(text);
}

interface MessageRow {
  id: number;
  text_raw: string;
  user_id: string;
  is_stored: boolean;
  created_at: string;
  last_quoted_at: string;
}

function rowToMessage (row: MessageRow) {
  return {
    id: row.id,
    text: row.text_raw,
    user: row.user_id,
  } as Message;
}

function stringToTsQuery (text: string) {
  return text.replace(/[^\w\s]*/g, '').trim().split(/\s+/g).join(' & ');
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
      text_searchable tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text_raw, ''))) STORED,
      user_id varchar(50),
      created_at timestamp,
      last_quoted_at timestamp,
      is_stored boolean
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS text_searchable_idx ON ${sql(tableName)} USING GIN (text_searchable)`;
  await sql`CREATE INDEX IF NOT EXISTS created_at_idx ON ${sql(tableName)} (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS last_quoted_at_idx ON ${sql(tableName)} (last_quoted_at)`;
  await sql`CREATE INDEX IF NOT EXISTS is_stored_idx ON ${sql(tableName)} (is_stored)`;

  const messageTmpl = async (message: Message) => {
    const user = await robot.userForId(message.user);
    return `${user.first_name || user.real_name}: ${message.text}`;
  };

  const cacheMessage = async (message: Message) => {
    return await sql.begin(async (sql) => {
      const size = await sql`
        SELECT
          count(*) AS size
        FROM
          ${sql(tableName)}
        WHERE
          is_stored = false
          AND user_id = ${message.user}
        GROUP BY
          is_stored
      `;
      if (size.length > 0 && size[0].size >= CACHE_SIZE) {
        const oldest = await sql`
          SELECT
            id
          FROM
            ${sql(tableName)}
          WHERE
            is_stored = false
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
          text_raw: message.text,
          user_id: message.user,
          is_stored: false,
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

    try {
      return await sql.begin(async (sql) => {
        const result = await sql`
          SELECT
            *
          FROM
            ${sql(tableName)}
          WHERE
            text_searchable @@ to_tsquery(${stringToTsQuery(text)})
            AND user_id = ${user.id}
            AND is_stored = ${!is_stored}
          ORDER BY
            ${is_stored ? sql`created_at DESC` : sql`last_quoted_at DESC, created_at DESC`}
          LIMIT 1
        `;

        const message = result[0] as MessageRow;
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

        return rowToMessage(message);
      });
    }
    catch (err) {
      console.error(`error storing message: ${err}`);
      return null;
    }
  };

  const searchStoredMessages = async (username: string, text: string, limit: number = 20) => {
    const user = robot.userForName(username);
    let results;

    try {
      if (isRegex(username) || isRegex(text)) {
        results = (await sql`
          SELECT
            *
          FROM
            ${sql(tableName)}
          WHERE
            is_stored = true
            AND text_raw ~* ${(isRegex(username) ? username : text).replace(regexExtract, '$1')}
            ${user ? sql`AND user_id = ${user.id}` : sql``}
          ORDER BY
            random()
          LIMIT ${limit}
        `) as MessageRow[];
      }
      else {
        results = (await sql`
          SELECT
            *
          FROM
            ${sql(tableName)}
          WHERE
            is_stored = true
            ${(text || (username && !user)) ? sql`AND text_searchable @@ to_tsquery(${stringToTsQuery(user ? text : `${username} ${text}`)})` : sql``}
            ${user ? sql`AND user_id = ${user.id}` : sql``}
          ORDER BY
            random()
          LIMIT ${limit}
        `) as MessageRow[];
      }
    }
    catch (err) {
      console.error(`error searching quotes: ${err}`)
      return [];
    }

    return results.map(row => rowToMessage(row));
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

    const messages = await searchStoredMessages(username, text, 1);
    if (messages && messages.length > 0) {
      const message = messages[0];
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

    const messages = await searchStoredMessages(username, text, limit);
    if (messages && messages.length > 0) {
      const messageStrings = await Promise.all(messages.map(async (message) => await messageTmpl(message)));
      say(messageStrings.join('\n\n'));
      messages.forEach(message => updateLastQuotedAt(message));
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