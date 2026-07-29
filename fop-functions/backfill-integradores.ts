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

export interface BackfillResult {
  pagina_inicial: number;
  paginas_lidas: number;
  deals_lidos: number;
  contabilizados: number;
  ja_contabilizados: number;
  sem_cnpj: number;
  erros: number;
  has_more: boolean;
  next_page: number;
  dry_run: boolean;
  amostra_erros: string[];
}

export async function backfillWon(opts: {
  page?: number;
  pagesPerRun?: number;
  pageSize?: number;
  dryRun?: boolean;
}): Promise<BackfillResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 200);
  const pagesPerRun = Math.min(Math.max(opts.pagesPerRun ?? 3, 1), 20);
  const dryRun = opts.dryRun === true;
  let page = Math.max(opts.page ?? 1, 1);

  const r: BackfillResult = {
    pagina_inicial: page,
    paginas_lidas: 0,
    deals_lidos: 0,
    contabilizados: 0,
    ja_contabilizados: 0,
    sem_cnpj: 0,
    erros: 0,
    has_more: false,
    next_page: page,
    dry_run: dryRun,
    amostra_erros: [],
  };

  for (let i = 0; i < pagesPerRun; i++) {
    const deals = await listWonDeals(page, pageSize);
    r.paginas_lidas++;
    r.deals_lidos += deals.length;

    for (const deal of deals) {
      const dealId = String(deal.id ?? "");
      if (!dealId) continue;

      try {
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

        const { cnpj } = await resolveDealCnpj(dealId, deal);
        if (!cnpj) {
          r.sem_cnpj++;
          continue;
        }

        const valor = Number(deal.amount_total ?? deal.amount_unique ?? 0) || 0;
        const closedAt = (deal.closed_at as string) || (deal.updated_at as string) || null;
        const razao = (deal.organization as Record<string, unknown> | undefined)?.name as
          | string
          | undefined;

        if (dryRun) {
          r.contabilizados++;
          continue;
        }

        // Marca primeiro: se a soma falhar, o deal NÃO fica marcado (a linha é
        // removida no catch) — nunca o contrário, que perderia o pedido.
        await q(
          `INSERT INTO public.rd_won_backfill (rd_deal_id, cnpj, valor, closed_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT (rd_deal_id) DO NOTHING`,
          [dealId, cnpj, valor, closedAt],
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
