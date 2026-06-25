// Gera docs/09-codigos.generated.md a partir das tabelas public.codigos_* (fonte da verdade).
// Uso: deno run -A scripts/gen-doc09.ts
// Lê via `supabase db query --linked` (usa a auth da CLI; --agent no = JSON limpo).

const OUT = "docs/09-codigos.generated.md";

async function q(sql: string): Promise<Record<string, string>[]> {
  const cmd = new Deno.Command("supabase", {
    args: ["db", "query", "--linked", "--agent", "no", "-o", "json", sql],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  return JSON.parse(new TextDecoder().decode(stdout));
}

function table(headers: string[], rows: string[][]): string {
  const h = `| ${headers.join(" | ")} |`;
  const sep = `|${headers.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${h}\n${sep}\n${body}`;
}

const canal = await q("select codigo, plataforma, utm_source, utm_medium, gera_via from codigos_canal where ativo order by ordem");
const objetivo = await q("select codigo, label from codigos_objetivo where ativo order by ordem");
const produto = await q("select codigo, label from codigos_produto where ativo order by ordem");
const publico = await q("select codigo, label from codigos_publico where ativo order by ordem");
const geo = await q("select codigo, label from codigos_geo where ativo order by ordem");

const md = [
  "# 09 — Códigos (gerado automaticamente)",
  "",
  "> ⚠️ NÃO EDITE À MÃO. Este arquivo é gerado de `public.codigos_*` no Supabase do FOP por `scripts/gen-doc09.ts`.",
  "> Para mudar um código, edite a tabela no Supabase e rode o script. As regras de prosa (GEO, CD, etc.) ficam no `09-naming-convention.md`.",
  "",
  "## CANAL",
  "",
  table(["Código", "Plataforma", "utm_source", "utm_medium", "gera_via"],
    canal.map((r) => [r.codigo, r.plataforma, r.utm_source, r.utm_medium, r.gera_via])),
  "",
  "## OBJETIVO",
  "",
  table(["Código", "Significado"], objetivo.map((r) => [r.codigo, r.label])),
  "",
  "## PRODUTO",
  "",
  table(["Código", "Produto / Tema"], produto.map((r) => [r.codigo, r.label])),
  "",
  "## PÚBLICO",
  "",
  table(["Código", "Quem é"], publico.map((r) => [r.codigo, r.label])),
  "",
  "## GEO",
  "",
  table(["Código", "Região / Estado"], geo.map((r) => [r.codigo, r.label])),
  "",
].join("\n");

await Deno.writeTextFile(OUT, md);
console.log(`OK: ${OUT} gerado (${canal.length} canais, ${objetivo.length} objetivos, ${produto.length} produtos, ${publico.length} públicos, ${geo.length} geos).`);
