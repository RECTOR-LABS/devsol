import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { createApp } from './app.js';
import { TreasuryService } from './services/treasury.js';
import { config } from './config.js';

async function main() {
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));

  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
  });

  const { app } = createApp({ treasury });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`DevSOL running on http://localhost:${info.port}`);
    console.log(`Treasury: ${treasury.address}`);
  });
}

main().catch(console.error);
