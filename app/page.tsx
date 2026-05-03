'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CATEGORIES, getCategoryByKey } from '@/lib/categories';

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

type AppState = 'idle' | 'processing' | 'results';

function formatAUD(n: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

function CategoryBadge({ categoryKey }: { categoryKey: string }) {
  const cat = getCategoryByKey(categoryKey);
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white whitespace-nowrap"
      style={{ backgroundColor: cat.color }}
    >
      {cat.label}
    </span>
  );
}

function ConfidenceDot({ level }: { level: string }) {
  const cls = level === 'high' ? 'conf-high' : level === 'medium' ? 'conf-medium' : 'conf-low';
  return (
    <span className="flex items-center gap-1.5 text-xs capitalize" style={{ color: 'rgba(255,255,255,0.45)' }}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />
      {level}
    </span>
  );
}

const TIPS = [
  'Scanning transaction descriptions…',
  'Matching merchants to ATO P8 categories…',
  'Checking for motor vehicle expenses…',
  'Identifying software subscriptions…',
  'Reviewing ambiguous merchants…',
  'Classifying deductible expenses…',
  'Flagging items that need your review…',
  'Almost there — finalising results…',
];

export default function Home() {
  const [state, setState] = useState<AppState>('idle');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [progress, setProgress] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [cardProgress, setCardProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tipRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startProgress = () => {
    setProgress(0);
    setTipIndex(0);
    progressRef.current = setInterval(() => setProgress((p) => (p < 92 ? p + 1 : p)), 330);
    tipRef.current = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 4000);
  };

  const stopProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    if (tipRef.current) clearInterval(tipRef.current);
    setProgress(100);
  };

  useEffect(() => () => {
    if (progressRef.current) clearInterval(progressRef.current);
    if (tipRef.current) clearInterval(tipRef.current);
  }, []);

  // Drive the upload card rise based on scroll position
  useEffect(() => {
    if (state !== 'idle') { setCardProgress(0); return; }
    const onScroll = () => {
      // Card fully reveals after scrolling 70% of viewport height
      const trigger = window.innerHeight * 0.7;
      setCardProgress(Math.min(1, window.scrollY / trigger));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [state]);

  const scrollToCard = () => {
    window.scrollTo({ top: window.innerHeight * 0.75, behavior: 'smooth' });
  };

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('Please upload a CSV file.'); return; }
    setError('');
    setFilename(file.name);
    setState('processing');
    startProgress();
    try {
      const text = await file.text();
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json();
      stopProgress();
      if (!res.ok) throw new Error(data.error ?? 'Classification failed.');
      setTransactions(data.transactions);
      setState('results');
    } catch (err) {
      stopProgress();
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setState('idle');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const deductible = transactions.filter((t) => getCategoryByKey(t.category).deductible === 'yes' && t.amount < 0);
  const notDeductible = transactions.filter((t) => getCategoryByKey(t.category).deductible === 'no');
  const needsReview = transactions.filter((t) => getCategoryByKey(t.category).deductible === 'review');
  const totalDeductible = deductible.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalNotDeductible = notDeductible.reduce((s, t) => s + Math.abs(t.amount), 0);

  const chartData = CATEGORIES.filter((c) => c.deductible === 'yes')
    .map((c) => ({
      name: c.label,
      total: deductible.filter((t) => t.category === c.key).reduce((s, t) => s + Math.abs(t.amount), 0),
      color: c.color,
    }))
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  const filtered = filterCategory === 'all' ? transactions : transactions.filter((t) => t.category === filterCategory);

  const exportCSV = () => {
    const header = 'Date,Description,Amount,ATO Category,P8 Label,Confidence,Notes';
    const rows = transactions.map((t) => {
      const cat = getCategoryByKey(t.category);
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [t.date, esc(t.description), t.amount, esc(cat.label), esc(cat.p8Label), t.confidence, esc(t.notes)].join(',');
    });
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename.replace('.csv', '') + '_taxsort.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setState('idle'); setTransactions([]); setFilename(''); setFilterCategory('all');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'transparent' }}>

      {/* ── Fixed background — dark navy + single warm amber glow ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden" style={{ background: '#07111E' }}>
        {/* Primary warm amber-orange glow — upper right */}
        <div
          className="orb orb-pulse"
          style={{
            width: '80vw',
            height: '80vw',
            top: '-20vw',
            right: '-15vw',
            background: 'radial-gradient(circle, rgba(234, 88, 12, 0.75) 0%, rgba(251, 146, 60, 0.45) 30%, transparent 65%)',
          }}
        />
        {/* Secondary warm amber centre — adds richness */}
        <div
          className="orb orb-pulse-2"
          style={{
            width: '50vw',
            height: '50vw',
            top: '5vw',
            left: '25vw',
            background: 'radial-gradient(circle, rgba(245, 158, 11, 0.3) 0%, transparent 65%)',
          }}
        />
        {/* Cool dark teal — bottom left, subtle counterpoint */}
        <div
          className="orb orb-pulse"
          style={{
            width: '55vw',
            height: '55vw',
            bottom: '-15vw',
            left: '-10vw',
            background: 'radial-gradient(circle, rgba(14, 60, 90, 0.6) 0%, transparent 65%)',
          }}
        />
      </div>

      {/* ── Header ── */}
      <header className="glass-nav sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Logo mark — receipt + checkmark */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #F97316, #C2410C)', boxShadow: '0 4px 16px rgba(249,115,22,0.3)' }}
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m-6 9 2 2 4-4" />
            </svg>
          </div>
          {/* Wordmark */}
          <span className="font-bold text-xl tracking-tight select-none">
            <span className="text-white">Tax</span><span style={{ color: '#F97316' }}>Sort</span>
          </span>
          {/* Subtle pill badge */}
          <span
            className="hidden sm:inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full"
            style={{ background: 'rgba(249,115,22,0.1)', color: 'rgba(251,146,60,0.7)', border: '1px solid rgba(249,115,22,0.15)' }}
          >
            ATO P8
          </span>
        </div>
        <div className="flex items-center gap-3">
          {state === 'results' && (
            <>
              <button
                onClick={exportCSV}
                className="text-white text-sm px-4 py-2 rounded-xl font-medium transition-all hover:opacity-90 hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #F97316, #C2410C)', boxShadow: '0 4px 14px rgba(249,115,22,0.3)' }}
              >
                Export CSV
              </button>
              <button
                onClick={reset}
                className="text-white/60 text-sm px-4 py-2 rounded-xl font-medium border border-white/10 hover:border-white/22 hover:text-white/90 transition-all"
              >
                New File
              </button>
            </>
          )}
          <span className="text-xs text-white/25 hidden md:block">For Australian sole traders</span>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col relative z-10">

        {/* ══════════════════════════════════════ IDLE ══════════════════════════════════════ */}
        {state === 'idle' && (
          <>
            {/* ── HERO — fixed to viewport, never moves ── */}
            <section
              className="fixed inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none"
              style={{ zIndex: 0 }}
            >
              <div className="animate-fade-up-1 inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold mb-9 border border-orange-400/20 text-orange-300/80" style={{ background: 'rgba(249,115,22,0.08)' }}>
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                ATO-aligned · 24 P8 categories · Sole trader ready
              </div>

              <h1 className="animate-fade-up-2 text-7xl sm:text-8xl font-bold text-white mb-7 leading-[1.05] tracking-tight max-w-3xl">
                Know exactly<br />
                <span style={{ color: 'rgba(251,146,60,0.95)' }}>what you can claim.</span>
              </h1>
              <p className="animate-fade-up-3 text-white/50 text-2xl max-w-xl leading-relaxed mb-14">
                Upload your bank statement CSV and every transaction is mapped to the exact ATO deduction category on your P8 Schedule.
              </p>

              <div className="animate-fade-up-3 pointer-events-auto">
                <button
                  onClick={scrollToCard}
                  className="text-white font-semibold text-lg px-10 py-4 rounded-2xl shadow-xl transition-all hover:scale-105 hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
                >
                  Get started — it&apos;s free
                </button>
              </div>

              {/* Bouncing scroll indicator */}
              <div
                className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-auto cursor-pointer"
                onClick={scrollToCard}
              >
                <span className="text-white/25 text-xs tracking-widest uppercase">Scroll</span>
                <svg className="w-5 h-5 text-white/25 bounce-y" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                </svg>
              </div>
            </section>

            {/* Scroll space — gives the page height so the user can scroll */}
            <div style={{ height: '180vh' }} />

            {/* ── FLOATING LIQUID GLASS UPLOAD CARD ── */}
            <div
              className="fixed z-30 overflow-y-auto"
              style={{
                left: '1.25rem',
                right: '1.25rem',
                bottom: '1.25rem',
                height: '82vh',
                transform: `translateY(${(1 - cardProgress) * 112}%)`,
                transition: 'transform 0.06s linear',
                borderRadius: '1.75rem',
                background: 'rgba(6, 12, 24, 0.78)',
                backdropFilter: 'blur(52px)',
                WebkitBackdropFilter: 'blur(52px)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 40px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.06) inset, inset 0 1px 0 rgba(255,255,255,0.14)',
              }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-4 pb-1 sticky top-0">
                <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
              </div>

              {/* Card content */}
              <div className="flex flex-col items-center px-8 pt-10 pb-16 max-w-3xl mx-auto">

                {/* Section heading */}
                <p className="text-white/40 text-base font-medium tracking-wider uppercase mb-9">Upload your statement</p>

                {/* Drop zone */}
                <div className="w-full max-w-xl mb-7">
                  <div
                    className={`rounded-3xl p-12 text-center cursor-pointer transition-all duration-200 ${dragging ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}
                    style={{
                      background: dragging ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.05)',
                      border: `2px dashed ${dragging ? 'rgba(249,115,22,0.6)' : 'rgba(255,255,255,0.13)'}`,
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                  >
                    <div
                      className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                      style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.3)' }}
                    >
                      <svg className="w-10 h-10" style={{ color: '#FB923C' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                      </svg>
                    </div>
                    <p className="text-white font-semibold text-xl mb-2">Drop your bank statement CSV here</p>
                    <p className="text-white/40 text-base mb-7">or click to browse your files</p>
                    <div
                      className="inline-flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-full"
                      style={{ background: 'rgba(249,115,22,0.12)', color: '#FB923C', border: '1px solid rgba(249,115,22,0.22)' }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                      CSV files only
                    </div>
                    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
                  </div>

                  {error && (
                    <div className="mt-4 rounded-2xl px-5 py-3.5 text-base text-red-400" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      {error}
                    </div>
                  )}
                </div>

                {/* Bank pills */}
                <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
                  <span className="text-white/25 text-sm mr-1">Works with</span>
                  {['ANZ', 'CBA', 'NAB', 'Westpac', 'Bendigo', 'St George', 'Macquarie'].map((b) => (
                    <span
                      key={b}
                      className="text-sm text-white/45 px-3.5 py-1.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
                    >
                      {b}
                    </span>
                  ))}
                </div>

                {/* Feature cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                  {[
                    { icon: '🧾', title: 'ATO P8 aligned', desc: 'Maps directly to the Business & Professional Items Schedule.' },
                    { icon: '⚡', title: 'Instant results', desc: 'Every transaction classified in under 35 seconds.' },
                    { icon: '📊', title: 'Export ready', desc: 'Download a clean CSV with category, P8 label, and confidence.' },
                  ].map((f) => (
                    <div
                      key={f.title}
                      className="rounded-2xl p-6"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
                    >
                      <div className="text-2xl mb-3">{f.icon}</div>
                      <h3 className="font-semibold text-white/80 text-base mb-1.5">{f.title}</h3>
                      <p className="text-white/35 text-sm leading-relaxed">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════ PROCESSING ═══════════════════════════════════ */}
        {state === 'processing' && (
          <div className="flex-1 flex flex-col items-center justify-center px-4 animate-fade-up">
            <div className="glass-card rounded-3xl p-10 max-w-md w-full text-center">
              {/* Icon */}
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.25)' }}
              >
                <svg className="w-8 h-8" style={{ color: '#FB923C' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-1">Classifying your transactions</h2>
              <p className="text-white/40 text-sm mb-8">{filename} · typically 20–35 seconds</p>

              {/* Progress bar */}
              <div className="w-full rounded-full h-1.5 mb-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-1.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #F97316, #FBBF24)' }}
                />
              </div>
              <div className="flex justify-between text-xs text-white/35 mb-8">
                <span>{TIPS[tipIndex]}</span>
                <span>{progress}%</span>
              </div>

              {/* Steps */}
              <div className="text-left space-y-3">
                {[
                  { label: 'Parse CSV & detect bank format', done: progress > 5 },
                  { label: 'Send transactions to Gemini 2.5 Flash', done: progress > 20 },
                  { label: 'Match to ATO P8 schedule categories', done: progress > 60 },
                  { label: 'Build results & summary', done: progress >= 100 },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${step.done ? '' : ''}`}
                      style={step.done
                        ? { background: 'linear-gradient(135deg, #F97316, #FBBF24)' }
                        : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
                    >
                      {step.done && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-sm ${step.done ? 'text-white/80 font-medium' : 'text-white/30'}`}>{step.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════ RESULTS ═══════════════════════════════════ */}
        {state === 'results' && (
          <div className="animate-fade-up px-4 sm:px-6 py-8 max-w-7xl mx-auto w-full">

            {/* Page title */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white">{filename}</h2>
              <p className="text-white/35 text-sm mt-0.5">{transactions.length} transactions classified</p>
            </div>

            {/* ── Summary cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              {[
                { label: 'Total Deductible', value: formatAUD(totalDeductible), sub: `${deductible.length} transactions`, accent: '#34D399' },
                { label: 'Not Deductible',   value: formatAUD(totalNotDeductible), sub: `${notDeductible.length} transactions`, accent: '#F87171' },
                { label: 'Needs Review',     value: String(needsReview.length),    sub: 'transactions flagged',               accent: '#FBBF24' },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl p-5"
                  style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
                >
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: card.accent }}>{card.label}</p>
                  <p className="text-3xl font-bold text-white mb-1">{card.value}</p>
                  <p className="text-xs text-white/35">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* ── Chart ── */}
            {chartData.length > 0 && (
              <div
                className="rounded-2xl p-6 mb-5"
                style={{ background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
              >
                <h3 className="text-sm font-semibold text-white/60 mb-5 uppercase tracking-wider">Deductions by Category</h3>
                <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 38)}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 56, top: 0, bottom: 0 }}>
                    <XAxis
                      type="number"
                      tickFormatter={(v) => `$${v.toLocaleString()}`}
                      tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.35)' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={195}
                      tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.55)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v) => formatAUD(Number(v))}
                      contentStyle={{ background: 'rgba(6,12,28,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', color: 'white', fontSize: 12 }}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    />
                    <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                      {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Filter pills ── */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setFilterCategory('all')}
                className="text-xs px-3 py-1.5 rounded-full font-medium transition-all"
                style={filterCategory === 'all'
                  ? { background: 'linear-gradient(135deg, #F97316, #C2410C)', color: 'white', boxShadow: '0 4px 12px rgba(249,115,22,0.3)' }
                  : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                All ({transactions.length})
              </button>
              {CATEGORIES.map((cat) => {
                const count = transactions.filter((t) => t.category === cat.key).length;
                if (!count) return null;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setFilterCategory(cat.key)}
                    className="text-xs px-3 py-1.5 rounded-full font-medium transition-all"
                    style={filterCategory === cat.key
                      ? { backgroundColor: cat.color, color: 'white', boxShadow: `0 4px 12px ${cat.color}55` }
                      : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    {cat.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* ── Table ── */}
            <div
              className="rounded-2xl table-scroll"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
            >
              <table className="w-full text-sm text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Date</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Description</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-right" style={{ color: 'rgba(255,255,255,0.3)' }}>Amount</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Category</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Confidence</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, idx) => (
                    <tr
                      key={t.id}
                      className="transition-colors"
                      style={{ borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.35)' }}>{t.date}</td>
                      <td className="px-4 py-3 max-w-xs" style={{ color: 'rgba(255,255,255,0.8)' }}><span className="line-clamp-1">{t.description}</span></td>
                      <td className={`px-4 py-3 text-right font-mono font-medium whitespace-nowrap ${t.amount < 0 ? '' : ''}`} style={{ color: t.amount < 0 ? 'rgba(255,255,255,0.75)' : '#34D399' }}>{formatAUD(t.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><CategoryBadge categoryKey={t.category} /></td>
                      <td className="px-4 py-3 whitespace-nowrap"><ConfidenceDot level={t.confidence} /></td>
                      <td className="px-4 py-3 text-xs max-w-xs" style={{ color: 'rgba(255,255,255,0.3)' }}><span className="line-clamp-2">{t.notes}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-center text-xs mt-6" style={{ color: 'rgba(255,255,255,0.18)' }}>
              TaxSort is a categorisation aid only. Always verify with a registered tax agent before lodging.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
