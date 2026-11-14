# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who already hold ETH or BTC and want it to reach the right people if they die or disappear. They know how to use a wallet but are not developers. Two supporting roles use the same app: guardians (trusted NEAR accounts who approve a release) and heirs (NEAR accounts who receive a share).

## Product Purpose

Zeltter is a crypto inheritance vault. One NEAR contract controls an Ethereum and a Bitcoin address per owner through NEAR Chain Signatures. The owner checks in on a schedule; if they stop, guardians can approve a release, a waiting period follows that the owner can still cancel, and then each heir can claim their share to the address the owner named. Success: the owner sets it up once, pings occasionally, and the money can only ever go to the named heirs.

## Positioning

No seed phrase is handed to anyone and no custodian holds keys. The release rules live in a public contract that builds the payout transaction itself, so guardians can only say "yes, start it" and can never redirect funds.

## Operating Context

- Owner: creates a vault (guardians, approval threshold, heirs with ETH address and % share, heartbeat, waiting period, heir fallback), funds the vault addresses, pings, can send ETH from the vault, can cancel a pending release.
- Guardian: sees vaults they guard, approves a release after a missed check-in.
- Heir: sees vaults they inherit from, can start a release alone after the longer fallback timer, claims ETH once the release is final.
- Runs on NEAR testnet, Sepolia, BTC testnet4 (hackathon build). Wallets via near-connect.

## Capabilities and Constraints

- Owner actions all count as a check-in. Editing guardians/heirs needs a full-access key (1 yoctoNEAR).
- Heir claims are ETH only; BTC address is shown and owner-spendable via the contract, but heir BTC claims are not built.
- 0.1 NEAR storage deposit on create, refunded on delete.
- Stack: Create React App + TypeScript + Tailwind 3, ethers, @hot-labs/near-connect.

## Brand Commitments

- Name: Zeltter (one spelling everywhere).
- Plain language for crypto holders; mechanism words (Chain Signatures, MPC) stay secondary.

## Evidence on Hand

- Live testnet contract `zeltter-59dbbe.testnet`, e2e script `scripts/e2e.mjs`.
- No users, testimonials, audits, or mainnet deployment exist. Never claim them.

## Product Principles

1. Money only goes where the owner wrote it down; the UI should make that feel obvious.
2. Alive-but-offline owners must always see how to stop a release and how long they have.
3. Every role sees only the one action that's available to them right now.
4. Say plainly what is not built yet rather than implying it.
