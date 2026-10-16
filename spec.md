# EthStorage SDK Interface Specification

# Table of Contents

- [1. Introduction](#Introduction)
- [2. Class Overview](#Class_Overview)
- [3. FlatDirectory Class](#FlatDirectory)
    - Static Methods
        - create
    - Methods
        - deploy
        - estimateCost
        - upload
        - download
        - fetchHashes
        - setDefault
        - remove
- [4. Version History](#Version)

---

<p id="Introduction"></p>

# 1. Introduction

This SDK aims to standardize the interaction between applications and the EthStorage network to achieve reliable and
efficient data management functionality.

This SDK includes the `FlatDirectory` class, a higher-level data management tool that provides methods for uploading
and downloading data of arbitrary size. Uploading is performed by sending the data through calldata in fixed-size
chunks, and each chunk is written to the FlatDirectory contract with `writeChunkByCalldata`.

<p id="Class_Overview"></p>

# 2. Class Overview

## FlatDirectory Class

| Method Name  | Description                                                    |
|--------------|----------------------------------------------------------------|
| create       | Create an instance of FlatDirectory                            |
| deploy       | Deploy a FlatDirectory contract                                |
| estimateCost | Estimate the cost of uploading data (gas cost)                 |
| upload       | Asynchronously upload data of arbitrary size via calldata      |
| download     | Asynchronously download data                                   |
| fetchHashes  | Get chunk hashes of data in batches                            |
| setDefault   | Set the default file for FlatDirectory                         |
| remove       | Remove a file from the FlatDirectory contract                  |

<p id="FlatDirectory"></p>

# 3. FlatDirectory Class

## Static Methods

### create

**Description**: Create an instance of `FlatDirectory`.

**Parameters**
- `config` (object): Configuration object containing necessary settings.
    - `rpc` (string, optional): RPC for any evm network. Required for operations that send transactions.
    - `ethStorageRpc` (string, optional): The EthStorage network rpc corresponding to this evm network, the data is obtained from
      the EthStorage network.
    - `privateKey` (string, optional): Wallet private key. Required for operations that send transactions.
    - `address` (string, optional): FlatDirectory contract address. If it does not exist, the `deploy` method can be
      called to create one.

**Example**
```javascript
const config = {
    rpc: "your_rpc",
    ethStorageRpc: "ethstorage_rpc",
    privateKey: "your_private_key",
    address: "flat_directory_address"
};

const flatDirectory = await FlatDirectory.create(config);
```

## Methods

### deploy

**Description**: Deploy a FlatDirectory contract. If the `address` is not set when creating a `FlatDirectory`, you must
call deploy before other functions.

**Returns**
- `address` (Promise<string | null>): A Promise that resolves to the FlatDirectory address, or `null` on failure.

**Example**
```javascript
const address = await flatDirectory.deploy();
```

### estimateCost

**Description**: Estimate the cost of uploading data|file through calldata.

**Parameters**
- `request` (object): Configuration of the upload object containing necessary settings.
    - `key` (string): The key of the data.
    - `content` (Buffer|File): The content to be uploaded, which can be either a Buffer or a File.
    - `maxFeePerGas` (bigint, optional): Custom max fee per gas, in wei (EIP-1559). Defaults to `1.1 × latest-block base fee + maxPriorityFeePerGas` (i.e. `baseFee * 11 / 10`, base fee from the node).
    - `maxPriorityFeePerGas` (bigint, optional): Custom max priority fee per gas, in wei (EIP-1559). Defaults to `100` wei.
    - `gasPrice` (bigint, optional): Custom gas price, in wei (legacy chains without EIP-1559, e.g. BNB Chain). Defaults to the node-suggested gas price.
    - `chunkHashes` (string[], optional): The chunk hashes corresponding to the content. If this parameter exists, no
      request to retrieve the hashes will be triggered.
    - `maxChunkSize` (number, optional): Size of each data chunk, in KB. Defaults to `DEFAULT_MAX_CHUNK_SIZE_KB` (64).
    - `maxChunks` (number, optional): Maximum number of chunks requested in a single call. Defaults to `MAX_CHUNKS`.

**Returns**
- `cost` (`Promise<object>`): A Promise that resolves to an object containing:
    - `gasCost` (BigInt): The estimated gas cost.
    - `storageCost` (BigInt): The estimated storage cost.

**Example**
```javascript
const request = {
    key: "example1.txt",
    maxFeePerGas: 30000000000n, // 30 gwei, in wei
    maxPriorityFeePerGas: 1500000000n, // 1.5 gwei, in wei
    content: Buffer.from("large data to upload")
}
const cost = await flatDirectory.estimateCost(request);
console.log(`Gas Cost: ${cost.gasCost}, Storage Cost: ${cost.storageCost}`);
```

If you want to use `file`, it can be divided into browser and Node.js.

Browser
```javascript
// <input id='fileToUpload' />
const file = document.getElementById('fileToUpload').files[0];

const request = {
    key: "example1.txt",
    content: file
}
const cost = await flatDirectory.estimateCost(request);
console.log(`Gas Cost: ${cost.gasCost}, Storage Cost: ${cost.storageCost}`);
```

Node.js
```javascript
const {NodeFile} = require("gethstorage-sdk/file");
const file = new NodeFile("/usr/download/test.jpg");

const request = {
    key: "example1.txt",
    content: file
}
const cost = await flatDirectory.estimateCost(request);
console.log(`Gas Cost: ${cost.gasCost}, Storage Cost: ${cost.storageCost}`);
```

### upload

**Description**: Upload data of arbitrary size via calldata.

**Parameters**
- `request` (object): Configuration of the upload object containing necessary settings.
    - `key` (string): The key of the data.
    - `content` (Buffer|File): The content to be uploaded, which can be either a Buffer or a File.
    - `maxFeePerGas` (bigint, optional): Custom max fee per gas, in wei (EIP-1559). Defaults to `1.1 × latest-block base fee + maxPriorityFeePerGas` (i.e. `baseFee * 11 / 10`, base fee from the node).
    - `maxPriorityFeePerGas` (bigint, optional): Custom max priority fee per gas, in wei (EIP-1559). Defaults to `100` wei.
    - `gasPrice` (bigint, optional): Custom gas price, in wei (legacy chains without EIP-1559, e.g. BNB Chain). Defaults to the node-suggested gas price.
    - `chunkHashes` (string[], optional): The chunk hashes corresponding to the content. If this parameter exists, no
      request to retrieve the hashes will be triggered.
    - `maxChunkSize` (number, optional): Size of each data chunk, in KB. Defaults to `DEFAULT_MAX_CHUNK_SIZE_KB` (64).
    - `maxChunks` (number, optional): Maximum number of chunks requested in a single call. Defaults to `MAX_CHUNKS`.
    - `callback` (object): An object containing callback functions:
        - `onProgress(currentChunk, totalChunks, isChange)` (function): Called during the upload process to track progress.
            - **`currentChunk`** (number): The index of the currently uploading chunk.
            - **`totalChunks`** (number): The total number of chunks to be uploaded.
            - **`isChange`** (boolean): Indicates whether the content has changed.
        - `onFail(error)` (function): Called when an error occurs during the upload process.
            - **`error`** (Error): The error object describing the failure.
        - `onFinish(totalUploadChunks, totalUploadSize, totalCost)` (function): Called when the upload is completed.
            - **`totalUploadChunks`** (number): The total number of uploaded chunks.
            - **`totalUploadSize`** (number): The total uploaded size (in bytes).
            - **`totalCost`** (bigint): The total cost of the upload, including **storage cost** and **gas cost**.
        - `onTransactionSent(txHash, chunkIds)` (function, optional): Called right after a transaction is sent.
            - **`txHash`** (string): The transaction hash.
            - **`chunkIds`** (number[] | number): The chunk id(s) contained in the transaction.

**Example**
```javascript
const cb = {
    onProgress: function (progress, count, isChange) {
        console.log(`Uploaded ${progress} of ${count} chunks`);
    },
    onFail: function (error) {
        console.error("Error uploading data:", error);
    },
    onFinish: function (totalUploadChunks, totalUploadSize, totalCost) {
        console.log(`Total upload chunk count is ${totalUploadChunks}, size is ${totalUploadSize}, total cost is ${totalCost}`);
    }
};
const request = {
    key: "example1.txt",
    maxFeePerGas: 30000000000n, // 30 gwei, in wei
    maxPriorityFeePerGas: 1500000000n, // 1.5 gwei, in wei
    content: Buffer.from("large data to upload"),
    callback: cb
}
await flatDirectory.upload(request);
```

Use `file`.

Browser
```javascript
// <input id='fileToUpload' />
const file = document.getElementById('fileToUpload').files[0];

const request = {
    key: "example1.txt",
    maxFeePerGas: 30000000000n, // 30 gwei, in wei
    maxPriorityFeePerGas: 1500000000n, // 1.5 gwei, in wei
    content: file,
    callback: cb
}
await flatDirectory.upload(request);
```

Node.js
```javascript
const {NodeFile} = require("gethstorage-sdk/file");
const file = new NodeFile("/usr/download/test.jpg");

const request = {
    key: "example1.txt",
    maxFeePerGas: 30000000000n, // 30 gwei, in wei
    maxPriorityFeePerGas: 1500000000n, // 1.5 gwei, in wei
    content: file,
    callback: cb
}
await flatDirectory.upload(request);
```

### download

**Description**: Asynchronously download data by key. Get the progress and data in the callback function.

**Parameters**
- `key` (string): The key for the data to be read.
- `callback` (object): An object containing callback functions:
    - `onProgress(currentChunk, totalChunks, chunkData)` (function): Called during the download process to track progress and receive chunk data.
      - **`currentChunk`** (number): The index of the currently downloading chunk.
      - **`totalChunks`** (number): The total number of chunks to be downloaded.
      - **`chunkData`** (Uint8Array): The binary data of the current chunk.
    - `onFail(error)` (function): Called when an error occurs during the download process.
      - **`error`** (Error): The error object describing the failure.
    - `onFinish()` (function): Indicates that the download was finish.

**Example**
```javascript
flatDirectory.download("example.txt", {
	onProgress: function (progress, count, chunk) {
		console.log(`Download ${progress} of ${count} chunks, this chunk is ${Buffer.from(chunk).toString()}`);
    },
    onFail: function (error) {
        console.error("Error download data:", error);
    },
    onFinish: function () {
        console.log("Download finish.");
    }
});
```

### fetchHashes

**Description**: Retrieve the chunk hashes corresponding to the batch of keys.

**Parameters**
- `keys` (string[]): The keys to be retrieved.
- `maxChunks` (number, optional): Maximum number of chunks requested in a single call, defaults to `MAX_CHUNKS`.

**Returns**
- `result` (Promise<Record<string, string[]>>): A Promise that resolves to an object where each key (from the input keys) maps to an array of chunk hashes.

**Example**
```javascript
const keys = ["key1", "key2"];
const result = await flatDirectory.fetchHashes(keys);
```

### setDefault

**Description**: Set the default file for FlatDirectory, the file that is accessed by default when no file name is
provided.

**Parameters**
- `filename` (string): The filename of the default file.

**Returns**
- `status` (Promise<boolean>): A Promise that resolves to the execution result. `true|false`

**Example**
```javascript
const defaultFile = "index.html";
const status = await flatDirectory.setDefault(defaultFile);
```

### remove

**Description**: Remove a file from the FlatDirectory contract.

**Parameters**
- `key` (string): The key of the file to be removed.

**Returns**
- `status` (Promise<boolean>): A Promise that resolves to the execution result. `true|false`

**Example**
```javascript
const status = await flatDirectory.remove("index.html");
```

<p id="Version"></p>

# 4. Version History

- v1.1.1: Initial release with basic storage and data management functionalities.
