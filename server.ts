import express, { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadDatabase, saveDatabase, loadSettings, saveSettings } from './server/db.js';
import { fetchLiveSolanaPairs, convertPairToTrackedToken, extractPairMintAddress, lastSyncDiagnostics } from './server/solanaService.js';
import { computeRunnerDna, computeNewRunnersDna, computeOldPoolsDna, computeUniversalDna, runBacktest, evaluateTokenFilter } from './server/dnaEngine.js';
import { sendTokenMilestoneAlert, sendRecoveryAlert, sendOldPoolAwakeningAlert, sendTestAlert, getAlertLogs, validateTelegramWebAppData } from './server/telegramService.js';
import { getOldPoolObservations, calculateOldPoolTrend, recordOldPoolObservation } from './server/oldPoolsEngine.js';
import { calculateEarlySignal, calculateRiskShield } from './server/earlySignalsEngine.js';
import { FilterCriteria, TrackedToken } from './server/types.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Unique deduplication helper to guarantee no duplicated tokens across any view
export function deduplicateTokenList(list: TrackedToken[]): TrackedToken[] {
  const seen = new Set<string>();
  return list.filter(t => {
    const key = (t.mintAddress || t.id || t.address || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// In-memory runtime state synced with persistent file
let tokensDatabase: TrackedToken[] = deduplicateTokenList(loadDatabase());
let appSettings = loadSettings();
let isSyncing = false;
let lastSyncTime = Date.now();

console.log(`Loaded ${tokensDatabase.length} persistent Solana tokens from database.`);

// Live Solana Data Sync Engine
async function syncSolanaData() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const pairs = await fetchLiveSolanaPairs();
    if (pairs.length > 0) {
      let updatedCount = 0;
      let newCount = 0;

      for (const pair of pairs) {
        // Resolve candidate real mint address using strict verification
        const targetMint = extractPairMintAddress(pair);
        if (!targetMint) continue;

        const existingIndex = tokensDatabase.findIndex(
          t => (t.mintAddress && t.mintAddress.toLowerCase() === targetMint.toLowerCase()) ||
               (t.id && t.id.toLowerCase() === targetMint.toLowerCase()) ||
               (t.poolAddress && pair.pairAddress && t.poolAddress.toLowerCase() === pair.pairAddress.toLowerCase())
        );

        if (existingIndex >= 0) {
          const oldToken = tokensDatabase[existingIndex];
          const prevHighest = oldToken.highestMarketCap;
          const prevStatus = oldToken.recovery.status;

          const updated = convertPairToTrackedToken(pair, oldToken);
          if (updated) {
            tokensDatabase[existingIndex] = updated;
            updatedCount++;

            // Check milestone alert triggers
            const entryMc = updated.entryMarketCap;
            const currentMc = updated.currentMarketCap;
            const multiplier = currentMc / Math.max(1, entryMc);

            if (!oldToken.milestones.hit_2x && updated.milestones.hit_2x) {
              sendTokenMilestoneAlert(appSettings.telegram, updated, '2x', multiplier).catch(console.error);
            } else if (!oldToken.milestones.hit_3x && updated.milestones.hit_3x) {
              sendTokenMilestoneAlert(appSettings.telegram, updated, '3x', multiplier).catch(console.error);
            } else if (!oldToken.milestones.hit_5x && updated.milestones.hit_5x) {
              sendTokenMilestoneAlert(appSettings.telegram, updated, '5x', multiplier).catch(console.error);
            } else if (!oldToken.milestones.hit_10x && updated.milestones.hit_10x) {
              sendTokenMilestoneAlert(appSettings.telegram, updated, '10x', multiplier).catch(console.error);
            }

            // Check Recovery Radar alerts
            if (prevStatus !== 'Strong Recovery Signals' && updated.recovery.status === 'Strong Recovery Signals') {
              sendRecoveryAlert(appSettings.telegram, updated).catch(console.error);
            }

            // Check Old Pool Awakening alerts (age >= 24h with Strong Recovery)
            if (updated.poolAgeHours >= 24 && updated.oldPoolTrend) {
              const prevOldClass = oldToken.oldPoolTrend?.classification;
              if (prevOldClass !== 'Strong Recovery Signals' && updated.oldPoolTrend.classification === 'Strong Recovery Signals') {
                sendOldPoolAwakeningAlert(appSettings.telegram, updated).catch(console.error);
              }
            }
          }
        } else {
          // Double check that we don't already have an entry with this mint
          const alreadyExists = tokensDatabase.some(
            t => (t.mintAddress && t.mintAddress.toLowerCase() === targetMint.toLowerCase()) ||
                 (t.id && t.id.toLowerCase() === targetMint.toLowerCase())
          );
          if (!alreadyExists) {
            // Discover new token: assign sourceTag
            const tag: TrackedToken['sourceTag'] = 
              pair.priceChange && (pair.priceChange.h1 || 0) > 20 ? 'hot_finalized' :
              (pair.pairCreatedAt && (Date.now() - pair.pairCreatedAt < 3600000 * 6) ? 'new_finalized' : 'trending');

            const newToken = convertPairToTrackedToken(pair, undefined, tag);
            if (newToken) {
              tokensDatabase.unshift(newToken);
              newCount++;
            }
          }
        }
      }

      // Maintain absolute deduplication invariant
      tokensDatabase = deduplicateTokenList(tokensDatabase);

      lastSyncTime = Date.now();
      saveDatabase(tokensDatabase);
      console.log(`Solana sync completed. Updated: ${updatedCount}, New: ${newCount}, Total Tracked: ${tokensDatabase.length}`);
    }
  } catch (err) {
    console.error('Error during Solana live sync:', err);
  } finally {
    isSyncing = false;
  }
}

// Background scheduler: initial sync + every 60s
syncSolanaData().catch(console.error);
setInterval(() => {
  syncSolanaData().catch(console.error);
}, 60000);

// API Routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    tokensCount: tokensDatabase.length,
    lastSyncTime,
    isSyncing,
    telegramConfigured: !!(appSettings.telegram.botToken && appSettings.telegram.chatId)
  });
});

