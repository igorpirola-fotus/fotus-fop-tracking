// funis.ts — quais pipelines do RD Station CRM contam como VENDA.
//
// POR QUE EXISTE (30/jul/2026): o CRM tem 10 pipelines e `status:won` aparece em
// vários — inclusive em funis que NÃO são de venda. O funil "MKT Movimentação"
// tinha 734 deals marcados como ganhos, TODOS na etapa "Descarte": são cards de
// processo de marketing, não pedidos. O backfill contou cada um como compra e
// somou no LTV; o rd-sync geraria `Purchase` para eles.
//
// Decisão do Igor (30/jul): contam como venda Funil Comercial, Funil BDR e Funil
// SDR. Conferido pelo custom field "Número do Pedido" que os três têm pedidos
// próprios, sem sobreposição entre si — não há contagem dupla (a suspeita
// inicial de que BDR/SDR só repassavam para o Comercial não se sustentou).
//
// Também conta **Fotus Charge**: é uma unidade de negócio distinta (não é o kit
// solar habitual) mas roda na mesma estrutura e **recebe leads de tráfego de
// performance** (Igor, 30/jul). Como a mídia paga alimenta esse funil, a venda
// dele é justamente o que o FOP existe para medir — deixá-lo fora seria mídia
// gerando receita sem conversão registrada. Em 30/jul ainda não tinha deal
// ganho, então não há efeito retroativo; passa a contar quando começar a fechar.
//
// Ficam de fora, todos confirmados pelo Igor como funis SECUNDÁRIOS de apoio a
// ações internas dos times, que não representam venda:
//   MKT Movimentação · INTERSOLAR NE 2026/BRINDES · [MKT] Oxigenação ·
//   FOTUS FINANCIA · Funil Cadastro Fotus
//   Funil IA SDR — ambiente isolado onde a Solange (IA) trabalha; quando ela
//   qualifica, MOVE o lead para o Funil SDR e o consultor fecha lá. A venda,
//   portanto, é contada no SDR — contar aqui também seria duplicar.
export const PIPELINES_VENDA: string[] = (
  Deno.env.get("RD_PIPELINES_VENDA") ||
  [
    "685d9b02b169f4001dd7f804", // Funil Comercial
    "688a45801a5566001921d886", // Funil BDR
    "68643e1eb11bf8001473affc", // Funil SDR
    "69e60a4c9b8aa90015d064d0", // Fotus Charge (unidade de negócio, recebe mídia paga)
  ].join(",")
).split(",").map((s) => s.trim()).filter(Boolean);

/** Extrai o pipeline_id de um deal (payload de webhook ou item de listagem). */
export function extractPipelineId(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const doc = (o.document as Record<string, unknown> | undefined) ?? o;
  const pipe = doc.deal_pipeline as Record<string, unknown> | undefined;
  const id = pipe?.id ?? doc.pipeline_id ?? o.pipeline_id;
  return id ? String(id) : null;
}

/** Nome do funil, quando o payload traz (só o webhook traz; a listagem não). */
export function extractPipelineNome(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const doc = (o.document as Record<string, unknown> | undefined) ?? o;
  const pipe = doc.deal_pipeline as Record<string, unknown> | undefined;
  return (pipe?.name as string) || null;
}

/** True quando o deal está num funil que representa venda de verdade. */
export function isFunilDeVenda(obj: unknown): boolean {
  const id = extractPipelineId(obj);
  // Sem pipeline identificável não se inventa: trata como não-venda, e o deal
  // fica registrado como skipped (auditável) em vez de virar um Purchase falso.
  return id !== null && PIPELINES_VENDA.includes(id);
}
