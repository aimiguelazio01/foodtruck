import pg from "pg";
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
pg.types.setTypeParser(20, Number);
