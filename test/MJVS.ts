import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { generateChart } from "../utils/Chart";

describe("MJVS Tests", function () {
  before(async function () {
    this.signers = await ethers.getSigners();
  });

  let log_str = "";

  it("Should deploy the Voting contract", async function () {
    const MJVSFactory = await ethers.getContractFactory("MJVS_POC", this.signers[0]);
    const voteContract = await MJVSFactory.deploy(2);
    await voteContract.waitForDeployment();
    this.voteContract = voteContract;
    log_str = "Vote contract address : " + voteContract.target.toString();
    log(log_str, "deploy vote contract");

    //eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expect(await voteContract.getAddress()).to.be.properAddress;
  });

  it("Should open voting", async function () {
    const openVoteTx = await this.voteContract.setVotingState(true);
    const openVoteReceipt = await openVoteTx.wait();

    log_str = "Open voting tx status : " + parseInt(openVoteReceipt.status).toString();
    log(log_str, "open voting");

    expect(openVoteReceipt.status).to.equal(1);
  });

  it("should generate 15 random votes", async function () {
    /**
     * Vote grade and values for uint8 :
     * 0	00000001	1
     * 1	00000010	2
     * 2	00000100	4
     * 3	00001000	8
     * 4	00010000	16
     * 5	00100000	32
     * 6	01000000	64
     */

    /**
     * Candidate 0 : MEDIUM -> 0001000 -> 8
     * Candidate 1 : VGOOD -> 0100000 -> 32
     */

    const grades = [1, 2, 4, 8, 16, 32, 64];
    const gradeLabels = ["Excellent", "VGood", "Good", "Medium", "Bad", "VBad", "Awful"];

    const voteCounts0: Record<string, number> = {};
    const voteCounts1: Record<string, number> = {};
    for (const label of gradeLabels) {
      voteCounts0[label] = 0;
      voteCounts1[label] = 0;
    }

    for (let i = 0; i < 15; i++) {
      const randomVote0 = grades[Math.floor(Math.random() * grades.length)];
      const randomVote1 = grades[Math.floor(Math.random() * grades.length)];

      const contractInstance = this.voteContract.connect(this.signers[i]);
      const voteInput = await fhevm.createEncryptedInput(contractInstance.target.toString(), this.signers[i].address);
      voteInput.add8(randomVote0);
      voteInput.add8(randomVote1);
      const encryptedVote = await voteInput.encrypt();

      const voteTx = await contractInstance.vote(
        [encryptedVote.handles[0], encryptedVote.handles[1]],
        encryptedVote.inputProof,
      );
      const voteReceipt = await voteTx.wait();

      log_str = `Vote ${i + 1} status : ${voteReceipt.status}`;
      log(log_str, "random votes");

      const label0 = gradeLabels[grades.indexOf(randomVote0)];
      const label1 = gradeLabels[grades.indexOf(randomVote1)];

      voteCounts0[label0]++;
      voteCounts1[label1]++;

      expect(voteReceipt.status).to.equal(1);
    }

    console.log("");
    log_str = "Random vote summary :";
    log(log_str, "random votes");

    log_str = "Candidate 0 :";
    log(log_str, "random votes");

    for (const label of gradeLabels) {
      log_str = `  ${label}: ${voteCounts0[label]}`;
      log(log_str, "random votes");
    }
    console.log("");

    log_str = "Candidate 1 :";
    log(log_str, "random votes");

    for (const label of gradeLabels) {
      log_str = `  ${label}: ${voteCounts1[label]}`;
      log(log_str, "random votes");
    }
  });

  it("it should send 5 illicit votes per candidate", async function () {
    //The user vote can be illegal, ie having multiple 1s => 00110000 (48 -> will count as 1 good and 1 medium).
    for (let i = 0; i < 5; i++) {
      const contractInstance = this.voteContract.connect(this.signers[15 + i]);
      const voteInput = await fhevm.createEncryptedInput(
        contractInstance.target.toString(),
        this.signers[15 + i].address,
      );
      voteInput.add8(64);
      voteInput.add8(16);
      const encryptedVote = await voteInput.encrypt();

      const voteTx = await contractInstance.vote(
        [encryptedVote.handles[0], encryptedVote.handles[1]],
        encryptedVote.inputProof,
      );
      const voteReceipt = await voteTx.wait();

      log_str = `Illicit Vote ${i + 1} status : ${voteReceipt.status}`;
      log(log_str, "illicit votes");

      expect(voteReceipt.status).to.equal(1);
    }
  });

  it("Should revert a second vote attempt with signer 0", async function () {
    const voteInput = await fhevm.createEncryptedInput(this.voteContract.target.toString(), this.signers[0].address);
    voteInput.add8(48);
    voteInput.add8(48);
    const encryptedVote = await voteInput.encrypt();

    await expect(
      this.voteContract.vote([encryptedVote.handles[0], encryptedVote.handles[1]], encryptedVote.inputProof),
    ).to.be.revertedWith("This address have already voted.");
  });

  it("Should decrypt candidates scores", async function () {
    const candidateNumber = Number(await this.voteContract.candidateNumber());
    for (let i = 0; i < candidateNumber; i++) {
      const eventPromise = pollSpecificEvent(this.voteContract, "voteDecrypted", "decrypt candidates score");
      const reqResultTx = await this.voteContract.requestResult(i);
      const reqResultReceipt = await reqResultTx.wait();

      log_str = `Request result candidate ${i + 1} tx status : ${reqResultReceipt.status}`;
      log(log_str, "decrypt candidates score");

      await fhevm.awaitDecryptionOracle();
      await eventPromise;
    }
  });

  it("Should display the decrypted results", async function () {
    const candidateNumber = Number(await this.voteContract.candidateNumber());
    const voteNumber = Number(await this.voteContract.voteCount());
    const total_scores = [];
    let trueVoteCount = 0;

    for (let i = 0; i < candidateNumber; i++) {
      trueVoteCount = 0;
      const result = await this.voteContract.result(i);
      const [Excellent, VGood, Good, Medium, Bad, VBad, Awful] = result;
      const candidateGrades = [
        Number(Excellent),
        Number(VGood),
        Number(Good),
        Number(Medium),
        Number(Bad),
        Number(VBad),
        Number(Awful),
      ];
      total_scores.push(candidateGrades);
      log_str = `Results for candidate ${i + 1} : \n\t\tExcellent :${Excellent}\n\t\tVGood :${VGood}\n\t\tGood : ${Good}\n\t\tMedium: ${Medium}\n\t\tBad : ${Bad}\n\t\tVBad : ${VBad}\n\t\tAwful : ${Awful}`;
      log(log_str, "display decrypted scores");
      for (let i = 0; i < candidateGrades.length; i++) {
        trueVoteCount += candidateGrades[i];
      }
      log_str = `Number of true (licit) votes for this candidate : ${trueVoteCount}`;
      log(log_str, "display decrypted scores");
      console.log("");
    }
    log_str = `Total number of votes (including illicit votes) : ${voteNumber}`;
    log(log_str, "display decrypted scores");

    //Here we use true vote count to have a matching scale on the chart.
    //If we were using voteNumber, we would be representing 30 votes in a scale where 100% would represent 32 votes.
    await generateChart(total_scores, trueVoteCount);
  });
});

