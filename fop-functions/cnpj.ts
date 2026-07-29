// cnpj.ts — normalização, validação e busca profunda de CNPJ.
//
// Por que "busca profunda": o CNPJ da Fotus não vive num campo previsível do RD
// Station CRM. Auditoria 02/jun/2026 mostrou que NÃO existe custom field `cnpj`
// em Contatos; e a auditoria 29/jul/2026 mostrou que o webhook de deal também
// não traz `organization`. Em vez de apostar num caminho de campo, varremos o
// objeto e aceitamos qualquer string que seja um CNPJ VÁLIDO (dígitos
// verificadores conferidos). A validação é o que impede confundir com telefone,
// CEP, valor ou id do RD.

/** Só dígitos. */
export function cleanCnpj(raw: unknown): string {
  return typeof raw === "string" || typeof raw === "number"
    ? String(raw).replace(/\D/g, "")
    : "";
}

/** Valida os dois dígitos verificadores do CNPJ (módulo 11). */
export function isValidCnpj(raw: unknown): boolean {
  const c = cleanCnpj(raw);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false; // 00000000000000 etc.

  const dv = (len: number): number => {
    let peso = len - 7;
    let soma = 0;
    for (let i = 0; i < len; i++) {
      soma += Number(c[i]) * peso;
      peso = peso - 1 < 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };

  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/**
 * Varre um objeto/array/string recursivamente e devolve o primeiro CNPJ válido.
 *
 * `preferKeys` (default: chaves contendo "cnpj"/"document") é varrido primeiro:
 * garante que, quando o campo certo existe, ele ganhe de um CNPJ que apareça
 * solto no meio de um texto (ex.: razão social com CNPJ no nome).
 */
export function findCnpjDeep(
  input: unknown,
  preferKeys: RegExp = /cnpj|documento|document(?!s)/i,
): string {
  const preferred: string[] = [];
  const others: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, keyHint: string, depth: number): void => {
    if (depth > 8 || node === null || node === undefined) return;

    if (typeof node === "string" || typeof node === "number") {
      const s = String(node);
      const bucket = preferKeys.test(keyHint) ? preferred : others;
      // Campo inteiro é o CNPJ (com ou sem máscara).
      if (isValidCnpj(s)) {
        bucket.push(cleanCnpj(s));
        return;
      }
      // CNPJ embutido em texto maior (ex.: "FOTUS LTDA 12.345.678/0001-95").
      for (const m of s.matchAll(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g)) {
        if (isValidCnpj(m[0])) bucket.push(cleanCnpj(m[0]));
      }
      return;
    }

    if (typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, keyHint, depth + 1);
      return;
    }

    const obj = node as Record<string, unknown>;
    // Custom field do RD vem como { value, custom_field: { label } } — o label
    // é que diz o que o `value` significa, então propagamos como dica de chave.
    const label = (obj.custom_field as Record<string, unknown> | undefined)?.label;
    for (const [k, v] of Object.entries(obj)) {
      const hint = k === "value" && typeof label === "string" ? `${k} ${label}` : k;
      walk(v, hint, depth + 1);
    }
  };

  walk(input, "", 0);
  return preferred[0] || others[0] || "";
}
