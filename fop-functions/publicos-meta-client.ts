// publicos-meta-client.ts — I/O com a Meta Marketing API (v25.0).
//   POST act_<id>/customaudiences   → cria o balde (uma vez por público)
//   POST <audience_id>/usersreplace → troca a lista inteira
//
// Por que `usersreplace` e não `users`: a doc oficial diz que o replace NÃO
// reseta a fase de aprendizado dos conjuntos que usam o público — é o que
// torna um sync diário viável. `users` (add) mexendo na composição, sim.
//
// Token: META_ADS_TOKEN (escopo ads_management) — NÃO é o META_CAPI_TOKEN.
const META_API_VERSION = "v25.0";
const GRAPH = "https://graph.facebook.com";
const MAX_RETRIES = 3;

function credenciais(): { adAccount: string; token: string } {
  const adAccount = Deno.env.get("META_AD_ACCOUNT_ID");
  const token = Deno.env.get("META_ADS_TOKEN");
  if (!adAccount || !token) {
    throw new Error("META_AD_ACCOUNT_ID e META_ADS_TOKEN são obrigatórios para públicos");
  }
  // Tolera o prefixo act_ na env para não quebrar por copy-paste do gerenciador.
  return { adAccount: adAccount.replace(/^act_/, ""), token };
}

export async function criarAudience(nome: string, descricao: string): Promise<string> {
  const { adAccount, token } = credenciais();
  const res = await fetch(`${GRAPH}/${META_API_VERSION}/act_${adAccount}/customaudiences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: nome,
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      description: descricao,
      access_token: token,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.id) {
    throw new Error(`criarAudience "${nome}": ${JSON.stringify(j?.error ?? j)}`);
  }
  return j.id as string;
}

export async function enviarLote(params: {
  audienceId: string;
  body: Record<string, unknown>;
}): Promise<{ ok: boolean; httpStatus: number; recebidos?: number; erro?: string }> {
  const { token } = credenciais();
  const url = `${GRAPH}/${META_API_VERSION}/${params.audienceId}/usersreplace`;

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params.body, access_token: token }),
      });
      const j = await res.json().catch(() => ({}));

      if (res.ok) {
        return { ok: true, httpStatus: res.status, recebidos: j?.num_received ?? undefined };
      }
      if (tentativa === MAX_RETRIES) {
        return { ok: false, httpStatus: res.status, erro: JSON.stringify(j?.error ?? j) };
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, tentativa - 1)));
    } catch (err) {
      if (tentativa === MAX_RETRIES) {
        return { ok: false, httpStatus: 0, erro: (err as Error).message };
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, tentativa - 1)));
    }
  }
  return { ok: false, httpStatus: 0, erro: "Max retries exceeded" };
}
