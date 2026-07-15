#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    Env, String, Vec,
};

#[contractclient(name = "TokenClient")]
pub trait Token {
    fn transfer(from: Address, to: Address, amount: i128);
}

#[contractclient(name = "PaymentStatsClient")]
pub trait PaymentStats {
    fn record_payment(recipient: Address, amount: i128) -> (i128, u32);
}

#[derive(Clone)]
#[contracttype]
pub struct PaymentBatch {
    pub id: u64,
    pub sender: Address,
    pub token: Address,
    pub stats_contract: Address,
    pub memo: String,
    pub total_amount: i128,
    pub recipient_count: u32,
    pub sent_count: u32,
    pub failed_count: u32,
    pub refunded: bool,
    pub funded: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum PaymentStatus {
    Pending,
    Sent,
    Failed,
    Refunded,
}

#[derive(Clone)]
#[contracttype]
pub struct RecipientPayment {
    pub batch_id: u64,
    pub index: u32,
    pub recipient: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub note: String,
}

#[contracttype]
pub enum DataKey {
    NextId,
    Batch(u64),
    Recipient(u64, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TrackerError {
    MissingBatch = 1,
    Unauthorized = 2,
    AlreadyFunded = 3,
    NotFunded = 4,
    AlreadyFinal = 5,
    InvalidInput = 6,
    MissingRecipient = 7,
    AlreadyRefunded = 8,
}

#[contractevent(topics = ["batch", "created"], data_format = "single-value")]
pub struct BatchCreatedEvent {
    id: u64,
}

#[contractevent(topics = ["batch", "funded"], data_format = "single-value")]
pub struct BatchFundedEvent {
    id: u64,
}

#[contractevent(topics = ["pay", "sent"], data_format = "single-value")]
pub struct PaymentSentEvent {
    #[topic]
    id: u64,
    #[topic]
    index: u32,
    tx_ref: String,
}

#[contractevent(topics = ["pay", "failed"], data_format = "single-value")]
pub struct PaymentFailedEvent {
    #[topic]
    id: u64,
    #[topic]
    index: u32,
    reason: String,
}

#[contractevent(topics = ["batch", "refunded"], data_format = "single-value")]
pub struct BatchRefundedEvent {
    payout: (u64, i128),
}

#[contract]
pub struct PaymentTrackerContract;

#[contractimpl]
impl PaymentTrackerContract {
    pub fn create_batch(
        env: Env,
        sender: Address,
        token: Address,
        stats_contract: Address,
        memo: String,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<u64, TrackerError> {
        sender.require_auth();
        if recipients.len() == 0 || recipients.len() != amounts.len() {
            return Err(TrackerError::InvalidInput);
        }

        let id = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(1_u64);
        let mut total = 0_i128;
        let mut index = 0_u32;
        while index < recipients.len() {
            let amount = amounts.get(index).unwrap();
            if amount <= 0 {
                return Err(TrackerError::InvalidInput);
            }
            total += amount;
            let payment = RecipientPayment {
                batch_id: id,
                index,
                recipient: recipients.get(index).unwrap(),
                amount,
                status: PaymentStatus::Pending,
                note: String::from_str(&env, ""),
            };
            env.storage()
                .persistent()
                .set(&DataKey::Recipient(id, index), &payment);
            index += 1;
        }

        let batch = PaymentBatch {
            id,
            sender,
            token,
            stats_contract,
            memo,
            total_amount: total,
            recipient_count: recipients.len(),
            sent_count: 0,
            failed_count: 0,
            refunded: false,
            funded: false,
        };

        env.storage().persistent().set(&DataKey::Batch(id), &batch);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        BatchCreatedEvent { id }.publish(&env);
        Ok(id)
    }

    pub fn fund_batch(env: Env, id: u64) -> Result<(), TrackerError> {
        let mut batch = Self::get_batch(env.clone(), id)?;
        batch.sender.require_auth();
        if batch.funded {
            return Err(TrackerError::AlreadyFunded);
        }

        let token = TokenClient::new(&env, &batch.token);
        token.transfer(
            &batch.sender,
            &env.current_contract_address(),
            &batch.total_amount,
        );
        batch.funded = true;
        env.storage().persistent().set(&DataKey::Batch(id), &batch);
        BatchFundedEvent { id }.publish(&env);
        Ok(())
    }

    pub fn mark_sent(env: Env, id: u64, index: u32, tx_ref: String) -> Result<(), TrackerError> {
        let mut batch = Self::get_batch(env.clone(), id)?;
        batch.sender.require_auth();
        if !batch.funded {
            return Err(TrackerError::NotFunded);
        }
        if batch.refunded {
            return Err(TrackerError::AlreadyRefunded);
        }

        let mut payment = Self::get_payment(env.clone(), id, index)?;
        if payment.status != PaymentStatus::Pending {
            return Err(TrackerError::AlreadyFinal);
        }

        let token = TokenClient::new(&env, &batch.token);
        token.transfer(
            &env.current_contract_address(),
            &payment.recipient,
            &payment.amount,
        );
        let stats = PaymentStatsClient::new(&env, &batch.stats_contract);
        stats.record_payment(&payment.recipient, &payment.amount);

        payment.status = PaymentStatus::Sent;
        payment.note = tx_ref.clone();
        batch.sent_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Recipient(id, index), &payment);
        env.storage().persistent().set(&DataKey::Batch(id), &batch);
        PaymentSentEvent { id, index, tx_ref }.publish(&env);
        Ok(())
    }

    pub fn mark_failed(env: Env, id: u64, index: u32, reason: String) -> Result<(), TrackerError> {
        let mut batch = Self::get_batch(env.clone(), id)?;
        batch.sender.require_auth();
        let mut payment = Self::get_payment(env.clone(), id, index)?;
        if payment.status != PaymentStatus::Pending {
            return Err(TrackerError::AlreadyFinal);
        }

        payment.status = PaymentStatus::Failed;
        payment.note = reason.clone();
        batch.failed_count += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Recipient(id, index), &payment);
        env.storage().persistent().set(&DataKey::Batch(id), &batch);
        PaymentFailedEvent { id, index, reason }.publish(&env);
        Ok(())
    }

    pub fn refund_pending(env: Env, id: u64) -> Result<i128, TrackerError> {
        let mut batch = Self::get_batch(env.clone(), id)?;
        batch.sender.require_auth();
        if !batch.funded {
            return Err(TrackerError::NotFunded);
        }
        if batch.refunded {
            return Err(TrackerError::AlreadyRefunded);
        }

        let mut index = 0_u32;
        let mut refund = 0_i128;
        while index < batch.recipient_count {
            let mut payment = Self::get_payment(env.clone(), id, index)?;
            if payment.status == PaymentStatus::Pending {
                payment.status = PaymentStatus::Refunded;
                refund += payment.amount;
                env.storage()
                    .persistent()
                    .set(&DataKey::Recipient(id, index), &payment);
            }
            index += 1;
        }

        if refund > 0 {
            let token = TokenClient::new(&env, &batch.token);
            token.transfer(&env.current_contract_address(), &batch.sender, &refund);
        }
        batch.refunded = true;
        env.storage().persistent().set(&DataKey::Batch(id), &batch);
        BatchRefundedEvent {
            payout: (id, refund),
        }
        .publish(&env);
        Ok(refund)
    }

    pub fn get_batch(env: Env, id: u64) -> Result<PaymentBatch, TrackerError> {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(id))
            .ok_or(TrackerError::MissingBatch)
    }

