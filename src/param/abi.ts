
export const FlatDirectoryAbi: readonly string[] = [
  "constructor(uint8 slotLimit, uint32 maxChunkSize, address storageAddress) public",
  "function version() external view returns (string)",
  "function setDefault(bytes memory _defaultFile) external",
  "function getChunkHash(bytes memory name, uint256 chunkId) public view returns (bytes32)",
  "function writeChunkByCalldata(bytes memory name, uint256 chunkId, bytes calldata data) external payable",
  "function remove(bytes memory name) external returns (uint256)",
  "function truncate(bytes memory name, uint256 chunkId) external returns (uint256)",

  "function readChunk(bytes memory name, uint256 chunkId) external view returns (bytes memory, bool)",
  "function readChunksPaged(bytes memory name, uint256 startChunkId, uint256 limit) external view returns (bytes[] memory chunks)",
  "function countChunks(bytes memory name) external view returns (uint256)",
  "function getUploadInfo(bytes memory name) external view returns (uint8 mode, uint256 chunkCount, uint256 storageCost)",
  "function getChunkHashesBatch((bytes,uint256[])[] memory fileChunks) external view returns (bytes32[] memory)",
  "function getChunkCountsBatch(bytes[] memory names) external view returns (uint256[] memory)"
];
