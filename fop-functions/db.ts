// db.ts — camada de acesso Postgres (substitui o supabase-js das Edge Functions)
// Conecta direto no fop-db (EasyPanel) via DATABASE_URL. Sem PostgREST, sem RLS.
import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) throw new Error("DATABASE_URL não definido");

// Pool pequeno: as functions são de baixa concorrência por instância.
const pool = new Pool(DATABASE_URL, 4, true);

/** Executa SQL parametrizado e devolve as linhas. */
export async function q<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  const c = await pool.connect();
  try {
    const r = await c.queryObject<T>(sql, args);
    return r.rows;
  } finally {
    c.release();
  }
}

/** Primeira linha ou null. */
export async function one<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, args);
  return rows[0] ?? null;
}

/**
 * INSERT genérico a partir de um objeto {coluna: valor}.
 * Colunas com valor `undefined` são ignoradas. `null` é enviado.
 * opts.onConflict: "col" | "col DO NOTHING" | "col DO UPDATE"(default merge das colunas)
 * opts.returning: coluna a retornar (ex.: "id").
 */
export async function insert(
  table: string,
  obj: Record<string, unknown>,
  opts: { onConflict?: string; conflictDoNothing?: boolean; returning?: string } = {},
): Promise<Record<string, unknown> | null> {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${k}"`);
  const params = entries.map((_, i) => `$${i + 1}`);
  const args = entries.map(([, v]) => v);

  let sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${params.join(", ")})`;

  if (opts.onConflict) {
    if (opts.conflictDoNothing) {
      sql += ` ON CONFLICT (${opts.onConflict}) DO NOTHING`;
    } else {
      const updates = entries
        .filter(([k]) => k !== opts.onConflict)
        .map(([k]) => `"${k}" = EXCLUDED."${k}"`);
      sql += ` ON CONFLICT (${opts.onConflict}) DO UPDATE SET ${updates.join(", ")}`;
    }
  }
  if (opts.returning) sql += ` RETURNING ${opts.returning}`;

  return await one(sql, args);
}

/** UPDATE genérico: SET das colunas do obj WHERE whereCol = whereVal. */
export async function update(
  table: string,
  obj: Record<string, unknown>,
  whereCol: string,
  whereVal: unknown,
): Promise<void> {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`);
  const args = entries.map(([, v]) => v);
  args.push(whereVal);
  const sql = `UPDATE ${table} SET ${sets.join(", ")} WHERE "${whereCol}" = $${args.length}`;
  await q(sql, args);
}

/** Log de erro — nunca lança (o log não pode quebrar o handler). */
export async function logError(
  functionName: string,
  errorMessage: string,
  payload: unknown = null,
): Promise<void> {
  try {
    await insert("public.error_logs", {
      function_name: functionName,
      error_message: errorMessage,
      payload: payload === null ? null : JSON.stringify(payload),
    });
  } catch (_) {
    // silencioso
  }
}
