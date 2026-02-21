function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`Missing env var: ${key}`);
  return value;
}

export const config = {
  port: Number(env('DEVSOL_PORT', '3100')),
  treasuryKeypair: env('DEVSOL_TREASURY_KEYPAIR', ''),
  facilitatorUrl: env('DEVSOL_X402_FACILITATOR_URL', 'https://x402.org/facilitator'),
  devnetRpc: env('DEVSOL_DEVNET_RPC', 'https://api.devnet.solana.com'),
  devnetWss: env('DEVSOL_DEVNET_WSS', 'wss://api.devnet.solana.com'),
  mainnetRpc: env('DEVSOL_MAINNET_RPC', 'https://api.mainnet-beta.solana.com'),
  mainnetWss: env('DEVSOL_MAINNET_WSS', 'wss://api.mainnet-beta.solana.com'),
  buyPrice: Number(env('DEVSOL_BUY_PRICE', '1.05')),
  sellPrice: Number(env('DEVSOL_SELL_PRICE', '0.95')),
  corsOrigin: env('DEVSOL_CORS_ORIGIN', 'https://devsol.rectorspace.com'),
  dbPath: env('DEVSOL_DB_PATH', './devsol.db'),
  svmNetwork: env('DEVSOL_SVM_NETWORK', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
} as const;
