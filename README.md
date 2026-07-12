# Stellar Payment Tracker dApp

Production-style Stellar dApp for creating multi-address payment batches, funding them on-chain, tracking each recipient payment, updating payment status, recording recipient stats, and streaming live Soroban events into a responsive frontend.

## What This Submission Covers

- Advanced Soroban smart contracts with batch payments, typed statuses, refunds, authorization, events, and typed errors
- Inter-contract communication between `payment_tracker` and `payment_stats`
- Event streaming in the frontend through Stellar RPC event polling
- Mobile responsive React frontend with loading, empty, and error states
- Contract and frontend tests with 5+ meaningful cases
- CI pipeline for formatting, contract tests, frontend linting, frontend tests, and build
- Deployment workflow for Stellar testnet and Vercel/Netlify

## Architecture

```text
contracts/
  payment_tracker/   Main multi-address payment batch contract
  payment_stats/     Recipient payment totals called by payment_tracker
frontend/
  src/
    lib/stellar.ts   RPC event helpers
    App.tsx          Responsive payment tracking UI
.github/workflows/ci.yml
docs/
  SUBMISSION.md      Final checklist, screenshots, and demo links
```

## Smart Contract Flow

1. A sender creates a payment batch with a memo, token address, stats contract address, recipients, and amounts.
2. The sender funds the batch escrow.
3. The sender marks individual recipient payments as sent or failed.
4. Sent payments transfer tokens from the tracker contract to the recipient.
5. `payment_tracker` calls `payment_stats` to update recipient totals and counts.
6. Pending payments can be refunded back to the sender.
7. Batch and payment events are emitted for the frontend event stream.

## Local Setup

Install:

- Git
- Rust stable
- Stellar CLI
- Node.js 20+
- Visual Studio C++ Build Tools on Windows

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli
npm install
```

## Run Tests

```bash
cargo test --workspace
npm test --workspace frontend
```

Included tests cover:

- Payment stats records recipient totals and counts
- Tracker creates and reads multi-address batches
- Tracker rejects mismatched recipients and amounts
- Tracker marks an individual payment failed
- Frontend renders the Payment Tracker surface
- Frontend renders the empty payment event state

## Deploy Contracts

Configure testnet identity:

```bash
stellar keys generate deployer --network testnet --fund
```

Build and deploy:

```bash
cargo build --target wasm32v1-none --release
stellar contract deploy \
  --wasm target/wasm32v1-none/release/payment_stats.wasm \
  --source-account deployer \
  --network testnet \
  --alias payment_stats

stellar contract deploy \
  --wasm target/wasm32v1-none/release/payment_tracker.wasm \
  --source-account deployer \
  --network testnet \
  --alias payment_tracker
```

Initialize `payment_stats` with the deployed tracker contract address:

```bash
stellar contract invoke \
  --id payment_stats \
  --source-account deployer \
  --network testnet \
  -- init \
  --tracker CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB
```

Copy the resulting contract IDs into `frontend/.env.local`.

## Frontend

```bash
npm run dev --workspace frontend
```

Environment:

```env
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_PAYMENT_TRACKER_CONTRACT_ID=CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB
VITE_PAYMENT_STATS_CONTRACT_ID=CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM
```

## CI/CD

GitHub Actions runs on every push and pull request:

- Rust format and tests
- Frontend install, lint, build, and tests

The frontend can be deployed to Vercel or Netlify from the `frontend` directory.

## Submission Links

Fill these in after deployment:

- Public GitHub repository: https://github.com/talibmallick117-arch/Simple-Payment-dApp
- Live demo: 
- Vercel dashboard/project area: https://vercel.com/talibmallick117-7774s-projects
- Payment Tracker contract address: CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB
- Deployment network: Stellar Testnet
- Deployment transaction hash: 605260c75c44980fe4a9068c2b509e83d4066d4df9924ffa780e66fca2a4fcd6
- Payment Stats contract address: CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM
- Transaction hash: 2bebb5fa80111c499ab20f1bb866ec417d4019b67204223747f5b452449a978e
- Demo video:


