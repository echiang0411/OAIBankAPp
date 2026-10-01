import { useEffect, useId, useRef, useState } from 'react';
import { Anchor, ShieldCheck, MessageSquareText, ImagePlus, LockKeyhole, Sparkles, Package, Landmark, CodeXml, CircleCheck, CircleAlert, LoaderCircle, Check, X, ThumbsUp, ThumbsDown, CreditCard, ChevronDown, FileCheck2, Inbox, Globe2, CircleHelp, ShieldAlert, Upload, SlidersHorizontal } from 'lucide-react';
import type { Campaign, CustomerNotification, CheckResponse, EvalItem, Language, ReportResponse, ReviewItem, ReviewSource, Verdict } from '../shared/schema.ts';
import { languages, verdicts } from '../shared/schema.ts';
import { automaticLabels, browserLanguage, languageNames, validPreference, type LanguagePreference } from '../shared/language.ts';
import { actionFor, copy } from '../shared/copy.ts';
import { guideCopy, followupCopy, notificationCopy, ui } from './i18n.ts';

type Meta = { mode: 'mock' | 'live'; liveReady: boolean; evalCount: number; pendingCount: number; config: { confidenceThreshold: number; smallModel: string; strongModel: string } };
type Demo = { id: string; text: string };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? 'Something went wrong. Please try again.');
  return json as T;
}
const money = (value: number) => `$${value.toFixed(6)}`;
const verdictLabel = (v: Verdict) => ({ scam: 'Scam', likely_scam: 'Likely scam', unclear: 'Unclear', likely_legitimate: 'Likely legitimate' })[v];

export default function App() {
  const [screen, setScreen] = useState<'customer' | 'analyst'>('customer');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bootError, setBootError] = useState('');
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const refreshNotifications = () => api<{ items: CustomerNotification[] }>('/notifications').then(data => setNotifications(data.items.filter(n => !n.read))).catch(e => setBootError(e.message));
  const refresh = async () => { await Promise.all([api<Meta>('/meta').then(setMeta).catch(e => setBootError(e.message)), refreshNotifications()]); };
  useEffect(() => { void refresh(); const timer = setInterval(() => void refreshNotifications(), 5000); return () => clearInterval(timer); }, []);
  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <button className="brand lookout-brand" onClick={() => setScreen('customer')} aria-label="Harbor Lookout home"><span className="brand-mark"><Anchor size={23} strokeWidth={1.7}/></span><span><span className="lookout-name">Harbor Lookout</span><span className="brand-sub">by Harbor National Bank</span></span></button>
      <nav aria-label="Demo views"><button className={screen === 'customer' ? 'nav-button active' : 'nav-button'} onClick={() => setScreen('customer')}><ShieldCheck size={17}/> Customer view</button><button className={screen === 'analyst' ? 'nav-button active' : 'nav-button'} onClick={() => setScreen('analyst')}><SlidersHorizontal size={16}/> Analyst view{Boolean(meta?.pendingCount) && <span className="nav-count">{meta?.pendingCount}</span>}</button></nav>
      <div className="header-status"><span className={`mode-badge ${meta?.mode === 'live' ? 'live' : ''}`}><span/>{meta?.mode === 'live' ? 'Live API' : 'Mock mode'}</span><span className="demo-label">LOCAL DEMO</span></div>
    </div></header>
    {bootError && <div role="alert" className="boot-error">{bootError}</div>}
    <main>{screen === 'customer' ? <Customer meta={meta} refresh={refresh} notices={notifications} dismissNotice={async id => { await api(`/notifications/${id}/read`, {}); await refreshNotifications(); }}/> : <Analyst refresh={refresh}/>}</main>
    <footer className="site-footer"><span><Anchor size={15}/> Fictional bank. Synthetic data. Real peace of mind.</span><span>Built with the OpenAI Responses API</span></footer>
  </div>;
}

