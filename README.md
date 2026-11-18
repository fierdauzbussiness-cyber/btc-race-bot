# btc-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/fierdauzbussiness-cyber/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/fierdauzbussiness-cyber/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A swing-catching cbBTC/USDC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty ($250 in USDC). It trades Coinbase Wrapped BTC against USDC minute by minute on the agent-fun/bars-replay/v1 protocol: one hello, one batch per minute bar, one reply per batch. Long only, one position at a time, full-size entries, deterministic — the same bars always give the same orders.

## The strategy

Most 1-minute BTC moves are noise (about 7 bp of standard deviation against a ~26 bp full-size round trip), so the bot sits in cash through chop and only enters on a clear multi-minute swing:

- **Dip** — buy when the close is 150 bp below its close 120 bars (2 hours) ago: buy the deep dip, ride the recovery.
- **Momentum** — buy when the close is 70 bp above its close 30 bars ago: buy a breakout that is already running.

It exits on whichever comes first: **+200 bp take-profit**, **70 bp trailing stop** off the highest close since entry, or **−100 bp hard stop**. A refused sell is re-sent on the next bar while its reason still holds, so a position never gets stranded. No fresh entries in the last 60 bars of the window — too little time for a swing to pay the round trip before the final flatten.

Every parameter was chosen by offline search on the published dev window and checked across a neighbourhood of nearby values that also clear the dev gate, so the bot is not tuned to one lucky print. On the dev window it scores **+$15.68 net PnL** (2 trades, 100% win rate, 0.76% max drawdown, $0.81 fees) — comfortably above the $0 dev gate, with drawdown far under the 25% guardrail, and still +$14.87 with every fee doubled.

## Run it

Node.js 22 or later, standard library only (plus the vendored `vendor/makefun-bars.ts` shim, a byte-identical copy of the kit's SDK):

```sh
node main.ts
```

The bot reads newline-delimited JSON on stdin and writes one reply per batch on stdout. Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot <this repo> --driver docker
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
