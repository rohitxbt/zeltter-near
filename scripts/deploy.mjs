// Deploy the contract to NEAR testnet.
//
//   node scripts/deploy.mjs <path/to/zeltter.wasm>          create account (first run) + deploy + init
//   node scripts/deploy.mjs --lock                          delete the full-access keys. No more upgrades, ever.
//
// The account key is kept in contract/neardev/account.json (gitignored).

import { Account, JsonRpcProvider, KeyPair, teraToGas } from "near-api-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const RPC = "https://test.rpc.fastnear.com";
const MPC = "v1.signer-prod.testnet";
const SEPOLIA = 11155111;
const CREDS = path.resolve("contract/neardev/account.json");

const provider = new JsonRpcProvider({ url: RPC });

async function loadOrCreateAccount() {
    if (fs.existsSync(CREDS)) return JSON.parse(fs.readFileSync(CREDS, "utf8"));

    const accountId = `zeltter-${crypto.randomBytes(3).toString("hex")}.testnet`;
    const key = KeyPair.fromRandom("ed25519");
    const res = await fetch("https://helper.nearprotocol.com/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
    });
    if (!res.ok) throw new Error(`faucet said ${res.status}: ${await res.text()}`);

    const creds = { accountId, privateKey: key.toString() };
    fs.mkdirSync(path.dirname(CREDS), { recursive: true });
    fs.writeFileSync(CREDS, JSON.stringify(creds, null, 2));
    console.log(`created ${accountId}`);
    await new Promise(r => setTimeout(r, 3000));
    return creds;
}

async function main() {
    const arg = process.argv[2];
    const creds = await loadOrCreateAccount();
    const account = new Account(creds.accountId, provider, creds.privateKey);

    if (arg === "--lock") {
        const { keys } = await account.getAccessKeyList();
        for (const k of keys) {
            if (k.access_key.permission === "FullAccess") {
                await account.deleteKey(k.public_key);
                console.log(`deleted ${k.public_key}`);
            }
        }
        console.log(`${creds.accountId} is now locked. Nobody can change this contract.`);
        return;
    }

    if (!arg) throw new Error("usage: node scripts/deploy.mjs <wasm> | --lock");
    await account.deployContract(new Uint8Array(fs.readFileSync(arg)));
    console.log(`deployed ${arg} to ${creds.accountId}`);

    const config = await provider
        .callFunction({ contractId: creds.accountId, method: "get_config", args: {} })
        .catch(() => null);
    if (!config) {
        await account.callFunction({
            contractId: creds.accountId,
            methodName: "new",
            args: { mpc_contract: MPC, eth_chain_id: SEPOLIA },
            gas: teraToGas("30"),
        });
        console.log("initialized");
    }
    console.log(await provider.callFunction({ contractId: creds.accountId, method: "get_config", args: {} }));
    console.log(`\nput this in .env:\nREACT_APP_CONTRACT_ID=${creds.accountId}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
