import { ethers } from "ethers";
import { CONTRACT_ID, MPC_ID, MpcSignature, view } from "./near";

export const SEPOLIA_CHAIN_ID = 11155111;
export const sepolia = new ethers.JsonRpcProvider(
    "https://ethereum-sepolia-rpc.publicnode.com",
    SEPOLIA_CHAIN_ID,
    { staticNetwork: true }
);
const MEMPOOL = "https://mempool.space/testnet4/api";

/// Public key the MPC network derives for (this contract, path). Returns 0x04... uncompressed.
export async function derivedPublicKey(path: string): Promise<string> {
    const s = await view<string>(
        "derived_public_key",
        { path, predecessor: CONTRACT_ID, domain_id: 0 },
        MPC_ID
    );
    const raw = ethers.toBeHex(ethers.decodeBase58(s.split(":")[1]), 64);
    return "0x04" + raw.slice(2);
}

export function ethAddress(pubkey: string): string {
    return ethers.computeAddress(pubkey);
}

/// Native segwit (P2WPKH) testnet address.
export function btcAddress(pubkey: string): string {
    const compressed = ethers.SigningKey.computePublicKey(pubkey, true);
    const h160 = ethers.getBytes(ethers.ripemd160(ethers.sha256(compressed)));
    return bech32Encode("tb", [0, ...convertBits(h160, 8, 5)]);
}

export async function ethBalance(addr: string): Promise<bigint> {
    return sepolia.getBalance(addr);
}

export async function btcBalance(addr: string): Promise<number> {
    const r = await fetch(`${MEMPOOL}/address/${addr}`);
    if (!r.ok) return 0;
    const j = await r.json();
    const c = j.chain_stats, m = j.mempool_stats;
    return c.funded_txo_sum - c.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum;
}

export async function txParams() {
    const [fee, block] = await Promise.all([sepolia.getFeeData(), sepolia.getBlock("latest")]);
    const prio = fee.maxPriorityFeePerGas ?? 1_000_000_000n;
    const base = block?.baseFeePerGas ?? 1_000_000_000n;
    return { maxPriorityFeePerGas: prio, maxFeePerGas: base * 2n + prio, gasLimit: 21000n };
}

export interface EthTxFields {
    nonce: number;
    to: string;
    value: bigint;
    data?: string;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    gasLimit: bigint;
}

/// Rebuild the tx the contract hashed, attach the MPC signature, and check
/// it really comes from `from` before anyone broadcasts it.
export function assemble(fields: EthTxFields, sig: MpcSignature, from: string): ethers.Transaction {
    const tx = ethers.Transaction.from({
        type: 2,
        chainId: SEPOLIA_CHAIN_ID,
        nonce: fields.nonce,
        to: fields.to,
        value: fields.value,
        data: fields.data ?? "0x",
        maxFeePerGas: fields.maxFeePerGas,
        maxPriorityFeePerGas: fields.maxPriorityFeePerGas,
        gasLimit: fields.gasLimit,
    });
    tx.signature = ethers.Signature.from({
        r: "0x" + sig.big_r.affine_point.slice(2),
        s: "0x" + sig.s.scalar,
        yParity: sig.recovery_id as 0 | 1,
    });
    if (tx.from?.toLowerCase() !== from.toLowerCase()) {
        throw new Error("signature does not match the vault address");
    }
    return tx;
}

export async function broadcast(tx: ethers.Transaction): Promise<string> {
    try {
        const res = await sepolia.broadcastTransaction(tx.serialized);
        return res.hash;
    } catch (e: any) {
        // already in the mempool or mined: fine, same hash
        if (/already known|nonce too low/i.test(e?.message || "")) return tx.hash!;
        throw e;
    }
}

// --- bech32 (BIP-173), just the encoder ---

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
        const top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
    }
    return chk;
}

function bech32Encode(hrp: string, data: number[]): string {
    const expand = [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));
    const mod = polymod([...expand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
    const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
    return hrp + "1" + [...data, ...checksum].map(d => CHARSET[d]).join("");
}

function convertBits(data: Uint8Array, from: number, to: number): number[] {
    let acc = 0, bits = 0;
    const out: number[] = [];
    const max = (1 << to) - 1;
    for (const v of data) {
        acc = (acc << from) | v;
        bits += from;
        while (bits >= to) {
            bits -= to;
            out.push((acc >> bits) & max);
        }
    }
    if (bits > 0) out.push((acc << (to - bits)) & max);
    return out;
}
