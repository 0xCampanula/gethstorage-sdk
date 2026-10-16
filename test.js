const { FlatDirectory } = require("./dist/node/index.cjs");
const { NodeFile } = require("./dist/node/file.cjs");

const dotenv = require("dotenv")
dotenv.config()
const privateKey = process.env.pk;

const filePath = '/Users/lmp/Downloads/dist/img122.jpeg';

async function FlatDirectoryTest() {
    const fd = await FlatDirectory.create({
        rpc: 'http://65.108.230.142:8545/',
        ethStorageRpc: 'https://rpc.testnet.ethstorage.io:9546',
        privateKey,
        // address: "0x808f50c22D18D137AEf6E464E3f83af5FFc78b7A"
    })

    const address = await fd.deploy();

    const uploadCallback = {
        onProgress: (progress, count, isChange) => {
            console.log(`progress:${progress}, count:${count}, isChange:${isChange}`);
        },
        onFail: (err) => {
            console.log(err);
        },
        onFinish: (totalUploadChunks, totalUploadSize, totalCost) => {
            console.log(`totalUploadChunks:${totalUploadChunks}, totalUploadSize:${totalUploadSize}, totalCost:${totalCost}`);
        }
    };

    const hashes = await fd.fetchHashes(["file.jpg"]);
    console.log(hashes);

    // calldata
    // data
    let request = {
        key: "data",
        content: Buffer.from("12345678"),
        maxFeePerGas: 30000000000n, // 30 gwei, in wei
        maxPriorityFeePerGas: 1500000000n, // 1.5 gwei, in wei
        callback: uploadCallback
    }
    let cost = await fd.estimateCost(request);
    console.log(cost);
    await fd.upload(request);
    cost = await fd.estimateCost(request);
    console.log(cost);
    console.log("");

    // file
    let file = new NodeFile(filePath);
    request = {
        key: "file.jpg",
        content: file,
        maxFeePerGas: 30000000000n, // 30 gwei, in wei
        maxPriorityFeePerGas: 1500000000n, // 1.5 gwei, in wei
        chunkHashes: hashes["file.jpg"],
        callback: uploadCallback
    }
    cost = await fd.estimateCost(request);
    console.log(cost);
    await fd.upload(request);
    cost = await fd.estimateCost(request);
    console.log(cost);
    console.log("");

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    await sleep(60000);

    // download
    await fd.download("data", {
        onProgress: (progress, count, data) => {
            console.log(progress, count, Buffer.from(data).toString());
        },
        onFail: (err) => {
            console.log(err)
        },
        onFinish: () => {
            console.log('download finish');
        }
    });
    await fd.download("file.jpg", {
        onProgress: (progress, count, data) => {
            console.log(progress, count, data.length);
        },
        onFail: (err) => {
            console.log(err)
        },
        onFinish: () => {
            console.log('download finish');
        }
    });

    const hashes2 = await fd.fetchHashes(["file.jpg"]);
    console.log("get hashes", hashes2);

    console.log("only download")
    const downloadFd = await FlatDirectory.create({
        ethStorageRpc: 'https://rpc.testnet.ethstorage.io:9546',
        address: address
    })
    await downloadFd.download("file.jpg", {
        onProgress: (progress, count, data) => {
            console.log(progress, count, data.length);
        },
        onFail: (err) => {
            console.log(err)
        },
        onFinish: () => {
            console.log('download finish');
        }
    });
}

async function main() {
    await FlatDirectoryTest();
}
main()
