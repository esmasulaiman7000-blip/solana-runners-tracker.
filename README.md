# Solana Runners Tracker — Quantitative Intelligence & Recovery Platform

A quantitative crypto research and real-time intelligence platform designed for Solana DEX pools. Built with **Express**, **Node.js**, **React 19**, **TypeScript**, and **Tailwind CSS**, this system tracks, scores, and classifies newly launched tokens and reviving pools with zero look-ahead bias and empirical evidence.

---

## ⚡ Core Upgraded Intelligence Modules

### 1. ⚡ Early Signal Detection Engine
Identifies tokens displaying statistical momentum anomalies *before* they appear on trending leaderboards:
- **Volume Velocity:** Annualized 5m volume scaled against 1h baseline (>1.6x).
- **Buyer Dominance:** Transaction count ratio (buys / sells >= 1.5x).
- **Liquidity Velocity:** Rapid liquidity expansion without abnormal price slippage.
- **Classification:** Categorizes candidates into `Early Surge`, `Volume Ignition`, `Quiet Accumulation`, or `Neutral`.

### 2. 📡 Recovery Radar
Evaluates declining or dormant pools showing measurable revival signals:
- **100-Point Scoring Algorithm:**
  - Net Buy/Sell Pressure (up to 28 pts)
  - Volume Acceleration (up to 26 pts)
  - Rebound from Local Troughs (up to 20 pts)
  - Liquidity Stabilization (up to 14 pts)
  - Smart-Money Accumulation (up to 12 pts)
  - Penalties for High Cluster Risk (-25 pts) and Unlocked LP (-15 pts).
- **Evidence Breakdown:** Full transparency on supporting and opposing market forces.

### 3. 🧬 3-Engine Runner DNA System
Provides three testable, distinct analytical perspectives:
- **Engine A: New Runners DNA:** Studies newly formed pools (0–24h) across 4 configurable age cohorts (0–30m, 30–60m, 1–5h, 5–24h). Identifies initial liquidity sweet-spots ($15k–$45k) and launch failure triggers.
- **Engine B: Old Pools DNA:** Analyzes established pools (>= 24h) categorizing states: `Dormant`, `Reactivating`, `Developing`, `Strong Activity`, `Weakening`.
- **Engine C: Universal DNA:** Cross-regime comparative synthesis identifying invariants that hold across all ages vs. regime-specific divergent indicators.

### 4. 🛡️ Risk Shield Guardrails
- **Supply Distribution:** Analyzes Top 10 holder concentration (<25% safe, >35% high risk).
- **Cluster & Sniper Detection:** Flags coordinated launch bundles and sniper wallet accumulation.
- **Immutability Audits:** Verifies LP token burning/locking and mint authority revocation.
- **Zero-Tolerance Missing Data Policy:** Missing on-chain fields are explicitly reported and never treated as passing.

### 5. 🧪 Quantitative Performance Lab
Backtesting simulator with realistic financial friction modeling:
- **DEX Swap Fees:** Configurable 0.25% round-trip fee.
- **Solana Priority Fees:** Configurable priority fee (default 0.0005 SOL).
- **Dynamic Liquidity Slippage:** Models market impact based on position size relative to pool liquidity depth (0.8%–6.0%).
- **Anti-Survivorship Bias Control:** Includes dropped, dormant, or rugged pools to prevent survivorship distortion.
- **Simulated Metrics:** Net PnL, Profit Factor, Win Rate %, Total Fees Paid, Max Drawdown.

### 6. 📱 Telegram Mini App & Alerts
- Real-time milestone alerts (1.5x, 2x, 3x, 5x, 10x), Recovery Radar alerts, and Old Pool Awakening notifications.
- Separate token name and 1-click copyable Solana Mint CA lines.
- Cryptographic `initData` validation (`validateTelegramWebAppData`) using HMAC-SHA256 signature verification.

---

## 🏗️ Architecture & File Structure