const log = (message: string, scope: string) => {
  const log_str = `\t[DEBUG] (${scope}) : ${message}`;
  console.log(log_str);
};

/**
 * Polls for a specific event emitted by the contract, returning true if the event is emitted, otherwise false.
 * @param contract The ethers.js Contract instance.
 * @param eventName The name of the event to listen for.
 * @param pollInterval The interval in milliseconds to poll for new events.
 * @returns A Promise that resolves to true if the event was emitted, otherwise false.
 */
async function pollSpecificEvent(
  contract: ethers.Contract,
  eventName: string,
  scope: string,
  pollInterval: number = 5000,
): Promise<any> {
  let lastBlockNumber = await ethers.provider.getBlockNumber(); // Start from the latest block
  let log_str = "";

  return new Promise<any[]>((resolve) => {
    // Set a timeout to stop the polling after 40 seconds
    const timeout = setTimeout(() => {
      log_str = `Timeout: Event '${eventName}' was not emitted within 180 seconds`;
      log(log_str, scope);
      clearInterval(pollingInterval); // Stop polling
      resolve(null); // Resolve with null since the event was not emitted in the given time
    }, 180000);

    // Set an interval to poll for the specific event
    const pollingInterval = setInterval(async () => {
      try {
        const currentBlockNumber = await ethers.provider.getBlockNumber();

        if (currentBlockNumber > lastBlockNumber) {
          // Fetch all events emitted since the last polled block
          const logs = await ethers.provider.getLogs({
            address: contract.target,
            fromBlock: lastBlockNumber + 1, // Start from the block after the last checked one
            toBlock: currentBlockNumber,
          });

          const param_names = [];
          const param_values = [];

          // Iterate over logs and filter for the specified event
          for (const log_entry of logs) {
            const parsedLog = contract.interface.parseLog(log_entry);
            if (parsedLog && parsedLog.name === eventName) {
              parsedLog.fragment.inputs.forEach((value, index) => {
                param_names.push(value.name);
              });

              parsedLog.args.forEach((value, index) => {
                param_values.push(value);
              });

              let display_str = `Event triggered: ${parsedLog.name} \n`;

              for (let i = 0; i < param_names.length; i++) {
                if (param_names[i] != "") {
                  display_str += "\t\t" + param_names[i] + " = " + param_values[i] + "\n";
                }
              }

              log(display_str, scope);

              // Resolve the promise with the parameter values
              clearTimeout(timeout); // Clear the timeout
              clearInterval(pollingInterval); // Stop polling
              resolve(param_values); // Resolve with the parameter values
              return;
            }
          }

          // Update the last block number
          lastBlockNumber = currentBlockNumber;
        }
      } catch (error) {
        console.error("Error polling events:", error);
        clearTimeout(timeout); // Clear the timeout in case of error
        clearInterval(pollingInterval); // Stop polling in case of error
        resolve(null); // Resolve with null in case of an error
      }
    }, pollInterval);
  });
}
