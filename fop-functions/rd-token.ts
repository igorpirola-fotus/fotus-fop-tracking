// Regra da rota /rd-token: o Rotacionador (n8n) pega aqui o access token do
// RD CRM do FOP, em vez de depender da cadeia OAuth da Solange (quedas de
// 27/ago e 15/set). O n8n só LÊ; quem renova é o refreshAccessToken().
export const MIN_VALIDADE_MS = 15 * 60 * 1000;

export function montarRespostaToken(
  accessToken: string,
  expiresAtMs: number,
  nowMs: number,
): { access_token: string; expiry: number; validade_min: number } {
  if (!accessToken || expiresAtMs - nowMs < MIN_VALIDADE_MS) {
    throw new Error("token_invalido");
  }
  return {
    access_token: accessToken,
    expiry: expiresAtMs,
    validade_min: Math.floor((expiresAtMs - nowMs) / 60000),
  };
}