app.get('/api/diagnostics', (req: Request, res: Response) => {
  res.json({
    ...lastSyncDiagnostics,
    totalTrackedInDb: tokensDatabase.length,
    lastSyncTime,
    isSyncing
  });
});

app.post('/api/sync', async (req: Request, res: Response) => {
  await syncSolanaData();
  res.json({
    success: true,
    lastSyncTime,
    tokensCount: tokensDatabase.length
  });
});

app.get('/api/tokens', (req: Request, res: Response) => {
  const { tab, timeframe = '1h', search = '' } = req.query as Record<string, string>;
  let result = [...tokensDatabase];

  // Tab filter: inclusive without dropping valid coins
  if (tab === 'trending') {
    result = result.filter(t => t.sourceTag === 'trending' || t.volume.h1 > 15000 || t.volume.h24 > 80000);
  } else if (tab === 'early_signals') {
    result = result.filter(t => (t.earlySignal?.score || 0) >= 40 || (t.volume.m5 * 12) / Math.max(1, t.volume.h1) >= 1.6);
  } else if (tab === 'new_finalized') {
    result = result.filter(t => t.sourceTag === 'new_finalized' || t.poolAgeHours <= 12);
  } else if (tab === 'hot_finalized') {
    result = result.filter(t => t.sourceTag === 'hot_finalized' || Math.abs(t.priceChange.h1) >= 8 || t.volume.h1 > 40000);
  } else if (tab === 'smart_money') {
    result = result.filter(t => (t.smartMoney?.smartWalletCount || 0) >= 1 || t.sourceTag === 'smart_money');
  } else if (tab === 'old_pools') {
    result = result.filter(t => t.poolAgeHours >= 24);
  }

  // Search filter
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q) ||
      t.poolAddress.toLowerCase().includes(q)
    );
  }

  // Include evaluation against active filter and ensure oldPoolTrend, earlySignal, riskShield are present
  const itemsWithEvaluation = result.map(token => {
    if (!token.oldPoolTrend) {
      token.oldPoolTrend = calculateOldPoolTrend(token);
    }
    if (!token.earlySignal) {
      token.earlySignal = calculateEarlySignal(token);
    }
    if (!token.riskShield) {
      token.riskShield = calculateRiskShield(token);
    }
    const evalResult = evaluateTokenFilter(token, appSettings.activeFilter);
    return {
      ...token,
      filterEvaluation: evalResult
    };
  });

  res.json({
    tokens: deduplicateTokenList(itemsWithEvaluation),
    totalTracked: tokensDatabase.length,
    activeTab: tab || 'all',
    timeframe,
    lastSyncTime
  });
});

