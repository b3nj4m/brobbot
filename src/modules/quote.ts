// Description:
//   Remember messages and quote them back
//
// Configuration:
//   BROBBOT_QUOTE_CACHE_SIZE=N - Cache the last N messages for each user for potential remembrance (default 25).

import Robot, { Message, User } from "../robot/robot";
import {format} from "date-fns";

var CACHE_SIZE = process.env.BROBBOT_QUOTE_CACHE_SIZE ? parseInt(process.env.BROBBOT_QUOTE_CACHE_SIZE) : 25;

var regexTest = new RegExp("^/.+/$");
var regexExtract = new RegExp("^/(.*)/$");

function isRegex(text: string) {
  return regexTest.test(text);
}

type SearchType = 'REGEX' | 'USER' | 'TEXT';

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
    created_at: new Date(row.created_at),
  } as Message;
}

const quote = async (robot: Robot) => {
  robot.helpCommands('quote', [
    ['remember [user] [text]', 'remember most recent message from `user` containing `text`'],
    ['forget [user] [text]', 'forget most recent remembered message from `user` containing `text`'],
    ['quote [user?] [text?]', 'quote a random remembered message that is from `user` and/or contains `text`'],
    ['quotemash [user?] [text?]', 'quote some random remembered messages that are from `user` and/or contain `text`'],
    ['[user]mash', 'quote some random remembered messages that are from `user`'],
    ['[text]mash', 'quote some random remembered messages that contain `text`'],
    ['/[regex]/mash', 'quote some random remembered messages that matches `regex` (no spaces, use \\s instead)'],
  ]);

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

  const noResultsTmpl = async (searchType: SearchType, searchString: string, user?: User) => {
    return {
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `no results for ${searchType === 'REGEX' ? '`/' + searchString + '/`' : `*${searchString}*`}${searchType === 'USER' ? ` from ${(user?.first_name || user?.real_name)}` : ''}.`
        }
      }]
    }
  };

  const mashTmpl = async (messages: Array<Message>, searchType: SearchType, searchString: string, user?: User) => {
    let header;
    if (searchType === 'REGEX') {
      header = `quotes matching ` + '`' + searchString + '`:';
    }
    else if (searchType === 'USER') {
      if (searchString) {
        header = `quotes matching *${searchString}* from *${user?.first_name || user?.real_name}*:`;
      }
      else {
        header = `quotes from *${user?.first_name || user?.real_name}*:`;
      }
    }
    else {
      if (searchString) {
        header = `quotes matching *${searchString}*:`;
      }
      else {
        header = 'random quotes:';
      }
    }
    const messageBlocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: header
      }
    }];

    for (var i = 0; i < messages.length; i++) {
      messageBlocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: await messageTmpl(messages[i])
        }
      });
    }

    return {
      blocks: messageBlocks
    };
  };

  const rememberedTmpl = async (message: Message) => {
    return {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `remembered:`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: await messageTmpl(message)
          }
        }
      ]
    }
  };

  const forgotTmpl = async (message: Message) => {
    return {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `forgot:`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: await messageTmpl(message)
          }
        }
      ]
    }
  };

  const messageTmpl = async (message: Message): Promise<string> => {
    const user = await robot.userForId(message.user);
    const date = message.created_at || new Date();
    //date created at started being tracked was 2022-10-30
    const formattedDate = `${format(date, 'yyyy-MM-dd') === '2022-10-30' ? 'sometime before ' : ''}${format(date, 'PPP')}`;
    return `> ${message.text}\n> - ${user.first_name || user.real_name}, ${formattedDate}`;
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
            text_searchable @@ websearch_to_tsquery('english', ${text})
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

  const getSearchType = (username: string, text: string, user?: User): SearchType => {
    if (isRegex(username) || isRegex(text)) {
      return 'REGEX';
    }

    if (user) {
      return 'USER';
    }

    return 'TEXT';
  };

  const getSearchString = (username: string, text: string, searchType: SearchType): string => {
    let searchString;
    if (searchType === 'REGEX') {
      searchString = isRegex(username) ? username : text;
    }
    else if (searchType === 'USER') {
      searchString = text;
    }
    else {
      searchString = `${username} ${text}`;
    }
    return searchString.trim();
  };

  const searchStoredMessages = async (searchString: string, searchType: SearchType, user?: User, limit: number = 20) => {
    let results;

    try {
      if (searchType === 'REGEX') {
        results = (await sql`
          SELECT
            *
          FROM
            ${sql(tableName)}
          WHERE
            is_stored = true
            AND text_raw ~* ${searchString.replace(regexExtract, '$1')}
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
            ${searchString ? sql`AND text_searchable @@ websearch_to_tsquery('english', ${searchString})` : sql``}
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
      say(await rememberedTmpl(message));
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
      say(await forgotTmpl(message));
    }
    else {
      say('nope.');
    }
  });

  //TODO handle regex search text
  robot.robotMessage(/^quote($| )([^\s]*)?( (.*))?/i, async ({say, match}) => {
    const username = match[2] || '';
    const text = match[4] || '';

    const user = robot.userForName(username);
    const searchType = getSearchType(username, text, user);
    const searchString = getSearchString(username, text, searchType);
    const messages = await searchStoredMessages(searchString, searchType, user, 1);
    if (messages && messages.length > 0) {
      say(await mashTmpl(messages, searchType, searchString, user));
      updateLastQuotedAt(messages[0]);
    }
    else {
      say(await noResultsTmpl(searchType, searchString, user));
    }
  });

  robot.robotMessage(/^(quotemash( ([^\s]*))?( (.*))?)|((([^\s]+))mash)/i, async ({say, match}) => {
    const username = match[3] || match[8] || '';
    const text = match[5] || '';
    const limit = 10;

    const user = robot.userForName(username);
    const searchType = getSearchType(username, text, user);
    const searchString = getSearchString(username, text, searchType);
    const messages = await searchStoredMessages(searchString, searchType, user, limit);
    console.log('search type', searchType, 'search string', searchString, 'user', user);
    if (messages && messages.length > 0) {
      say(await mashTmpl(messages, searchType, searchString, user));
      messages.forEach(message => updateLastQuotedAt(message));
    }
    else {
      say(await noResultsTmpl(searchType, searchString, user));
    }
  });

  robot.message(/.*/, async ({message}) => {
    cacheMessage({id: 0, ...message} as Message);
  });
}

export default quote;