import { task, types } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";

// Helper function to load the content of MJVS.env file.
export function loadMJVSenv(): void {
  const envFilePath = path.resolve(__dirname, "..", "MJVS.env");

  if (!fs.existsSync(envFilePath)) {
    console.warn(
      "Could not find MJVS.env, please run 'npx hardhat task:deploy_mjvs' to deploy contract and create the .env file.",
    );
    process.exit(1);
  }

  dotenv.config({ path: envFilePath });
}

task("task:deploy_mjvs", "Deploys the MJVS contract").setAction(async function (_taskArguments: TaskArguments, hre) {
  console.log("Deploying MJVS_POC contract.");
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const MJVSFactory = await ethers.getContractFactory("MJVS_POC");
  const MJVSContract = await MJVSFactory.connect(deployer).deploy();
  await MJVSContract.deploymentTransaction()?.wait();
  const MJVSContractAddress = await MJVSContract.getAddress();

  const envFilePath = path.resolve(__dirname, "..", "MJVS.env");
  const fileContent = `MJVS_CONTRACT_ADDRESS=${MJVSContractAddress}`;
  fs.writeFileSync(envFilePath, fileContent);
  console.log(`Contract deployed at : ${MJVSContractAddress}`);
});

task("task:create_election", "Creates a new election on the contract.")
  .addParam("candidatenumber", "The number of candidates to this new election.", 1, types.int)
  .addParam("label", "The label of this new election", "", types.string)
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    loadMJVSenv();
    const contractAddress = process.env.MJVS_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("MJVS_CONTRACT_ADDRESS is not defined in MJVS.env");
    }
    const { ethers } = hre;
    const signers = await ethers.getSigners();
    const signer = signers[0];
    const mjvsContract = await ethers.getContractAt("MJVS_POC", contractAddress, signer);

    console.log(
      `Creating a new election with ${_taskArguments.candidatenumber} candidates and labeled : ${_taskArguments.label}.`,
    );

    const eventPromise: Promise<{
      blockNumber: bigint;
      electionOwner: string;
      electionLabel: string;
      electionId: bigint;
    }> = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for newElection event"));
      }, 60000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void mjvsContract.once(mjvsContract.filters.newElection(), (event: any) => {
        clearTimeout(timeout);

        const { blockNumber, electionOwner, electionLabel, electionId } = event.args;

        resolve({
          blockNumber,
          electionOwner,
          electionLabel,
          electionId,
        });
      });
    });

    const createElectionTx = await mjvsContract.createElection(_taskArguments.candidatenumber, _taskArguments.label);
    const { blockNumber, electionId } = await eventPromise;
    const createElectionReceipt = await createElectionTx.wait();

    if (!createElectionReceipt?.status) {
      throw new Error("Create election Tx failed.");
    }

    console.log(`Create election tx status : ${createElectionReceipt?.status}`);

    console.log(`Election created, ID: ${electionId}, Block number: ${blockNumber}`);

    console.log("Done");
  });

task("task:change_voting_state", "Change the voting state for the given election.")
  .addParam("electionid", "The target election ID.", undefined, types.int, false)
  .addParam("state", "The new voting state.", undefined, types.boolean, false)
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    loadMJVSenv();
    const contractAddress = process.env.MJVS_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("MJVS_CONTRACT_ADDRESS is not defined in MJVS.env");
    }
    const { ethers } = hre;
    const signers = await ethers.getSigners();
    const signer = signers[0];
    const mjvsContract = await ethers.getContractAt("MJVS_POC", contractAddress, signer);

    console.log(`Setting voting state on election ${_taskArguments.electionid} to ${_taskArguments.state}.`);

    const setVotingStateTx = await mjvsContract.setVotingState(_taskArguments.electionid, _taskArguments.state);
    const setVotingStateReceipt = await setVotingStateTx.wait();

    if (!setVotingStateReceipt?.status) {
      throw new Error("Set voting state Tx failed (Are you sure you are the owner of this election?).");
    }

    console.log(`Change voting state tx status : ${setVotingStateReceipt?.status}`);

    console.log("Done");
  });

