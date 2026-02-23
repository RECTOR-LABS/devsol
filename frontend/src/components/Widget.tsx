import { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import type { PublicKey, Connection } from '@solana/web3.js';
import { api } from '../api';
import { useQuote } from '../hooks/useQuote';
import { useTxPoller } from '../hooks/useTxPoller';
import { buildBuyTransaction } from '../lib/transactions';
import type { BuyResponse, SellResponse, Transaction } from '../types';

type Tab = 'buy' | 'sell';
type View = 'form' | 'instructions' | 'result';

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-text-muted hover:text-text-secondary text-xs ml-2 shrink-0"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function StatusIcon({ status }: { status: Transaction['status'] }) {
  if (status === 'completed') {
    return <div className="text-accent text-5xl mb-3">&#10003;</div>;
  }
  return <div className="text-red-500 text-5xl mb-3">&#10007;</div>;
}

function statusLabel(status: Transaction['status']): string {
  switch (status) {
    case 'completed':
      return 'Order Completed';
    case 'failed':
      return 'Order Failed';
    case 'expired':
      return 'Order Expired';
    case 'refunded':
      return 'Order Refunded';
    default:
      return 'Processing...';
  }
}

export function Widget() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? '';
  const { prices, getBuyQuote, getSellQuote } = useQuote();
  const { tx, polling, startPolling, reset: resetPoller } = useTxPoller();

  const [tab, setTab] = useState<Tab>('buy');
  const [amount, setAmount] = useState('');
  const [view, setView] = useState<View>('form');
  const [orderResponse, setOrderResponse] = useState<BuyResponse | SellResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isBuy = tab === 'buy';
  const parsedAmount = parseFloat(amount) || 0;

  // For buy: input is SOL amount (what they want), derive USDC cost
  // For sell: input is SOL amount (what they send), derive USDC payout
  const quote = isBuy ? getBuyQuote(parsedAmount) : getSellQuote(parsedAmount);

  // Transition from instructions to result when polling resolves
  useEffect(() => {
    if (view === 'instructions' && tx && tx.status !== 'pending') {
      setView('result');
    }
  }, [view, tx]);

  function resetForm() {
    setAmount('');
    setView('form');
    setOrderResponse(null);
    setError(null);
    setSubmitting(false);
    resetPoller();
  }

  function handleTabSwitch(newTab: Tab) {
    if (newTab === tab) return;
    setTab(newTab);
    setAmount('');
    setError(null);
  }

  async function handleSubmit() {
    if (!connected || !walletAddress || parsedAmount <= 0 || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const response = isBuy
        ? await api.buy(walletAddress, parsedAmount)
        : await api.sell(walletAddress, parsedAmount);

      setOrderResponse(response);
      setView('instructions');
      startPolling(response.transaction_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] p-6 w-full max-w-[420px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <span className="text-xl font-bold text-text-primary">DevSOL</span>
        <WalletMultiButton />
      </div>

      {view === 'form' && (
        <FormView
          tab={tab}
          isBuy={isBuy}
          amount={amount}
          quote={quote}
          prices={prices}
          connected={connected}
          submitting={submitting}
          error={error}
          onTabSwitch={handleTabSwitch}
          onAmountChange={setAmount}
          onSubmit={handleSubmit}
        />
      )}

      {view === 'instructions' && orderResponse && publicKey && (
        <DepositView
          isBuy={isBuy}
          order={orderResponse}
          polling={polling}
          publicKey={publicKey}
          connection={connection}
          sendTransaction={sendTransaction}
        />
      )}

      {view === 'result' && tx && (
        <ResultView tx={tx} onReset={resetForm} />
      )}
    </div>
  );
}

function FormView({
  tab,
  isBuy,
  amount,
  quote,
  prices,
  connected,
  submitting,
  error,
  onTabSwitch,
  onAmountChange,
  onSubmit,
}: {
  tab: Tab;
  isBuy: boolean;
  amount: string;
  quote: { sol: number; usdc: number } | null;
  prices: { buy: { usdc_per_sol: number }; sell: { usdc_per_sol: number } } | null;
  connected: boolean;
  submitting: boolean;
  error: string | null;
  onTabSwitch: (t: Tab) => void;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const parsedAmount = parseFloat(amount) || 0;
  const canSubmit = connected && parsedAmount > 0 && !submitting;

  // Rate display for footer context
  const rate = prices
    ? isBuy ? prices.buy.usdc_per_sol : prices.sell.usdc_per_sol
    : null;

  return (
    <>
      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        <button
          type="button"
          onClick={() => onTabSwitch('buy')}
          className={`flex-1 h-10 rounded-[8px] font-semibold text-sm cursor-pointer transition-colors ${
            tab === 'buy'
              ? 'bg-primary text-white'
              : 'bg-input-bg text-text-secondary'
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => onTabSwitch('sell')}
          className={`flex-1 h-10 rounded-[8px] font-semibold text-sm cursor-pointer transition-colors ${
            tab === 'sell'
              ? 'bg-accent text-[#0A0A0F]'
              : 'bg-input-bg text-text-secondary'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Input: Amount of SOL */}
      <div className="mb-1">
        <span className="text-text-secondary text-sm mb-2 block">
          {isBuy ? 'You Buy' : 'You Send'}
        </span>
        <div className="bg-input-bg border border-input-border rounded-[8px] p-4 flex items-center">
          <input
            type="number"
            min={0}
            step={0.1}
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="0.00"
            className="text-2xl font-bold text-text-primary bg-transparent outline-none flex-1 min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <CurrencyBadge currency="SOL" />
        </div>
      </div>

      {/* Arrow divider */}
      <div className="text-text-muted text-lg my-2 text-center select-none">&darr;</div>

      {/* Output: USDC cost/payout */}
      <div className="mb-5">
        <span className="text-text-secondary text-sm mb-2 block">
          {isBuy ? 'You Pay' : 'You Receive'}
        </span>
        <div className="bg-input-bg border border-input-border rounded-[8px] p-4 flex items-center">
          <span className="text-2xl font-bold text-text-primary flex-1">
            {quote ? formatAmount(quote.usdc) : '\u2014'}
          </span>
          <CurrencyBadge currency="USDC" />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-red-400 text-sm mb-3 text-center">{error}</div>
      )}

      {/* Action Button */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className={`w-full h-12 rounded-[8px] font-semibold text-base transition-colors ${
          isBuy
            ? 'bg-primary hover:bg-primary/90 text-white'
            : 'bg-accent hover:bg-accent/90 text-[#0A0A0F]'
        } ${!canSubmit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {submitting
          ? 'Processing...'
          : !connected
            ? 'Connect Wallet'
            : isBuy
              ? 'Buy Devnet SOL'
              : 'Sell Devnet SOL'}
      </button>

      {/* Footer */}
      <div className="flex justify-between text-text-muted text-xs mt-4">
        <span>{rate ? `1 SOL = ${rate} USDC` : 'Secured by Solana'}</span>
        <span>Expires in 30 min</span>
      </div>
    </>
  );
}

function DepositView({
  isBuy,
  order,
  polling,
  publicKey,
  connection,
  sendTransaction,
}: {
  isBuy: boolean;
  order: BuyResponse | SellResponse;
  polling: boolean;
  publicKey: PublicKey;
  connection: Connection;
  sendTransaction: WalletContextState['sendTransaction'];
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const depositAmount = isBuy
    ? (order as BuyResponse).usdc_cost
    : (order as SellResponse).amount_sol;
  const currency = isBuy ? 'USDC' : 'SOL';

  // Sell flow must use manual instructions — Phantom blocks signTransaction
  // as a security measure (flags it as potentially malicious dApp).
  const sellNeedsManual = !isBuy;

  async function handleSend() {
    if (sending || sent || !isBuy) return;
    setSendError(null);
    setSending(true);

    try {
      const tx = await buildBuyTransaction(
        connection,
        publicKey,
        order.deposit_address,
        (order as BuyResponse).usdc_cost,
        order.memo,
      );
      await sendTransaction(tx, connection);
      setSent(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      // Don't show error for user rejection — they know what they did
      if (!message.includes('User rejected')) {
        setSendError(message);
      }
    } finally {
      setSending(false);
    }
  }

  // After successful send, show polling state
  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-2 py-6">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-text-secondary text-sm">
            Transaction sent. Waiting for confirmation...
          </span>
        </div>
        <div className="text-text-muted text-xs text-center">
          TX: <span className="font-mono">{order.transaction_id}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-text-primary font-semibold text-base">
        Send Deposit
      </h3>

      <p className="text-text-secondary text-sm">
        Send{' '}
        <span className="text-text-primary font-semibold">
          {depositAmount} {currency}
        </span>{' '}
        {isBuy ? 'on mainnet' : 'on devnet'} to complete your order.
      </p>

      {/* One-click send button (unless wallet lacks signTransaction for sell) */}
      {!sellNeedsManual && !showManual && (
        <>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className={`w-full h-12 rounded-[8px] font-semibold text-base transition-colors cursor-pointer ${
              isBuy
                ? 'bg-primary hover:bg-primary/90 text-white'
                : 'bg-accent hover:bg-accent/90 text-[#0A0A0F]'
            } ${sending ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {sending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Sending...
              </span>
            ) : (
              `Send ${depositAmount} ${currency}`
            )}
          </button>

          {sendError && (
            <div className="space-y-2">
              <p className="text-red-400 text-sm text-center">{sendError}</p>
              <button
                type="button"
                onClick={handleSend}
                className="w-full h-10 rounded-[8px] font-semibold text-sm bg-input-bg text-text-secondary hover:text-text-primary border border-input-border cursor-pointer transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </>
      )}

      {/* Manual fallback toggle */}
      {!showManual && !sellNeedsManual && (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="text-text-muted hover:text-text-secondary text-xs underline w-full text-center cursor-pointer"
        >
          Send manually instead
        </button>
      )}

      {/* Manual instructions (shown by default if wallet can't sign for sell) */}
      {(showManual || sellNeedsManual) && (
        <div className="space-y-3">
          {sellNeedsManual && (
            <p className="text-yellow-400 text-xs">
              Your wallet does not support direct signing. Please send manually:
            </p>
          )}

          <div className="bg-input-bg border border-input-border rounded-[8px] p-3">
            <span className="text-text-muted text-xs block mb-1">Address</span>
            <div className="flex items-center">
              <span className="text-text-primary text-sm font-mono truncate flex-1">
                {truncateAddress(order.deposit_address)}
              </span>
              <CopyButton text={order.deposit_address} />
            </div>
          </div>

          <div className="bg-input-bg border border-input-border rounded-[8px] p-3">
            <span className="text-text-muted text-xs block mb-1">Memo (required)</span>
            <div className="flex items-center">
              <span className="text-text-primary text-sm font-mono truncate flex-1">
                {order.memo}
              </span>
              <CopyButton text={order.memo} />
            </div>
          </div>
        </div>
      )}

      {/* Transaction ID */}
      <div className="text-text-muted text-xs">
        TX: <span className="font-mono">{order.transaction_id}</span>
      </div>

      {/* Polling status */}
      {polling && (
        <div className="flex items-center justify-center gap-2 py-3">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-text-secondary text-sm">Waiting for deposit...</span>
        </div>
      )}
    </div>
  );
}

function ResultView({
  tx,
  onReset,
}: {
  tx: Transaction;
  onReset: () => void;
}) {
  const isSuccess = tx.status === 'completed';

  return (
    <div className="flex flex-col items-center py-6">
      <StatusIcon status={tx.status} />
      <h3 className={`text-lg font-semibold mb-1 ${isSuccess ? 'text-accent' : 'text-red-400'}`}>
        {statusLabel(tx.status)}
      </h3>
      <p className="text-text-secondary text-sm mb-1">
        {tx.sol_amount} SOL &harr; {tx.usdc_amount} USDC
      </p>
      <p className="text-text-muted text-xs mb-6 font-mono">
        {tx.id}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="w-full h-10 rounded-[8px] font-semibold text-sm bg-input-bg text-text-secondary hover:text-text-primary border border-input-border cursor-pointer transition-colors"
      >
        New Order
      </button>
    </div>
  );
}

function CurrencyBadge({ currency }: { currency: 'SOL' | 'USDC' }) {
  const isUsdc = currency === 'USDC';
  return (
    <span
      className={`text-xs font-semibold px-3 py-1.5 rounded-full shrink-0 ${
        isUsdc
          ? 'bg-usdc/20 text-usdc'
          : 'bg-primary/20 text-primary'
      }`}
    >
      {currency}
    </span>
  );
}

function formatAmount(value: number): string {
  // Show up to 6 decimal places, strip trailing zeros
  const formatted = value.toFixed(6);
  return formatted.replace(/\.?0+$/, '') || '0';
}
