import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

const MAINNET_RPC = import.meta.env.VITE_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []); // Wallet Standard auto-detects installed wallets
  return (
    <ConnectionProvider endpoint={MAINNET_RPC}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
