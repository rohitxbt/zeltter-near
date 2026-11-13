use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const MIN: u64 = 60;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, secs: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("zeltter.testnet"))
        .predecessor_account_id(acc(who))
        .block_timestamp(secs * 1_000_000_000)
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .build());
}

fn plan_input() -> PlanInput {
    PlanInput {
        guardians: vec![acc("g1.testnet"), acc("g2.testnet"), acc("g3.testnet")],
        threshold: 2,
        heirs: vec![
            Heir { account: acc("h1.testnet"), eth_address: format!("0x{}", "11".repeat(20)), share_bps: 7_000 },
            Heir { account: acc("h2.testnet"), eth_address: format!("0x{}", "22".repeat(20)), share_bps: 3_000 },
        ],
        inactivity_secs: 5 * MIN,
        waiting_secs: 3 * MIN,
        heir_fallback_secs: 10 * MIN,
    }
}

fn setup() -> Contract {
    ctx("owner.testnet", 1_000, PLAN_DEPOSIT);
    let mut c = Contract::new(acc("v1.signer-prod.testnet"), 11155111);
    c.create_plan(plan_input());
    c
}

fn status(c: &Contract) -> String {
    c.get_plan(acc("owner.testnet")).unwrap().status
}

fn tx(nonce: u64) -> EthTxInput {
    EthTxInput {
        nonce,
        max_fee_per_gas: U128(10),
        max_priority_fee_per_gas: U128(1),
        gas_limit: 21_000,
    }
}

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const ZERO: NearToken = NearToken::from_yoctonear(0);

#[test]
fn eth_hash_matches_ethers() {
    ctx("x.testnet", 1, ZERO);
    let h = eth::Eip1559 {
        chain_id: 11155111,
        nonce: 7,
        max_priority_fee_per_gas: 1_500_000_000,
        max_fee_per_gas: 30_000_000_000,
        gas_limit: 21_000,
        to: [0x11; 20],
        value: 123_456_789_012_345_678,
        data: vec![],
    }
    .signing_hash();
    assert_eq!(hex::encode(h), "0bc67d1323f0e937168a93f77b979cc0c0972f62354469fe6fbde99ec12e2d11");

    // zero values and data longer than 55 bytes hit the other RLP branches
    let h = eth::Eip1559 {
        chain_id: 11155111,
        nonce: 0,
        max_priority_fee_per_gas: 0,
        max_fee_per_gas: 1,
        gas_limit: 60_000,
        to: [0x22; 20],
        value: 0,
        data: vec![0xab; 70],
    }
    .signing_hash();
    assert_eq!(hex::encode(h), "9999fd3342a6871c9ccb2e072239c2d941ee561ab45b57a207c557592c8a2d3e");
}

#[test]
fn timeline_and_statuses() {
    let c = setup();
    assert_eq!(status(&c), "active");
    ctx("anyone.testnet", 1_000 + 5 * MIN, ZERO);
    assert_eq!(status(&c), "missed_check_in");
    ctx("anyone.testnet", 1_000 + 15 * MIN, ZERO);
    assert_eq!(status(&c), "heirs_can_start");
}

#[test]
#[should_panic(expected = "owner is still checking in")]
fn guardians_cannot_approve_while_owner_active() {
    let mut c = setup();
    ctx("g1.testnet", 1_000 + 4 * MIN, ZERO);
    c.approve_release(acc("owner.testnet"), U128(1000));
}

#[test]
fn guardians_release_then_owner_cancels() {
    let mut c = setup();
    let t = 1_000 + 6 * MIN;
    ctx("g1.testnet", t, ZERO);
    c.approve_release(acc("owner.testnet"), U128(1_000_000));
    assert_eq!(status(&c), "missed_check_in"); // 1 of 2
    ctx("g2.testnet", t, ZERO);
    c.approve_release(acc("owner.testnet"), U128(900_000));
    assert_eq!(status(&c), "pending");
    let r = c.get_plan(acc("owner.testnet")).unwrap().plan.release.unwrap();
    assert_eq!(r.eth_balance_wei.0, 900_000); // lowest report

    ctx("owner.testnet", t + 2 * MIN, ZERO);
    c.cancel_release();
    assert_eq!(status(&c), "active");
    let p = c.get_plan(acc("owner.testnet")).unwrap().plan;
    assert!(p.approvals.is_empty() && p.release.is_none());
}

#[test]
#[should_panic(expected = "assets already released")]
fn owner_cannot_cancel_after_waiting_period() {
    let mut c = setup();
    let t = 1_000 + 6 * MIN;
    ctx("g1.testnet", t, ZERO);
    c.approve_release(acc("owner.testnet"), U128(1));
    ctx("g2.testnet", t, ZERO);
    c.approve_release(acc("owner.testnet"), U128(1));
    ctx("owner.testnet", t + 3 * MIN, ZERO);
    c.check_in();
}

#[test]
#[should_panic(expected = "already approved")]
fn guardian_cannot_approve_twice() {
    let mut c = setup();
    ctx("g1.testnet", 1_000 + 6 * MIN, ZERO);
    c.approve_release(acc("owner.testnet"), U128(1));
    c.approve_release(acc("owner.testnet"), U128(1));
}

