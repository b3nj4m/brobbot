import { App, LogLevel } from "@slack/bolt";
import RobotStorage from "./robotStorage";

export default class Robot {
  public storage: RobotStorage;
  public app: App;
  public helps: [string, string][] = [];

  constructor () {
    this.storage = new RobotStorage();

    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      logLevel: LogLevel.DEBUG,
    });
  }

  public async start () {
    return Promise.all([
      this.app.start(Number(process.env.PORT) || 3000),
      //TODO way to validate db connection here? maybe have to run a dummy query?
      this.storage.userForId('beans'),
    ]);
  }

  public helpCommand (command: string, description: string) {
    this.helps.push([command, description]);
  }
}