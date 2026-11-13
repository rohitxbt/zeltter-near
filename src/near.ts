import { NearConnector } from "@hot-labs/near-connect";

export const CONTRACT_ID = process.env.REACT_APP_CONTRACT_ID || "zeltter-59dbbe.testnet";
export const MPC_ID = "v1.signer-prod.testnet";
const RPC = "https://rpc.testnet.near.org";

export const connector = new NearConnector({ network: "testnet" });

export const TGAS = "000000000000";
export const ONE_YOCTO = "1";

export interface Heir {
    account: string;
    eth_address: string;
    share_bps: number;
}

export interface EthClaim {
    heir: string;
    nonce: number;
    value_wei: string;
    max_fee_per_gas: string;
    max_priority_fee_per_gas: string;
    gas_limit: number;
    payload: string;
    signature: MpcSignature | null;
}

export interface MpcSignature {
    scheme?: string;
    big_r: { affine_point: string };
    s: { scalar: string };
    recovery_id: number;
}

export type Status = "active" | "missed_check_in" | "heirs_can_start" | "pending" | "released";

export interface Plan {
    owner: string;
    guardians: string[];
    threshold: number;
    heirs: Heir[];
    inactivity_secs: number;
    waiting_secs: number;
    heir_fallback_secs: number;
    last_check_in: number;
    approvals: { guardian: string; eth_balance_wei: string }[];
    release: { started_at: number; release_at: number; started_by_heirs: boolean; eth_balance_wei: string } | null;
    eth_claims: EthClaim[];
    status: Status;
    eth_path: string;
    btc_path: string;
}

/// Same rules as Plan::status in the contract, so countdowns tick locally.
export function statusAt(p: Plan, now: number): Status {
    if (p.release) return now >= p.release.release_at ? "released" : "pending";
    const silent = now - p.last_check_in;
    if (silent >= p.inactivity_secs + p.heir_fallback_secs) return "heirs_can_start";
    if (silent >= p.inactivity_secs) return "missed_check_in";
    return "active";
}

export async function view<T>(method: string, args: object = {}, contract = CONTRACT_ID): Promise<T> {
    const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: "zeltter",
            method: "query",
            params: {
                request_type: "call_function",
                finality: "optimistic",
                account_id: contract,
                method_name: method,
                args_base64: btoa(JSON.stringify(args)),
            },
        }),
    });
    const json = await res.json();
    if (json.error || json.result?.error) {
        throw new Error(json.result?.error || json.error?.cause?.name || "view failed");
    }
    return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

export async function call<T = unknown>(
    signerId: string,
    methodName: string,
    args: object,
    opts: { deposit?: string; tgas?: number } = {}
): Promise<T> {
    const wallet = await connector.wallet();
    const outcome: any = await wallet.signAndSendTransaction({
        signerId,
        receiverId: CONTRACT_ID,
        actions: [
            {
                type: "FunctionCall",
                params: {
                    methodName,
                    args,
                    gas: `${opts.tgas ?? 30}${TGAS}`,
                    deposit: opts.deposit ?? "0",
                },
            },
        ],
    });
    const status = outcome?.status;
    if (status && typeof status === "object" && "Failure" in status) {
        throw new Error(failureMessage(status.Failure));
    }
    const b64 = status?.SuccessValue;
    if (!b64) return undefined as T;
    return JSON.parse(atob(b64));
}

function failureMessage(f: any): string {
    const kind = f?.ActionError?.kind;
    const msg = kind?.FunctionCallError?.ExecutionError;
    if (typeof msg === "string") return msg.replace("Smart contract panicked: ", "");
    return JSON.stringify(f).slice(0, 160);
}
