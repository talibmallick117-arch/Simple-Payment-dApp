#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Tracker,
    TotalReceived(Address),
    PaymentCount(Address),
}

#[contract]
pub struct PaymentStatsContract;

#[contractevent(topics = ["stats"], data_format = "single-value")]
pub struct PaymentRecordedEvent {
    #[topic]
    recipient: Address,
    totals: (i128, u32),
}

#[contractimpl]
impl PaymentStatsContract {
    pub fn init(env: Env, tracker: Address) {
        if env.storage().instance().has(&DataKey::Tracker) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Tracker, &tracker);
    }

    pub fn record_payment(env: Env, recipient: Address, amount: i128) -> (i128, u32) {
        let total_key = DataKey::TotalReceived(recipient.clone());
        let count_key = DataKey::PaymentCount(recipient.clone());
        let next_total = Self::total_received(env.clone(), recipient.clone()) + amount;
        let next_count = Self::payment_count(env.clone(), recipient.clone()) + 1;

        env.storage().persistent().set(&total_key, &next_total);
        env.storage().persistent().set(&count_key, &next_count);
        PaymentRecordedEvent {
            recipient,
            totals: (next_total, next_count),
        }
        .publish(&env);
        (next_total, next_count)
    }

    pub fn total_received(env: Env, recipient: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalReceived(recipient))
            .unwrap_or(0)
    }

    pub fn payment_count(env: Env, recipient: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PaymentCount(recipient))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn records_recipient_payment_stats() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentStatsContract, ());
        let client = PaymentStatsContractClient::new(&env, &contract_id);
        let tracker = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.init(&tracker);
        assert_eq!(client.record_payment(&recipient, &50), (50, 1));
        assert_eq!(client.record_payment(&recipient, &75), (125, 2));
        assert_eq!(client.total_received(&recipient), 125);
        assert_eq!(client.payment_count(&recipient), 2);
    }
}
