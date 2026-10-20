import React from 'react';
import { MainTab, Timeframe, IntelligenceSubTab, TrackedToken, AppSettings, HistoryStats, RunnerDnaData, TelegramAlertLog } from './types.js';
import { TopBar } from './components/TopBar.js';
import { BottomNav } from './components/BottomNav.js';
import { FilterModal } from './components/FilterModal.js';
import { TelegramModal } from './components/TelegramModal.js';
import { TokenDetailModal } from './components/TokenDetailModal.js';
import { PoolIntelligenceTab } from './tabs/PoolIntelligenceTab.js';
import { PoolHistoryTab } from './tabs/PoolHistoryTab.js';
import { RecoveryRadarTab } from './tabs/RecoveryRadarTab.js';
import { RunnerDnaTab } from './tabs/RunnerDnaTab.js';
import { PerformanceLabTab } from './tabs/PerformanceLabTab.js';

export default function App() {
  const [currentTab, setCurrentTab] = React.useState<MainTab>('intelligence');
  const [timeframe, setTimeframe] = React.useState<Timeframe>('1h');
  const [activeSubTab, setActiveSubTab] = React.useState<IntelligenceSubTab>('trending');
  const [searchQuery, setSearchQuery] = React.useState('');

  const [tokens, setTokens] = React.useState<TrackedToken[]>([]);
  const [historyTokens, setHistoryTokens] = React.useState<TrackedToken[]>([]);
  const [historyStats, setHistoryStats] = React.useState<HistoryStats | null>(null);
  const [radarTokens, setRadarTokens] = React.useState<TrackedToken[]>([]);
  const [radarCounts, setRadarCounts] = React.useState({ strong: 0, developing: 0, early: 0, weakening: 0 });
  const [dnaData, setDnaData] = React.useState<RunnerDnaData | null>(null);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [alerts, setAlerts] = React.useState<TelegramAlertLog[]>([]);

  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [isTelegramOpen, setIsTelegramOpen] = React.useState(false);
  const [selectedTokenForDetail, setSelectedTokenForDetail] = React.useState<TrackedToken | null>(null);

  // Initialize Telegram WebApp SDK
  React.useEffect(() => {
    try {
      // @ts-expect-error Telegram WebApp global
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
        if (tg.setHeaderColor) tg.setHeaderColor('#020617');
        if (tg.setBackgroundColor) tg.setBackgroundColor('#020617');
      }
    } catch (err) {
      console.warn('Telegram WebApp initialization notice:', err);
    }
  }, []);

  // Unique token deduplicator helper to safeguard UI against any duplicate key warnings
  const deduplicateTokens = (toks: TrackedToken[]): TrackedToken[] => {
    const seen = new Set<string>();
    return (toks || []).filter(t => {
      const k = (t.mintAddress || t.id || t.address || '').toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  // Fetch initial app settings
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json() as AppSettings;
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  // Fetch tokens for Pool Intelligence
  const fetchIntelligenceTokens = async () => {
    try {
      const query = new URLSearchParams({
        tab: activeSubTab,
        timeframe,
        search: searchQuery
      });
      const res = await fetch(`/api/tokens?${query.toString()}`);
      if (res.ok) {
        const data = await res.json() as { tokens: TrackedToken[] };
        setTokens(deduplicateTokens(data.tokens));
      }
    } catch (err) {
      console.error('Failed to load tokens:', err);
    }
  };

  // Fetch History and Success Rate
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json() as { tokens: TrackedToken[]; stats: HistoryStats };
        setHistoryTokens(deduplicateTokens(data.tokens));
        setHistoryStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  // Fetch Recovery Radar
  const fetchRadar = async () => {
    try {
      const res = await fetch('/api/radar');
      if (res.ok) {
        const data = await res.json() as {
          tokens: TrackedToken[];
          counts: { strong: number; developing: number; early: number; weakening: number };
        };
        setRadarTokens(deduplicateTokens(data.tokens));
        setRadarCounts(data.counts);
      }
    } catch (err) {
      console.error('Failed to load radar:', err);
    }
  };

  // Fetch Runner DNA
  const fetchDna = async () => {
    try {
      const res = await fetch('/api/dna');
      if (res.ok) {
        const data = await res.json() as RunnerDnaData;
        setDnaData(data);
      }
    } catch (err) {
      console.error('Failed to load DNA:', err);
    }
  };

  // Fetch Telegram Alert logs
  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/telegram/alerts');
      if (res.ok) {
        const data = await res.json() as { alerts: TelegramAlertLog[] };
        setAlerts(data.alerts);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  };

  // Initial load
  React.useEffect(() => {
    fetchSettings();
    fetchHistory();
    fetchRadar();
    fetchDna();
    fetchAlerts();
  }, []);

  // Fetch intelligence tokens on dependencies change
  React.useEffect(() => {
    fetchIntelligenceTokens();
  }, [activeSubTab, timeframe, searchQuery]);

  // Refresh handler (triggers server-side live Solana sync)
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      await Promise.all([
        fetchIntelligenceTokens(),
        fetchHistory(),
        fetchRadar(),
        fetchDna(),
        fetchAlerts()
      ]);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Save filter changes
  const handleApplyFilter = async (criteria: AppSettings['activeFilter']) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeFilter: criteria })
      });
      if (res.ok) {
        const data = await res.json() as { settings: AppSettings };
        setSettings(data.settings);
        fetchIntelligenceTokens();
        fetchRadar();
      }
    } catch (err) {
      console.error('Failed to save filter settings:', err);
    }
  };

  // Save Telegram config
  const handleSaveTelegram = async (tgConfig: AppSettings['telegram']) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram: tgConfig })
      });
      if (res.ok) {
        const data = await res.json() as { settings: AppSettings };
        setSettings(data.settings);
      }
    } catch (err) {
      console.error('Failed to save Telegram settings:', err);
    }
  };

  // Active filter count calculation
  const getActiveFilterCount = () => {
    if (!settings?.activeFilter) return 0;
    const f = settings.activeFilter;
    let count = 0;
    if (f.minLiquidity !== undefined) count++;
    if (f.maxLiquidity !== undefined) count++;
    if (f.minLiquidityDelta !== undefined) count++;
    if (f.minVolume !== undefined) count++;
    if (f.minBuys !== undefined) count++;
    if (f.minBuySellRatio !== undefined) count++;
    if (f.minMarketCap !== undefined) count++;
    if (f.maxMarketCap !== undefined) count++;
    if (f.minSmartWallets !== undefined) count++;
    if (f.maxTop10HolderPct !== undefined) count++;
    if (f.requireLpLocked) count++;
    if (f.requireMintRevoked) count++;
    return count;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* 1. APP LAYOUT: Top Bar with ONLY Timeframe Selector + Action Triggers */}
      <TopBar
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        onOpenFilter={() => setIsFilterOpen(true)}
        onOpenTelegram={() => setIsTelegramOpen(true)}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        telegramConfigured={!!(settings?.telegram.botToken && settings?.telegram.chatId)}
        activeFilterCount={getActiveFilterCount()}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-3 pt-3">
        {currentTab === 'intelligence' && (
          <PoolIntelligenceTab
            tokens={tokens}
            timeframe={timeframe}
            activeSubTab={activeSubTab}
            onSubTabChange={setActiveSubTab}
            onSelectToken={setSelectedTokenForDetail}
            onOpenFilter={() => setIsFilterOpen(true)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        )}

        {currentTab === 'history' && (
          <PoolHistoryTab
            tokens={historyTokens}
            stats={historyStats}
            timeframe={timeframe}
            onSelectToken={setSelectedTokenForDetail}
          />
        )}

        {currentTab === 'radar' && (
          <RecoveryRadarTab
            tokens={radarTokens}
            timeframe={timeframe}
            onSelectToken={setSelectedTokenForDetail}
            radarCounts={radarCounts}
          />
        )}

        {currentTab === 'dna' && (
          <RunnerDnaTab
            dnaData={dnaData}
            loading={!dnaData}
          />
        )}

        {currentTab === 'lab' && settings && (
          <PerformanceLabTab
            initialCriteria={settings.activeFilter}
            presets={settings.savedPresets}
            timeframe={timeframe}
            onSelectToken={setSelectedTokenForDetail}
          />
        )}
      </main>

      {/* 1. APP LAYOUT: Five Bottom Navigation Tabs (Center Highlighted Recovery Radar) */}
      <BottomNav
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        radarStrongCount={radarCounts.strong}
      />

      {/* Smart Filters Modal */}
      {settings && (
        <FilterModal
          isOpen={isFilterOpen}
          onClose={() => setIsFilterOpen(false)}
          criteria={settings.activeFilter}
          onApply={handleApplyFilter}
          presets={settings.savedPresets}
        />
      )}

      {/* Telegram Alert Settings Modal */}
      {settings && (
        <TelegramModal
          isOpen={isTelegramOpen}
          onClose={() => setIsTelegramOpen(false)}
          config={settings.telegram}
          onSave={handleSaveTelegram}
          alerts={alerts}
        />
      )}

      {/* Token Detail and Evidence Inspector Modal */}
      <TokenDetailModal
        token={selectedTokenForDetail}
        onClose={() => setSelectedTokenForDetail(null)}
      />
    </div>
  );
}
