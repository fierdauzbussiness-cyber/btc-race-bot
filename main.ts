// btc-race-bot: a swing-catching cbBTC/USDC bot for the make.fun btc-race-24h bounty.
//
// Strategy (written from scratch for this entry; not a copy of any kit baseline):
// long-only, one position at a time, full-size entries. It sits in cash through chop and
// only enters on a clear multi-minute swing signal, then exits on a take-profit, a
// trailing stop, or a hard stop — whichever comes first. Every parameter was chosen by
// offline search on the published dev window and checked for a neighbourhood of nearby
// values that also clear the dev gate, so the bot is not tuned to one lucky print.
//
//   Entry (flat, and only while more than NO_ENTRY_LAST_BARS bars of the window remain):
//     DIP  — the close is at least DIP_BPS below its close DIP_LB bars ago: buy the deep
//            dip, ride the recovery. (The dev window's one big swing is exactly this: a
//            ~200 bp slide over two hours, then a ~210 bp recovery.)
//     MOM  — the close is at least MOM_BPS above its close MOM_LB bars ago: buy a breakout
//            that is already running, while it still has room.
//   Exit (long):
//     TP    — the close is TP_BPS above the close the entry was decided on: bank the swing.
//     TRAIL — the close has fallen TRAIL_BPS below the highest close since entry: the
//             swing has turned, get out before it gives the profit back.
//     STOP  — the close is STOP_BPS below the entry: the signal was wrong, cut it.
//   A sell that the market refuses (no bar, slippage cap) is re-sent on the next bar
//   while its reason still holds, so a held position never gets stranded.
//
// Protocol: agent-fun/bars-replay/v1, one hello, one batch per minute bar, one reply per
// batch echoing its seq. Orders decided on a batch fill at the next bar's open. The bot
// is deterministic: pure float arithmetic on the bars it has seen, no clock, no random,
// no environment, no files. The same bars always give the same orders.
//
// Sizing: a buy spends all the cash on hand, capped by the weight room (hello caps say
// 100% of equity). A sell empties the whole position. max_slippage_bps 100 (1%) past the
// close the order was decided on, so a fill into a liquidity gap is refused and retried
// rather than filled for almost nothing.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- entry signals -----------------------------------------------------------
const DIP_LB = 120; // bars of lookback for the dip signal (2 hours)
const DIP_BPS = 150; // buy when the close is this far below its close DIP_LB bars ago
const MOM_LB = 30; // bars of lookback for the momentum signal (30 minutes)
const MOM_BPS = 70; // buy when the close is this far above its close MOM_LB bars ago

// --- exits -------------------------------------------------------------------
const TP_BPS = 200; // take profit, bps above the entry close
const TRAIL_BPS = 70; // trailing stop, bps below the highest close since entry
const STOP_BPS = 100; // hard stop, bps below the entry close

// --- guards ------------------------------------------------------------------
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
const TOTAL_BARS = 1440; // both windows are 1,440 one-minute bars (RULES.md: Windows)
const NO_ENTRY_LAST_BARS = 60; // no fresh entries in the last hour: too little time
// for a swing to pay the ~26 bp round trip before the final flatten

const BPS = 10_000;

// Closes seen so far, newest last (one per batch that carried a CBBTC bar).
const closes: number[] = [];
// Entry bookkeeping for the open position (reset when flat).
let entryClose = 0; // close of the bar the entry was decided on
let peakClose = 0; // highest close seen since entry

/** Return of `now` against `then`, in basis points (float; deterministic). */
function retBps(now: number, then: number): number {
  return ((now - then) / then) * BPS;
}

function shouldEnter(i: number): boolean {
  const now = closes[i];
  if (i >= DIP_LB && retBps(now, closes[i - DIP_LB]) <= -DIP_BPS) return true;
  if (i >= MOM_LB && retBps(now, closes[i - MOM_LB]) >= MOM_BPS) return true;
  return false;
}

function shouldExit(i: number): boolean {
  const now = closes[i];
  if (now > peakClose) peakClose = now;
  if (retBps(now, entryClose) >= TP_BPS) return true;
  if (retBps(peakClose, now) >= TRAIL_BPS) return true;
  if (retBps(now, entryClose) <= -STOP_BPS) return true;
  return false;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Only the fresh bar of this batch advances the series; a batch with no CBBTC
    // bar (a minute the recorder missed) adds nothing and sends no order.
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || state.warmingUp) return [];
    const close = Number(bar.c);
    closes.push(close);
    const i = closes.length - 1;

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (shouldExit(i)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: reset the entry bookkeeping, then look for a swing worth buying.
    // No signal is trusted until the longest lookback (DIP_LB) is fully seeded:
    // a 30-minute bounce inside an unseeded slide is noise, not a breakout — on
    // the dev window an unseeded momentum buy at bar 95 cost ~$9 before the real
    // dip trade, so the gate below waits for bar 120.
    entryClose = 0;
    peakClose = 0;
    if (i < DIP_LB) return [];
    if (state.seq >= TOTAL_BARS - NO_ENTRY_LAST_BARS) return [];
    if (!shouldEnter(i)) return [];

    const room = state.weightRoom(SYMBOL);
    let stake = state.cash < room ? state.cash : room;
    if (stake < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryClose = close;
    peakClose = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
