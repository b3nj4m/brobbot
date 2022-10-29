import postgres, { Sql } from "postgres";

export default class RobotStorage {
  public pg: Sql;
  public tablePrefix: string;

  constructor(tablePrefix: string = "brobbot_") {
    this.pg = postgres(process.env.DATABASE_URL || '', {
      debug: console.log,
      ssl: {
        rejectUnauthorized: false
      }
    });
    this.tablePrefix = tablePrefix;
  }

  public tableName (name: string) {
    return `${this.tablePrefix}${name}`;
  }

  public async checkVersion () {
    const version = await this.pg`SELECT VERSION()`;
    if (version.length === 0 || parseFloat(version[0].version.replace(/^postgresql /i)) < 9.4) {
      throw "Postgres version must be at least 9.4";
    }
  }

  public async initTables () {
    return await this.pg`
      CREATE TABLE IF NOT EXISTS ${this.pg(this.tableName('users'))}
        (id varchar(255) NOT NULL,
        name varchar(255),
        raw_data jsonb,
        UNIQUE (id),
        KEY name)`;
  }

}
