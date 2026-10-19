import { PrismaClient } from "@ravi/db";

/**
 * Refuses databases that are not UTF-8. Windows' initdb defaults to WIN1252, which cannot store
 * Urdu (or most non-Latin text) and fails at runtime with "has no equivalent in encoding".
 */
export async function assertUtf8Database(url: string): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [row] = await client.$queryRaw<{ encoding: string }[]>`
      SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()`;
    if (row?.encoding !== "UTF8") {
      throw new Error(
        `Database encoding is ${row?.encoding ?? "unknown"}, expected UTF8. Recreate it with ENCODING 'UTF8' (Urdu text cannot be stored otherwise).`,
      );
    }
  } finally {
    await client.$disconnect();
  }
}
