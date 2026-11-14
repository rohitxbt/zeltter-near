import React from 'react';
import { Plan, Status, statusAt } from './near';

/// Plain-language span: "90 days", "6 hours", "2 minutes".
export function span(secs: number): string {
    const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (secs >= 86400 && secs % 86400 === 0) return unit(secs / 86400, 'day');
    if (secs >= 3600 && secs % 3600 === 0) return unit(secs / 3600, 'hour');
    if (secs >= 86400) return unit(Math.round(secs / 86400), 'day');
    if (secs >= 3600) return unit(Math.round(secs / 3600), 'hour');
    return unit(Math.max(1, Math.round(secs / 60)), 'minute');
}

export function countdown(diff: number): string {
    if (diff <= 0) return '0:00';
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

type Phase = { name: string; length: string };

export interface ClockReading {
    status: Status;
    big: string;
    caption: string;
    phase: number;      // 0 heartbeat, 1 guardians can approve, 2 waiting, 3 released
    fraction: number;   // progress inside the phase, 0..1
    phases: Phase[];
    loading?: boolean;  // nothing read yet: no status, no live point
}

export function readClock(p: Plan, now: number): ClockReading {
    const st = statusAt(p, now);
    const phases: Phase[] = [
        { name: 'Heartbeat', length: span(p.inactivity_secs) },
        { name: 'Guardians approve', length: span(p.heir_fallback_secs) },
        { name: 'Waiting period', length: span(p.waiting_secs) },
        { name: 'Released', length: '' },
    ];
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const silentEnd = p.last_check_in + p.inactivity_secs;
    switch (st) {
        case 'active':
            return {
                status: st, phases, phase: 0,
                fraction: clamp((now - p.last_check_in) / p.inactivity_secs),
                big: countdown(silentEnd - now),
                caption: 'until guardians can step in. Any check-in resets it.',
            };
        case 'missed_check_in':
            return {
                status: st, phases, phase: 1,
                fraction: clamp((now - silentEnd) / p.heir_fallback_secs),
                big: countdown(silentEnd + p.heir_fallback_secs - now),
                caption: `Missed check-in. Guardians can approve now; heirs can start alone in this long.`,
            };
        case 'heirs_can_start':
            return {
                status: st, phases, phase: 1, fraction: 1,
                big: 'Silent',
                caption: 'Past the fallback. Guardians or heirs can start the release.',
            };
        case 'pending': {
            const r = p.release!;
            return {
                status: st, phases, phase: 2,
                fraction: clamp((now - r.started_at) / Math.max(1, r.release_at - r.started_at)),
                big: countdown(r.release_at - now),
                caption: 'until the release is final. The owner can still cancel.',
            };
        }
        default:
            return {
                status: st, phases, phase: 3, fraction: 1,
                big: 'Released',
                caption: 'Heirs can claim their share to the addresses the owner named.',
            };
    }
}

/// The signature: the vault drawn as a heartbeat line. Beats while the owner
/// is checking in, goes flat once they stop, and a live point marks now.
export function VaultLine({ reading }: { reading: ClockReading }) {
    const W = 400, H = 72, base = 46, seg = W / 4;
    const nowX = Math.min(W - 6, Math.max(6, reading.phase * seg + reading.fraction * seg));
    const alive = reading.status === 'active' && !reading.loading;

    // beats every 22px up to "now" inside the heartbeat phase, flat after
    let d = `M0 ${base}`;
    const beatEnd = reading.loading ? 0 : alive ? nowX : seg;
    for (let x = 0; x + 22 <= beatEnd; x += 22) {
        d += ` L${x + 8} ${base} L${x + 11} ${base - 22} L${x + 14} ${base + 9} L${x + 17} ${base} L${x + 22} ${base}`;
    }
    d += ` L${nowX} ${base}`;
    const len = Math.ceil(nowX * 2.2);

    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" role="img"
                aria-label={`Vault timeline, now in phase: ${reading.phases[reading.phase].name}`}>
                {[1, 2, 3].map(i => (
                    <line key={i} x1={i * seg} x2={i * seg} y1={8} y2={H - 4} stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" />
                ))}
                <line x1={nowX} x2={W} y1={base} y2={base} stroke="currentColor" strokeOpacity="0.32" strokeWidth="1.5" strokeDasharray="2 5" />
                <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                    className="trace" style={{ ['--len' as any]: len }} />
                {!reading.loading && <>
                    <circle cx={nowX} cy={base} r="5" fill="currentColor" className="beat-ring" />
                    <circle cx={nowX} cy={base} r="5" fill="currentColor" />
                </>}
            </svg>
            <ol className="grid grid-cols-4 mt-3">
                {reading.phases.map((ph, i) => (
                    <li key={ph.name} className={`pr-2 text-[13px] leading-snug ${i === reading.phase ? 'text-on-field' : 'text-on-field-muted'}`}>
                        <span className={i === reading.phase ? 'font-semibold' : ''}>{ph.name}</span>
                        {ph.length && <span className="block num">{ph.length}</span>}
                    </li>
                ))}
            </ol>
        </div>
    );
}

const STATUS_TEXT: Record<Status, string> = {
    active: 'Owner is checking in',
    missed_check_in: 'Missed check-in',
    heirs_can_start: 'Silent past the fallback',
    pending: 'Release pending',
    released: 'Released',
};

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/// Placeholder while the vault is being read: the line, no made-up numbers.
export function loadingReading(): ClockReading {
    return {
        loading: true, status: 'active', big: '—d —h', caption: 'Reading the vault from NEAR…', phase: 0, fraction: 0,
        phases: [{ name: 'Heartbeat', length: '' }, { name: 'Guardians approve', length: '' }, { name: 'Waiting period', length: '' }, { name: 'Released', length: '' }],
    };
}

/// The red field's content: how long, what it means, the line, then who and when.
export function VaultClock({ reading, title, lastCheckIn, children }: { reading: ClockReading; title: string; lastCheckIn?: number; children?: React.ReactNode }) {
    const status = STATUS_TEXT[reading.status];
    return (
        <div className="flex flex-col gap-8">
            <div>
                <p className="font-display font-semibold num text-[clamp(3.25rem,8vw,6rem)] leading-[0.95] tracking-[-0.03em]" aria-live="polite">
                    {reading.big}
                </p>
                <p className="mt-3 text-[15px] text-on-field-muted max-w-[36ch] [text-wrap:pretty]">{reading.caption}</p>
            </div>
            <VaultLine reading={reading} />
            {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
            <div className="pt-5 border-t border-on-field-line text-sm text-on-field-muted flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-on-field">{title}</span>
                {!reading.loading && status !== reading.big && <span>{status}</span>}
                {lastCheckIn !== undefined && <span className="num">Last check-in {dateFmt.format(new Date(lastCheckIn * 1000))}</span>}
            </div>
        </div>
    );
}
