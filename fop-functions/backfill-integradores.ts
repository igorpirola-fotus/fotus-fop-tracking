// backfill-integradores.ts — reconstrói o histórico de compras em
// `public.integradores` a partir dos deals GANHOS do RD Station CRM.
//
// POR QUE EXISTE (29/jul/2026): com o CNPJ finalmente resolvido, o rd-sync
// passou a barrar no filtro seguinte — `integrador CNPJ ... não encontrado`.
// A base tem ~1.970 integradores (só quem passou pela LP) contra ~12.000 deals
// distintos por semana. Sem histórico, a compra de um cliente antigo seria
// contada como `Purchase` (primeira compra) e não `PurchaseRecorrente`,
// inflando justamente a conversão que as campanhas de aquisição otimizam.
//
// Desenho portado do doc 14 do projeto RD (era Edge Function no Supabase):
// processa N páginas por chamada e devolve `has_more`/`next_page`, para o
// workflow n8n fazer o loop sem timeout.
//
// IDEMPOTÊNCIA: a acumulação é SOMA, então cada deal é registrado em
// `public.rd_won_backfill` antes de somar. Rodar duas vezes não dobra o LTV.
import { one, q } from "./db.ts";
import { listWonDeals, resolveDealCnpj } from "./rd-crm-client.ts";
import { extractPipelineId, isFunilDeVenda } from "./funis.ts";

export interface BackfillResult {
  pagina_inicial: number;
  paginas_lidas: number;
  deals_lidos: number;
  contabilizados: number;
  ja_contabilizados: number;
  sem_cnpj: number;
  funil_fora_escopo: number;
  erros: number;
  has_more: boolean;
  next_page: number;
  dry_run: boolean;
  amostra_erros: string[];
}

/**
 * Preenche `pipeline_id` nas linhas de `rd_won_backfill` gravadas ANTES da
 * migration 009 — sem tocar em LTV nem em integradores.
 *
 * Por que é necessário: as 34.261 linhas do backfill de 2026 foram gravadas sem
 * o funil, então não havia como saber quais vieram de "MKT Movimentação" (que
 * não é venda) a não ser relistando. A listagem de deals traz `pipeline_id`, e
 * relistar custa 1 chamada por página — barato o suficiente para varrer tudo e
 * tornar a correção cirúrgica, em vez de zerar a base e recalcular às cegas.
 */
export async function preencherPipelines(opts: {
  page?: number;
  pagesPerRun?: number;
  pageSize?: number;
  desde?: string;
  ate?: string;
  throttleMs?: number;
}): Promise<{
  paginas_lidas: number;
  deals_lidos: number;
  atualizados: number;
  ja_tinham: number;
  fora_do_backfill: number;
  has_more: boolean;
  next_page: number;
}> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 200, 1), 200);
  const pagesPerRun = Math.min(Math.max(opts.pagesPerRun ?? 10, 1), 60);
  const throttleMs = Math.min(Math.max(opts.throttleMs ?? 600, 0), 5000);
  let page = Math.max(opts.page ?? 1, 1);

  const r = {
    paginas_lidas: 0,
    deals_lidos: 0,
    atualizados: 0,
    ja_tinham: 0,
    fora_do_backfill: 0,
    has_more: false,
    next_page: page,
  };

  for (let i = 0; i < pagesPerRun; i++) {
    const deals = await listWonDeals(page, pageSize, opts.desde, opts.ate);
    r.paginas_lidas++;
    r.deals_lidos += deals.length;

    for (const deal of deals) {
      const dealId = String(deal.id ?? "");
      const pipelineId = extractPipelineId(deal);
      if (!dealId || !pipelineId) continue;

      const upd = await one<{ rd_deal_id: string }>(
        `UPDATE public.rd_won_backfill SET pipeline_id = $2
          WHERE rd_deal_id = $1 AND pipeline_id IS NULL
          RETURNING rd_deal_id`,
        [dealId, pipelineId],
      );
      if (upd) r.atualizados++;
      else {
        const existe = await one<{ rd_deal_id: string }>(
          "SELECT rd_deal_id FROM public.rd_won_backfill WHERE rd_deal_id = $1",
          [dealId],
        );
        if (existe) r.ja_tinham++;
        else r.fora_do_backfill++;
      }
    }

    if (deals.length < pageSize) {
      r.has_more = false;
      r.next_page = page;
      return r;
    }
    page++;
    // Só a listagem consome cota aqui (1 chamada por página).
    if (throttleMs > 0) await new Promise((res) => setTimeout(res, throttleMs));
  }

  r.has_more = true;
  r.next_page = page;
  return r;
}