    pub fn get_payment(env: Env, id: u64, index: u32) -> Result<RecipientPayment, TrackerError> {
        env.storage()
            .persistent()
            .get(&DataKey::Recipient(id, index))
            .ok_or(TrackerError::MissingRecipient)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, String};

    #[test]
    fn creates_and_reads_multi_address_batch() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentTrackerContract, ());
        let client = PaymentTrackerContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let token = Address::generate(&env);
        let stats = Address::generate(&env);
        let recipient_one = Address::generate(&env);
        let recipient_two = Address::generate(&env);
        let recipients = vec![&env, recipient_one.clone(), recipient_two.clone()];
        let amounts = vec![&env, 40_i128, 60_i128];

        let id = client.create_batch(
            &sender,
            &token,
            &stats,
            &String::from_str(&env, "July contractor payouts"),
            &recipients,
            &amounts,
        );
        let batch = client.get_batch(&id);
        let payment = client.get_payment(&id, &1);

        assert_eq!(id, 1);
        assert_eq!(batch.recipient_count, 2);
        assert_eq!(batch.total_amount, 100);
        assert_eq!(payment.recipient, recipient_two);
        assert_eq!(payment.status, PaymentStatus::Pending);
    }

    #[test]
    fn rejects_mismatched_recipients_and_amounts() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentTrackerContract, ());
        let client = PaymentTrackerContractClient::new(&env, &contract_id);

        let result = client.try_create_batch(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &String::from_str(&env, "Bad batch"),
            &vec![&env, Address::generate(&env)],
            &vec![&env, 10_i128, 20_i128],
        );

        assert_eq!(result, Err(Ok(TrackerError::InvalidInput)));
    }

    #[test]
    fn marks_individual_payment_failed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentTrackerContract, ());
        let client = PaymentTrackerContractClient::new(&env, &contract_id);
        let recipient = Address::generate(&env);
        let id = client.create_batch(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &String::from_str(&env, "One payout"),
            &vec![&env, recipient],
            &vec![&env, 25_i128],
        );

        client.mark_failed(&id, &0, &String::from_str(&env, "recipient KYC pending"));
        let payment = client.get_payment(&id, &0);

        assert_eq!(payment.status, PaymentStatus::Failed);
    }
}