task("task:random_vote", "Sends random votes to selected election.")
  .addParam("electionid", "The target election ID.", undefined, types.int, false)
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    loadMJVSenv();
    const contractAddress = process.env.MJVS_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("MJVS_CONTRACT_ADDRESS is not defined in MJVS.env");
    }
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();
    const signers = await ethers.getSigners();
    const signer = signers[0];
    const mjvsContract = await ethers.getContractAt("MJVS_POC", contractAddress, signer);

    const candidateNumber = await mjvsContract.getCandidateNumber(_taskArguments.electionid);

    const gradeValues = [1, 2, 4, 8, 16, 32, 64];
    const gradeLabels = ["Excellent", "VGood", "Good", "Medium", "Bad", "VBad", "Awful"];
    const grades = [];

    console.log(`Election ${_taskArguments.electionid} have ${candidateNumber} candidates.`);
    console.log("Generating random votes.");

    for (let i = 0; i < candidateNumber; i++) {
      const currentGrade = gradeValues[Math.floor(Math.random() * gradeValues.length)];
      grades.push(currentGrade);
      const label = gradeLabels[gradeValues.indexOf(currentGrade)];
      console.log(`Candidate ${i} grade : ${label}`);
    }

    console.log("Encrypting parameters...");

    const clearParams = await fhevm.createEncryptedInput(contractAddress, signer.address);
    for (let i = 0; i < grades.length; i++) {
      clearParams.add8(grades[i]);
    }

    const encryptedParams = await clearParams.encrypt();
    const voteTx = await mjvsContract.vote(
      _taskArguments.electionid,
      encryptedParams.handles,
      encryptedParams.inputProof,
    );
    const voteReceipt = await voteTx.wait();

    if (!voteReceipt?.status) {
      throw new Error("Vote Tx failed.");
    }

    console.log(`Vote tx status : ${voteReceipt?.status}`);

    console.log("Done");
  });

task("task:decrypt_election", "Decrypts the result of the target election.")
  .addParam("electionid", "The target election ID.", undefined, types.int, false)
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    loadMJVSenv();
    const contractAddress = process.env.MJVS_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("MJVS_CONTRACT_ADDRESS is not defined in MJVS.env");
    }
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();
    const signers = await ethers.getSigners();
    const signer = signers[0];
    const mjvsContract = await ethers.getContractAt("MJVS_POC", contractAddress, signer);

    const candidateNumber = await mjvsContract.getCandidateNumber(_taskArguments.electionid);

    for (let i = 0; i < candidateNumber; i++) {
      const eventPromise: Promise<{
        blockNumber: bigint;
        electionId: bigint;
        candidateId: bigint;
      }> = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for voteDecrypted event"));
        }, 180_000);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void mjvsContract.once(mjvsContract.filters.voteDecrypted(), (event: any) => {
          clearTimeout(timeout);

          const { blockNumber, electionId, candidateId } = event.args;

          resolve({
            blockNumber,
            electionId,
            candidateId,
          });
        });
      });

      const reqResultTx = await mjvsContract.requestResult(_taskArguments.electionid, i);
      const reqResultReceipt = await reqResultTx.wait();

      if (!reqResultReceipt?.status) {
        throw new Error(`Request result tx for candidate ${i + 1} on election ${_taskArguments.electionid} failed.`);
      }

      console.log(
        `Request result tx status for candidate ${i + 1} on election ${_taskArguments.electionid} : ${reqResultReceipt?.status}`,
      );

      console.log("Waiting for the KMS to decrypt values...");
      await fhevm.awaitDecryptionOracle();
      const { blockNumber, electionId, candidateId } = await eventPromise;
      console.log(
        `Decryption request fulfilled for candidate ${candidateId} on election ${electionId}. (blockNumber : ${blockNumber})`,
      );
    }

    console.log("Done");
  });

task("task:get_election_results", "Retrieves decrypted election results.")
  .addParam("electionid", "The target election ID.", undefined, types.int, false)
  .setAction(async function (_taskArguments: TaskArguments, hre) {
    loadMJVSenv();
    const contractAddress = process.env.MJVS_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("MJVS_CONTRACT_ADDRESS is not defined in MJVS.env");
    }
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();
    const signers = await ethers.getSigners();
    const signer = signers[0];
    const mjvsContract = await ethers.getContractAt("MJVS_POC", contractAddress, signer);

    const candidateNumber = await mjvsContract.getCandidateNumber(_taskArguments.electionid);

    for (let i = 0; i < candidateNumber; i++) {
      const result = await mjvsContract.getCandidateResult(_taskArguments.electionid, i);
      const [Excellent, VGood, Good, Medium, Bad, VBad, Awful] = result;
      const totalVotes = Excellent + VGood + Good + Medium + Bad + VBad + Awful;
      console.log(
        `Results for candidate ${i + 1} (${totalVotes} votes) : \n\t\tExcellent :${Excellent}\n\t\tVGood :${VGood}\n\t\tGood : ${Good}\n\t\tMedium: ${Medium}\n\t\tBad : ${Bad}\n\t\tVBad : ${VBad}\n\t\tAwful : ${Awful}`,
      );
    }
  });
