import { AllMiddlewareArgs, App, LogLevel, SlackEventMiddlewareArgs } from "@slack/bolt";
import { StringIndexed } from "@slack/bolt/dist/types/helpers";
import { flatten } from "lodash";
import pollen from "../modules/pollen";
import quote from "../modules/quote";
import roll from "../modules/roll";
import summon from "../modules/summon";
import weather from "../modules/weather";
import RobotStorage from "./robotStorage";

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  real_name: string;
  status_text: string;
  status_emoji: string;
  image_72: string;
}

export interface Message {
  text?: string;
  ts: string;
  type: string;
  user: string;
  id: number;
}

export type RobotMessageHandler = (e: SlackEventMiddlewareArgs<"message"> & AllMiddlewareArgs<StringIndexed> & {match: RegExpMatchArray}) => Promise<void>;

export default class Robot {
  public storage: RobotStorage;
  public app: App;
  public helps: Record<string, [string, string][]>;
  public users: Record<string, User>;
  public listeners: [string | RegExp, RobotMessageHandler][];
  public robotListeners: [string | RegExp, RobotMessageHandler][];
  public botName = "bb";

  constructor () {
    this.storage = new RobotStorage();

    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
      logLevel: LogLevel.DEBUG,
      port: parseInt(process.env.PORT || '') || 3000,
    });

    this.helps = {};
    this.users = {};
    this.listeners = [];
    this.robotListeners = [];

    if (process.env.BROBBOT_BOT_NAME) {
      this.botName = process.env.BROBBOT_BOT_NAME;
    }
  }

  public async start () {
    await Promise.all([
      this.app.start(),
      this.allUsers(),
      this.storage.checkVersion(),
      this.storage.initTables(),
      weather(this),
      quote(this),
      pollen(this),
      summon(this),
      roll(this),
    ]);
    this.handleMessages();
    this.handleHelp();
  }

  public helpCommands (group: string, commands: [string, string][]) {
    this.helps[group] = commands;
  }

  public async userForId (id: string) {
    if (this.users[id]) {
      return this.users[id];
    }
    const user = (await this.app.client.users.profile.get({id})).profile as User;
    this.users[id] = user;
    return user;
  }

  public userForName (name: string) {
    return name ? Object.values(this.users).find(user => `${user.first_name}`.toLowerCase().includes(name.toLowerCase())) : undefined;
  }

  public async allUsers () {
    const users = (await this.app.client.users.list()).members?.map((user) => ({id: user.id, ...user.profile})) as User[];
    users.forEach((user) => {
      if (user.id) {
        this.users[user.id] = user;
      }
    });
    return users;
  }

  public message (pattern: string | RegExp, listener: RobotMessageHandler) {
    this.listeners.push([pattern, listener]);
  }

  public robotMessage (pattern: string | RegExp, listener: RobotMessageHandler) {
    this.robotListeners.push([pattern, listener]);
  }

  private handleMessages () {
    this.app.message('', async (e) => {
      const {message} = e;

      if (message.subtype === undefined) {
        console.log(`saw message: ${message.text}`);

        if (message.text?.match(new RegExp(`^${this.botName}\\b`, 'i'))) {
          this.robotListeners.find(([pattern, listener]) => {
            const match = message.text?.replace(new RegExp(`^${this.botName}\\s+`, 'i'), '').match(pattern);
            if (!match) {
              return false;
            }
            listener({...e, match});
            return true;
          });
        }
        else {
          this.listeners.forEach(([pattern, listener]) => {
            const match = message.text?.match(pattern);
            if (!match) {
              return;
            }
            listener({...e, match});
          })
        }
      }
    });
  }

  //render a markdown block with each module in its own section
  private handleHelp() {
    this.robotMessage(/^help\s*$/i, async ({say}) => {
      const blocks = Object.keys(this.helps).map((group) => {
        const commands = this.helps[group];
        return [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: group
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: commands.map(([command, description]) => `\`${command}\`: ${description}`).join('\n\n')
            }
          },
          {
            type: 'divider'
          }
        ];
      });
      say({
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: 'brobbot commands'
            }
          },
          ...flatten(blocks).slice(0, -1),
        ]
      })
    });
  }
}