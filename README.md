# gethstorage-sdk

This SDK aims to standardize the interaction between applications and the EthStorage network to achieve reliable and
efficient data management functionality.

This SDK provides the `FlatDirectory` class, a higher-level data management tool that provides methods for uploading
and downloading data of arbitrary size. Uploads are performed by sending the data through calldata.

Click here to view [spec](./spec.md).

# Installation

Install the SDK using [npm](https://www.npmjs.com/package/gethstorage-sdk):

```bash
$ npm install gethstorage-sdk
```

# Example Usage

## FlatDirectory

### create

Create a `FlatDirectory` instance.

```js
const { FlatDirectory } = require("gethstorage-sdk");

const rpc = "https://rpc.beta.testnet.l2.quarkchain.io:8545";
const ethStorageRpc = "https://rpc.beta.testnet.l2.ethstorage.io:9596";
const privateKey = "0xabcd...";

const flatDirectory = await FlatDirectory.create({
    rpc: rpc,
    ethStorageRpc: ethStorageRpc,
    privateKey: privateKey,
});
```

If `FlatDirectory` has been deployed, it can be set through the `address` field.

```js
const address = "0x987..."; // FlatDirectory address
const flatDirectory = await FlatDirectory.create({
    rpc: rpc,
    ethStorageRpc: ethStorageRpc,
    privateKey: privateKey,
    address: address,
});
```

If you only need the `download` function, you can create a `FlatDirectory` using the following pattern.

```js
const address = "0x987..."; // FlatDirectory address
const flatDirectory = await FlatDirectory.create({
    ethStorageRpc: 'https://rpc.beta.testnet.l2.ethstorage.io:9596',
    address: address
});
```

### deploy

Deploy the implementation
contract [FlatDirectory](https://github.com/ethstorage/evm-large-storage)
for [EIP-5018](https://eips.ethereum.org/EIPS/eip-5018) standard.

```js
const contractAddress = await flatDirectory.deploy();
console.log(`FlatDirectory address is ${contractAddress}.`);
```

### upload

Upload `buffer | file` to the FlatDirectory. The content is sliced into chunks and each chunk is sent through calldata.

```js
const callback = {
    onProgress: function (progress, count, isChange) {
        console.log(`Uploaded ${progress} of ${count} chunks`);
    },
    onFail: function (err) {
        console.log(err);
    },
    onFinish: function (totalUploadChunks, totalUploadSize, totalCost) {
        console.log(`Total upload chunk count is ${totalUploadChunks}, size is ${totalUploadSize}, total cost is ${totalCost}`);
    }
};

const request = {
    key: "test.txt",
    content: Buffer.from("big data"),
    callback: callback
}
await flatDirectory.upload(request);
```

If you want to use `file`, it can be divided into browser and Node.js.

Browser
```javascript
// <input id='fileToUpload' />
const file = document.getElementById('fileToUpload').files[0];

const request = {
    key: "test.txt",
    content: file,
    callback: callback
}
await flatDirectory.upload(request);
```

Node.js
```javascript
const {NodeFile} = require("gethstorage-sdk/file");
const file = new NodeFile("/usr/download/test.jpg");

const request = {
    key: "test.txt",
    content: file,
    callback: callback
}
await flatDirectory.upload(request);
```

### download

Monitor the download progress by passing in a callback function.

```js
const key = "test.txt";
await flatDirectory.download(key, {
	onProgress: function (progress, count, chunk) {
		console.log(`Download ${progress} of ${count} chunks, this chunk is ${Buffer.from(chunk).toString()}`);
	},
    onFail: function (error) {
        console.error("Error download data:", error);
    },
    onFinish: function () {
        console.log("Download success.");
    }
});
```

### estimateCost

Estimate gas costs before uploading.

```js
const request = {
    key: "example1.txt",
    content: Buffer.from("large data to upload")
}

const cost = await flatDirectory.estimateCost(request);
console.log(`Gas Cost: ${cost.gasCost}, Storage Cost: ${cost.storageCost}`);
```

Use `file`.

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
```


### Chunk options

Uploads are sliced into calldata chunks. Both `estimateCost` and `upload`
requests accept two optional fields:

| Field          | Type   | Default | Description                                              |
|----------------|--------|---------|----------------------------------------------------------|
| `maxChunkSize` | number | `64`    | data size of each chunk, in KB                            |
| `maxChunks`    | number | `100`   | maximum number of chunks requested in a single call       |

```js
const request = {
    key: "example1.txt",
    content: Buffer.from("large data to upload"),
    maxChunkSize: 32, // 32 KB per chunk
    maxChunks: 120    // at most 120 chunks per request
}
await flatDirectory.upload({ ...request, callback });
```

`fetchHashes(keys, maxChunks)` accepts the same chunk limit as its second argument.
