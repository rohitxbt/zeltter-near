import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { connector, view as nearView, call, Plan, ONE_YOCTO, CONTRACT_ID } from './near';
import { derivedPublicKey, ethAddress, btcAddress, ethBalance, btcBalance, txParams, assemble, broadcast, sepolia } from './chains';
import { VaultClock, readClock, span, loadingReading } from './VaultLine';

type Unit = 'minutes' | 'hours' | 'days';
type View = 'vault' | 'setup' | 'inheriting';
const UNIT_SECS: Record<Unit, number> = { minutes: 60, hours: 3600, days: 86400 };
const PLAN_DEPOSIT = "100000000000000000000000"; // 0.1 NEAR, refunded on delete

interface Timer { val: number; unit: Unit; }
interface HeirRow { account: string; eth: string; pct: string; }
interface Addresses { eth: string; btc: string; ethWei: bigint; btcSats: number; ethNonce: number; }

const toSecs = (t: Timer) => Math.max(1, t.val || 0) * UNIT_SECS[t.unit];
const fromSecs = (s: number): Timer => {
    if (s % 86400 === 0) return { val: s / 86400, unit: 'days' };
    if (s % 3600 === 0) return { val: s / 3600, unit: 'hours' };
    return { val: Math.max(1, Math.round(s / 60)), unit: 'minutes' };
};
const short = (s: string, n = 6) => (s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);
const fmtEth = (wei: bigint | string) => Number(ethers.formatEther(wei)).toFixed(4);

async function loadAddresses(p: Plan): Promise<Addresses> {
    const [ethPub, btcPub] = await Promise.all([derivedPublicKey(p.eth_path), derivedPublicKey(p.btc_path)]);
    const eth = ethAddress(ethPub);
    const btc = btcAddress(btcPub);
    const [ethWei, btcSats, ethNonce] = await Promise.all([
        ethBalance(eth),
        btcBalance(btc).catch(() => 0),
        sepolia.getTransactionCount(eth, 'pending'),
    ]);
    return { eth, btc, ethWei, btcSats, ethNonce };
}

/// Synthetic vault for the landing page's example clock.
function exampleVault(now: number): Plan {
    return {
        owner: 'example.testnet', guardians: ['a.testnet', 'b.testnet', 'c.testnet'], threshold: 2,
        heirs: [], inactivity_secs: 90 * 86400, waiting_secs: 7 * 86400, heir_fallback_secs: 90 * 86400,
        last_check_in: now - 23 * 86400 - 5 * 3600, approvals: [], release: null, eth_claims: [],
        status: 'active', eth_path: '', btc_path: '',
    };
}

function Icon({ name, className = '' }: { name: string; className?: string }) {
    return <span className={`icon ${className}`} aria-hidden="true">{name}</span>;
}

/// Split layout: quiet cream work column + committed red field.
function Split({ work, field, fieldFirstOnMobile = true }: { work: React.ReactNode; field: React.ReactNode; fieldFirstOnMobile?: boolean }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] min-h-[calc(100vh-4rem)]">
            <div className={`px-5 sm:px-10 lg:px-16 py-10 lg:py-16 ${fieldFirstOnMobile ? 'order-2 lg:order-1' : ''}`}>
                <div className="max-w-[640px]">{work}</div>
            </div>
            <aside className={`bg-field text-on-field ${fieldFirstOnMobile ? 'order-1 lg:order-2' : ''}`}>
                <div className="lg:sticky lg:top-16 px-5 sm:px-10 lg:px-14 py-10 lg:py-16 lg:min-h-[calc(100vh-4rem)] flex flex-col justify-center">
                    {field}
                </div>
            </aside>
        </div>
    );
}

function TimerInput({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: Timer; onChange: (t: Timer) => void }) {
    return (
        <div>
            <label htmlFor={id} className="label">{label}</label>
            <div className="flex gap-2">
                <input id={id} type="number" min={1} value={value.val || ''} onChange={e => onChange({ ...value, val: Number(e.target.value) })}
                    className="input num w-28" />
                <select aria-label={`${label} unit`} value={value.unit} onChange={e => onChange({ ...value, unit: e.target.value as Unit })} className="input w-36">
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                </select>
            </div>
            <p className="hint">{hint}</p>
        </div>
    );
}

function AddressRow({ label, addr, balance, onCopy }: { label: string; addr?: string; balance: string; onCopy: (s: string) => void }) {
    return (
        <div className="py-4 border-t border-line first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-muted">{label}</span>
                <span className="num font-medium">{balance}</span>
            </div>
            <button onClick={() => addr && onCopy(addr)} disabled={!addr}
                className="mt-1 flex items-center gap-2 text-left num text-[14px] break-all hover:underline disabled:no-underline disabled:text-muted">
                {addr || 'Deriving address…'}
                {addr && <Icon name="content_copy" className="text-muted !text-[16px] shrink-0" />}
            </button>
        </div>
    );
}