function ResolutionNotice({ note, dismiss }: { note: CustomerNotification; dismiss: () => Promise<void> }) {
  const t = notificationCopy[note.language], f = followupCopy[note.language];
  const [error, setError] = useState('');
  const [exposure, setExposure] = useState<'checking' | 'card' | 'password' | null>(null);
  const danger = note.verdict === 'scam' || note.verdict === 'likely_scam';
  return <section className="resolution-notice" lang={note.language} dir={note.language === 'ar' ? 'rtl' : 'ltr'}>
    <div className="resolution-content">
      <div role="status"><h2>{t.title}</h2><p className={`resolution-final ${danger ? 'scam' : ''}`}><strong>{t.final}: {t[note.verdict]}</strong></p><p>{t.next}: {actionFor(note.verdict, note.language)}</p></div>
      <div className="resolution-followup"><Followup language={note.language} exposure={exposure} onChange={setExposure}/>{exposure === 'checking' && <ul className="safe-steps">{f.safeSteps.map(step => <li key={step}>{step}</li>)}</ul>}</div>
      {error && <p role="alert">{error}</p>}
    </div>
    <button aria-label={t.dismiss} onClick={() => void dismiss().catch(e => setError(e.message))}><X size={19}/></button>
  </section>;
}

function Customer({ meta, refresh, notices, dismissNotice }: { meta: Meta | null; refresh: () => Promise<void>; notices: CustomerNotification[]; dismissNotice: (id: string) => Promise<void> }) {
  const [preference, setPreference] = useState<LanguagePreference>(() => {
    try { return validPreference(localStorage.getItem('harbor.language')); } catch { return 'auto'; }
  });
  const language = preference === 'auto' ? browserLanguage(navigator.languages.length ? navigator.languages : [navigator.language]) : preference;
  function changeLanguage(value: string) {
    const next = validPreference(value);
    setPreference(next);
    try { localStorage.setItem('harbor.language', next); } catch { /* The selector also works without storage. */ }
    clear();
  }
  const [tab, setTab] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [filename, setFilename] = useState('');
  const [demos, setDemos] = useState<Demo[]>([]);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [exposure, setExposure] = useState<'checking' | 'card' | 'password' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!result) return;
    resultRef.current?.focus({ preventScroll: true });
    resultRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [result]);
  const t = ui[language], g = guideCopy[language];
  const resolved = Boolean(result && notices.some(note => note.checkId === result.id));
  useEffect(() => { api<Demo[]>('/demos').then(setDemos).catch(e => setError(e.message)); }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const clear = () => { setResult(null); setExposure(null); setError(''); };
  async function pickDemo(id: string) {
    clear(); setSelected(id);
    const demo = demos.find(d => d.id === id);
    if (!demo) return;
    setText(demo.text); setImage(''); setFilename(''); setTab('text');
  }
  function upload(file?: File) {
    if (!file) return;
    clear(); setSelected('');
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError(t.fileHelp); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(reader.result as string); setFilename(file.name); setText(''); };
    reader.onerror = () => setError('The file could not be read. Please try another screenshot.');
    reader.readAsDataURL(file);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); clear();
    try { setResult(await api<CheckResponse>('/check', { ...(tab === 'text' ? { text } : { image }), language })); setHasChecked(true); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="customer-view" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <section className="customer-heading">
      <h1>{hasChecked ? t.checkAnotherTitle : t.checkTitle}</h1>
      <select id="language" className="compact-language" aria-label={t.language} value={language} disabled={busy} onChange={e => changeLanguage(e.target.value)}>
        {languages.map(value => <option key={value} value={value} lang={value}>{languageNames[value]}</option>)}
      </select>
    </section>
    {notices.map(note => <ResolutionNotice key={note.id} note={note} dismiss={() => dismissNotice(note.id)}/>)}
    <div className={`customer-grid ${result ? 'has-result' : ''}`}>
      {result && !resolved && <div className="result-followup" ref={resultRef} tabIndex={-1} role="region" aria-label={followupCopy[result.language].question}><Followup key={result.id} language={result.language} exposure={exposure} onChange={setExposure}/></div>}
      <div className="input-column">
        <form className="panel checker-panel" onSubmit={submit}>
          <fieldset disabled={busy}><legend className="sr-only">Message input</legend>
          <div className="input-tabs"><button type="button" className={tab === 'text' ? 'selected' : ''} onClick={() => { setTab('text'); clear(); }}><MessageSquareText size={17}/>{t.textTab}</button><button type="button" className={tab === 'image' ? 'selected' : ''} onClick={() => { setTab('image'); clear(); }}><ImagePlus size={17}/>{t.imageTab}</button></div>
          {tab === 'text' ? <div className="text-field"><label htmlFor="message">{t.label}</label><textarea dir="auto" id="message" placeholder={t.placeholder} value={text} maxLength={6000} onChange={e => { setText(e.target.value); setSelected(''); clear(); }} rows={6}/><span className="character-count">{text.length.toLocaleString()} / 6,000</span></div> : <div className="upload-area">
            <input ref={fileRef} id="screenshot" className="sr-only" type="file" accept="image/png,image/jpeg" onChange={e => upload(e.target.files?.[0])}/>
            {image ? <div className="image-preview"><img src={image} alt="Selected message screenshot"/><div><span className="file-icon"><FileCheck2 size={25}/></span><strong>{filename}</strong><span>{t.fileHelp}</span><button type="button" className="text-button" onClick={() => fileRef.current?.click()}>{t.upload}</button></div></div> : <button type="button" className="upload-button" onClick={() => fileRef.current?.click()}><span className="upload-icon"><Upload size={28}/></span><strong>{t.upload}</strong><span>{t.fileHelp}</span></button>}
          </div>}
          <button className="primary-button check-button" disabled={busy || !meta || !(tab === 'text' ? text.trim() : image)}>{busy ? <LoaderCircle size={19} className="spin"/> : <ShieldCheck size={19}/>} {busy ? t.checking : t.submit}</button>
          </fieldset>
          {error && <div className="error-message" role="alert"><CircleAlert size={18}/><span>{error}</span></div>}
          <p className="privacy-note"><LockKeyhole size={13}/>{t.privacy}</p>
        </form>
        <div className="samples"><p className="eyebrow">{t.examples}</p><div className="sample-buttons">{[{ id: 'harbor-alert', title: t.bank, Icon: Landmark }, { id: 'injection', title: t.injection, Icon: CodeXml }].map(({ id, title, Icon }) => <button key={id} disabled={busy} className={selected === id ? 'selected' : ''} onClick={() => void pickDemo(id).catch(e => setError(e.message))}><Icon size={15}/>{title}</button>)}</div><p className="synthetic-note">{t.synthetic}</p></div>
      </div>
      <div className="result-column" role="region" aria-label={t.result} aria-live="polite" aria-busy={busy}>
        {busy ? <div className="panel loading-panel"><div className="loading-symbol"><ShieldCheck size={36}/><LoaderCircle className="spin" size={65}/></div><h2>{t.checking}</h2><p>{meta?.mode === 'live' ? g.loadingLive : g.loadingMock}</p></div> : result ? <ResultCard key={result.id} data={result} refresh={refresh} exposure={exposure} resolved={resolved}/> : <aside className="guide-panel"><div className="guide-art" aria-hidden="true"><div className="art-message"><span/><span/><span/><div className="art-link"><LockKeyhole size={12}/> harbor.example</div></div><div className="art-shield"><ShieldCheck size={34}/></div><span className="art-spark"><Sparkles size={20}/></span></div><p className="eyebrow">{g.eyebrow}</p><h2>{g.title}</h2><p className="guide-description">{g.description}</p><div className="guide-steps"><div><span>01</span><p><strong>{g.share}</strong>{g.shareBody}</p></div><div><span>02</span><p><strong>{g.understand}</strong>{g.understandBody}</p></div><div><span>03</span><p><strong>{g.decide}</strong>{g.decideBody}</p></div></div><div className="guide-bottom"><ShieldCheck size={17}/><span>{g.policy}</span></div></aside>}
      </div>
    </div>
    <div className="principle-strip"><span><span className="principle-dot"/>{g.interprets}</span><span><span className="principle-dot"/>{g.validates}</span><span><span className="principle-dot"/>{g.youDecide}</span></div>
  </div>;
}

