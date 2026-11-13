//! Just enough Ethereum to build an EIP-1559 transfer and hash it for signing.
//! The contract builds the transaction itself so a caller can't slip in a
//! different recipient than the one written in the plan.

use near_sdk::env;

pub fn parse_hex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).unwrap_or_else(|_| env::panic_str("bad hex"))
}

pub fn parse_address(s: &str) -> [u8; 20] {
    let bytes = parse_hex(s);
    if bytes.len() != 20 {
        env::panic_str("eth address must be 20 bytes");
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    out
}

pub fn is_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}

pub struct Eip1559 {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: [u8; 20],
    pub value: u128,
    pub data: Vec<u8>,
}

impl Eip1559 {
    /// keccak256(0x02 || rlp([chainId, nonce, maxPriority, maxFee, gas, to, value, data, accessList]))
    pub fn signing_hash(&self) -> [u8; 32] {
        let mut body = Vec::new();
        body.extend(rlp_uint(self.chain_id as u128));
        body.extend(rlp_uint(self.nonce as u128));
        body.extend(rlp_uint(self.max_priority_fee_per_gas));
        body.extend(rlp_uint(self.max_fee_per_gas));
        body.extend(rlp_uint(self.gas_limit as u128));
        body.extend(rlp_bytes(&self.to));
        body.extend(rlp_uint(self.value));
        body.extend(rlp_bytes(&self.data));
        body.extend(rlp_list_header(0)); // empty access list

        let mut out = vec![0x02];
        out.extend(rlp_list_header(body.len()));
        out.extend(body);
        env::keccak256_array(&out)
    }
}

fn rlp_uint(v: u128) -> Vec<u8> {
    let be = v.to_be_bytes();
    let first = be.iter().position(|b| *b != 0).unwrap_or(be.len());
    rlp_bytes(&be[first..])
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return vec![b[0]];
    }
    let mut out = len_prefix(b.len(), 0x80);
    out.extend_from_slice(b);
    out
}

fn rlp_list_header(len: usize) -> Vec<u8> {
    len_prefix(len, 0xc0)
}

fn len_prefix(len: usize, offset: u8) -> Vec<u8> {
    if len <= 55 {
        return vec![offset + len as u8];
    }
    let be = (len as u64).to_be_bytes();
    let first = be.iter().position(|b| *b != 0).unwrap();
    let mut out = vec![offset + 55 + (8 - first) as u8];
    out.extend_from_slice(&be[first..]);
    out
}
