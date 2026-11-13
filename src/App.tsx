import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import './App.css';
import gsap from 'gsap';
import { TextPlugin } from 'gsap/TextPlugin';
import { Flip } from 'gsap/all';
import { connector, view as nearView, call, Plan, Status, statusAt, ONE_YOCTO, CONTRACT_ID } from './near';
import { derivedPublicKey, ethAddress, btcAddress, ethBalance, btcBalance, txParams, assemble, broadcast, sepolia } from './chains';

gsap.registerPlugin(TextPlugin, Flip);

type Unit = 'minutes' | 'hours' | 'days';
const UNIT_SECS: Record<Unit, number> = { minutes: 60, hours: 3600, days: 86400 };
const PLAN_DEPOSIT = "100000000000000000000000"; // 0.1 NEAR, refunded on delete

interface Timer { val: number; unit: Unit; }
interface HeirRow { account: string; eth: string; pct: string; }
interface Addresses { eth: string; btc: string; ethWei: bigint; btcSats: number; ethNonce: number; }

const toSecs = (t: Timer) => t.val * UNIT_SECS[t.unit];
const fromSecs = (s: number): Timer => {
    if (s % 86400 === 0 && s / 86400 <= 100) return { val: s / 86400, unit: 'days' };
    if (s % 3600 === 0 && s / 3600 <= 100) return { val: s / 3600, unit: 'hours' };
    return { val: Math.min(100, Math.max(1, Math.round(s / 60))), unit: 'minutes' };
};
const short = (s: string, n = 6) => (s.length > n * 2 + 3 ? `${s.slice(0, n)}...${s.slice(-4)}` : s);
const fmtEth = (wei: bigint | string) => Number(ethers.formatEther(wei)).toFixed(5);

const STATUS_LABEL: Record<Status, { text: string; color: string; active: boolean }> = {
    active: { text: "SECURE", color: "bg-green-500", active: true },
    missed_check_in: { text: "MISSED CHECK-IN", color: "bg-orange-500", active: false },
    heirs_can_start: { text: "HEIRS CAN START", color: "bg-orange-600", active: false },
    pending: { text: "RELEASE PENDING", color: "bg-red-500", active: false },
    released: { text: "RELEASED", color: "bg-gray-500", active: false },
};

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

