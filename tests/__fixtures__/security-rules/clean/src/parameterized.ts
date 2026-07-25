interface Db {
  query(sql: string, params: readonly unknown[]): Promise<unknown>;
}

// Static SQL with bound parameters: the sink never sees attacker strings.
export function findUser(db: Db, id: string): Promise<unknown> {
  return db.query("SELECT * FROM users WHERE id = $1", [id]);
}
