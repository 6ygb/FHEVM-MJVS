// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MJVS_POC is SepoliaConfig {
    // euint32 max : 4,294,967,295

    struct clearNotation {
        uint32 Excellent;
        uint32 VGood;
        uint32 Good;
        uint32 Medium;
        uint32 Bad;
        uint32 VBad;
        uint32 Awful;
    }

    struct Notation {
        euint32 Excellent;
        euint32 VGood;
        euint32 Good;
        euint32 Medium;
        euint32 Bad;
        euint32 VBad;
        euint32 Awful;
    }

    struct additionnalDecryptionParamsStruct {
        uint256 electionId;
        uint256 candidateId;
    }

    struct electionStruct {
        string label;
        bool votingOpen;
        uint256 voteCount;
        uint256 candidateNumber;
        mapping(uint256 candidateId => clearNotation score) result;
        mapping(uint256 candidateId => Notation score) candidateScore;
        mapping(address userAddress => bool hasVoted) voterStatus;
        address electionOwner;
    }

    uint256 private latestRequestId;
    bool public isDecryptionPending;
    uint256 electionNumber;

    mapping(uint256 eleciontId => electionStruct) private election;
    mapping(uint256 requestId => additionnalDecryptionParamsStruct) private additionalDecryptionParams;

    event voteDecrypted(uint256 blockNumber, uint256 eleciontId, uint256 candidateId);
    event newElection(uint256 blockNumber, address electionOwner, string electionLabel, uint256 electionId);

    /**
     * @dev Modifier to ensure voting is open.
     */
    modifier ensureVotingOpen(uint256 electionId) {
        require(election[electionId].votingOpen, "Voting is currently closed.");
        _;
    }

    /**
     * @dev Modifier to ensure that the voter has not voted yet.
     */
    modifier ensureHasNotVoted(uint256 electionId, address voterAddr) {
        require(!election[electionId].voterStatus[voterAddr], "This address has already voted.");
        _;
    }

    /**
     * @dev Modifier to ensure that the msg sender is owner of the current election.
     */
    modifier onlyElectionOwner(uint256 electionId, address targetAddr) {
        require(targetAddr == election[electionId].electionOwner, "You are not the owner of this election.");
        _;
    }

    function getVoteCount(uint256 electionId) public view returns (uint256) {
        return election[electionId].voteCount;
    }

    function getCandidateNumber(uint256 electionId) public view returns (uint256) {
        return election[electionId].candidateNumber;
    }

    function getCandidateResult(uint256 electionId, uint256 candidateId) public view returns (clearNotation memory) {
        return election[electionId].result[candidateId];
    }

    function createElection(uint256 candidateNumber, string calldata label_) public {
        uint256 currentElectionId = electionNumber;
        election[currentElectionId].electionOwner = msg.sender;
        election[currentElectionId].candidateNumber = candidateNumber;
        election[currentElectionId].label = label_;
        electionNumber++;

        emit newElection(block.number, msg.sender, label_, currentElectionId);
    }

    /**
     * @dev Allows the owner to modify the voting state of the election (open or close).
     * @param _state The state to set votingOpen on.
     */
    function setVotingState(uint256 electionId, bool _state) public onlyElectionOwner(electionId, msg.sender) {
        election[electionId].votingOpen = _state;
    }

    /**
     *
     * @param userVote_ the euint8 representing user grade for a given candidate
     */
    function fraudCheck(euint8 userVote_) internal returns (euint8) {
        //if user vote is 0, then it doesn't affect the candidate grade.
        //The user vote can be illegal, ie having multiple 1s => 00110000 (48 -> will count as 1 good and 1 medium).
        //We have to make sure the binary representation of the user vote contains only one "1".
        //If the vote is illegal, we return 0.
        //To detect fraud, we check that user vote is a power of 2 (only one "1" in the binary representation)
        //To do so we simply do n & (n - 1) where n is user vote
        //If the result is 0, the vote is licit, else it is not.
        /*
            n (binary)          n-1         n & (n - 1)
            00000001            00000000    00000000        licit
            00000010            00000001    00000000        licit
            00000011            00000010    00000010        illicit
            ...                 ...         ...             ...
            10000000            01111111    00000000        licit
            11111111            11111110    11111110        illicit
        */

        //Underflow warning, FHE.sub is not currently underflow proof, fhevm 0.7
        ebool underflowRisk = FHE.lt(userVote_, 1);
        euint8 userVoteSafeSub = FHE.select(underflowRisk, FHE.asEuint8(0), FHE.sub(userVote_, 1));

        //Check if userVote is a power of 2. If vote is valid (power of 2), then fraudFlag will be 0.
        ebool fraudFlag = FHE.asEbool(FHE.and(userVote_, userVoteSafeSub));
        euint8 safeVote = FHE.select(fraudFlag, FHE.asEuint8(0), userVote_);
        return safeVote;
    }

    function processVote(uint256 electionId, uint256 candidateId, euint8 userVote_) internal {
        euint8 licitVote = fraudCheck(userVote_);
        euint32[7] memory gradeArray;
        for (uint256 i = 0; i < 7; i++) {
            euint32 value = FHE.asEuint32(FHE.and(licitVote, 1));
            gradeArray[i] = value;
            licitVote = FHE.shr(licitVote, 1);
        }

        //sum gradeArray > 1 fraud -> invalid vote
        election[electionId].candidateScore[candidateId].Awful = FHE.add(
            election[electionId].candidateScore[candidateId].Awful,
            gradeArray[6]
        );
        election[electionId].candidateScore[candidateId].VBad = FHE.add(
            election[electionId].candidateScore[candidateId].VBad,
            gradeArray[5]
        );
        election[electionId].candidateScore[candidateId].Bad = FHE.add(
            election[electionId].candidateScore[candidateId].Bad,
            gradeArray[4]
        );
        election[electionId].candidateScore[candidateId].Medium = FHE.add(
            election[electionId].candidateScore[candidateId].Medium,
            gradeArray[3]
        );
        election[electionId].candidateScore[candidateId].Good = FHE.add(
            election[electionId].candidateScore[candidateId].Good,
            gradeArray[2]
        );
        election[electionId].candidateScore[candidateId].VGood = FHE.add(
            election[electionId].candidateScore[candidateId].VGood,
            gradeArray[1]
        );
        election[electionId].candidateScore[candidateId].Excellent = FHE.add(
            election[electionId].candidateScore[candidateId].Excellent,
            gradeArray[0]
        );

        FHE.allowThis(election[electionId].candidateScore[candidateId].Awful);
        FHE.allowThis(election[electionId].candidateScore[candidateId].VBad);
        FHE.allowThis(election[electionId].candidateScore[candidateId].Bad);
        FHE.allowThis(election[electionId].candidateScore[candidateId].Medium);
        FHE.allowThis(election[electionId].candidateScore[candidateId].Good);
        FHE.allowThis(election[electionId].candidateScore[candidateId].VGood);
        FHE.allowThis(election[electionId].candidateScore[candidateId].Excellent);
    }

    function vote(
        uint256 electionId,
        externalEuint8[] calldata encryptedUserVote,
        bytes calldata inputProof
    ) public ensureVotingOpen(electionId) ensureHasNotVoted(electionId, msg.sender) {
        for (uint256 i = 0; i < election[electionId].candidateNumber; i++) {
            euint8 userVote = FHE.fromExternal(encryptedUserVote[i], inputProof);
            processVote(electionId, i, userVote);
        }

        election[electionId].voteCount++;
        election[electionId].voterStatus[msg.sender] = true;
    }

    function requestResult(uint256 electionId, uint256 candidateId) public onlyElectionOwner(electionId, msg.sender) {
        bytes32[] memory cts = new bytes32[](7);
        cts[0] = FHE.toBytes32(election[electionId].candidateScore[candidateId].Awful);
        cts[1] = FHE.toBytes32(election[electionId].candidateScore[candidateId].VBad);
        cts[2] = FHE.toBytes32(election[electionId].candidateScore[candidateId].Bad);
        cts[3] = FHE.toBytes32(election[electionId].candidateScore[candidateId].Medium);
        cts[4] = FHE.toBytes32(election[electionId].candidateScore[candidateId].Good);
        cts[5] = FHE.toBytes32(election[electionId].candidateScore[candidateId].VGood);
        cts[6] = FHE.toBytes32(election[electionId].candidateScore[candidateId].Excellent);
        uint256 requestID = FHE.requestDecryption(cts, this.resultCallback.selector);

        additionalDecryptionParams[requestID].electionId = electionId;
        additionalDecryptionParams[requestID].candidateId = candidateId;

        latestRequestId = requestID;
        isDecryptionPending = true;
    }

    function resultCallback(
        uint256 requestID,
        uint32 awful_,
        uint32 vbad_,
        uint32 bad_,
        uint32 medium_,
        uint32 good_,
        uint32 vgood_,
        uint32 excellent_,
        bytes[] memory signatures
    ) external {
        require(requestID == latestRequestId, "Invalid requestId");
        FHE.checkSignatures(requestID, signatures);

        uint256 candidateId_ = additionalDecryptionParams[requestID].candidateId;
        uint256 electionId_ = additionalDecryptionParams[requestID].electionId;
        election[electionId_].result[candidateId_].Awful = awful_;
        election[electionId_].result[candidateId_].VBad = vbad_;
        election[electionId_].result[candidateId_].Bad = bad_;
        election[electionId_].result[candidateId_].Medium = medium_;
        election[electionId_].result[candidateId_].Good = good_;
        election[electionId_].result[candidateId_].VGood = vgood_;
        election[electionId_].result[candidateId_].Excellent = excellent_;

        isDecryptionPending = false;
        emit voteDecrypted(block.number, electionId_, candidateId_);
    }
}
