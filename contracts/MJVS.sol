// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract MJVS_POC is SepoliaConfig, Ownable2Step {
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

    uint256 latestRequestId;
    bool isDecryptionPending;

    bool public votingOpen;
    uint256 public voteCount;
    uint256 public candidateNumber;

    mapping(uint256 candidateId => clearNotation score) public result;
    mapping(uint256 candidateId => Notation score) public candidateScore;

    mapping(uint256 requestId => uint256 candidateId) private additionalDecryptionParams;

    event voteDecrypted(uint256 blockNumber, uint256 candidateId);

    constructor(uint256 candidateNumber_) Ownable(msg.sender) {
        candidateNumber = candidateNumber_;
    }

    /**
     * @dev Modifier to ensure voting is open.
     */
    modifier ensureVotingOpen() {
        require(votingOpen, "Voting is currently closed.");
        _;
    }

    /**
     * @dev Allows the owner to modify the voting state (open or close).
     * @param _state The state to set votingOpen on.
     */
    function setVotingState(bool _state) public onlyOwner {
        votingOpen = _state;
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

    function processVote(uint256 candidateId, euint8 userVote_) internal {
        euint8 licitVote = fraudCheck(userVote_);
        euint32[7] memory gradeArray;
        for (uint256 i = 0; i < 7; i++) {
            euint32 value = FHE.asEuint32(FHE.and(licitVote, 1));
            gradeArray[i] = value;
            licitVote = FHE.shr(licitVote, 1);
        }

        //sum gradeArray > 1 fraud -> invalid vote
        candidateScore[candidateId].Awful = FHE.add(candidateScore[candidateId].Awful, gradeArray[6]);
        candidateScore[candidateId].VBad = FHE.add(candidateScore[candidateId].VBad, gradeArray[5]);
        candidateScore[candidateId].Bad = FHE.add(candidateScore[candidateId].Bad, gradeArray[4]);
        candidateScore[candidateId].Medium = FHE.add(candidateScore[candidateId].Medium, gradeArray[3]);
        candidateScore[candidateId].Good = FHE.add(candidateScore[candidateId].Good, gradeArray[2]);
        candidateScore[candidateId].VGood = FHE.add(candidateScore[candidateId].VGood, gradeArray[1]);
        candidateScore[candidateId].Excellent = FHE.add(candidateScore[candidateId].Excellent, gradeArray[0]);

        FHE.allowThis(candidateScore[candidateId].Awful);
        FHE.allowThis(candidateScore[candidateId].VBad);
        FHE.allowThis(candidateScore[candidateId].Bad);
        FHE.allowThis(candidateScore[candidateId].Medium);
        FHE.allowThis(candidateScore[candidateId].Good);
        FHE.allowThis(candidateScore[candidateId].VGood);
        FHE.allowThis(candidateScore[candidateId].Excellent);
    }

    function vote(externalEuint8[] calldata encryptedUserVote, bytes calldata inputProof) public ensureVotingOpen {
        for (uint256 i = 0; i < candidateNumber; i++) {
            euint8 userVote = FHE.fromExternal(encryptedUserVote[i], inputProof);
            processVote(i, userVote);
        }

        voteCount++;
    }

    function requestResult(uint256 candidateId) public onlyOwner {
        bytes32[] memory cts = new bytes32[](7);
        cts[0] = FHE.toBytes32(candidateScore[candidateId].Awful);
        cts[1] = FHE.toBytes32(candidateScore[candidateId].VBad);
        cts[2] = FHE.toBytes32(candidateScore[candidateId].Bad);
        cts[3] = FHE.toBytes32(candidateScore[candidateId].Medium);
        cts[4] = FHE.toBytes32(candidateScore[candidateId].Good);
        cts[5] = FHE.toBytes32(candidateScore[candidateId].VGood);
        cts[6] = FHE.toBytes32(candidateScore[candidateId].Excellent);
        uint256 requestID = FHE.requestDecryption(cts, this.resultCallback.selector);
        latestRequestId = requestID;
        isDecryptionPending = true;

        additionalDecryptionParams[requestID] = candidateId;
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

        uint256 candidateId_ = additionalDecryptionParams[requestID];
        result[candidateId_].Awful = awful_;
        result[candidateId_].VBad = vbad_;
        result[candidateId_].Bad = bad_;
        result[candidateId_].Medium = medium_;
        result[candidateId_].Good = good_;
        result[candidateId_].VGood = vgood_;
        result[candidateId_].Excellent = excellent_;

        isDecryptionPending = false;
        emit voteDecrypted(block.number, candidateId_);
    }
}