export async function backfillWon(opts: {
  page?: number;
  pagesPerRun?: number;
  pageSize?: number;
  dryRun?: boolean;
  throttleMs?: number;
  desde?: string;
  ate?: string;
}): Promise<BackfillResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 200);
  const pagesPerRun = Math.min(Math.max(opts.pagesPerRun ?? 3, 1), 20);
  const dryRun = opts.dryRun === true;
  // Freio: um deal NOVO custa até 2 chamadas na API (deal + organização) e o
  // limite do CRM é 120 req/min. Medido em 29/jul sem freio: 20 deals em 10s
  // = ~240 req/min, o dobro do teto. 500ms/deal mantém ~120 req/min no pior
  // caso; deals em cache não gastam chamada e a pausa fica ociosa de propósito.
  const throttleMs = Math.min(Math.max(opts.throttleMs ?? 500, 0), 5000);
  let page = Math.max(opts.page ?? 1, 1);

  const r: BackfillResult = {
    pagina_inicial: page,
    paginas_lidas: 0,
    deals_lidos: 0,
    contabilizados: 0,
    ja_contabilizados: 0,
    sem_cnpj: 0,
    funil_fora_escopo: 0,
    erros: 0,
    has_more: false,
    next_page: page,
    dry_run: dryRun,
    amostra_erros: [],
  };

  for (let i = 0; i < pagesPerRun; i++) {
    const deals = await listWonDeals(page, pageSize, opts.desde, opts.ate);
    r.paginas_lidas++;
    r.deals_lidos += deals.length;

    for (const deal of deals) {
      const dealId = String(deal.id ?? "");
      if (!dealId) continue;

      try {
        // Funil que não é de venda não entra no histórico de compras. Checado
        // ANTES do cache/API: é grátis (o pipeline_id vem na listagem) e é o
        // filtro que impede um card de "MKT Movimentação" na etapa "Descarte"
        // de virar pedido no LTV — foram 734 deals assim antes de 30/jul.
        if (!isFunilDeVenda(deal)) {
          r.funil_fora_escopo++;
          continue;
        }

        // Só registra depois de saber o CNPJ, mas verifica antes para não
        // gastar chamada de API em deal já contabilizado.
        const visto = await one<{ rd_deal_id: string }>(
          "SELECT rd_deal_id FROM public.rd_won_backfill WHERE rd_deal_id = $1",
          [dealId],
        );
        if (visto) {
          r.ja_contabilizados++;
          continue;
        }

        const { cnpj, orgName, fonte } = await resolveDealCnpj(dealId, deal);

        // Freio APENAS quando houve chamada de API. Deal cuja organização já
        // está em cache não consome cota, então pausar ali seria desperdício
        // puro: medido em 29/jul, 100 deals resolveram 100% em 12,7s, e a
        // maioria das organizações repete entre deals (vários pedidos por
        // integrador). Sem esta distinção, o backfill de 2026 levaria ~5h em vez
        // de ~30min — ou estouraria os 120 req/min se eu baixasse o throttle.
        const gastouApi = !["cache", "cache_organizacao", "webhook_payload"].includes(fonte);
        if (gastouApi && throttleMs > 0) {
          await new Promise((r) => setTimeout(r, throttleMs));
        }

        if (!cnpj) {
          r.sem_cnpj++;
          continue;
        }

        // ATENÇÃO aos nomes de campo: a LISTAGEM de deals usa `total_price` /
        // `one_time_price`. O `amount_total` só aparece no payload do WEBHOOK.
        // Verificado em 29/jul via sample_keys — ler o campo errado gravaria
        // LTV zero para os 51.661 deals, silenciosamente.
        const valor = Number(deal.total_price ?? deal.one_time_price ?? deal.amount_total ?? 0) || 0;
        const closedAt = (deal.closed_at as string) || (deal.updated_at as string) || null;
        // A listagem não traz a organização inline; o nome vem de quem resolveu
        // o CNPJ (a consulta da organização) — e só preenche se ainda for nulo.
        const razao = orgName ?? undefined;

        if (dryRun) {
          r.contabilizados++;
          continue;
        }

        // Marca primeiro: se a soma falhar, o deal NÃO fica marcado (a linha é
        // removida no catch) — nunca o contrário, que perderia o pedido.
        await q(
          `INSERT INTO public.rd_won_backfill (rd_deal_id, cnpj, valor, closed_at, pipeline_id)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (rd_deal_id) DO NOTHING`,
          [dealId, cnpj, valor, closedAt, extractPipelineId(deal)],
        );

        try {
          await q(
            `INSERT INTO public.integradores
               (cnpj, razao_social, status, numero_pedidos, ltv_total, ticket_medio,
                data_primeira_compra, data_ultima_compra, rd_deal_id)
             VALUES ($1, $2, 'cliente', 1, $3, $3, $4, $4, $5)
             ON CONFLICT (cnpj) DO UPDATE SET
               status = 'cliente',
               numero_pedidos = COALESCE(public.integradores.numero_pedidos, 0) + 1,
               ltv_total = COALESCE(public.integradores.ltv_total, 0) + $3,
               ticket_medio = (COALESCE(public.integradores.ltv_total, 0) + $3)
                            / (COALESCE(public.integradores.numero_pedidos, 0) + 1),
               data_primeira_compra = LEAST(
                 COALESCE(public.integradores.data_primeira_compra, $4::timestamptz), $4::timestamptz),
               data_ultima_compra = GREATEST(
                 COALESCE(public.integradores.data_ultima_compra, $4::timestamptz), $4::timestamptz),
               razao_social = COALESCE(public.integradores.razao_social, $2),
               rd_deal_id = COALESCE(public.integradores.rd_deal_id, $5),
               updated_at = now()`,
            [cnpj, razao ?? null, valor, closedAt, dealId],
          );
          r.contabilizados++;
        } catch (upsertErr) {
          await q("DELETE FROM public.rd_won_backfill WHERE rd_deal_id = $1", [dealId]);
          throw upsertErr;
        }
      } catch (e) {
        r.erros++;
        if (r.amostra_erros.length < 5) {
          r.amostra_erros.push(`${dealId}: ${(e as Error).message}`);
        }
      }
    }

    // Página incompleta = última página do filtro.
    if (deals.length < pageSize) {
      r.has_more = false;
      r.next_page = page;
      return r;
    }
    page++;
  }

  r.has_more = true;
  r.next_page = page;
  return r;
}