function InnerApp() {
    const [account, setAccount] = useState<string | null>(null);
    const [view, setView] = useState<View>('vault');
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<{ title: string, msg: string, error?: boolean } | null>(null);
    const [busyStep, setBusyStep] = useState<string>("");
    const [pingLoading, setPingLoading] = useState(false);
    const [loadedOnce, setLoadedOnce] = useState(false);

    // Form
    const [guardians, setGuardians] = useState<string[]>([""]);
    const [threshold, setThreshold] = useState(1);
    const [heirs, setHeirs] = useState<HeirRow[]>([{ account: "", eth: "", pct: "100" }]);
    const [inactivity, setInactivity] = useState<Timer>({ val: 90, unit: 'days' });
    const [waiting, setWaiting] = useState<Timer>({ val: 7, unit: 'days' });
    const [fallback, setFallback] = useState<Timer>({ val: 90, unit: 'days' });

    // Data
    const [myPlan, setMyPlan] = useState<Plan | null>(null);
    const [myAddr, setMyAddr] = useState<Addresses | null>(null);
    const [watched, setWatched] = useState<{ plan: Plan; addr: Addresses | null }[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));

    // Owner send
    const [sendTo, setSendTo] = useState("");
    const [sendAmount, setSendAmount] = useState("");

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        // Dev only: look at any account's screens read-only, for screenshots.
        if (process.env.NODE_ENV === 'development') {
            const q = new URLSearchParams(window.location.search);
            if (q.get('as')) { setAccount(q.get('as')); if (q.get('view')) setView(q.get('view') as View); return; }
        }
        connector.getConnectedWallet()
            .then(({ accounts }) => { if (accounts[0]) setAccount(accounts[0].accountId); })
            .catch(() => { });
        connector.on("wallet:signIn", (t: any) => setAccount(t.accounts[0].accountId));
        connector.on("wallet:signOut", () => setAccount(null));
    }, []);

    const fetchMyPlan = useCallback(async () => {
        if (!account) return;
        try {
            const p = await nearView<Plan | null>("get_plan", { owner: account });
            setMyPlan(p);
            setLoadedOnce(true);
            if (p) setMyAddr(await loadAddresses(p));
        } catch (e) { console.error(e); }
    }, [account]);

    const fetchWatched = useCallback(async () => {
        if (!account) return;
        try {
            const owners = await nearView<string[]>("get_plans_for", { account });
            const plans = await Promise.all(owners.map(o => nearView<Plan | null>("get_plan", { owner: o })));
            const list = await Promise.all(plans.filter((p): p is Plan => !!p).map(async plan => ({
                plan,
                addr: await loadAddresses(plan).catch(() => null),
            })));
            setWatched(list);
        } catch (e) { console.error(e); }
    }, [account]);

    useEffect(() => {
        if (!account) return;
        setLoadedOnce(false);
        fetchMyPlan();
        fetchWatched();
        const interval = setInterval(() => { fetchMyPlan(); fetchWatched(); }, 10000);
        return () => clearInterval(interval);
    }, [account, fetchMyPlan, fetchWatched]);

    // First load: no vault yet means set one up
    useEffect(() => {
        if (loadedOnce && !myPlan && view === 'vault') setView(watched.length ? 'inheriting' : 'setup');
        // eslint-disable-next-line
    }, [loadedOnce]);

    // Prefill the form with the existing plan so setup doubles as edit
    useEffect(() => {
        if (!myPlan) return;
        setGuardians(myPlan.guardians);
        setThreshold(myPlan.threshold);
        setHeirs(myPlan.heirs.map(h => ({ account: h.account, eth: h.eth_address, pct: String(h.share_bps / 100) })));
        setInactivity(fromSecs(myPlan.inactivity_secs));
        setWaiting(fromSecs(myPlan.waiting_secs));
        setFallback(fromSecs(myPlan.heir_fallback_secs));
        // eslint-disable-next-line
    }, [myPlan?.owner]);

    // --- ACTIONS ---

    const handleConnect = async () => {
        try { await connector.connect(); } catch (e) { console.error(e); }
    };

    const showToast = (title: string, msg: string, error = false) => {
        setToast({ title, msg, error });
        setTimeout(() => setToast(null), 5000);
    };

    const run = async (step: string, fn: () => Promise<void>) => {
        setBusyStep(step);
        try {
            await fn();
        } catch (e: any) {
            console.error(e);
            let msg = e?.message || "Transaction failed";
            if (msg.length > 140) msg = msg.slice(0, 140) + "…";
            showToast("That didn't go through", msg, true);
        } finally {
            setBusyStep("");
        }
    };

    const savePlan = async () => {
        if (!account) return;
        const g = guardians.map(s => s.trim()).filter(Boolean);
        const h = heirs.filter(r => r.account.trim());
        if (g.length === 0) return showToast("Add a guardian", "At least one guardian account is needed.", true);
        if (h.length === 0) return showToast("Add an heir", "At least one heir is needed.", true);
        if (h.some(r => !ethers.isAddress(r.eth))) return showToast("Check the ETH addresses", "Every heir needs a valid ETH address (0x…).", true);
        const bps = h.map(r => Math.round(parseFloat(r.pct || "0") * 100));
        if (bps.reduce((a, b) => a + b, 0) !== 10000) return showToast("Shares must add up to 100%", `They add up to ${totalPct}% right now.`, true);

        const plan = {
            guardians: g,
            threshold: Math.min(threshold, g.length),
            heirs: h.map((r, i) => ({ account: r.account.trim(), eth_address: ethers.getAddress(r.eth), share_bps: bps[i] })),
            inactivity_secs: toSecs(inactivity),
            waiting_secs: toSecs(waiting),
            heir_fallback_secs: toSecs(fallback),
        };

        setIsLoading(true);
        try {
            if (myPlan) {
                await call(account, "update_plan", { plan }, { deposit: ONE_YOCTO });
                showToast("Vault updated", "Saving also counted as a check-in.");
            } else {
                await call(account, "create_plan", { plan }, { deposit: PLAN_DEPOSIT });
                showToast("Vault created", "Fund the addresses below, then check in now and then.");
            }
            await fetchMyPlan();
            setView('vault');
        } catch (e: any) {
            console.error(e);
            showToast("That didn't go through", e?.message || "Transaction failed", true);
        } finally {
            setIsLoading(false);
        }
    };

    const checkIn = async () => {
        if (!account) return;
        setPingLoading(true);
        try {
            await call(account, "check_in", {});
            showToast("Checked in", "Your heartbeat timer starts again.");
            fetchMyPlan();
        } catch (e: any) {
            showToast("Check-in failed", e?.message || "Try again in a moment.", true);
        } finally {
            setPingLoading(false);
        }
    };

    const cancelRelease = () => run("Cancelling the release…", async () => {
        await call(account!, "cancel_release", {});
        showToast("Release cancelled", "You're marked as alive and the timer restarted.");
        fetchMyPlan();
    });

    const deletePlan = () => {
        if (!window.confirm("Delete this vault? Guardians and heirs lose access, and your 0.1 NEAR deposit comes back. Funds at the vault addresses stay there and you can still move them only through a new vault.")) return;
        run("Deleting the vault…", async () => {
            await call(account!, "delete_plan", {}, { deposit: ONE_YOCTO });
            setMyPlan(null);
            setMyAddr(null);
            setView('setup');
            showToast("Vault deleted", "Your deposit is on its way back.");
        });
    };

    const ownerSend = () => run("Signing with Chain Signatures…", async () => {
        if (!myAddr) throw new Error("Vault address not loaded yet");
        if (!ethers.isAddress(sendTo)) throw new Error("That destination isn't a valid ETH address");
        const value = ethers.parseEther(sendAmount || "0");
        const fees = await txParams();
        const nonce = await sepolia.getTransactionCount(myAddr.eth, 'pending');
        const sig = await call<any>(account!, "owner_sign_eth", {
            to: sendTo, value_wei: value.toString(), data: "0x",
            tx: {
                nonce, gas_limit: Number(fees.gasLimit),
                max_fee_per_gas: fees.maxFeePerGas.toString(),
                max_priority_fee_per_gas: fees.maxPriorityFeePerGas.toString(),
            },
        }, { deposit: ONE_YOCTO, tgas: 300 });
        setBusyStep("Sending to Sepolia…");
        const tx = assemble({ nonce, to: sendTo, value, ...fees }, sig, myAddr.eth);
        const hash = await broadcast(tx);
        showToast("Sent", `Transaction ${short(hash)}`);
        setSendAmount("");
        fetchMyPlan();
    });

    const approve = (p: Plan, addr: Addresses | null) => run("Recording your approval…", async () => {
        await call(account!, "approve_release", { owner: p.owner, eth_balance_wei: (addr?.ethWei ?? 0n).toString() });
        showToast("Approval recorded", `${p.approvals.length + 1} of ${p.threshold} guardians have approved.`);
        fetchWatched();
    });

    const startHeirRelease = (p: Plan, addr: Addresses | null) => run("Starting the release…", async () => {
        await call(account!, "start_heir_release", { owner: p.owner, eth_balance_wei: (addr?.ethWei ?? 0n).toString() });
        showToast("Release started", "The waiting period is running. The owner can still cancel.");
        fetchWatched();
    });

    const reportBalance = (p: Plan, addr: Addresses) => run("Correcting the balance…", async () => {
        await call(account!, "report_balance", { owner: p.owner, eth_balance_wei: addr.ethWei.toString() });
        showToast("Balance corrected", "Shares now use the real balance.");
        fetchWatched();
    });

    const broadcastClaim = async (p: Plan, claim: Plan["eth_claims"][number], from: string) => {
        const heir = p.heirs.find(h => h.account === claim.heir)!;
        const tx = assemble({
            nonce: claim.nonce,
            to: heir.eth_address,
            value: BigInt(claim.value_wei),
            maxFeePerGas: BigInt(claim.max_fee_per_gas),
            maxPriorityFeePerGas: BigInt(claim.max_priority_fee_per_gas),
            gasLimit: BigInt(claim.gas_limit),
        }, claim.signature!, from);
        if (tx.unsignedHash.slice(2) !== claim.payload) throw new Error("Rebuilt transaction doesn't match what the contract signed");
        return broadcast(tx);
    };

    const claimEth = (p: Plan, addr: Addresses) => run("Asking the NEAR MPC network to sign…", async () => {
        const mine = p.eth_claims.find(c => c.heir === account);
        const fees = await txParams();
        const nonce = mine ? mine.nonce : await sepolia.getTransactionCount(addr.eth, 'pending');
        await call(account!, "claim_eth", {
            owner: p.owner,
            tx: {
                nonce, gas_limit: Number(fees.gasLimit),
                max_fee_per_gas: fees.maxFeePerGas.toString(),
                max_priority_fee_per_gas: fees.maxPriorityFeePerGas.toString(),
            },
        }, { deposit: ONE_YOCTO, tgas: 300 });
        const fresh = await nearView<Plan>("get_plan", { owner: p.owner });
        const claim = fresh.eth_claims.find(c => c.heir === account);
        if (!claim?.signature) throw new Error("The signature isn't stored yet. Try again in a few seconds.");
        setBusyStep("Sending to Sepolia…");
        const hash = await broadcastClaim(fresh, claim, addr.eth);
        showToast("Claimed", `Transaction ${short(hash)}`);
        fetchWatched();
    });

    const rebroadcast = (p: Plan, addr: Addresses) => run("Sending to Sepolia…", async () => {
        const claim = p.eth_claims.find(c => c.heir === account);
        if (!claim?.signature) throw new Error("No signed claim yet");
        const hash = await broadcastClaim(p, claim, addr.eth);
        showToast("Sent", `Transaction ${short(hash)}`);
    });

    const copy = (text: string) => {
        navigator.clipboard.writeText(text);
        showToast("Copied", short(text, 10));
    };

    const totalPct = heirs.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0);
    const guardianCount = Math.max(1, guardians.filter(g => g.trim()).length);
    const effThreshold = Math.min(threshold, guardianCount);

    // --- VIEWS ---

    const landing = () => {
        const reading = readClock(exampleVault(currentTime), currentTime);
        return (
            <Split fieldFirstOnMobile={false}
                work={
                    <div className="flex flex-col">
                        <div className="pt-4 lg:pt-12">
                            <h1 className="font-display font-semibold text-[clamp(2.75rem,5.4vw,4.5rem)] leading-[0.98] tracking-[-0.035em] max-w-[16ch]">
                                If you go quiet, <span className="text-muted">your crypto goes only to the people you chose.</span>
                            </h1>
                            <p className="mt-8 text-[17px] leading-relaxed text-muted max-w-[46ch] [text-wrap:pretty]">
                                Name your heirs and a few guardians, then check in now and then. Miss enough check-ins and your ETH goes to your heirs, with a waiting period you can still cancel. No one ever holds your keys.
                            </p>
                            <button onClick={handleConnect} className="btn btn-ink mt-10 h-12 px-7 text-base">
                                Connect wallet to set up a vault
                            </button>
                        </div>
                        <a href={`https://testnet.nearblocks.io/address/${CONTRACT_ID}`} target="_blank" rel="noopener noreferrer"
                            className="group mt-12 flex items-center justify-between gap-6 max-w-[440px] bg-paper rounded-2xl px-5 py-4 shadow-[0_1px_2px_rgba(31,31,31,0.06),0_8px_24px_-12px_rgba(31,31,31,0.18)] hover:shadow-[0_1px_2px_rgba(31,31,31,0.08),0_12px_28px_-12px_rgba(31,31,31,0.28)] transition-shadow">
                            <span>
                                <span className="block font-medium">Read the rules on-chain</span>
                                <span className="block text-sm text-muted num">{CONTRACT_ID}</span>
                            </span>
                            <Icon name="arrow_outward" className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                        </a>
                    </div>
                }
                field={
                    <VaultClock reading={reading} title="Example vault: 90 day heartbeat, 2 of 3 guardians" />
                }
            />
        );
    };

    const loadingView = () => (
        <Split
            work={<div className="flex items-center gap-4 text-muted"><div className="spinner" />Reading from NEAR…</div>}
            field={<VaultClock reading={loadingReading()} title="Reading from NEAR" />}
        />
    );

    const vaultView = () => {
        if (!loadedOnce) return loadingView();
        if (!myPlan) {
            return (
                <Split
                    work={
                        <div>
                            <h1 className="font-display font-semibold text-[40px] leading-tight tracking-[-0.025em]">You don't have a vault yet.</h1>
                            <p className="mt-4 text-muted max-w-[46ch]">Set one up: pick your guardians and heirs and how long you can go without checking in.</p>
                            <button onClick={() => setView('setup')} className="btn btn-ink mt-8">Set up a vault</button>
                        </div>
                    }
                    field={<VaultClock reading={readClock(exampleVault(currentTime), currentTime)} title="Example vault" />}
                />
            );
        }
        const reading = readClock(myPlan, currentTime);
        const st = reading.status;
        return (
            <Split
                work={
                    <div>
                        <section className="section">
                            <h2 className="section-title">Vault addresses</h2>
                            <p className="hint mt-1 mb-5">Controlled by this contract through NEAR Chain Signatures. Fund them like any wallet.</p>
                            <AddressRow label="ETH · Sepolia" addr={myAddr?.eth} balance={myAddr ? `${fmtEth(myAddr.ethWei)} ETH` : '…'} onCopy={copy} />
                            <AddressRow label="BTC · testnet4" addr={myAddr?.btc} balance={myAddr ? `${myAddr.btcSats.toLocaleString()} sats` : '…'} onCopy={copy} />
                        </section>

                        <section className="section">
                            <h2 className="section-title">Send ETH</h2>
                            <p className="hint mt-1 mb-5">Spend from the vault while you're alive. Sending counts as a check-in.</p>
                            <div className="grid sm:grid-cols-[1fr_9rem] gap-3">
                                <div>
                                    <label htmlFor="send-to" className="label">To</label>
                                    <input id="send-to" value={sendTo} onChange={e => setSendTo(e.target.value)} className="input num" placeholder="0x…"
                                        aria-invalid={!!sendTo && !ethers.isAddress(sendTo)} />
                                </div>
                                <div>
                                    <label htmlFor="send-amt" className="label">Amount (ETH)</label>
                                    <input id="send-amt" inputMode="decimal" value={sendAmount} onChange={e => setSendAmount(e.target.value)} className="input num" placeholder="0.01" />
                                </div>
                            </div>
                            <button onClick={ownerSend} disabled={st === 'released' || !sendTo || !sendAmount} className="btn btn-line mt-4">Sign and send</button>
                        </section>

                        <section className="section">
                            <div className="flex items-baseline justify-between gap-4">
                                <h2 className="section-title">The rules</h2>
                                <button onClick={() => setView('setup')} className="text-sm font-medium underline">Edit</button>
                            </div>
                            <p className="hint mt-1 mb-5">Public, in the contract. Guardians can only approve; money only goes to these heirs.</p>
                            <dl className="grid grid-cols-[9rem_1fr] gap-x-6 gap-y-3 text-[15px]">
                                <dt className="text-muted">Guardians</dt>
                                <dd>{myPlan.threshold} of {myPlan.guardians.length} must approve
                                    <span className="block text-sm text-muted">{myPlan.guardians.join(', ')}</span></dd>
                                <dt className="text-muted">Heirs</dt>
                                <dd className="space-y-1">{myPlan.heirs.map(h => (
                                    <span key={h.account} className="block"><span className="num">{h.share_bps / 100}%</span> to {h.account}
                                        <span className="block text-sm text-muted num">{short(h.eth_address, 8)}</span></span>
                                ))}</dd>
                                <dt className="text-muted">Heartbeat</dt><dd>{span(myPlan.inactivity_secs)}</dd>
                                <dt className="text-muted">Waiting period</dt><dd>{span(myPlan.waiting_secs)}</dd>
                                <dt className="text-muted">Heir fallback</dt><dd>{span(myPlan.heir_fallback_secs)} after a missed heartbeat</dd>
                            </dl>
                        </section>

                        <section className="section">
                            <button onClick={deletePlan} disabled={st === 'released'} className="text-sm font-medium text-field underline disabled:text-muted disabled:no-underline">
                                Delete this vault
                            </button>
                        </section>
                    </div>
                }
                field={
                    <VaultClock reading={reading} title={`Your vault · ${myPlan.owner}`} lastCheckIn={myPlan.last_check_in}>
                        {st !== 'released' && (
                            <button onClick={checkIn} disabled={pingLoading} className="btn btn-paper h-12 px-7 text-base">
                                <Icon name="favorite" />{pingLoading ? 'Checking in…' : "I'm here, check in"}
                            </button>
                        )}
                        {st === 'pending' && (
                            <button onClick={cancelRelease} className="btn btn-on-field h-12 px-6">Cancel the release</button>
                        )}
                        {myPlan.approvals.length > 0 && !myPlan.release && (
                            <p className="w-full text-sm text-on-field-muted num">{myPlan.approvals.length} of {myPlan.threshold} guardians have approved a release.</p>
                        )}
                    </VaultClock>
                }
            />
        );
    };

    const setupView = () => {
        const preview: Plan = {
            owner: account || '', guardians: [], threshold: effThreshold, heirs: [],
            inactivity_secs: toSecs(inactivity), waiting_secs: toSecs(waiting), heir_fallback_secs: toSecs(fallback),
            last_check_in: currentTime, approvals: [], release: null, eth_claims: [], status: 'active', eth_path: '', btc_path: '',
        };
        const reading = readClock(preview, currentTime);
        return (
            <Split fieldFirstOnMobile={false}
                work={
                    <div>
                        <h1 className="font-display font-semibold text-[40px] leading-tight tracking-[-0.025em]">
                            {myPlan ? 'Edit your vault' : 'Set up your vault'}
                        </h1>
                        <p className="mt-3 mb-10 text-muted max-w-[52ch]">
                            {myPlan ? 'Saving counts as a check-in and cancels any pending release.' : 'You can change all of this later while you\'re checking in.'}
                        </p>

                        <section className="section">
                            <h2 className="section-title">Guardians</h2>
                            <p className="hint mt-1 mb-5">People who confirm you've gone quiet. They can approve a release but never choose where money goes.</p>
                            <div className="space-y-2">
                                {guardians.map((g, i) => (
                                    <div key={i} className="flex gap-2">
                                        <input aria-label={`Guardian ${i + 1} NEAR account`} value={g} onChange={e => setGuardians(guardians.map((x, j) => j === i ? e.target.value : x))}
                                            className="input" placeholder="guardian.testnet" />
                                        {guardians.length > 1 && (
                                            <button aria-label={`Remove guardian ${i + 1}`} onClick={() => setGuardians(guardians.filter((_, j) => j !== i))}
                                                className="btn btn-line w-11 px-0 shrink-0"><Icon name="close" /></button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
                                <button onClick={() => setGuardians([...guardians, ""])} className="btn btn-line btn-sm"><Icon name="add" />Add guardian</button>
                                <label className="flex items-center gap-2 text-sm">
                                    <span className="text-muted">Approvals needed</span>
                                    <select value={effThreshold} onChange={e => setThreshold(Number(e.target.value))} className="input h-9 w-20 num">
                                        {Array.from({ length: guardianCount }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                    <span className="text-muted num">of {guardianCount}</span>
                                </label>
                            </div>
                        </section>

                        <section className="section">
                            <div className="flex items-baseline justify-between gap-4">
                                <h2 className="section-title">Heirs</h2>
                                <span className={`text-sm font-medium num ${totalPct === 100 ? 'text-ok' : 'text-field'}`}>{totalPct}% of 100%</span>
                            </div>
                            <p className="hint mt-1 mb-5">Each heir's ETH share goes to the address you write here, and only there.</p>
                            <div className="space-y-4">
                                {heirs.map((h, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
                                        <input aria-label={`Heir ${i + 1} NEAR account`} value={h.account} onChange={e => setHeirs(heirs.map((x, j) => j === i ? { ...x, account: e.target.value } : x))}
                                            className="input" placeholder="heir.testnet" />
                                        <input aria-label={`Heir ${i + 1} ETH address`} value={h.eth} onChange={e => setHeirs(heirs.map((x, j) => j === i ? { ...x, eth: e.target.value } : x))}
                                            className="input num col-span-3 order-last" placeholder="0x… ETH address"
                                            aria-invalid={!!h.eth && !ethers.isAddress(h.eth)} />
                                        {h.eth && <p className="sm:hidden col-span-3 order-last -mt-1 text-[13px] text-muted num break-all">{h.eth}</p>}
                                        <div className="relative">
                                            <input aria-label={`Heir ${i + 1} share percent`} inputMode="decimal" value={h.pct} onChange={e => setHeirs(heirs.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))}
                                                className="input num pr-7" placeholder="50" />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">%</span>
                                        </div>
                                        <button aria-label={`Remove heir ${i + 1}`} disabled={heirs.length === 1} onClick={() => setHeirs(heirs.filter((_, j) => j !== i))}
                                            className="btn btn-line w-11 px-0"><Icon name="close" /></button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => setHeirs([...heirs, { account: "", eth: "", pct: "" }])} className="btn btn-line btn-sm mt-4"><Icon name="add" />Add heir</button>
                        </section>

                        <section className="section space-y-6">
                            <h2 className="section-title">Timers</h2>
                            <TimerInput id="t-heart" label="Heartbeat" value={inactivity} onChange={setInactivity}
                                hint="Go this long without checking in and guardians can approve a release." />
                            <TimerInput id="t-wait" label="Waiting period" value={waiting} onChange={setWaiting}
                                hint="After approval, nothing moves for this long. You can cancel any time inside it." />
                            <TimerInput id="t-fall" label="Heir fallback" value={fallback} onChange={setFallback}
                                hint="If guardians don't act, heirs can start the release alone after this much more silence." />
                            <p className="text-sm text-muted">For a demo, set each to a couple of minutes.</p>
                        </section>
                    </div>
                }
                field={
                    <div className="flex flex-col gap-10">
                        <VaultClock reading={reading} title="Preview of your timeline" />
                        <div>
                            <p className="text-[17px] leading-relaxed max-w-[40ch]">
                                If you don't check in for <b className="font-semibold">{span(toSecs(inactivity))}</b>, {effThreshold} of {guardianCount} guardian{guardianCount > 1 ? 's' : ''} can approve.
                                Then after <b className="font-semibold">{span(toSecs(waiting))}</b> your heirs can claim, unless you cancel first.
                            </p>
                            <button onClick={savePlan} disabled={isLoading} className="btn btn-paper h-12 px-7 text-base mt-8">
                                {isLoading ? 'Confirm in your wallet…' : myPlan ? 'Save changes' : 'Create vault'}
                            </button>
                            {!myPlan && <p className="mt-3 text-sm text-on-field-muted">0.1 NEAR storage deposit, returned if you delete the vault.</p>}
                        </div>
                    </div>
                }
            />
        );
    };

    const inheritingView = () => {
        const item = watched.find(w => w.plan.owner === selected) || watched[0];
        if (!item && !loadedOnce) return loadingView();
        if (!item) {
            return (
                <Split
                    work={
                        <div>
                            <h1 className="font-display font-semibold text-[40px] leading-tight tracking-[-0.025em]">Nothing to watch yet.</h1>
                            <p className="mt-4 text-muted max-w-[48ch]">When someone names <span className="num">{account}</span> as a guardian or heir, their vault shows up here.</p>
                        </div>
                    }
                    field={<VaultClock reading={readClock(exampleVault(currentTime), currentTime)} title="Example vault" />}
                />
            );
        }
        const p = item.plan, addr = item.addr;
        const reading = readClock(p, currentTime);
        const st = reading.status;
        const isGuardian = !!account && p.guardians.includes(account);
        const myHeir = p.heirs.find(h => h.account === account);
        const approved = p.approvals.some(a => a.guardian === account);
        const myClaim = p.eth_claims.find(c => c.heir === account);
        const claimDone = !!myClaim?.signature && !!addr && addr.ethNonce > myClaim.nonce;
        const balanceTooHigh = st === 'pending' && addr && p.release && addr.ethWei < BigInt(p.release.eth_balance_wei);

        let action: React.ReactNode = null;
        if (isGuardian && !p.release && (st === 'missed_check_in' || st === 'heirs_can_start')) {
            action = approved
                ? <p className="text-on-field-muted num">You approved. {p.approvals.length} of {p.threshold} so far.</p>
                : <button onClick={() => approve(p, addr)} className="btn btn-paper h-12 px-7 text-base">Approve the release</button>;
        } else if (myHeir && st === 'heirs_can_start' && !p.release) {
            action = <button onClick={() => startHeirRelease(p, addr)} className="btn btn-paper h-12 px-7 text-base">Start the release without guardians</button>;
        } else if (myHeir && st === 'released' && addr) {
            action = claimDone
                ? <p className="text-on-field-muted">Your share was sent.</p>
                : <>
                    <button onClick={() => claimEth(p, addr)} className="btn btn-paper h-12 px-7 text-base">
                        {myClaim ? 'Sign the claim again' : `Claim your ${myHeir.share_bps / 100}% in ETH`}
                    </button>
                    {myClaim?.signature && <button onClick={() => rebroadcast(p, addr)} className="btn btn-on-field h-12 px-6">Send signed claim</button>}
                </>;
        } else if (st === 'active') {
            action = <p className="text-on-field-muted">Nothing to do. The owner is checking in.</p>;
        } else if (st === 'pending') {
            action = <p className="text-on-field-muted">Nothing to do until the waiting period ends.</p>;        } else if (st === 'released') {
            action = <p className="text-on-field-muted">Nothing left for you to do. The heirs can claim now.</p>;
        }

        return (
            <Split fieldFirstOnMobile={watched.length <= 1}
                work={
                    <div>
                        <h1 className="font-display font-semibold text-[40px] leading-tight tracking-[-0.025em]">Vaults you're part of</h1>
                        <p className="mt-3 mb-8 text-muted">You're a guardian or heir on these. Pick one to see where it stands.</p>
                        <ul className="border-t border-line" role="listbox" aria-label="Vaults">
                            {watched.map(({ plan: wp, addr: wa }) => {
                                const r = readClock(wp, currentTime);
                                const active = wp.owner === p.owner;
                                const roles = [wp.guardians.includes(account || '') && 'Guardian', wp.heirs.find(h => h.account === account) && `Heir ${wp.heirs.find(h => h.account === account)!.share_bps / 100}%`].filter(Boolean).join(' · ');
                                return (
                                    <li key={wp.owner} role="option" aria-selected={active} className="border-b border-line py-1">
                                        <button onClick={() => setSelected(wp.owner)}
                                            className={`w-full text-left py-3 px-3 -mx-3 rounded-xl grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 transition-colors ${active ? 'bg-paper' : 'hover:bg-paper/60'}`}>
                                            <span className="font-medium truncate">{wp.owner}</span>
                                            <span className="num text-[15px] text-right">{r.status === 'released' || r.status === 'heirs_can_start' ? '' : r.big}</span>
                                            <span className="text-sm text-muted">{roles}</span>
                                            <span className={`text-sm text-right ${r.status === 'active' ? 'text-ok' : r.status === 'missed_check_in' || r.status === 'heirs_can_start' ? 'text-warn' : 'text-field'}`}>
                                                {r.phases[r.phase].name}
                                            </span>
                                            {wa && <span className="text-sm text-muted num col-span-2">{fmtEth(wa.ethWei)} ETH at {short(wa.eth)}</span>}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {balanceTooHigh && addr && (
                            <div className="mt-8 rounded-xl bg-paper p-4 text-sm">
                                <p>The balance reported for {p.owner} is higher than what's at the address now, so shares would be off.</p>
                                <button onClick={() => reportBalance(p, addr)} className="btn btn-line btn-sm mt-3">Correct it to {fmtEth(addr.ethWei)} ETH</button>
                            </div>
                        )}
                    </div>
                }
                field={
                    <VaultClock reading={reading} title={`${p.owner} · ${p.threshold} of ${p.guardians.length} guardians`} lastCheckIn={p.last_check_in}>
                        {action}
                        {!p.release && p.approvals.length > 0 && !(isGuardian && approved) && (
                            <p className="w-full text-sm text-on-field-muted num">{p.approvals.length} of {p.threshold} guardians have approved.</p>
                        )}
                    </VaultClock>
                }
            />
        );
    };

    // --- RENDER ---
    const tabs: { id: View; label: string }[] = [
        { id: 'vault', label: 'My vault' },
        { id: 'setup', label: myPlan ? 'Edit' : 'Set up' },
        { id: 'inheriting', label: 'Inheriting' },
    ];

    return (
        <div className="min-h-screen bg-ground text-ink">
            <header className="sticky top-0 z-40 bg-ground border-b border-line">
                <div className="h-16 px-5 sm:px-10 lg:px-16 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-6">
                    <span className="font-display font-semibold text-[22px] tracking-[-0.02em]">Zeltter</span>
                    {account && (
                        <nav role="tablist" aria-label="Sections" className="hidden md:flex self-stretch items-stretch gap-6 justify-self-center">
                            {tabs.map(t => (
                                <button key={t.id} role="tab" aria-selected={view === t.id} onClick={() => { setView(t.id); if (t.id === 'inheriting') fetchWatched(); }}
                                    className={`text-[15px] border-b-2 -mb-px transition-colors ${view === t.id ? 'border-ink text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
                                    {t.label}
                                </button>
                            ))}
                        </nav>
                    )}
                    {!account && <span className="hidden md:block" aria-hidden="true" />}
                    <div className="justify-self-end flex items-center gap-3">
                        <span className="hidden sm:inline-flex items-center gap-2 h-8 px-3 rounded-full border border-line-strong text-[13px] text-muted">
                            <span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden="true" />NEAR testnet
                        </span>
                        {account ? (
                            <button onClick={() => { connector.disconnect().catch(() => { }); setAccount(null); setMyPlan(null); setWatched([]); }}
                                className="btn btn-line btn-sm max-w-[220px]" title="Disconnect">
                                <span className="truncate num">{short(account, 10)}</span><Icon name="logout" />
                            </button>
                        ) : (
                            <button onClick={handleConnect} className="btn btn-ink btn-sm">Connect wallet</button>
                        )}
                    </div>
                </div>
                {account && (
                    <nav role="tablist" aria-label="Sections" className="md:hidden flex bg-ground border-t border-line px-5 gap-6 h-11">
                        {tabs.map(t => (
                            <button key={t.id} role="tab" aria-selected={view === t.id} onClick={() => setView(t.id)}
                                className={`text-sm border-b-2 -mb-px ${view === t.id ? 'border-ink font-medium' : 'border-transparent text-muted'}`}>{t.label}</button>
                        ))}
                    </nav>
                )}
            </header>

            <main>
                {!account ? landing() : view === 'vault' ? vaultView() : view === 'setup' ? setupView() : inheritingView()}
            </main>

            {busyStep && (
                <div className="fixed inset-0 z-50 bg-ground/90 flex flex-col items-center justify-center gap-5 px-6 text-center" role="status" aria-live="assertive">
                    <div className="spinner" />
                    <p className="font-display text-[22px] font-semibold">{busyStep}</p>
                    <p className="text-sm text-muted">Confirm in your wallet if it asks.</p>
                </div>
            )}

            <div role="status" aria-live="polite"
                className={`fixed bottom-6 right-6 left-6 sm:left-auto z-50 sm:max-w-[380px] bg-paper rounded-2xl px-5 py-4 shadow-[0_2px_4px_rgba(31,31,31,0.06),0_16px_40px_-16px_rgba(31,31,31,0.35)] transition-all duration-300 ${toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
                <p className={`font-medium ${toast?.error ? 'text-field' : ''}`}>{toast?.title}</p>
                <p className="text-sm text-muted mt-0.5 break-words">{toast?.msg}</p>
            </div>
        </div>
    );
}

export default function App() {
    return <InnerApp />;
}
