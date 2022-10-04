import postgres, { Sql } from "postgres";

export default class RobotStorage {
  public pg: Sql;

  constructor() {
    this.pg = postgres();
  }

  public async userForId(id: string) {
    return this.pg`
      SELECT * FROM users WHERE id = ${id}
    `;
  }
}