function ResultCard({ data, refresh, exposure, resolved }: { data: CheckResponse; refresh: () => Promise<void>; exposure: 'checking' | 'card' | 'password' | null; resolved: boolean }) {
  const { result: r } = data;
  const t = ui[data.language], f = followupCopy[data.language];
  const [estimatedWait, setEstimatedWait] = useState<number | null>(null);
  const [sent, setSent] = useState<Array<'report' | 'escalation'>>([]);
  const [sending, setSending] = useState<'report' | 'escalation' | null>(null);
  const [error, setError] = useState('');
  const safe = r.verdict === 'likely_legitimate';
  const danger = r.verdict === 'scam' || r.verdict === 'likely_scam';
  async function send(kind: 'report' | 'escalation') {
    setSending(kind); setError('');
    try {
      const submission = await api<ReportResponse>('/reports', { checkId: data.id, kind });
      if (kind === 'escalation') setEstimatedWait(submission.estimatedWaitMinutes);
      setSent(previous => [...new Set([...previous, kind])]);
      await refresh();
    }
    catch (e) { setError((e as Error).message); } finally { setSending(null); }
  }
  return <div className={`panel result-panel ${safe ? 'safe' : danger ? 'danger' : 'unclear'}`}>
    <div className="result-top"><p className="eyebrow">{t.result}</p><span className="result-mode">{data.mode === 'mock' ? 'SAVED RESPONSE' : 'LIVE ANALYSIS'}</span></div>
    <div className="verdict-heading"><span className="verdict-icon">{safe ? <ShieldCheck size={27}/> : danger ? <ShieldAlert size={27}/> : <CircleHelp size={27}/>}</span><h2>{copy[data.language][r.verdict]}</h2></div>
    <div className={`fraud-help ${r.escalate_to_human || r.verdict === 'unclear' ? 'recommended' : ''}`}>
      {(r.escalate_to_human || r.verdict === 'unclear') && <p className="human-note"><CircleHelp size={18}/>{t.human}</p>}
      <button className={r.escalate_to_human || r.verdict === 'unclear' ? 'primary-button' : 'secondary-button'} disabled={resolved || Boolean(sending) || sent.includes('escalation')} onClick={() => void send('escalation')}>{sending === 'escalation' ? <LoaderCircle size={18} className="spin"/> : sent.includes('escalation') ? <CircleCheck size={18}/> : <CircleHelp size={18}/>} {f.escalation}</button>
      {!resolved && estimatedWait !== null && estimatedWait > 0 && <p className="fraud-wait" role="status">{f.estimatedWait.replace('{minutes}', new Intl.NumberFormat(data.language).format(estimatedWait))}</p>}
      <p className="fraud-hotline">{f.hotline} <bdi dir="ltr">1-800-422-6398</bdi> <span>{f.hotlineWait}</span></p>
      {sent.length > 0 && <p className="feedback-thanks" role="status"><CircleCheck size={18}/>{f.sent}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="result-overview">
      <p className="result-explanation">{r.explanation_in_user_language}</p>
      <section className="result-actions" aria-label={t.next}>
        <div className="next-step"><div><ShieldCheck size={22}/><h3>{t.next}</h3></div>{exposure === 'checking' ? <ul className="safe-steps">{f.safeSteps.map(step => <li key={step}>{step}</li>)}</ul> : <p>{r.recommended_action}</p>}</div>
        {danger && <div className="report-row"><button className="secondary-button" disabled={Boolean(sending) || sent.includes('report')} onClick={() => void send('report')}>{sending === 'report' ? <LoaderCircle size={16} className="spin"/> : sent.includes('report') ? <CircleCheck size={16}/> : <ShieldAlert size={16}/>} {f.report}</button></div>}
      </section>
      <section className="flags"><h3>{t.flags}</h3>{r.red_flags.length ? <ul>{r.red_flags.map((flag, i) => <li key={i}><span>{i + 1}</span>{flag}</li>)}</ul> : <p className="no-flags"><CircleCheck size={17}/>{t.noFlags}</p>}</section>
    </div>
    <CheckDetails data={data}/>
  </div>;
}

function CheckDetails({ data, internal = false }: { data: CheckResponse; internal?: boolean }) {
  const r = data.result;
  const t = ui[internal ? 'en' : data.language], f = followupCopy[internal ? 'en' : data.language];
  return (
    <details className="technical-details"><summary>{t.details}<ChevronDown size={16}/></summary><div className="details-content"><h4>{f.links}</h4>{data.extracted_links.map((url, i) => <code className="extracted-url" key={i}>{url}</code>)}<h4>{t.domains}</h4>{data.links.length ? data.links.map(link => <div key={link.domain} className="domain-row"><span><code>{link.domain}</code><small>{f.registeredDomain}: <strong>{link.registeredDomain ?? "Unavailable"}</strong></small></span><span className={link.status.includes('allowlisted') ? 'domain-ok' : 'domain-warning'}>{({ allowlisted: 'Allowlisted', demo_allowlisted: 'Demo allowlist', unrecognized: 'Not allowlisted', invalid: 'Invalid URL', unverifiable: f.unverifiable })[link.status]}</span></div>) : <p>{t.noLinks}</p>}<p>{t.policy}</p>{internal && <><div className="metrics"><div><span>{t.confidence}</span><strong>{Math.round(r.confidence * 100)}%</strong><small>{t.confidenceHelp}</small></div><div><span>{data.mode === 'mock' ? t.mockCost : t.cost}</span><strong>{money(data.estimatedCost)}</strong><small>{data.mode === 'mock' ? t.actualMock : 'Includes all model calls and image input tokens'}</small></div></div><h4>{t.route}</h4>{data.calls.map((c, i) => <div className="call-row" key={i}><span><code>{c.model}</code><small>{c.purpose} · {c.input} input / {c.output} output tokens</small></span><span>{money(c.estimatedCost)}</span></div>)}{data.escalationReason && <p className="escalation-note">{data.escalationReason}. Stronger model used.</p>}<p className="injection-status">Injection detected: <strong>{r.injection_detected ? 'Yes' : 'No'}</strong></p></>}</div></details>
  );
}

function InternalDiagnostics({ checks }: { checks: CheckResponse[] }) {
  return <section className="panel internal-diagnostics"><div className="eval-header"><h2>Developer diagnostics</h2><span>Internal demo view</span></div>
    <p className="diagnostics-description">API costs are estimates for the bank, not customer charges. Showing the latest 50 checks. Mock estimates use illustrative token usage; actual mock spend is $0.</p>
    {checks.length ? checks.map(check => <article className="diagnostic-check" key={check.id}>
      <div className="diagnostic-summary"><span><strong>{verdictLabel(check.result.verdict)}</strong><small>{check.language} · {check.source} · {check.mode}</small></span><span>{check.mode === 'mock' ? 'Illustrative API cost' : 'Estimated API cost'}<strong>{money(check.estimatedCost)}</strong></span></div>
      <p className="diagnostic-message">{check.redactedText}</p>
      <CheckDetails data={check} internal/>
    </article>) : <p className="diagnostics-description">Run a message check to see its cost, token usage, and model routing here.</p>}
  </section>;
}

type DemoAction = 'freeze' | 'replace' | 'reset' | 'signout';
function Followup({ language, exposure, onChange }: { language: Language; exposure: 'checking' | 'card' | 'password' | null; onChange: (value: 'checking' | 'card' | 'password') => void }) {
  const f = followupCopy[language];
  const actionTitleId = useId();
  const [confirm, setConfirm] = useState<DemoAction | null>(null);
  const [completed, setCompleted] = useState<DemoAction[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (confirm) dialog.current?.showModal(); else dialog.current?.close(); }, [confirm]);
  const actions: DemoAction[] = exposure === 'card' ? ['freeze', 'replace'] : exposure === 'password' ? ['reset', 'signout'] : [];
  return <section className="followup"><h3>{f.question}</h3><div className="exposure-options">{(['checking', 'card', 'password'] as const).map(value => <button key={value} aria-pressed={exposure === value} className={exposure === value ? 'selected' : ''} onClick={() => onChange(value)}>{f[value]}</button>)}</div>
    {actions.length > 0 && <div className="recovery-actions"><small>{f.simulated}</small>{actions.map(action => <div key={action}>{completed.includes(action) ? <p role="status" className="action-completed"><CircleCheck size={17}/><span>{f[action]}: {f.completed}</span></p> : <button className="freeze-button" onClick={() => setConfirm(action)}>{exposure === 'card' ? <CreditCard size={17}/> : <LockKeyhole size={17}/>} {f[action]}</button>}</div>)}</div>}
    <dialog ref={dialog} onCancel={() => setConfirm(null)} onClose={() => setConfirm(null)} aria-labelledby={actionTitleId}><div className="dialog-icon"><ShieldCheck size={27}/></div><p className="eyebrow">{f.confirmation}</p><h2 id={actionTitleId}>{confirm ? f[confirm] : ''}</h2><p>{f.body}</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setConfirm(null)} autoFocus>{f.cancel}</button><button className="primary-button" onClick={() => { if (confirm) setCompleted(previous => [...previous, confirm]); setConfirm(null); }}>{f.confirm}</button></div></dialog>
  </section>;
}

