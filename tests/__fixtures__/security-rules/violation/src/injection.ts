interface Db {
  query(sql: string): Promise<unknown>;
}

// Template interpolation reaching a query sink: possible SQL injection.
export function findUser(db: Db, id: string): Promise<unknown> {
  return db.query(`SELECT * FROM users WHERE id = ${id}`);
}