#[test]
#[should_panic(expected = "not a guardian")]
fn heir_cannot_approve_as_guardian() {
    let mut c = setup();
    ctx("h1.testnet", 1_000 + 6 * MIN, ZERO);
    c.approve_release(acc("owner.testnet"), U128(1));
}

#[test]
#[should_panic(expected = "heirs can't start a release yet")]
fn heirs_wait_for_fallback() {
    let mut c = setup();
    ctx("h1.testnet", 1_000 + 10 * MIN, ZERO);
    c.start_heir_release(acc("owner.testnet"), U128(1));
}

#[test]
fn heirs_start_release_when_guardians_gone() {
    let mut c = setup();
    ctx("h2.testnet", 1_000 + 15 * MIN, ZERO);
    c.start_heir_release(acc("owner.testnet"), U128(5_000_000));
    assert_eq!(status(&c), "pending");
    // other heir lowers the number, raising it is ignored
    ctx("h1.testnet", 1_000 + 16 * MIN, ZERO);
    c.report_balance(acc("owner.testnet"), U128(4_000_000));
    c.report_balance(acc("owner.testnet"), U128(9_000_000));
    let r = c.get_plan(acc("owner.testnet")).unwrap().plan.release.unwrap();
    assert_eq!(r.eth_balance_wei.0, 4_000_000);
    assert!(r.started_by_heirs);
}

fn released(c: &mut Contract) -> u64 {
    let t = 1_000 + 6 * MIN;
    ctx("g1.testnet", t, ZERO);
    c.approve_release(acc("owner.testnet"), U128(10_000_000));
    ctx("g3.testnet", t, ZERO);
    c.approve_release(acc("owner.testnet"), U128(10_000_000));
    t + 3 * MIN
}

#[test]
fn heir_claim_goes_to_their_address_with_their_share() {
    let mut c = setup();
    let t = released(&mut c);
    ctx("h1.testnet", t, ONE_YOCTO);
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
    let claim = c.get_plan(acc("owner.testnet")).unwrap().plan.eth_claims[0].clone();
    // 70% of 10_000_000 minus 21000 gas * 10 wei
    assert_eq!(claim.value_wei.0, 7_000_000 - 210_000);
    assert_eq!(claim.heir, acc("h1.testnet"));
    let expected = eth::Eip1559 {
        chain_id: 11155111,
        nonce: 4,
        max_priority_fee_per_gas: 1,
        max_fee_per_gas: 10,
        gas_limit: 21_000,
        to: [0x11; 20],
        value: 7_000_000 - 210_000,
        data: vec![],
    }
    .signing_hash();
    assert_eq!(claim.payload, hex::encode(expected));

    // re-sign with the same nonce replaces, does not add
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
    assert_eq!(c.get_plan(acc("owner.testnet")).unwrap().plan.eth_claims.len(), 1);
}

#[test]
#[should_panic(expected = "same nonce")]
fn heir_cannot_double_claim_with_new_nonce() {
    let mut c = setup();
    let t = released(&mut c);
    ctx("h1.testnet", t, ONE_YOCTO);
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
    let _ = c.claim_eth(acc("owner.testnet"), tx(5));
}

#[test]
#[should_panic(expected = "another heir already used this nonce")]
fn heirs_cannot_share_a_nonce() {
    let mut c = setup();
    let t = released(&mut c);
    ctx("h1.testnet", t, ONE_YOCTO);
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
    ctx("h2.testnet", t, ONE_YOCTO);
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
}

#[test]
#[should_panic(expected = "release is not final yet")]
fn heir_cannot_claim_during_waiting_period() {
    let mut c = setup();
    let t = released(&mut c);
    ctx("h1.testnet", t - 1, ONE_YOCTO);
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
}

#[test]
#[should_panic(expected = "not an heir")]
fn guardian_cannot_claim() {
    let mut c = setup();
    let t = released(&mut c);
    ctx("g1.testnet", t, ONE_YOCTO);
    let _ = c.claim_eth(acc("owner.testnet"), tx(4));
}

#[test]
#[should_panic(expected = "attach 1 yoctoNEAR")]
fn changing_heirs_needs_full_access_key() {
    let mut c = setup();
    ctx("owner.testnet", 1_100, ZERO);
    c.update_plan(plan_input());
}

#[test]
#[should_panic(expected = "heir shares must add up to 100%")]
fn shares_must_add_up() {
    ctx("owner.testnet", 1_000, PLAN_DEPOSIT);
    let mut c = Contract::new(acc("v1.signer-prod.testnet"), 11155111);
    let mut p = plan_input();
    p.heirs[0].share_bps = 6_000;
    c.create_plan(p);
}

#[test]
fn guardians_and_heirs_can_find_the_plan() {
    let mut c = setup();
    assert_eq!(c.get_plans_for(acc("g2.testnet")), vec![acc("owner.testnet")]);
    assert_eq!(c.get_plans_for(acc("h1.testnet")), vec![acc("owner.testnet")]);
    let mut p = plan_input();
    p.guardians = vec![acc("g9.testnet")];
    p.threshold = 1;
    ctx("owner.testnet", 1_100, ONE_YOCTO);
    c.update_plan(p);
    assert!(c.get_plans_for(acc("g2.testnet")).is_empty());
    assert_eq!(c.get_plans_for(acc("g9.testnet")), vec![acc("owner.testnet")]);
}
