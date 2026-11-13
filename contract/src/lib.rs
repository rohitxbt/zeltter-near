//! Zeltter inheritance contract.
//!
//! One NEAR account (this contract) controls an Ethereum and a Bitcoin address
//! per owner through Chain Signatures. The owner checks in on a schedule. If
//! they stop, guardians can approve a release to the heirs named in the plan,
//! and after a waiting period (which the owner can still cancel) each heir can
//! get a signed transfer of their share.
//!
//! Who can do what:
//! - owner: anything while alive. Every owner call counts as a check-in and
//!   cancels a pending release.
//! - guardians: approve a release, report a balance. They can never pick where
//!   money goes.
//! - heirs: start a release on their own after a much longer silence (in case
//!   the guardians are gone), and claim their share once the release is final.

mod eth;

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

/// Covers storage for one plan (bounded by MAX_GUARDIANS / MAX_HEIRS).
/// Returned when the owner deletes the plan.
const PLAN_DEPOSIT: NearToken = NearToken::from_millinear(100);
const MAX_GUARDIANS: usize = 10;
const MAX_HEIRS: usize = 10;
const MIN_TIMER_SECS: u64 = 60;
const SIGN_GAS: Gas = Gas::from_tgas(150);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Plans,
    Watching,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Heir {
    pub account: AccountId,
    /// Where this heir's ETH goes. Fixed by the owner, nobody else can change it.
    pub eth_address: String,
    /// Share of the released balance in basis points. All heirs add up to 10000.
    pub share_bps: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Approval {
    pub guardian: AccountId,
    pub eth_balance_wei: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Release {
    pub started_at: u64,
    pub release_at: u64,
    pub started_by_heirs: bool,
    /// Lowest balance anyone reported. Heir shares are computed from this.
    pub eth_balance_wei: U128,
}

/// What the MPC signer returns for secp256k1 (the "scheme" tag is ignored).
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AffinePoint {
    pub affine_point: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Scalar {
    pub scalar: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct MpcSignature {
    pub big_r: AffinePoint,
    pub s: Scalar,
    pub recovery_id: u8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct EthClaim {
    pub heir: AccountId,
    pub nonce: u64,
    pub value_wei: U128,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub gas_limit: u64,
    /// Hash that was sent to the MPC signer, hex.
    pub payload: String,
    /// MPC signature. Anyone can read it and broadcast the tx.
    pub signature: Option<MpcSignature>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Plan {
    pub owner: AccountId,
    pub guardians: Vec<AccountId>,
    pub threshold: u8,
    pub heirs: Vec<Heir>,
    pub inactivity_secs: u64,
    pub waiting_secs: u64,
    /// Extra silence (after inactivity_secs) before heirs can start a release
    /// without guardians.
    pub heir_fallback_secs: u64,
    pub last_check_in: u64,
    pub approvals: Vec<Approval>,
    pub release: Option<Release>,
    pub eth_claims: Vec<EthClaim>,
}

#[near(serializers = [json])]
pub struct PlanView {
    #[serde(flatten)]
    pub plan: Plan,
    pub status: String,
    pub now: u64,
    pub eth_path: String,
    pub btc_path: String,
}

#[near(serializers = [json])]
pub struct PlanInput {
    pub guardians: Vec<AccountId>,
    pub threshold: u8,
    pub heirs: Vec<Heir>,
    pub inactivity_secs: u64,
    pub waiting_secs: u64,
    pub heir_fallback_secs: u64,
}

#[near(serializers = [json])]
pub struct EthTxInput {
    pub nonce: u64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
    pub gas_limit: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    mpc_contract: AccountId,
    eth_chain_id: u64,
    plans: LookupMap<AccountId, Plan>,
    /// guardian or heir -> owners whose plans they are in
    watching: LookupMap<AccountId, Vec<AccountId>>,
}

fn now() -> u64 {
    env::block_timestamp_ms() / 1000
}

impl Plan {
    pub fn status(&self, now: u64) -> &'static str {
        if let Some(r) = &self.release {
            return if now >= r.release_at { "released" } else { "pending" };
        }
        let silent_for = now.saturating_sub(self.last_check_in);
        if silent_for >= self.inactivity_secs + self.heir_fallback_secs {
            "heirs_can_start"
        } else if silent_for >= self.inactivity_secs {
            "missed_check_in"
        } else {
            "active"
        }
    }

    fn is_guardian(&self, a: &AccountId) -> bool {
        self.guardians.contains(a)
    }

    fn heir(&self, a: &AccountId) -> Option<&Heir> {
        self.heirs.iter().find(|h| &h.account == a)
    }

    /// Proof of life. Resets the timer and throws away approvals and any
    /// pending release.
    fn touch(&mut self) {
        require!(self.status(now()) != "released", "assets already released");
        if self.release.is_some() || !self.approvals.is_empty() {
            log!("release cancelled by owner");
        }
        self.last_check_in = now();
        self.approvals.clear();
        self.release = None;
    }

    fn start_release(&mut self, by_heirs: bool, balance: u128) {
        let t = now();
        self.release = Some(Release {
            started_at: t,
            release_at: t + self.waiting_secs,
            started_by_heirs: by_heirs,
            eth_balance_wei: U128(balance),
        });
        log!("release started, final at {}", t + self.waiting_secs);
    }
}

fn validate(owner: &AccountId, p: &PlanInput) {
    require!(!p.guardians.is_empty(), "need at least one guardian");
    require!(p.guardians.len() <= MAX_GUARDIANS, "too many guardians");
    require!(
        p.threshold >= 1 && (p.threshold as usize) <= p.guardians.len(),
        "threshold must be between 1 and the number of guardians"
    );
    require!(!p.heirs.is_empty() && p.heirs.len() <= MAX_HEIRS, "need 1 to 10 heirs");
    require!(!p.guardians.contains(owner), "owner can't be a guardian");

    let mut seen: Vec<&AccountId> = Vec::new();
    for g in &p.guardians {
        require!(!seen.contains(&g), "duplicate guardian");
        seen.push(g);
    }
    let mut total: u32 = 0;
    let mut heirs_seen: Vec<&AccountId> = Vec::new();
    for h in &p.heirs {
        require!(&h.account != owner, "owner can't be an heir");
        require!(!heirs_seen.contains(&&h.account), "duplicate heir");
        heirs_seen.push(&h.account);
        require!(eth::is_address(&h.eth_address), "bad heir eth address");
        require!(h.share_bps > 0, "heir share must be above zero");
        total += h.share_bps as u32;
    }
    require!(total == 10_000, "heir shares must add up to 100%");
    require!(
        p.inactivity_secs >= MIN_TIMER_SECS
            && p.waiting_secs >= MIN_TIMER_SECS
            && p.heir_fallback_secs >= MIN_TIMER_SECS,
        "timers must be at least 60 seconds"
    );
}

#[near]
impl Contract {
    #[init]
    pub fn new(mpc_contract: AccountId, eth_chain_id: u64) -> Self {
        Self {
            mpc_contract,
            eth_chain_id,
            plans: LookupMap::new(Key::Plans),
            watching: LookupMap::new(Key::Watching),
        }
    }

    // ---------------------------------------------------------------- owner

    #[payable]
    pub fn create_plan(&mut self, plan: PlanInput) {
        let owner = env::predecessor_account_id();
        require!(
            env::attached_deposit() >= PLAN_DEPOSIT,
            "attach 0.1 NEAR for storage, returned when the plan is deleted"
        );
        require!(self.plans.get(&owner).is_none(), "plan already exists");
        validate(&owner, &plan);

        let p = Plan {
            owner: owner.clone(),
            guardians: plan.guardians,
            threshold: plan.threshold,
            heirs: plan.heirs,
            inactivity_secs: plan.inactivity_secs,
            waiting_secs: plan.waiting_secs,
            heir_fallback_secs: plan.heir_fallback_secs,
            last_check_in: now(),
            approvals: vec![],
            release: None,
            eth_claims: vec![],
        };
        self.index(&p);
        self.plans.insert(owner.clone(), p);

        let extra = env::attached_deposit().saturating_sub(PLAN_DEPOSIT);
        if !extra.is_zero() {
            Promise::new(owner).transfer(extra);
        }
    }

    /// Change guardians, heirs or timers. Needs a full-access key (1 yocto),
    /// so a leaked check-in key can't rewrite the heirs.
    #[payable]
    pub fn update_plan(&mut self, plan: PlanInput) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach 1 yoctoNEAR");
        let owner = env::predecessor_account_id();
        validate(&owner, &plan);
        let mut p = self.plans.get(&owner).cloned().unwrap_or_else(|| env::panic_str("no plan"));
        p.touch();
        self.unindex(&p);
        p.guardians = plan.guardians;
        p.threshold = plan.threshold;
        p.heirs = plan.heirs;
        p.inactivity_secs = plan.inactivity_secs;
        p.waiting_secs = plan.waiting_secs;
        p.heir_fallback_secs = plan.heir_fallback_secs;
        self.index(&p);
        self.plans.insert(owner, p);
    }

    /// No deposit, so it works with the function-call key the wallet hands
    /// out at login. One click, no wallet popup.
    pub fn check_in(&mut self) {
        let owner = env::predecessor_account_id();
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        p.touch();
    }

    pub fn cancel_release(&mut self) {
        let owner = env::predecessor_account_id();
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        require!(p.status(now()) == "pending", "nothing pending to cancel");
        p.touch();
    }

    #[payable]
    pub fn delete_plan(&mut self) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "attach 1 yoctoNEAR");
        let owner = env::predecessor_account_id();
        let p = self.plans.get(&owner).cloned().unwrap_or_else(|| env::panic_str("no plan"));
        require!(p.status(now()) != "released", "released plans stay for the heirs");
        self.unindex(&p);
        self.plans.remove(&owner);
        Promise::new(owner).transfer(PLAN_DEPOSIT);
    }

    /// Owner spends from their own ETH address. Counts as a check-in.
    #[payable]
    pub fn owner_sign_eth(&mut self, to: String, value_wei: U128, data: String, tx: EthTxInput) -> Promise {
        let owner = env::predecessor_account_id();
        let chain_id = self.eth_chain_id;
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        p.touch();
        let hash = eth::Eip1559 {
            chain_id,
            nonce: tx.nonce,
            max_priority_fee_per_gas: tx.max_priority_fee_per_gas.0,
            max_fee_per_gas: tx.max_fee_per_gas.0,
            gas_limit: tx.gas_limit,
            to: eth::parse_address(&to),
            value: value_wei.0,
            data: eth::parse_hex(&data),
        }
        .signing_hash();
        self.sign(eth_path(&owner), hash)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed())
    }

    /// Owner signs a Bitcoin sighash from their BTC address. Counts as a check-in.
    #[payable]
    pub fn owner_sign_btc(&mut self, payload: String) -> Promise {
        let owner = env::predecessor_account_id();
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        p.touch();
        let bytes = eth::parse_hex(&payload);
        require!(bytes.len() == 32, "payload must be 32 bytes");
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&bytes);
        self.sign(btc_path(&owner), hash)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed())
    }

    // ------------------------------------------------------------ guardians

    pub fn approve_release(&mut self, owner: AccountId, eth_balance_wei: U128) {
        let me = env::predecessor_account_id();
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        require!(p.is_guardian(&me), "not a guardian of this plan");
        let st = p.status(now());
        require!(
            st == "missed_check_in" || st == "heirs_can_start",
            "owner is still checking in"
        );
        require!(!p.approvals.iter().any(|a| a.guardian == me), "already approved");
        p.approvals.push(Approval { guardian: me, eth_balance_wei });
        if p.approvals.len() >= p.threshold as usize {
            let lowest = p.approvals.iter().map(|a| a.eth_balance_wei.0).min().unwrap();
            p.start_release(false, lowest);
        }
    }

    /// While a release is pending, any guardian or heir can report the ETH
    /// balance they see. The lowest report wins, so nobody can inflate the
    /// number to take more than their share.
    pub fn report_balance(&mut self, owner: AccountId, eth_balance_wei: U128) {
        let me = env::predecessor_account_id();
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        require!(p.is_guardian(&me) || p.heir(&me).is_some(), "not in this plan");
        require!(p.status(now()) == "pending", "no pending release");
        let r = p.release.as_mut().unwrap();
        if eth_balance_wei.0 < r.eth_balance_wei.0 {
            r.eth_balance_wei = eth_balance_wei;
        }
    }

    // ---------------------------------------------------------------- heirs

    /// For when the guardians are gone. Only opens after inactivity plus the
    /// extra fallback time, and still has the same waiting period.
    pub fn start_heir_release(&mut self, owner: AccountId, eth_balance_wei: U128) {
        let me = env::predecessor_account_id();
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        require!(p.heir(&me).is_some(), "not an heir of this plan");
        require!(p.status(now()) == "heirs_can_start", "heirs can't start a release yet");
        p.start_release(true, eth_balance_wei.0);
    }

    /// Heir asks for a signed transfer of their share to the address the
    /// owner wrote down. Gas comes out of the share. Asking again with the
    /// same nonce re-signs (e.g. to bump gas); only one of them can land.
    #[payable]
    pub fn claim_eth(&mut self, owner: AccountId, tx: EthTxInput) -> Promise {
        require!(!env::attached_deposit().is_zero(), "attach at least 1 yoctoNEAR for the signer");
        let me = env::predecessor_account_id();
        let chain_id = self.eth_chain_id;
        let p = self.plans.get_mut(&owner).unwrap_or_else(|| env::panic_str("no plan"));
        require!(p.status(now()) == "released", "release is not final yet");
        let heir = p.heir(&me).cloned().unwrap_or_else(|| env::panic_str("not an heir of this plan"));

        let balance = p.release.as_ref().unwrap().eth_balance_wei.0;
        let share = balance / 10_000 * heir.share_bps as u128
            + balance % 10_000 * heir.share_bps as u128 / 10_000;
        let max_gas_cost = tx.max_fee_per_gas.0.saturating_mul(tx.gas_limit as u128);
        require!(share > max_gas_cost, "share is smaller than the gas cost");
        let value = share - max_gas_cost;

        if let Some(existing) = p.eth_claims.iter().find(|c| c.heir == me) {
            require!(existing.nonce == tx.nonce, "re-sign must use the same nonce as your first claim");
        } else {
            require!(
                !p.eth_claims.iter().any(|c| c.nonce == tx.nonce),
                "another heir already used this nonce"
            );
        }

        let hash = eth::Eip1559 {
            chain_id,
            nonce: tx.nonce,
            max_priority_fee_per_gas: tx.max_priority_fee_per_gas.0,
            max_fee_per_gas: tx.max_fee_per_gas.0,
            gas_limit: tx.gas_limit,
            to: eth::parse_address(&heir.eth_address),
            value,
            data: vec![],
        }
        .signing_hash();
        let payload = hex::encode(hash);

        let claim = EthClaim {
            heir: me.clone(),
            nonce: tx.nonce,
            value_wei: U128(value),
            max_fee_per_gas: tx.max_fee_per_gas,
            max_priority_fee_per_gas: tx.max_priority_fee_per_gas,
            gas_limit: tx.gas_limit,
            payload: payload.clone(),
            signature: None,
        };
        match p.eth_claims.iter_mut().find(|c| c.heir == me) {
            Some(c) => *c = claim,
            None => p.eth_claims.push(claim),
        }

        self.sign(eth_path(&owner), hash).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_claim_signed(owner, me, payload),
        )
    }

    // ------------------------------------------------------------ callbacks

    #[private]
    pub fn on_signed(&self) -> MpcSignature {
        signature_result()
    }

    #[private]
    pub fn on_claim_signed(&mut self, owner: AccountId, heir: AccountId, payload: String) -> MpcSignature {
        let sig = signature_result();
        if let Some(p) = self.plans.get_mut(&owner) {
            if let Some(c) = p.eth_claims.iter_mut().find(|c| c.heir == heir && c.payload == payload) {
                c.signature = Some(sig.clone());
            }
        }
        sig
    }

    // ---------------------------------------------------------------- views

    pub fn get_plan(&self, owner: AccountId) -> Option<PlanView> {
        self.plans.get(&owner).map(|p| PlanView {
            status: p.status(now()).to_string(),
            now: now(),
            eth_path: eth_path(&owner),
            btc_path: btc_path(&owner),
            plan: p.clone(),
        })
    }

    pub fn get_plans_for(&self, account: AccountId) -> Vec<AccountId> {
        self.watching.get(&account).cloned().unwrap_or_default()
    }

    pub fn get_config(&self) -> Value {
        json!({
            "mpc_contract": self.mpc_contract,
            "eth_chain_id": self.eth_chain_id,
            "plan_deposit": PLAN_DEPOSIT,
        })
    }
}

