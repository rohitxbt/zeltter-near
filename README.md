# Zeltter

Crypto inheritance on NEAR. If you die or vanish, your ETH (and BTC address) goes to the people you picked, and nobody else can touch it.

Built for the NEAR Hackathon, Open Innovation track.

Contract on testnet: [`zeltter-59dbbe.testnet`](https://testnet.nearblocks.io/address/zeltter-59dbbe.testnet)

## How it works

One NEAR contract controls an Ethereum address and a Bitcoin address for every owner, using NEAR Chain Signatures. You never hold a private key for those addresses. The contract asks the NEAR MPC network to sign, and only does so when the rules allow it.

1. You create a vault: pick guardians (NEAR accounts), how many of them must agree, your heirs (NEAR account + ETH address + % share) and three timers.
2. You fund the ETH/BTC addresses shown in the app. You can spend from them any time from the app.
3. You press PING now and then. Any action you take (ping, send, edit) counts as a check-in.
4. Miss the heartbeat timer and guardians can approve a release. When enough of them approve, a waiting period starts.
5. During the waiting period you can still cancel. One click and everything resets.
6. After the waiting period each heir clicks CLAIM. The contract builds an ETH transfer to that heir's address for their share, has it signed by MPC, and the app broadcasts it to Sepolia.

If the guardians are gone (lost keys, dead, not answering), heirs can start the release themselves, but only after a second, much longer timer ("heir fallback"). The same waiting period and owner cancel apply.

## The rules (all public)

Everything lives in the contract and can be read by anyone with `get_plan(owner)`:

- Guardians can only approve. They can't choose where money goes, and they can't claim.
- Heirs can only receive to the ETH address the owner wrote down. The contract builds the transaction itself, so a heir can't swap in another recipient or a bigger amount.
- An heir gets `share% x balance - gas`. The balance comes from what guardians/heirs reported when the release started. The lowest report wins, so nobody gains by inflating it.
- An heir can re-sign their claim (for example with more gas) but only with the same nonce, so at most one of those transactions can ever land.
- Changing guardians or heirs needs a full access key (1 yoctoNEAR deposit). A leaked check-in key can't rewrite your will.
- After the waiting period ends the owner can't cancel anymore. That's the point of the waiting period.

Contract: `contract/src/lib.rs`. The Ethereum transaction encoding is in `contract/src/eth.rs` and is tested against ethers.js output.

## Failure cases

**A guardian loses their keys.** Approval is M of N, so one lost guardian doesn't block anything as long as M are left. The owner can swap guardians at any time while alive. If too many are lost and the owner is gone, the heirs use the fallback path after the longer timer.

**A guardian turns hostile.** One guardian alone can't do anything unless the threshold is 1, so don't set it to 1 unless you trust that person completely. If enough guardians collude, the worst they can do is start the release early, and the money still only goes to your heirs. You get the whole waiting period to cancel. A hostile guardian could also report a balance that's too low, which makes heirs claim less than they should. The leftover stays at the address (see known gaps).

**The owner is alive but offline** (hospital, travel, lost phone). This is the one that hurts the most, so there are two layers. First, the heartbeat timer should be long (90 days is the default). Second, even after guardians approve, nothing moves until the waiting period ends, and any action from you during that time cancels it. Pick a waiting period you're sure you could get online within. Tell your guardians to contact you before approving.

**An heir loses their keys.** Their share is signed to their ETH address. If they lose the NEAR account they can't claim, and their share stays at the vault address. The owner should update heirs while alive.

**NEAR MPC network is down.** Nothing can be signed, by anyone, until it's back. Funds aren't lost, just stuck. This is a real dependency on NEAR's signer network.

**A bug in this contract.** It's a hackathon contract and it hasn't been audited. After deploying, the contract account's full access keys are deleted (`node scripts/deploy.mjs --lock`), so nobody (including me) can upgrade it to steal from it. It also means bugs can't be fixed in place.

## Known gaps

- BTC: the vault has a BTC address and the contract can sign BTC sighashes for the owner (`owner_sign_btc`), but heir claims are ETH only for now.
- Leftover ETH after all heirs claim (dust, or under-reported balance) has no claim path yet.
- No ERC-20 claims yet. The owner can still move tokens with `owner_sign_eth` (it takes calldata).
- Not legal advice. No court treats this as a will.

## Demo on testnet

Timers can be set in minutes, so the full flow takes about 10 minutes:

1. Owner creates a vault with heartbeat 2 min, waiting 2 min, fallback 5 min.
2. Send some Sepolia ETH to the vault's ETH address.
3. Wait 2 minutes without pinging. Guardians see APPROVE RELEASE.
4. Once enough guardians approve, the owner can cancel (try it), or let the 2 minutes pass.
5. Heirs click CLAIM ETH and get their share on Sepolia.

## Test it without a browser

```bash
node scripts/e2e.mjs zeltter-59dbbe.testnet
```

Makes fresh faucet accounts (owner, 2 guardians, 1 heir) and runs the whole thing with 60 second timers: owner signs an ETH tx, guardians try too early and get rejected, owner goes quiet, guardians approve, heir tries during the waiting period and gets rejected, owner tries to cancel too late and gets rejected, heir claims. Each MPC signature is checked to recover to the vault address. Takes about 3 minutes.

## Run it

```bash
npm install --legacy-peer-deps
npm start
```

Set `REACT_APP_CONTRACT_ID` in `.env` to the deployed contract.

The contract builds in GitHub Actions (`.github/workflows/contract.yml`): unit tests, then `cargo near build`. Download the wasm artifact and deploy:

```bash
node scripts/deploy.mjs zeltter.wasm   # creates a testnet account on first run, deploys, inits
node scripts/deploy.mjs --lock         # removes full access keys, no upgrades after this
```

## Stack

- Rust contract with near-sdk 5
- NEAR Chain Signatures (`v1.signer-prod.testnet`) for ETH/BTC keys
- React + Tailwind frontend, `@hot-labs/near-connect` for NEAR wallets, ethers for Sepolia
