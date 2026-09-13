import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

export function getDb() {
  if (!env.databaseUrl) return null;
  const sql = neon(env.databaseUrl);
  return drizzle(sql, { schema });
}
