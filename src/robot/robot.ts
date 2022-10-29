import { AllMiddlewareArgs, App, LogLevel, SlackEventMiddlewareArgs } from "@slack/bolt";
import { StringIndexed } from "@slack/bolt/dist/types/helpers";
import RobotStorage from "./robotStorage";

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
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
  public helps: [string, string][];
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
    });

    this.helps = [];
    this.users = {};
    this.listeners = [];
    this.robotListeners = [];

    if (process.env.BROBBOT_BOT_NAME) {
      this.botName = process.env.BROBBOT_BOT_NAME;
    }
  }

  public async start () {
    await Promise.all([
      this.app.start(Number(process.env.PORT) || 3000),
      this.allUsers(),
      this.storage.checkVersion(),
    ]);
    this.handleMessages();
  }

  public helpCommand (command: string, description: string) {
    this.helps.push([command, description]);
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
    return Object.values(this.users).find(user => user.first_name.toLowerCase() === name.toLowerCase());
  }

  public async allUsers () {
    const users = (await this.app.client.users.list()).members?.map((user) => user.profile) as User[];
    users.forEach((user) => {
      this.users[user.id] = user;
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
    this.app.message(/.*/, async (e) => {
      const {message} = e;
      if (message.subtype === undefined) {
        if (message.text?.match(new RegExp(`^${this.botName}\b`))) {
          this.robotListeners.find(([pattern, listener]) => {
            const match = message.text?.replace(new RegExp(`^${this.botName}\s+`), '').match(pattern);
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
}