function InnerApp() {
    const [account, setAccount] = useState<string | null>(null);

    const [view, setView] = useState<'hero' | 'create' | 'vaults' | 'claim'>('hero');
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<{ title: string, msg: string, icon: string } | null>(null);
    const [busyStep, setBusyStep] = useState<string>("");
    const [pingLoading, setPingLoading] = useState(false);

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
    const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));

    // Owner send
    const [sendTo, setSendTo] = useState("");
    const [sendAmount, setSendAmount] = useState("");

    const loaderRef = useRef<HTMLDivElement>(null);

    // --- INIT ---
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const tl = gsap.timeline();
        tl.to(".loader-char", { y: 0, opacity: 1, duration: 1, stagger: 0.1, ease: "power4.out" })
            .to("#loader-bar", { x: "0%", duration: 1.5, ease: "expo.inOut" }, "-=0.5")
            .to("#loader", { y: "-100%", duration: 0.8, ease: "power2.in", delay: 0.5, onComplete: () => { if (loaderRef.current) loaderRef.current.style.display = 'none'; } });
    }, []);

    useEffect(() => {
        connector.getConnectedWallet()
            .then(({ accounts }) => { if (accounts[0]) { setAccount(accounts[0].accountId); setView('vaults'); } })
            .catch(() => { });
        connector.on("wallet:signIn", (t: any) => {
            setAccount(t.accounts[0].accountId);
            setView(v => (v === 'hero' ? 'create' : v));
        });
        connector.on("wallet:signOut", () => { setAccount(null); setView('hero'); });
    }, []);

    const fetchMyPlan = useCallback(async () => {
        if (!account) return;
        try {
            const p = await nearView<Plan | null>("get_plan", { owner: account });
            setMyPlan(p);
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
        fetchMyPlan();
        fetchWatched();
        const interval = setInterval(() => { fetchMyPlan(); fetchWatched(); }, 10000);
        return () => clearInterval(interval);
    }, [account, fetchMyPlan, fetchWatched]);

    // Prefill the form with the existing plan so "create" doubles as "edit"
    useEffect(() => {
        if (!myPlan) return;
        setGuardians(myPlan.guardians);
        setThreshold(myPlan.threshold);
        setHeirs(myPlan.heirs.map(h => ({ account: h.account, eth: h.eth_address, pct: String(h.share_bps / 100) })));
        setInactivity(fromSecs(myPlan.inactivity_secs));
        setWaiting(fromSecs(myPlan.waiting_secs));
        setFallback(fromSecs(myPlan.heir_fallback_secs));
        // only when a different plan shows up, not on every poll
        // eslint-disable-next-line
    }, [myPlan?.owner]);

    useEffect(() => {
        if (view === 'create') {
            gsap.fromTo(".glass-panel", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.1, ease: "power3.out", clearProps: "all" });
        }
        if (view === 'vaults') {
            gsap.fromTo(".glass-panel", { scale: 0.95, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.7)", clearProps: "all" });
        }
        if (view === 'claim') {
            gsap.fromTo(".glass-panel", { x: -20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power2.out", clearProps: "all" });
        }
    }, [view]);

    // --- ACTIONS ---

    const handleConnect = async () => {
        try { await connector.connect(); } catch (e) { console.error(e); }
    };

    const run = async (step: string, fn: () => Promise<void>) => {
        setBusyStep(step);
        try {
            await fn();
        } catch (e: any) {
            console.error(e);
            let msg = e?.message || "Transaction failed";
            if (msg.length > 120) msg = msg.slice(0, 120) + "...";
            showToast("Error", msg, "error");
        } finally {
            setBusyStep("");
        }
    };

    const savePlan = async () => {
        if (!account) return;
        const g = guardians.map(s => s.trim()).filter(Boolean);
        const h = heirs.filter(r => r.account.trim());
        if (g.length === 0) return showToast("Error", "Add at least one guardian", "error");
        if (h.length === 0) return showToast("Error", "Add at least one heir", "error");
        if (h.some(r => !ethers.isAddress(r.eth))) return showToast("Error", "Every heir needs a valid ETH address", "error");
        const bps = h.map(r => Math.round(parseFloat(r.pct || "0") * 100));
        if (bps.reduce((a, b) => a + b, 0) !== 10000) return showToast("Error", "Heir shares must add up to 100%", "error");

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
                showToast("Saved", "Vault updated. Timer reset.", "lock");
            } else {
                await call(account, "create_plan", { plan }, { deposit: PLAN_DEPOSIT });
                showToast("Success", "Vault Created.", "lock");
            }
            await fetchMyPlan();
            setView('vaults');
        } catch (e: any) {
            console.error(e);
            showToast("Error", e?.message || "Tx Failed", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const checkIn = async () => {
        if (!account) return;
        setPingLoading(true);
        try {
            await call(account, "check_in", {});
            showToast("Pulse Confirmed", "Timer reset successfully.", "check_circle");
            fetchMyPlan();
        } catch (e: any) {
            showToast("Error", e?.message || "Check-in failed", "error");
        } finally {
            setPingLoading(false);
        }
    };

    const cancelRelease = () => run("Cancelling release...", async () => {
        await call(account!, "cancel_release", {});
        showToast("Cancelled", "Release stopped. You're marked alive.", "block");
        fetchMyPlan();
    });

    const deletePlan = () => {
        if (!window.confirm("Delete this vault? Guardians and heirs lose access. The 0.1 NEAR deposit comes back to you.")) return;
        run("Deleting vault...", async () => {
            await call(account!, "delete_plan", {}, { deposit: ONE_YOCTO });
            setMyPlan(null);
            setMyAddr(null);
            showToast("Deleted", "Vault removed", "delete");
        });
    };

    const ownerSend = () => run("Signing with Chain Signatures...", async () => {
        if (!myAddr) throw new Error("Vault address not loaded");
        if (!ethers.isAddress(sendTo)) throw new Error("Invalid destination address");
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
        setBusyStep("Broadcasting to Sepolia...");
        const tx = assemble({ nonce, to: sendTo, value, ...fees }, sig, myAddr.eth);
        const hash = await broadcast(tx);
        showToast("Sent", `Tx ${short(hash)}`, "send");
        setSendAmount("");
        fetchMyPlan();
    });

    const approve = (p: Plan, addr: Addresses | null) => run("Approving release...", async () => {
        await call(account!, "approve_release", { owner: p.owner, eth_balance_wei: (addr?.ethWei ?? 0n).toString() });
        showToast("Approved", "Your approval is recorded on-chain.", "how_to_vote");
        fetchWatched();
    });

    const startHeirRelease = (p: Plan, addr: Addresses | null) => run("Starting release...", async () => {
        await call(account!, "start_heir_release", { owner: p.owner, eth_balance_wei: (addr?.ethWei ?? 0n).toString() });
        showToast("Started", "Waiting period started. The owner can still cancel.", "hourglass_top");
        fetchWatched();
    });

    const reportBalance = (p: Plan, addr: Addresses) => run("Reporting balance...", async () => {
        await call(account!, "report_balance", { owner: p.owner, eth_balance_wei: addr.ethWei.toString() });
        showToast("Updated", "Balance corrected.", "balance");
        fetchWatched();
    });

    const claimEth = (p: Plan, addr: Addresses) => run("Requesting signature from the MPC network...", async () => {
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
        // The contract stored the claim with the signature; read it back and send it.
        const fresh = await nearView<Plan>("get_plan", { owner: p.owner });
        const claim = fresh.eth_claims.find(c => c.heir === account);
        if (!claim?.signature) throw new Error("Signature not stored yet, try again");
        setBusyStep("Broadcasting to Sepolia...");
        const hash = await broadcastClaim(fresh, claim, addr.eth);
        showToast("Claimed", `Tx ${short(hash)}`, "account_balance_wallet");
        fetchWatched();
    });

    const rebroadcast = (p: Plan, addr: Addresses) => run("Broadcasting to Sepolia...", async () => {
        const claim = p.eth_claims.find(c => c.heir === account);
        if (!claim?.signature) throw new Error("No signed claim yet");
        const hash = await broadcastClaim(p, claim, addr.eth);
        showToast("Sent", `Tx ${short(hash)}`, "send");
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
        if (tx.unsignedHash.slice(2) !== claim.payload) throw new Error("Rebuilt tx does not match what the contract signed");
        return broadcast(tx);
    };

    const copy = (text: string) => {
        navigator.clipboard.writeText(text);
        showToast("Copied", short(text, 10), "content_copy");
    };

    // --- UI HELPERS ---
    const showToast = (title: string, msg: string, icon: string = 'info') => {
        setToast({ title, msg, icon });
        setTimeout(() => setToast(null), 4000);
    };

    const fmtDuration = (diff: number) => {
        if (diff <= 0) return "0s";
        const d = Math.floor(diff / 86400);
        const h = Math.floor((diff % 86400) / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        return `${m}m ${s}s`;
    };

    const timeLeft = (p: Plan) => {
        const st = statusAt(p, currentTime);
        if (st === 'pending') return fmtDuration(p.release!.release_at - currentTime);
        if (st === 'active') return fmtDuration(p.last_check_in + p.inactivity_secs - currentTime);
        if (st === 'missed_check_in') return fmtDuration(p.last_check_in + p.inactivity_secs + p.heir_fallback_secs - currentTime);
        return "BREACHED";
    };

    const progress = (p: Plan) => {
        const st = statusAt(p, currentTime);
        if (st === 'pending') return Math.max(0, Math.min(100, ((p.release!.release_at - currentTime) / p.waiting_secs) * 100));
        if (st !== 'active') return 0;
        return Math.max(0, Math.min(100, ((p.last_check_in + p.inactivity_secs - currentTime) / p.inactivity_secs) * 100));
    };

    const ttlLabel = (p: Plan) => {
        const st = statusAt(p, currentTime);
        if (st === 'pending') return "FINAL IN";
        if (st === 'missed_check_in') return "HEIR FALLBACK IN";
        return "TTL";
    };

    const totalPct = heirs.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0);
    const guardianCount = guardians.filter(g => g.trim()).length;

    const TimerField = ({ label, value, onChange, hint }: { label: string, value: Timer, onChange: (t: Timer) => void, hint: string }) => (
        <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
            <div className="p-4 bg-white rounded-xl border border-gray-200 shadow-sm space-y-3">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-4xl font-bold font-mono tracking-tighter transition-all">{value.val}</span>
                    <div className="z-select-wrapper">
                        <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })} className="bg-gray-100 font-bold text-sm px-4 py-2 pr-10 rounded-lg appearance-none cursor-pointer outline-none">
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                        </select>
                    </div>
                </div>
                <div className="range-slider-container">
                    <div className="range-tooltip" style={{ left: `${(value.val / 100) * 100}%` }}>{value.val} {value.unit}</div>
                    <input type="range" min="1" max="100" value={value.val} onChange={(e) => onChange({ ...value, val: Number(e.target.value) })} className="accent-black w-full" />
                </div>
                <p className="text-[10px] text-gray-400 font-mono">{hint}</p>
            </div>
        </div>
    );

    // --- RENDER ---
    return (
        <>
            <div className="grid-bg"></div>

            {/* INITIAL LOAD SCREEN */}
            <div id="loader" ref={loaderRef} className="fixed inset-0 z-[10000] bg-black flex flex-col justify-center items-center text-white">
                <div className="overflow-hidden">
                    <h1 className="text-6xl md:text-9xl font-bold font-sans tracking-tighter" id="loader-text">
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">Z</span>
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">E</span>
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">L</span>
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">L</span>
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">T</span>
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">E</span>
                        <span className="inline-block translate-y-[100%] opacity-0 loader-char">R</span>
                    </h1>
                </div>
                <div className="mt-8 flex items-center gap-4">
                    <div className="w-32 h-[1px] bg-gray-800 relative overflow-hidden">
                        <div className="absolute inset-0 bg-zyellow w-full -translate-x-full" id="loader-bar"></div>
                    </div>
                    <div className="font-mono text-xs text-gray-500 uppercase tracking-widest">Initializing Vaults</div>
                </div>
            </div>

            {/* BUSY OVERLAY */}
            {busyStep && (
                <div className="claim-loader-overlay">
                    <div className="claim-loader-spinner"></div>
                    <h3 className="text-xl font-bold mb-2">Secure Vault Access</h3>
                    <p className="text-gray-500 font-mono text-xs uppercase tracking-wider">{busyStep}</p>
                </div>
            )}

            <nav className="fixed top-0 w-full z-50 px-6 py-6 transition-all duration-300">
                <div className="max-w-7xl mx-auto flex justify-between items-center glass-panel rounded-full px-8 py-4 border border-white/50 shadow-sm">
                    <div className="flex items-center gap-4 group cursor-pointer" onClick={() => window.location.reload()}>
                        <div className="relative w-10 h-10 flex items-center justify-center bg-black rounded-xl overflow-hidden shadow-xl">
                            <span className="font-sans font-bold text-zyellow text-xl z-10">Z</span>
                        </div>
                        <div className="hidden md:flex flex-col">
                            <span className="font-bold tracking-tight text-sm leading-none">ZELLTER</span>
                            <span className="font-mono text-[10px] text-gray-400 leading-none mt-1">PROTOCOL V4.2</span>
                        </div>
                    </div>
                    <a href={`https://testnet.nearblocks.io/address/${CONTRACT_ID}`} target="_blank" rel="noopener noreferrer" className="hidden md:flex items-center gap-2 px-4 py-2 bg-black text-zyellow rounded-full text-xs font-bold hover:bg-zyellow hover:text-black transition-all shadow-md">
                        <span className="material-symbols-outlined text-sm">play_circle</span>
                        How it Works
                    </a>

                    <div className="relative">
                        {account ? (
                            <button onClick={() => { connector.disconnect().catch(() => { }); setAccount(null); setView('hero'); showToast("Disconnected", "Wallet disconnected", "link_off"); }} className="btn-core bg-white border border-black text-black px-6 py-2.5 font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all shadow-md">
                                <span className="material-symbols-outlined text-base">logout</span>
                                <span>{short(account, 8)}</span>
                            </button>
                        ) : (
                            <button onClick={handleConnect} className="btn-core bg-white border border-black text-black px-6 py-2.5 font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:bg-black hover:text-white transition-all shadow-md">
                                <span className="material-symbols-outlined text-base">wallet</span>
                                <span>Connect Wallet</span>
                            </button>
                        )}
                    </div>
                </div>
            </nav>

            <main className="relative min-h-screen pt-40 px-4 md:px-12 pb-24 max-w-7xl mx-auto flex flex-col items-center">
                {view === 'hero' && (
                    <section className="w-full text-center max-w-4xl mx-auto mb-16 relative perspective-1000 animate-float-slow">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur rounded-full border border-white mb-8">
                            <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zyellow opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-zyellow"></span>
                            </span>
                            <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">System Active • NEAR Testnet</span>
                        </div>
                        <h1 className="text-6xl md:text-8xl lg:text-[7rem] font-bold leading-[0.9] tracking-tight mb-8">
                            Dead Man's <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-500">Switch Protocol.</span>
                        </h1>
                        <div className="flex justify-center gap-4">
                            <button onClick={() => { account ? setView('create') : handleConnect(); }} className="btn-core btn-glow bg-black text-white px-8 py-4 rounded-full font-bold text-sm shadow-xl hover:shadow-2xl hover:scale-105 flex items-center gap-3 transition-all shimmer-trigger">
                                Start Vault <span className="material-symbols-outlined">arrow_forward</span>
                            </button>
                        </div>
                    </section>
                )}

                {view !== 'hero' && (
                    <div className="w-full max-w-6xl relative perspective-1000">
                        <div className="flex justify-center mb-8 sticky top-28 z-40">
                            <div className="bg-white/95 backdrop-blur-md p-1 rounded-full inline-flex shadow-lg border border-gray-200">
                                <button onClick={() => setView('create')} className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${view === 'create' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-black hover:bg-gray-100'}`}>{myPlan ? 'EDIT' : 'CREATE'}</button>
                                <button onClick={() => { setView('vaults'); fetchMyPlan(); }} className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${view === 'vaults' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-black hover:bg-gray-100'}`}>MY VAULTS</button>
                                <button onClick={() => { setView('claim'); fetchWatched(); }} className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${view === 'claim' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-black hover:bg-gray-100'}`}>CLAIM</button>
                            </div>
                        </div>

                        {view === 'create' && (
                            <div className="grid lg:grid-cols-12 gap-6 items-start animate-fade-in-up">
                                <div className="lg:col-span-7 glass-panel rounded-2xl p-6 md:p-8 relative overflow-hidden">
                                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                                        <span className="w-1.5 h-6 bg-black rounded-full"></span> Configure Vault
                                    </h2>
                                    <div className="space-y-5">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Guardians</label>
                                            {guardians.map((g, i) => (
                                                <div key={i} className="flex gap-2">
                                                    <input value={g} onChange={e => setGuardians(guardians.map((x, j) => j === i ? e.target.value : x))} className="z-input flex-1 input-field-elevate font-mono text-sm" placeholder="guardian.testnet" />
                                                    {guardians.length > 1 && (
                                                        <button onClick={() => setGuardians(guardians.filter((_, j) => j !== i))} className="w-10 rounded-xl bg-gray-100 hover:bg-red-500 hover:text-white transition-all"><span className="material-symbols-outlined text-sm">close</span></button>
                                                    )}
                                                </div>
                                            ))}
                                            <div className="flex justify-between items-center">
                                                <button onClick={() => setGuardians([...guardians, ""])} className="text-xs font-bold underline">+ Add guardian</button>
                                                <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                                                    Approvals needed
                                                    <div className="z-select-wrapper">
                                                        <select value={Math.min(threshold, Math.max(1, guardianCount))} onChange={e => setThreshold(Number(e.target.value))} className="bg-gray-100 font-bold text-sm px-4 py-2 pr-10 rounded-lg appearance-none cursor-pointer outline-none">
                                                            {Array.from({ length: Math.max(1, guardianCount) }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                                                        </select>
                                                    </div>
                                                    of {Math.max(1, guardianCount)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2 pt-3 border-t border-gray-200">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Heirs</label>
                                            {heirs.map((h, i) => (
                                                <div key={i} className="grid grid-cols-12 gap-2">
                                                    <input value={h.account} onChange={e => setHeirs(heirs.map((x, j) => j === i ? { ...x, account: e.target.value } : x))} className="z-input col-span-4 input-field-elevate font-mono text-sm" placeholder="heir.testnet" />
                                                    <input value={h.eth} onChange={e => setHeirs(heirs.map((x, j) => j === i ? { ...x, eth: e.target.value } : x))} className="z-input col-span-5 input-field-elevate font-mono text-sm" placeholder="0x... (ETH)" />
                                                    <input value={h.pct} onChange={e => setHeirs(heirs.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} className="z-input col-span-2 input-field-elevate font-mono text-sm" placeholder="%" />
                                                    <button disabled={heirs.length === 1} onClick={() => setHeirs(heirs.filter((_, j) => j !== i))} className="col-span-1 rounded-xl bg-gray-100 hover:bg-red-500 hover:text-white transition-all disabled:opacity-30"><span className="material-symbols-outlined text-sm">close</span></button>
                                                </div>
                                            ))}
                                            <div className="flex justify-between items-center">
                                                <button onClick={() => setHeirs([...heirs, { account: "", eth: "", pct: "" }])} className="text-xs font-bold underline">+ Add heir</button>
                                                <span className={`text-xs font-mono font-bold ${totalPct === 100 ? 'text-green-600' : 'text-red-500'}`}>TOTAL {totalPct}%</span>
                                            </div>
                                        </div>

                                        <div className="pt-3 border-t border-gray-200">
                                            <TimerField label="Heartbeat Timer" value={inactivity} onChange={setInactivity} hint="Miss check-ins this long and guardians can approve a release." />
                                        </div>
                                    </div>
                                </div>
                                <div className="lg:col-span-5 space-y-6">
                                    <div className="glass-panel rounded-[2rem] p-8 shadow-xl space-y-5">
                                        <TimerField label="Waiting Period" value={waiting} onChange={setWaiting} hint="After approval. You can still cancel during this time." />
                                        <TimerField label="Heir Fallback" value={fallback} onChange={setFallback} hint="Extra silence after the heartbeat before heirs can start a release without guardians." />
                                    </div>
                                    <button onClick={savePlan} disabled={isLoading} className="w-full group relative overflow-hidden bg-black text-white rounded-[1.5rem] p-6 text-left shadow-2xl transition-all hover:scale-[1.02] btn-slide-fill hover:shadow-yellow">
                                        <div className="relative z-10 flex justify-between items-center">
                                            <div>
                                                <div className="text-2xl font-bold text-zyellow mb-1">
                                                    {isLoading ? "Confirming..." : myPlan ? "Update Vault" : "Lock Vault"}
                                                </div>
                                                <div className="text-xs text-gray-400 font-mono">
                                                    {myPlan ? "Saving also counts as a check-in" : "0.1 NEAR storage deposit, refunded on delete"}
                                                </div>
                                            </div>
                                            <div className="w-12 h-12 rounded-full border border-gray-600 flex items-center justify-center group-hover:bg-zyellow group-hover:text-black transition-all">
                                                <span className="material-symbols-outlined icon-bounce">lock</span>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}

                        {view === 'vaults' && (
                            <div className="glass-panel rounded-[2.5rem] min-h-[400px] p-8">
                                <h2 className="text-4xl font-bold mb-8">Your Vaults</h2>
                                {!myPlan ? (
                                    <div className="text-center py-20">
                                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <span className="material-symbols-outlined text-3xl text-gray-400">lock_open</span>
                                        </div>
                                        <h3 className="font-bold text-gray-400">No active vaults found.</h3>
                                        <button className="mt-4 text-xs font-bold underline" onClick={() => setView('create')}>Create one</button>
                                    </div>
                                ) : (
                                    <div className="grid md:grid-cols-2 gap-6">
                                        <div className="vault-card card-shine bg-white p-6 rounded-3xl border border-gray-100 shadow-soft flex flex-col gap-6">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h3 className="text-2xl font-bold">{myPlan.owner}</h3>
                                                    <p className="text-xs text-gray-400 font-mono">
                                                        {myPlan.threshold} OF {myPlan.guardians.length} GUARDIANS • {myPlan.heirs.length} HEIR{myPlan.heirs.length > 1 ? 'S' : ''}
                                                    </p>
                                                </div>
                                                <button onClick={deletePlan} title="Delete vault" className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all">
                                                    <span className="material-symbols-outlined text-sm">delete</span>
                                                </button>
                                            </div>
                                            <div className={`px-3 py-1 text-white text-xs font-bold rounded-full w-fit ${STATUS_LABEL[statusAt(myPlan, currentTime)].color} transition-colors duration-500 ${STATUS_LABEL[statusAt(myPlan, currentTime)].active ? 'vault-status-active' : ''}`}>
                                                {STATUS_LABEL[statusAt(myPlan, currentTime)].text}
                                            </div>
                                            <div className="space-y-2">
                                                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden relative">
                                                    <div className="h-full bg-black transition-all duration-1000 ease-linear relative overflow-hidden progress-glow" style={{ width: `${progress(myPlan)}%` }}>
                                                        <div className="absolute inset-0 bg-white/20 progress-striped"></div>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between text-xs font-mono">
                                                    <span className="text-gray-400 font-bold">{ttlLabel(myPlan)}</span>
                                                    <span className="font-bold text-lg">{timeLeft(myPlan)}</span>
                                                </div>
                                                {myPlan.approvals.length > 0 && !myPlan.release && (
                                                    <p className="text-xs font-mono text-orange-600">{myPlan.approvals.length}/{myPlan.threshold} guardians approved a release</p>
                                                )}
                                            </div>
                                            {statusAt(myPlan, currentTime) === 'pending' && (
                                                <button onClick={cancelRelease} className="w-full py-4 font-bold rounded-xl flex items-center justify-center gap-2 transition-all btn-magnetic bg-red-500 text-white hover:bg-black">
                                                    <span className="material-symbols-outlined">block</span> CANCEL RELEASE
                                                </button>
                                            )}
                                            <button
                                                onClick={checkIn}
                                                disabled={pingLoading || statusAt(myPlan, currentTime) === 'released'}
                                                className={`w-full py-4 font-bold rounded-xl flex items-center justify-center gap-2 transition-all btn-magnetic ${pingLoading ? 'bg-gray-200 text-gray-400' : 'bg-zyellow hover:bg-black hover:text-white text-black hover:shadow-black'}`}
                                            >
                                                {pingLoading ? <div className="ping-loader"></div> : <span className="material-symbols-outlined animate-pulse">ecg_heart</span>}
                                                {pingLoading ? "Sending heartbeat..." : "PING"}
                                            </button>
                                        </div>

                                        <div className="vault-card card-shine bg-white p-6 rounded-3xl border border-gray-100 shadow-soft flex flex-col gap-4">
                                            <h3 className="text-2xl font-bold">Assets</h3>
                                            <p className="text-xs text-gray-400 font-mono -mt-3">CONTROLLED BY CHAIN SIGNATURES</p>
                                            {[
                                                { label: "ETH • SEPOLIA", addr: myAddr?.eth, bal: myAddr ? `${fmtEth(myAddr.ethWei)} ETH` : "..." },
                                                { label: "BTC • TESTNET4", addr: myAddr?.btc, bal: myAddr ? `${myAddr.btcSats} sats` : "..." },
                                            ].map(a => (
                                                <div key={a.label} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                                    <div className="flex justify-between text-xs font-bold text-gray-500"><span>{a.label}</span><span className="font-mono text-black">{a.bal}</span></div>
                                                    <button onClick={() => a.addr && copy(a.addr)} className="mt-1 font-mono text-sm break-all text-left hover:underline">{a.addr || "deriving..."}</button>
                                                </div>
                                            ))}
                                            <div className="pt-2 border-t border-gray-100 space-y-2">
                                                <label className="text-xs font-bold text-gray-500 uppercase">Send ETH</label>
                                                <input value={sendTo} onChange={e => setSendTo(e.target.value)} className="z-input w-full font-mono text-sm input-field-elevate" placeholder="0x... destination" />
                                                <div className="flex gap-2">
                                                    <input value={sendAmount} onChange={e => setSendAmount(e.target.value)} className="z-input flex-1 font-mono text-sm input-field-elevate" placeholder="0.01" />
                                                    <button onClick={ownerSend} disabled={statusAt(myPlan, currentTime) === 'released'} className="px-6 bg-black text-white font-bold rounded-xl hover:bg-zyellow hover:text-black transition-all">SEND</button>
                                                </div>
                                                <p className="text-[10px] text-gray-400 font-mono">Sending also counts as a check-in.</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {view === 'claim' && (
                            <div className="glass-panel rounded-[2.5rem] min-h-[400px] p-8">
                                <div className="flex justify-between items-center mb-8">
                                    <h2 className="text-4xl font-bold">Claim Vaults</h2>
                                    <button onClick={fetchWatched} className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center hover:bg-black hover:text-white transition-all"><span className="material-symbols-outlined">refresh</span></button>
                                </div>
                                <div className="grid md:grid-cols-2 gap-6">
                                    {watched.map(({ plan: p, addr }) => {
                                        const st = statusAt(p, currentTime);
                                        const isGuardian = !!account && p.guardians.includes(account);
                                        const myHeir = p.heirs.find(h => h.account === account);
                                        const approved = p.approvals.some(a => a.guardian === account);
                                        const myClaim = p.eth_claims.find(c => c.heir === account);
                                        const claimDone = !!myClaim?.signature && !!addr && addr.ethNonce > myClaim.nonce;
                                        const balanceTooHigh = st === 'pending' && addr && p.release && addr.ethWei < BigInt(p.release.eth_balance_wei);
                                        return (
                                            <div key={p.owner} className="vault-card card-shine bg-white p-6 rounded-3xl border border-gray-100 shadow-soft">
                                                <div className="mb-4">
                                                    <div className="flex justify-between">
                                                        <h3 className="text-lg font-bold truncate">Owner: {p.owner}</h3>
                                                        <div className="flex gap-1">
                                                            {isGuardian && <span className="h-6 px-2 rounded bg-gray-100 text-[10px] font-bold flex items-center">GUARDIAN</span>}
                                                            {myHeir && <span className="h-6 px-2 rounded bg-gray-100 text-[10px] font-bold flex items-center">HEIR {myHeir.share_bps / 100}%</span>}
                                                        </div>
                                                    </div>
                                                    <h4 className="text-sm font-mono text-gray-500">{addr ? `${fmtEth(addr.ethWei)} ETH • ${short(addr.eth)}` : 'loading assets...'}</h4>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span className={`w-2 h-2 rounded-full ${STATUS_LABEL[st].color} ${STATUS_LABEL[st].active ? '' : 'status-pulse'}`}></span>
                                                        <span className="text-xs font-bold text-gray-500">{STATUS_LABEL[st].text}</span>
                                                        {st !== 'released' && <span className="text-xs font-mono text-gray-400 ml-auto">{ttlLabel(p)} {timeLeft(p)}</span>}
                                                    </div>
                                                    {!p.release && p.approvals.length > 0 && (
                                                        <p className="text-xs font-mono text-gray-400 mt-1">{p.approvals.length}/{p.threshold} approvals</p>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    {isGuardian && !p.release && (st === 'missed_check_in' || st === 'heirs_can_start') && (
                                                        <button disabled={approved} onClick={() => approve(p, addr)} className={`flex-1 py-3 font-bold rounded-xl transition-all btn-magnetic ${approved ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-black text-white hover:bg-zyellow hover:text-black hover:shadow-yellow'}`}>
                                                            {approved ? 'APPROVED' : 'APPROVE RELEASE'}
                                                        </button>
                                                    )}
                                                    {myHeir && st === 'heirs_can_start' && !p.release && (
                                                        <button onClick={() => startHeirRelease(p, addr)} className="flex-1 py-3 bg-black text-white font-bold rounded-xl hover:bg-zyellow hover:text-black transition-all btn-magnetic hover:shadow-yellow">START RELEASE (NO GUARDIANS)</button>
                                                    )}
                                                    {balanceTooHigh && addr && (
                                                        <button onClick={() => reportBalance(p, addr)} className="flex-1 py-2 bg-gray-100 text-xs font-bold rounded-xl hover:bg-black hover:text-white transition-all">REPORTED BALANCE IS TOO HIGH: FIX IT</button>
                                                    )}
                                                    {myHeir && st === 'released' && addr && (
                                                        claimDone ? (
                                                            <button disabled className="flex-1 py-3 bg-gray-100 text-gray-400 font-bold rounded-xl cursor-not-allowed">CLAIMED</button>
                                                        ) : (
                                                            <div className="flex gap-2">
                                                                <button onClick={() => claimEth(p, addr)} className="flex-1 py-3 bg-black text-white font-bold rounded-xl hover:bg-zyellow hover:text-black transition-all btn-magnetic hover:shadow-yellow">
                                                                    {myClaim ? 'RE-SIGN CLAIM' : 'CLAIM ETH'}
                                                                </button>
                                                                {myClaim?.signature && (
                                                                    <button onClick={() => rebroadcast(p, addr)} className="flex-1 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-all btn-magnetic flex items-center justify-center gap-2">
                                                                        <span className="material-symbols-outlined text-sm">send</span> BROADCAST
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )
                                                    )}
                                                    {(st === 'active' || (st === 'pending') || (!isGuardian && st === 'missed_check_in')) && (
                                                        <button disabled className="flex-1 py-3 bg-gray-100 text-gray-400 font-bold rounded-xl cursor-not-allowed">LOCKED</button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {watched.length === 0 && (
                                        <div className="col-span-full text-center text-gray-400 text-sm py-10">You are not a guardian or heir for any vaults yet.</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <div id="toast" className={`fixed bottom-8 right-8 z-[10000] transition-transform duration-500 flex items-center gap-4 bg-white px-6 py-4 rounded-xl shadow-2xl border-l-4 border-black ${toast ? 'translate-y-0' : 'translate-y-40'}`}>
                <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center text-zyellow">
                    <span className="material-symbols-outlined text-sm">{toast?.icon || 'info'}</span>
                </div>
                <div>
                    <h4 className="font-bold text-sm">{toast?.title}</h4>
                    <p className="text-xs text-gray-500">{toast?.msg}</p>
                </div>
            </div>
        </>
    );
}

export default function App() {
    return <InnerApp />;
}
