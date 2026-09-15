// publicos-meta.ts — montagem do payload de Custom Audience (puro, sem rede).
//
// Regras da doc oficial da Marketing API v25.0 (lida em 27/ago/2026):
//   - SHA-256 hex minúsculo em tudo, menos MADID e EXTERN_ID;
//   - e-mail: trim + lowercase; telefone: só dígitos, sem zero à esquerda;
//   - nomes e geo: minúsculo, sem pontuação; COUNTRY em ISO-2;
//   - máximo 10.000 registros por chamada, `session` costurando os lotes.
//
// EXTERN_ID vai hasheado (sha256 do CNPJ) DE PROPÓSITO: tem de ser byte-a-byte
// igual ao `external_id` que o capi-sender manda nos eventos, senão a Meta não
// casa público com evento. Consistência importa mais que o formato.
import { hashValue, normalizeGeo, normalizeName, normalizePhone } from "./capi-sender.ts";

export const SCHEMA_META = [
  "EMAIL",
  "PHONE",
  "FN",
  "LN",
  "CT",
  "ST",
  "ZIP",
  "COUNTRY",
  "EXTERN_ID",
] as const;

export const MAX_POR_CHAMADA = 10_000;

/** Abaixo disso a Meta não entrega o público — não vale gastar chamada. */
export const MIN_PUBLICO = 1_000;

export type LinhaPublico = {
  cnpj: string;
  email: string | null;
  phone: string | null;
  nome_contato: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
};

// A normalização vive em capi-sender.ts DE PROPÓSITO: público e evento têm de
// produzir o mesmo hash para o mesmo cliente. Duas implementações = duas regras
// que divergem na primeira manutenção.

export async function linhaParaData(linha: LinhaPublico): Promise<string[]> {
  const email = linha.email ? await hashValue(linha.email.trim().toLowerCase()) : "";

  let phone = "";
  if (linha.phone) {
    const normalizado = normalizePhone(linha.phone);
    if (normalizado) phone = await hashValue(normalizado);
  }

  let fn = "", ln = "";
  if (linha.nome_contato) {
    const partes = normalizeName(linha.nome_contato).split(" ").filter(Boolean);
    if (partes[0]) fn = await hashValue(partes[0]);
    if (partes.length > 1) ln = await hashValue(partes.slice(1).join(" "));
  }

  const cidadeLimpa = linha.cidade ? normalizeGeo(linha.cidade) : "";
  const ufLimpa = linha.uf ? normalizeGeo(linha.uf) : "";
  const ct = cidadeLimpa ? await hashValue(cidadeLimpa) : "";
  const st = ufLimpa ? await hashValue(ufLimpa) : "";
  const cepDigitos = linha.cep ? linha.cep.replace(/\D/g, "") : "";
  const zip = cepDigitos ? await hashValue(cepDigitos) : "";
  const country = await hashValue("br");
  const cnpjDigitos = linha.cnpj.replace(/\D/g, "");
  const externId = cnpjDigitos ? await hashValue(cnpjDigitos) : "";

  return [email, phone, fn, ln, ct, st, zip, country, externId];
}

export function chunk<T>(arr: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < arr.length; i += tamanho) lotes.push(arr.slice(i, i + tamanho));
  return lotes;
}

export function montarBody(params: {
  sessionId: number;
  batchSeq: number;
  ultimo: boolean;
  estimadoTotal: number;
  data: string[][];
}): {
  session: {
    session_id: number;
    batch_seq: number;
    last_batch_flag: boolean;
    estimated_num_total: number;
  };
  payload: { schema: readonly string[]; data: string[][] };
} {
  return {
    session: {
      session_id: params.sessionId,
      batch_seq: params.batchSeq,
      last_batch_flag: params.ultimo,
      estimated_num_total: params.estimadoTotal,
    },
    payload: { schema: SCHEMA_META, data: params.data },
  };
}