impl Contract {
    fn sign(&self, path: String, hash: [u8; 32]) -> Promise {
        let args = json!({
            "request": {
                "path": path,
                "payload_v2": { "Ecdsa": hex::encode(hash) },
                "domain_id": 0,
            }
        });
        Promise::new(self.mpc_contract.clone()).function_call(
            "sign".to_string(),
            serde_json::to_vec(&args).unwrap(),
            env::attached_deposit(),
            SIGN_GAS,
        )
    }

    fn members(p: &Plan) -> Vec<AccountId> {
        let mut out: Vec<AccountId> = p.guardians.clone();
        for h in &p.heirs {
            if !out.contains(&h.account) {
                out.push(h.account.clone());
            }
        }
        out
    }

    fn index(&mut self, p: &Plan) {
        for a in Self::members(p) {
            let mut list = self.watching.get(&a).cloned().unwrap_or_default();
            if !list.contains(&p.owner) {
                list.push(p.owner.clone());
            }
            self.watching.insert(a, list);
        }
    }

    fn unindex(&mut self, p: &Plan) {
        for a in Self::members(p) {
            if let Some(list) = self.watching.get_mut(&a) {
                list.retain(|o| o != &p.owner);
            }
        }
    }
}

fn eth_path(owner: &AccountId) -> String {
    format!("{}/eth", owner)
}

fn btc_path(owner: &AccountId) -> String {
    format!("{}/btc", owner)
}

fn signature_result() -> MpcSignature {
    let bytes = env::promise_result_checked(0, 1024)
        .unwrap_or_else(|_| env::panic_str("signing failed"));
    serde_json::from_slice(&bytes).unwrap_or_else(|_| env::panic_str("bad signer response"))
}

#[cfg(test)]
mod tests;
