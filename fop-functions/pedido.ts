// pedido.ts — extração do "Número do Pedido" de um deal do RD Station CRM.
//
// POR QUE EXISTE (30/jul/2026): é a chave para conciliar o fop-db com a extração
// oficial de vendas. Sem ela, o de-para teria de ser por CNPJ+valor+data — e
// falharia exatamente nos casos que queremos encontrar (valor divergente).
//
// O campo aparece em DOIS formatos diferentes, dependendo da origem:
//   • WEBHOOK  → `deal_custom_fields: [{ value, custom_field: { label } }]`
//                (tem o label legível: "Número do Pedido")
//   • LISTAGEM → `custom_fields: { "<slug>-<hash>": valor }`
//                (só a chave sufixada, sem label — igual ao "cnpj-41d5" da
//                organização, que já nos surpreendeu uma vez)
// Por isso a busca cobre os dois, e devolve também as chaves encontradas para
// diagnóstico quando não acha nada.

const RX_PEDIDO = /pedido/i;

/**
 * Normaliza o número do pedido para o padrão do ERP: `<6-8 dígitos>-<2 dígitos>`.
 *
 * Regra definida pelo Igor (30/jul/2026) a partir do que apareceu no CRM:
 *   • falta o hífen (`1486589 98`, `148658998`) → INSERE o hífen
 *   • fora do padrão (`00`, `01`, `11111111111`, `13.402`) → DESCARTA (devolve "")
 *
 * Medido na conciliação: 364 dos 32.995 números do CRM eram lixo digitado, e
 * recuperar os que só perderam o hífen devolveu 71 pedidos ao de-para. Sem o
 * descarte, o lixo entra na conciliação como "pedido que não existe no ERP".
 */
export function normalizeNumeroPedido(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const bruto = String(raw).trim();
  if (!bruto) return "";

  // Já no padrão, com qualquer separador (hífen, espaço, barra, ponto).
  const comSeparador = bruto.match(/^(\d{6,8})[\s\-./]+(\d{2})$/);
  if (comSeparador) return `${comSeparador[1]}-${comSeparador[2]}`;

  // Só dígitos: os 2 últimos são o sufixo do ERP.
  const soDigitos = bruto.replace(/\D/g, "");
  if (/^\d+$/.test(bruto) && soDigitos.length >= 8 && soDigitos.length <= 10) {
    return `${soDigitos.slice(0, -2)}-${soDigitos.slice(-2)}`;
  }

  // Qualquer outra coisa é preenchimento inválido — não se adivinha pedido.
  return "";
}

/** Número do pedido, ou "" quando o deal não tem. */
export function extractNumeroPedido(deal: unknown): string {
  if (!deal || typeof deal !== "object") return "";
  const o = deal as Record<string, unknown>;
  const doc = (o.document as Record<string, unknown> | undefined) ?? o;

  // Formato do webhook: array com label legível.
  const arr = doc.deal_custom_fields as unknown[] | undefined;
  if (Array.isArray(arr)) {
    for (const item of arr) {
      const f = item as Record<string, unknown>;
      const label = (f.custom_field as Record<string, unknown> | undefined)?.label;
      if (typeof label === "string" && RX_PEDIDO.test(label)) {
        const norm = normalizeNumeroPedido(f.value);
        if (norm) return norm;
      }
    }
  }

  // Formato da listagem: objeto com chave sufixada.
  const obj = doc.custom_fields as Record<string, unknown> | undefined;
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (RX_PEDIDO.test(k)) {
        const norm = normalizeNumeroPedido(v);
        if (norm) return norm;
      }
    }
  }

  return "";
}

/**
 * Chaves de custom field disponíveis no deal — só os NOMES, nunca os valores.
 * Serve para descobrir o slug real quando `extractNumeroPedido` volta vazio.
 */
export function listarChavesCustomFields(deal: unknown): string[] {
  if (!deal || typeof deal !== "object") return [];
  const o = deal as Record<string, unknown>;
  const doc = (o.document as Record<string, unknown> | undefined) ?? o;
  const out: string[] = [];

  const arr = doc.deal_custom_fields as unknown[] | undefined;
  if (Array.isArray(arr)) {
    for (const item of arr) {
      const label = ((item as Record<string, unknown>).custom_field as
        | Record<string, unknown>
        | undefined)?.label;
      if (typeof label === "string") out.push(`label:${label}`);
    }
  }

  const obj = doc.custom_fields as Record<string, unknown> | undefined;
  if (obj && typeof obj === "object") out.push(...Object.keys(obj).map((k) => `key:${k}`));

  return out;
}
