// End-to-end run on testnet with 60 second timers. Takes about 3 minutes.
//
//   node scripts/e2e.mjs <contract-id>
//
// Creates fresh owner / guardian / heir accounts from the faucet, then:
// owner signs an ETH tx -> guardians approve after a missed check-in ->
// waiting period -> heir claims. Every MPC signature is checked to recover
// to the vault's derived ETH address. Nothing is broadcast.

import { Account, JsonRpcProvider, KeyPair, teraToGas, nearToYocto } from "near-api-js";
import { ethers } from "ethers";
import crypto from "node:crypto";

const CONTRACT = process.argv[2];
if (!CONTRACT) throw new Error("usage: node scripts/e2e.mjs <contract-id>");
const MPC = "v1.signer-prod.testnet";
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const sleep = s => new Promise(r => setTimeout(r, s * 1000));

async function newAccount(tag) {
    const id = `zt-${tag}-${crypto.randomBytes(3).toString("hex")}.testnet`;
    const key = KeyPair.fromRandom("ed25519");
    const res = await fetch("https://helper.nearprotocol.com/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`faucet: ${res.status} ${await res.text()}`);
    return new Account(id, provider, key.toString());
}

const view = (method, args) => provider.callFunction({ contractId: CONTRACT, method, args });
const call = (acct, methodName, args, deposit = 0n, tgas = "30") =>
    acct.callFunction({ contractId: CONTRACT, methodName, args, gas: teraToGas(tgas), deposit });

async function vaultEthAddress(path) {
    const s = await provider.callFunction({
        contractId: MPC, method: "derived_public_key",
        args: { path, predecessor: CONTRACT, domain_id: 0 },
    });
    const raw = ethers.toBeHex(ethers.decodeBase58(s.split(":")[1]), 64);
    return ethers.computeAddress("0x04" + raw.slice(2));
}

function recover(fields, sig) {
    const tx = ethers.Transaction.from({ type: 2, chainId: 11155111, data: "0x", ...fields });
    tx.signature = ethers.Signature.from({
        r: "0x" + sig.big_r.affine_point.slice(2),
        s: "0x" + sig.s.scalar,
        yParity: sig.recovery_id,
    });
    return { from: tx.from, hash: tx.unsignedHash };
}

function check(ok, msg) {
    if (!ok) throw new Error("FAIL: " + msg);
    console.log("ok  " + msg);
}

async function expectFail(p, msg) {
    try { await p; } catch (e) { console.log("ok  " + msg + "  (" + String(e.message || e).slice(0, 70) + ")"); return; }
    throw new Error("FAIL: should have been rejected: " + msg);
}

const owner = await newAccount("owner");
const g1 = await newAccount("g1");
const g2 = await newAccount("g2");
const heir = await newAccount("heir");
console.log("accounts:", owner.accountId, g1.accountId, g2.accountId, heir.accountId);
await sleep(3);

const heirEth = ethers.Wallet.createRandom().address;
await call(owner, "create_plan", {
    plan: {
        guardians: [g1.accountId, g2.accountId],
        threshold: 2,
        heirs: [{ account: heir.accountId, eth_address: heirEth, share_bps: 10000 }],
        inactivity_secs: 60, waiting_secs: 60, heir_fallback_secs: 60,
    },
}, nearToYocto("0.1"));
const plan = await view("get_plan", { owner: owner.accountId });
check(plan.status === "active", "plan created and readable by anyone");

const vault = await vaultEthAddress(plan.eth_path);
console.log("vault ETH address:", vault);

// 1. owner signs a normal transfer through the contract
const fields = { nonce: 0, to: heirEth, value: 1n, maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 21000n };
const sig = await call(owner, "owner_sign_eth", {
    to: fields.to, value_wei: "1", data: "0x",
    tx: { nonce: 0, max_fee_per_gas: "20000000000", max_priority_fee_per_gas: "1000000000", gas_limit: 21000 },
}, 1n, "300");
check(recover(fields, sig).from === vault, "owner tx signed by MPC recovers to the vault address");

await expectFail(call(g1, "approve_release", { owner: owner.accountId, eth_balance_wei: "1" }), "guardian can't approve while owner is active");

// 2. owner goes quiet
console.log("waiting 62s for the missed check-in...");
await sleep(62);
await call(g1, "approve_release", { owner: owner.accountId, eth_balance_wei: "10000000000000000" });
await call(g2, "approve_release", { owner: owner.accountId, eth_balance_wei: "10000000000000000" });
check((await view("get_plan", { owner: owner.accountId })).status === "pending", "2 of 2 guardians approved, release pending");

await expectFail(call(heir, "claim_eth", {
    owner: owner.accountId,
    tx: { nonce: 1, max_fee_per_gas: "20000000000", max_priority_fee_per_gas: "1000000000", gas_limit: 21000 },
}, 1n, "300"), "heir can't claim during the waiting period");

// 3. waiting period passes
console.log("waiting 62s for the waiting period...");
await sleep(62);
await expectFail(call(owner, "check_in", {}), "owner can't cancel after the waiting period");

await call(heir, "claim_eth", {
    owner: owner.accountId,
    tx: { nonce: 1, max_fee_per_gas: "20000000000", max_priority_fee_per_gas: "1000000000", gas_limit: 21000 },
}, 1n, "300");
const after = await view("get_plan", { owner: owner.accountId });
const claim = after.eth_claims[0];
check(!!claim?.signature, "heir claim signed and stored on-chain");
const value = BigInt(claim.value_wei);
check(value === 10_000_000_000_000_000n - 21000n * 20_000_000_000n, "heir gets 100% of reported balance minus gas");
const r = recover({ nonce: 1, to: heirEth, value, maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 21000n }, claim.signature);
check(r.from === vault, "heir claim recovers to the vault address");
check(r.hash.slice(2) === claim.payload, "rebuilt tx matches the hash the contract signed");

console.log("\nall good");