function Analyst({ refresh }: { refresh: () => Promise<void> }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [evals, setEvals] = useState<EvalItem[]>([]);
  const [tab, setTab] = useState<'queue' | 'evals'>('queue');
  const [evalFilter, setEvalFilter] = useState<'all' | 'review'>('all');
  const recordsRef = useRef<HTMLDivElement>(null);
  const visibleEvals = evalFilter === 'review' ? evals.filter(item => item.origin === 'review') : evals;
  function openRecords(nextTab: 'queue' | 'evals', filter: 'all' | 'review' = 'all') {
    setTab(nextTab); setEvalFilter(filter);
    requestAnimationFrame(() => {
      recordsRef.current?.focus({ preventScroll: true });
      recordsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [checks, setChecks] = useState<CheckResponse[]>([]);
  const [sampling, setSampling] = useState(false);
  const [sampleInfo, setSampleInfo] = useState({ historyCount: 0, sampleSize: 5, lookbackDays: 7, campaignWindowDays: 30 });
  async function load() { try { const [reviews, dataset] = await Promise.all([api<{ items: ReviewItem[]; recentChecks: CheckResponse[]; campaigns: Campaign[]; historyCount: number; sampleSize: number; lookbackDays: number; campaignWindowDays: number }>('/reviews'), api<{ items: EvalItem[] }>('/evals')]); setItems(reviews.items); setChecks(reviews.recentChecks); setCampaigns(reviews.campaigns); setSampleInfo(reviews); setEvals(dataset.items); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  useEffect(() => { document.documentElement.lang = 'en'; void load(); }, []);
  async function approve(id: string, label: Verdict) {
    setError('');
    const response = await api<{ added: boolean; notified: boolean }>(`/reviews/${id}/approve`, { label });
    setNotice((response.added ? 'Approved. One new example joined the bank-owned eval set.' : 'Approved. The existing eval example was updated.') + (response.notified ? ' The customer received a simulated notification in their chosen language.' : ''));
    await load(); await refresh();
  }
  async function sample() {
    setSampling(true); setError('');
    try {
      const result = await api<{ added: number; alreadyRun: boolean }>('/reviews/sample', {});
      setNotice(result.alreadyRun ? 'This week’s random sample has already been collected.' : result.added ? `Added ${result.added} randomly selected checks to the review queue.` : 'No eligible past checks yet. Run some checks first.');
      await load(); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setSampling(false); }
  }
  return <div className="analyst"><div className="analyst-heading"><div><p className="eyebrow"><span className="small-diamond"/>HUMAN OVERSIGHT</p><h1>Better with every review.</h1><p>Review reports and random samples to build a bank-owned evaluation set.</p></div><span className="local-tag"><LockKeyhole size={14}/> Local analyst workspace</span></div>
    <div className="stat-grid">
      <button type="button" className="stat-card" aria-controls="analyst-records" onClick={() => openRecords('queue')}><span className="stat-icon"><Inbox size={23}/></span><span><strong>{items.length}</strong><small>Awaiting review</small></span></button>
      <button type="button" className="stat-card" aria-controls="analyst-records" onClick={() => openRecords('evals')}><span className="stat-icon"><FileCheck2 size={23}/></span><span><strong data-testid="eval-count">{evals.length}</strong><small>Bank-owned eval examples</small></span></button>
      <button type="button" className="stat-card" aria-controls="analyst-records" onClick={() => openRecords('evals', 'review')}><span className="stat-icon"><ShieldCheck size={23}/></span><span><strong>{evals.filter(e => e.origin === 'review').length}</strong><small>Analyst-approved examples</small></span></button>
    </div>
    <section className="panel campaign-panel"><div className="eval-header"><h2>Active campaigns</h2><span>Analyst-confirmed reports · last {sampleInfo.campaignWindowDays} days</span></div>{campaigns.length ? <div className="campaign-list">{campaigns.map(c => <article key={c.id}><div><strong>{c.count} confirmed {c.count === 1 ? 'report' : 'reports'}</strong><small>Campaign {c.id}</small></div><p>{c.text}</p></article>)}</div> : <p className="campaign-empty">No confirmed campaigns yet. Approve reported messages as scam or likely scam to group near-identical text here.</p>}</section>
    <div className="sample-toolbar"><div><strong>Look beyond customer reports</strong><p>{sampleInfo.historyCount} masked past checks. Sample up to {sampleInfo.sampleSize} unreviewed checks from the last {sampleInfo.lookbackDays} days.</p></div><button className="secondary-button" disabled={sampling || loading} onClick={() => void sample()}>{sampling ? <LoaderCircle size={16} className="spin"/> : <Inbox size={16}/>} Weekly random sample</button></div>
    <div id="analyst-records" ref={recordsRef} tabIndex={-1} aria-label="Review queue and evaluation set">
    <div className="analyst-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>Review queue <span>{items.length}</span></button><button className={tab === 'evals' ? 'active' : ''} onClick={() => { setTab('evals'); setEvalFilter('all'); }}>Evaluation set <span>{evals.length}</span></button></div>
    {notice && <div className="success-notice" role="status"><CircleCheck size={18}/>{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={17}/></button></div>}
    {error && <div className="error-message" role="alert">{error}</div>}
    <p className="queue-note"><LockKeyhole size={13}/> Personal details are masked before storage. Screenshots are never stored. Only analyst-approved items join the eval set. Customers do not assign labels.</p>
    {loading ? <div className="empty-state"><LoaderCircle className="spin"/>Loading reviews...</div> : tab === 'queue' ? items.length ? <div className="review-list">{items.map(item => <ReviewCard key={item.id} item={item} onApprove={approve}/>)}</div> : <div className="panel empty-state"><div className="empty-icon"><Inbox size={32}/></div><h2>You’re all caught up.</h2><p>Reported scams, fraud-team escalations, and weekly random samples appear here for analyst review.</p><span className="small-label">YOUR NEXT REVIEW MAKES THE CHECKER MORE TESTABLE</span></div> : <div className="panel eval-panel"><div className="eval-header"><h2>{evalFilter === 'review' ? 'Analyst-approved evaluation examples' : 'The bank’s evaluation set'}</h2>{evalFilter === 'review' && <button type="button" className="text-button" onClick={() => setEvalFilter('all')}>Show all examples</button>}<span>Newest first · dates in your local time</span><span>Run with <code>npm run eval</code></span></div><div className="table-scroll"><table><thead><tr><th aria-sort="descending">Added / updated</th><th>Message</th><th>Language</th><th>Expected verdict</th><th>Source</th></tr></thead><tbody>{visibleEvals.length === 0 && <tr><td colSpan={5}>No analyst-approved examples yet.</td></tr>}{visibleEvals.map(item => <tr key={item.id}><td className="eval-date">{item.updatedAt || item.addedAt ? <time dateTime={item.updatedAt ?? item.addedAt} title={item.updatedAt ? "Last analyst approval" : "Added to the evaluation set"}>{new Date((item.updatedAt ?? item.addedAt)!).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</time> : <span title="This older example has no recorded date">Not recorded</span>}</td><td>{item.text}<CallbackEvidence numbers={item.callback_numbers}/></td><td>{item.language}</td><td><span className={`label-badge ${item.label}`}>{verdictLabel(item.label)}</span></td><td>{item.origin === 'seed' ? 'Synthetic seed' : 'Analyst approved'}</td></tr>)}</tbody></table></div></div>}
    </div>
    <InternalDiagnostics checks={checks}/>
    <div className="analyst-footnote"><CodeXml size={18}/><p><strong>Reports are evidence, not an automatic label.</strong> Analysts decide the expected verdict. The eval script compares it with the checker’s prediction. Mock scores verify replay behavior; live scores measure this small synthetic set.</p></div>
  </div>;
}

const sourceLabels: Record<ReviewSource, string> = { report: "Report", escalation: "Escalation", random_sample: "Random sample", legacy_feedback: "Legacy feedback" };

function ReviewCard({ item, onApprove }: { item: ReviewItem; onApprove: (id: string, label: Verdict) => Promise<void> }) {
  const [label, setLabel] = useState<Verdict | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <article className="panel review-card"><div className="review-top"><span className="feedback-label"><ShieldAlert size={14}/>{item.sources.map(source => sourceLabels[source]).join(" · ")}</span><span>{item.language} · {item.mode} · {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><blockquote>{item.text}</blockquote><CallbackEvidence numbers={item.callback_numbers}/><div className="review-model"><span>Model verdict <strong>{verdictLabel(item.result.verdict)}</strong></span><span>Confidence <strong>{Math.round(item.result.confidence * 100)}%</strong></span>{item.result.injection_detected && <span className="injection-chip"><ShieldAlert size={13}/> Injection flagged</span>}</div><div className="review-decision"><label>Analyst’s expected verdict<select aria-label="Analyst's expected verdict" value={label} disabled={busy} onChange={e => setLabel(e.target.value as Verdict)}><option value="" disabled>Select an analyst label</option>{verdicts.map(v => <option value={v} key={v}>{verdictLabel(v)}</option>)}</select></label><button className="primary-button" disabled={busy || !label} onClick={async () => { if (!label) return; setBusy(true); try { await onApprove(item.id, label); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}Approve & add to eval set</button></div>{error && <p className="error-message" role="alert">{error}</p>}</article>;
}

function CallbackEvidence({ numbers }: { numbers?: string[] }) {
  if (!numbers?.length) return null;
  return <aside className="callback-evidence"><strong>Unverified callback numbers</strong>{numbers.map(number => <code key={number}>{number}</code>)}<p>Requested callback destinations from the message. Ownership is not verified. Compare with trusted bank records; do not call these numbers to verify the message.</p></aside>;
}
