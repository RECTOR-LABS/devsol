const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SOL = 1000;

export function validateBuySellBody(body: any): { wallet: string; amount_sol: number } | string {
  if (!body || typeof body !== 'object') return 'Invalid request body';

  const { wallet, amount_sol } = body;

  if (typeof wallet !== 'string' || !BASE58_RE.test(wallet)) {
    return 'Invalid wallet: must be a valid Solana address';
  }

  if (typeof amount_sol !== 'number' || !isFinite(amount_sol) || amount_sol <= 0) {
    return 'Invalid amount_sol: must be a positive finite number';
  }

  if (amount_sol > MAX_SOL) {
    return `Invalid amount_sol: maximum is ${MAX_SOL} SOL per transaction`;
  }

  return { wallet, amount_sol };
}