app.get('/api/radar', (req: Request, res: Response) => {
  const { statusFilter = 'all' } = req.query as { statusFilter?: string };

  let radarTokens = tokensDatabase.map(t => {
    const evalResult = evaluateTokenFilter(t, appSettings.activeFilter);
    return {
      ...t,
      filterEvaluation: evalResult
    };
  });

  if (statusFilter !== 'all') {
    radarTokens = radarTokens.filter(t => t.recovery.status === statusFilter);
  } else {
    // Show all tokens that have some recovery signal or classification
    radarTokens = radarTokens.filter(t => t.recovery.status !== 'None');
  }

  // Sort by recovery score descending
  radarTokens.sort((a, b) => b.recovery.score - a.recovery.score);

  const counts = {
    strong: tokensDatabase.filter(t => t.recovery.status === 'Strong Recovery Signals').length,
    developing: tokensDatabase.filter(t => t.recovery.status === 'Developing Recovery').length,
    early: tokensDatabase.filter(t => t.recovery.status === 'Early Recovery').length,
    weakening: tokensDatabase.filter(t => t.recovery.status === 'Weakening').length,
  };

  res.json({
    tokens: deduplicateTokenList(radarTokens),
    counts,
    totalTracked: tokensDatabase.length,
    lastSyncTime
  });
});

app.get('/api/old-pools', (req: Request, res: Response) => {
  const {
    minAge = '24',
    minLiquidity = '0',
    minMarketCap = '0',
    minScore = '0',
    classification = 'all',
    sort = 'score_desc'
  } = req.query as Record<string, string>;

  const ageThreshold = parseFloat(minAge) || 24;
  const liqThreshold = parseFloat(minLiquidity) || 0;
  const mcapThreshold = parseFloat(minMarketCap) || 0;
  const scoreThreshold = parseFloat(minScore) || 0;

  // Filter older pools
  let oldPools = tokensDatabase.filter(t => {
    if (t.poolAgeHours < ageThreshold) return false;
    if (t.liquidity < liqThreshold) return false;
    if (t.currentMarketCap < mcapThreshold) return false;
    // Exclude unreliable or insufficient data
    if (!t.liquidity || t.liquidity <= 0 || !t.currentMarketCap || t.currentMarketCap <= 0) return false;
    return true;
  });

  // Calculate trends & record observations
  oldPools = oldPools.map(t => {
    t.oldPoolTrend = calculateOldPoolTrend(t);
    if (t.oldPoolTrend && t.oldPoolTrend.classification !== 'Dormant') {
      recordOldPoolObservation(t);
    }
    const evalResult = evaluateTokenFilter(t, appSettings.activeFilter);
    return {
      ...t,
      filterEvaluation: evalResult
    };
  });

  // Score threshold filter
  if (scoreThreshold > 0) {
    oldPools = oldPools.filter(t => (t.oldPoolTrend?.score || 0) >= scoreThreshold);
  }

  // Classification filter
  if (classification !== 'all') {
    oldPools = oldPools.filter(t => t.oldPoolTrend?.classification === classification);
  }

  // Sorting
  if (sort === 'score_desc') {
    oldPools.sort((a, b) => (b.oldPoolTrend?.score || 0) - (a.oldPoolTrend?.score || 0));
  } else if (sort === 'liquidity_desc') {
    oldPools.sort((a, b) => b.liquidity - a.liquidity);
  } else if (sort === 'buyers_desc') {
    oldPools.sort((a, b) => (b.txns?.h1?.buys || 0) - (a.txns?.h1?.buys || 0));
  } else if (sort === 'age_desc') {
    oldPools.sort((a, b) => b.poolAgeHours - a.poolAgeHours);
  }

  const allOldInDb = tokensDatabase.filter(t => t.poolAgeHours >= ageThreshold);
  const classificationCounts = {
    all: allOldInDb.length,
    earlyAwakening: allOldInDb.filter(t => (t.oldPoolTrend || calculateOldPoolTrend(t)).classification === 'Early Awakening').length,
    liquidityRecovery: allOldInDb.filter(t => (t.oldPoolTrend || calculateOldPoolTrend(t)).classification === 'Liquidity Recovery').length,
    buyerAccumulation: allOldInDb.filter(t => (t.oldPoolTrend || calculateOldPoolTrend(t)).classification === 'Buyer Accumulation').length,
    strongRecovery: allOldInDb.filter(t => (t.oldPoolTrend || calculateOldPoolTrend(t)).classification === 'Strong Recovery Signals').length,
    falseAwakening: allOldInDb.filter(t => (t.oldPoolTrend || calculateOldPoolTrend(t)).classification === 'False Awakening Risk').length,
  };

  res.json({
    tokens: deduplicateTokenList(oldPools),
    counts: classificationCounts,
    totalTracked: tokensDatabase.length,
    ageThreshold,
    lastSyncTime
  });
});

