# Confidential Majority Judgment Voting System (FHEVM MJVS)

This repository showcases a **confidential on-chain voting system** based on the **Majority Judgment** method. It uses **Zama's Fully Homomorphic Encryption (FHEVM)** to protect voter privacy while enabling accurate, verifiable tallying on Ethereum-compatible blockchains.

> ⚠️ This project is a **technical proof-of-concept**. It is not intended for production use.

---

## Testnet address

Contract is deployed and available to test on Sepolia testnet. It's also verified on etherscan.
```
0x0D956C563bE7E6BEf1AC398D2F30720450333F47
```

https://sepolia.etherscan.io/address/0x0d956c563be7e6bef1ac398d2f30720450333f47#code

---

## Overview

- **Voting method:** [Majority Judgment](https://en.wikipedia.org/wiki/Majority_judgment)
- **Privacy mechanism:** [Zama's FHEVM](https://github.com/zama-ai/fhevm)

Votes are **encrypted locally**, processed **on-chain** in encrypted form, and only **aggregated results** are decrypted via Zama’s gateway.

---

## 🔐 How It Works: End-to-End Voting Flow

### 1. **Vote Preparation (Client-Side)**

Each voter:

- Assigns a **grade** to each candidate from: `Awful`, `Very Bad`, `Bad`, `Medium`, `Good`, `Very Good`, `Excellent`
- The grade is converted to **one-hot 7-bit representation**:

  ```
  Medium -> 0001000 -> Decimal 8
  ```
- Then encrypted using Zama’s FHEVM library:

  ```ts
  const voteInput = await fhevm.createEncryptedInput(contractAddress, voterAddress);
  voteInput.add8(8); // Medium
  const encryptedVote = await voteInput.encrypt();
  ```

### 2. **On-Chain Vote Submission**

Encrypted vote is submitted with a proof of correct encryption:

```ts
await voteContract.vote(
  electionId,
  encryptedVote.handles,
  encryptedVote.inputProof
);
```

### 3. **Encrypted Vote Aggregation**

- Each encrypted vote is **split into 7 binary flags** (for each grade).
- These encrypted bits are **added homomorphically** to encrypted grade counters per candidate:

```solidity
candidateScore[candidateId].Medium = FHE.add(candidateScore[candidateId].Medium, gradeArray[3]);
```

### 4. **Result Decryption**

- Only **aggregated totals** per grade and candidate are decrypted via the **Zama Gateway**.
- The decrypted values are written back on-chain via a callback.

### 5. **Public Results**

After decryption:

```text
Candidate 0:
  Excellent: 4
  Very Good: 6
  Medium: 10
  ...
```

**❌ Individual votes are never decrypted or accessible.**

---

## 🛡️ Fraud Detection

Votes must correspond to a single grade (i.e., a power of two). A valid vote must have exactly **one bit**.

### ✅ Valid Grades

| Grade     | Binary   | Decimal |
| --------- | -------- | ------- |
| Excellent | 00000001 | 1       |
| Very Good | 00000010 | 2       |
| Good      | 00000100 | 4       |
| Medium    | 00001000 | 8       |
| Bad       | 00010000 | 16      |
| Very Bad  | 00100000 | 32      |
| Awful     | 01000000 | 64      |

### ❌ Invalid Vote Example

- Vote = `00011000` (24)
- Corresponds to `Bad` **and** `Medium`

### Encrypted Check (in Solidity)

```solidity
//Underflow warning, FHE.sub is not currently underflow proof, fhevm 0.7
ebool underflowRisk = FHE.lt(userVote_, 1);
euint8 userVoteSafeSub = FHE.select(underflowRisk, FHE.asEuint8(0), FHE.sub(userVote_, 1));

//Check if userVote is a power of 2. If vote is valid (power of 2), then fraudFlag will be 0.
ebool fraudFlag = FHE.asEbool(FHE.and(userVote_, userVoteSafeSub));
euint8 safeVote = FHE.select(fraudFlag, FHE.asEuint8(0), userVote_);
return safeVote;
```

If `fraudFlag == true`, the vote is nullified (zero-weight).

---

## 🏆 Winner Selection (Majority Judgment)

### 1. **Tally Votes** per Grade

| Grade     | Count |     |
| --------- | ----- | --- |
| Excellent | 5     |     |
| Very Good | 7     |     |
| Good      | 10    |     |
| Medium    | 8     | ... |

### 2. **Determine Median Grade**

- Sort grades from best to worst
- Find the grade where **cumulative count** crosses half of total votes

### 3. **Compare Candidates**

- Candidate with **highest median** wins
- Tie? Use MJ tie-break (e.g., compare vote distributions above median)

---

## 🔹 Features

- ✔ End-to-end encrypted voting
- ✔ On-chain aggregation using FHE
- ✔ No vote decryption
- ✔ Public and verifiable tally after election ends
- ✔ Enforced fraud detection logic

---

## 🔧 Hardhat Tasks

Custom commands for interacting with the contract:
```bash
npx hardhat task:deploy_mjvs
npx hardhat task:create_election --candidatenumber 2 --label "My Election"
npx hardhat task:change_voting_state --electionid 0 --state true
npx hardhat task:random_vote --electionid 0
npx hardhat task:decrypt_election --electionid 0
npx hardhat task:get_election_results --electionid 0
```

---

## 🔮 Testing

Coverage includes:

- Contract deployment
- Election creation
- Random & illicit vote simulation
- Fraud rejection
- Result decryption
- Winner determination

To run:

```bash
npx hardhat test
```

---

## 👁️ Visual Output

A vote chart is generated during test execution:
<br />

<img src="./images/majority_judgment_chart.png" width=550>


---

## 📜 License

This project contains components under different licenses:

- Parts of this project are licensed under the **MIT License**, inherited from the original template.
- The original contributions in this repository (including the MJVS smart contract and test logic) are licensed under the **BSD 3-Clause Clear License**.

---

<br />
<br />
<br />
<br />




# FHEVM Hardhat Template

A FHEVM Hardhat-based template for developing Solidity smart contracts.

# Quick Start

- [FHEVM Hardhat Quick Start Tutorial](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial)

# Documentation

- [The FHEVM documentation](https://docs.zama.ai/fhevm)
- [How to set up a FHEVM Hardhat development environment](https://docs.zama.ai/protocol/solidity-guides/getting-started/setup)
- [Run the FHEVM Hardhat Template Tests](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/run_test)
- [Write FHEVM Tests using Hardhat](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/write_test)
- [FHEVM Hardhart Plugin](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat)
