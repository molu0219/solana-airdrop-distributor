# Solana SOL Claim Program

A high-performance, secure, and production-ready Solana program for distributing SOL to multiple addresses using a cumulative allocation system. Built with the **Anchor Framework**.

## 🌟 Key Features

*   **Cumulative State Tracking**: Supports multiple funding rounds. Users can claim their total allocation minus what they've already received.
*   **Security Pause Mechanism**: Provides an administrative "Emergency Stop" to halt all claim operations during maintenance or security incidents.
*   **Gas-Efficient Batch Processing**: Optimized for updating large lists of users in a single transaction.
*   **Full Tooling Suite**:
    - `set-claims`: A secure script that automates the "Pause -> Batch Update -> Unpause" workflow.
    - `check-status`: Generates real-time global and per-user distribution reports.
*   **Adversarial Verified**: Includes a comprehensive test suite simulating hack attempts, unauthorized access, and edge cases.

---

## 🚀 Getting Started

### Prerequisites

- [Rust & Cargo](https://www.rust-lang.org/tools/install)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18+)
- [Anchor Framework](https://www.anchor-lang.com/docs/installation) (v0.29+)
- Node.js & Yarn

### 1. Installation

```bash
yarn install
```

### 2. Deployment (Devnet/Testnet)

1.  **Configure Solana CLI**:
    ```bash
    solana config set --url devnet
    ```
2.  **Airdrop Test SOL**:
    ```bash
    solana airdrop 2
    ```
3.  **Deploy**:
    ```bash
    anchor build
    anchor deploy
    ```

---

## 🛠️ Management Workflow

### A. Setup Allocation List (CSV)
Edit `./claims.csv` with the following format:
```csv
address,amount
ADDR_1,1.5
ADDR_2,0.8
```

### B. Execute Secure Batch Update
Run the automated management script:
```bash
anchor run set-claims
```
*Note: This script automatically pauses the contract to ensure state consistency during the update.*

### C. Generate Audit Reports
To view global statistics and export all user data to `status_report.csv`:
```bash
anchor run check-status
```

---

## 🛡️ Security Verification

This project prioritizes asset safety. To run the full adversarial test suite (including attack simulations):

```bash
# Simulates unauthorized access, double-claiming, and pause-lock scenarios
anchor test
```

## 📝 License

This project is open-source and available under the MIT License.