app.get('/api/old-pools/observations', (req: Request, res: Response) => {
  res.json({
    observations: getOldPoolObservations(),
    totalTracked: tokensDatabase.length
  });
});

app.get('/api/history', (req: Request, res: Response) => {
  const { milestone = 'all', sort = 'ath_desc' } = req.query as Record<string, string>;
  let list = [...tokensDatabase];

  if (milestone !== 'all') {
    if (milestone === '1.5x') list = list.filter(t => t.milestones.hit_1_5x);
    if (milestone === '2x') list = list.filter(t => t.milestones.hit_2x);
    if (milestone === '3x') list = list.filter(t => t.milestones.hit_3x);
    if (milestone === '5x') list = list.filter(t => t.milestones.hit_5x);
    if (milestone === '10x') list = list.filter(t => t.milestones.hit_10x);
  }

  if (sort === 'ath_desc') {
    list.sort((a, b) => (b.highestMarketCap / Math.max(1, b.entryMarketCap)) - (a.highestMarketCap / Math.max(1, a.entryMarketCap)));
  } else if (sort === 'current_desc') {
    list.sort((a, b) => (b.currentMarketCap / Math.max(1, b.entryMarketCap)) - (a.currentMarketCap / Math.max(1, a.entryMarketCap)));
  } else if (sort === 'recent') {
    list.sort((a, b) => b.discoveryTime - a.discoveryTime);
  }

  const total = tokensDatabase.length;
  const uniqueDenominator = total;

  const hit1_5xCount = tokensDatabase.filter(t => t.milestones.hit_1_5x).length;
  const hit2xCount = tokensDatabase.filter(t => t.milestones.hit_2x).length;
  const hit3xCount = tokensDatabase.filter(t => t.milestones.hit_3x).length;
  const hit5xCount = tokensDatabase.filter(t => t.milestones.hit_5x).length;
  const hit10xCount = tokensDatabase.filter(t => t.milestones.hit_10x).length;

  res.json({
    tokens: deduplicateTokenList(list),
    stats: {
      totalUniqueTokens: uniqueDenominator,
      hit1_5xCount,
      hit1_5xPct: Number(((hit1_5xCount / uniqueDenominator) * 100).toFixed(1)),
      hit2xCount,
      hit2xPct: Number(((hit2xCount / uniqueDenominator) * 100).toFixed(1)),
      hit3xCount,
      hit3xPct: Number(((hit3xCount / uniqueDenominator) * 100).toFixed(1)),
      hit5xCount,
      hit5xPct: Number(((hit5xCount / uniqueDenominator) * 100).toFixed(1)),
      hit10xCount,
      hit10xPct: Number(((hit10xCount / uniqueDenominator) * 100).toFixed(1)),
      avgPeakMultiplier: Number((tokensDatabase.map(t => t.highestMarketCap / Math.max(1, t.entryMarketCap)).reduce((a, b) => a + b, 0) / uniqueDenominator).toFixed(2))
    }
  });
});

app.get('/api/early-signals', (req: Request, res: Response) => {
  const earlyTokens = tokensDatabase
    .map(t => {
      if (!t.earlySignal) t.earlySignal = calculateEarlySignal(t);
      if (!t.riskShield) t.riskShield = calculateRiskShield(t);
      const evalResult = evaluateTokenFilter(t, appSettings.activeFilter);
      return { ...t, filterEvaluation: evalResult };
    })
    .sort((a, b) => (b.earlySignal?.score || 0) - (a.earlySignal?.score || 0));

  const counts = {
    all: earlyTokens.length,
    earlySurge: earlyTokens.filter(t => t.earlySignal?.classification === 'Early Surge').length,
    volumeIgnition: earlyTokens.filter(t => t.earlySignal?.classification === 'Volume Ignition').length,
    quietAccumulation: earlyTokens.filter(t => t.earlySignal?.classification === 'Quiet Accumulation').length,
  };

  res.json({
    tokens: deduplicateTokenList(earlyTokens),
    counts,
    totalTracked: tokensDatabase.length,
    lastSyncTime
  });
});

app.get('/api/dna', (req: Request, res: Response) => {
  const summary = computeRunnerDna(tokensDatabase);
  res.json(summary);
});

app.get('/api/dna/new-runners', (req: Request, res: Response) => {
  const { c1, c2, c3, c4 } = req.query as Record<string, string>;
  const config = {
    c1MaxHours: parseFloat(c1) || 0.5,
    c2MaxHours: parseFloat(c2) || 1.0,
    c3MaxHours: parseFloat(c3) || 5.0,
    c4MaxHours: parseFloat(c4) || 24.0,
  };
  const data = computeNewRunnersDna(tokensDatabase, config);
  res.json(data);
});

app.get('/api/dna/old-pools', (req: Request, res: Response) => {
  const data = computeOldPoolsDna(tokensDatabase);
  res.json(data);
});

app.get('/api/dna/universal', (req: Request, res: Response) => {
  const data = computeUniversalDna(tokensDatabase);
  res.json(data);
});

app.post('/api/backtest', (req: Request, res: Response) => {
  const { filter, options } = req.body as { filter?: FilterCriteria; options?: any };
  const targetFilter = filter || appSettings.activeFilter;
  const result = runBacktest(tokensDatabase, targetFilter, options);
  res.json(result);
});

app.get('/api/settings', (req: Request, res: Response) => {
  res.json(appSettings);
});

app.post('/api/settings', (req: Request, res: Response) => {
  appSettings = { ...appSettings, ...req.body };
  saveSettings(appSettings);
  res.json({ success: true, settings: appSettings });
});

app.get('/api/telegram/alerts', (req: Request, res: Response) => {
  res.json({ alerts: getAlertLogs() });
});

app.post('/api/telegram/test', async (req: Request, res: Response) => {
  const { botToken, chatId } = req.body;
  const targetConfig = (botToken && chatId) ? { ...appSettings.telegram, botToken, chatId } : appSettings.telegram;
  const success = await sendTestAlert(targetConfig);
  res.json({ success });
});

app.post('/api/telegram/verify-init-data', (req: Request, res: Response) => {
  const { initData, botToken } = req.body;
  const token = botToken || appSettings.telegram.botToken;
  const result = validateTelegramWebAppData(initData, token);
  res.json(result);
});

// Vite middleware in dev, static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
