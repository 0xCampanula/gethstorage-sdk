import pLimit from 'p-limit';
import { ethers } from "ethers";
import {
    SDKConfig, EstimateGasRequest, UploadRequest, CostEstimate,
    DownloadCallback, ContentLike, FileBatch,
    ChunkCountResult, ChunkHashResult,
    UploadCallback, UploadResult, GasFeeOptions, ResolvedGasFees,
    FlatDirectoryAbi, FlatDirectoryBytecode, ETHSTORAGE_MAPPING,
    MAX_CHUNKS, toChunkSizeBytes, CONTRACT_MAX_CHUNK_SIZE
} from "./param";
import {
    TxSender,
    isBuffer, isFile,
    stringToHex,
    stableRetry, getContentChunk,
    getUploadInfo, getChunkCounts,
    getChunkHashes
} from "./utils";

const defaultCallback: DownloadCallback = {
    onProgress: () => { },
    onFail: () => { },
    onFinish: () => { }
};

export class FlatDirectory {
    // ======================= Private fields =======================
    #ethStorageRpc?: string;
    #contractAddr?: string;

    #wallet?: ethers.Wallet;
    #txSender?: TxSender;

    #isLoggingEnabled: boolean = true;

    /**
     * Private constructor - use create() factory method
     */
    private constructor() {}

    static async create(config: SDKConfig): Promise<FlatDirectory> {
        const flatDirectory = new FlatDirectory();
        await flatDirectory.#initialize(config);
        return flatDirectory;
    }

    // ======================= Public methods =======================
    /**
     * Enable or disable logging
     * @param value - true to enable logging, false to disable
     */
    setLogEnabled(value: boolean) {
        this.#isLoggingEnabled = value;
    }

    /**
     * Deploy a new FlatDirectory contract
     * @returns Contract address if successful, null otherwise
     */
    async deploy(): Promise<string | null> {
        const chainId = await this.#txSenderChecked.getChainId();

        const ethStorage = ETHSTORAGE_MAPPING[chainId] || '0x0000000000000000000000000000000000000000';
        try {
            // Route through TxSender so deploy uses the same chain-class gas fees
            // and retry logic as upload transactions.
            const factory = new ethers.ContractFactory(FlatDirectoryAbi, FlatDirectoryBytecode);
            // @ts-ignore
            const tx = await factory.getDeployTransaction(0, CONTRACT_MAX_CHUNK_SIZE, ethStorage);
            const resolvedFees = await this.#txSenderChecked.resolveGasFees();
            this.#applyGasFees(tx, resolvedFees);
            const txResponse = await this.#txSenderChecked.sendTx(tx);
            this.#log(`Deploy transaction sent. Hash: ${txResponse.hash}`);

            const receipt = await this.#txSenderChecked.waitForReceipt(txResponse.hash);
            if (receipt?.status === 1 && receipt.contractAddress) {
                this.#contractAddr = receipt.contractAddress;
                this.#log(`Contract deployed successfully. Address: ${this.#contractAddr}`);
                return this.#contractAddr;
            }
            this.#log(`Deployment failed! Transaction reverted (Hash: ${txResponse.hash})`, true);
            return null;
        } catch (e) {
            this.#log(`Deployment failed! ${(e as any).message || e}`, true);
            return null;
        }
    }

    /**
     * Set a file as the default file
     * @param filename - Name of the file to set as default
     * @returns true if successful, false otherwise
     */
    async setDefault(filename: string): Promise<boolean> {
        const hexName = filename ? stringToHex(filename) : "0x";
        const fileContract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, this.#walletChecked) as any;
        try {
            const tx = await fileContract["setDefault"].populateTransaction(hexName);
            const resolvedFees = await this.#txSenderChecked.resolveGasFees();
            this.#applyGasFees(tx, resolvedFees);
            const txResponse = await this.#txSenderChecked.sendTx(tx);
            this.#log(`Setting default file (Key: ${filename}). Transaction sent (Hash: ${txResponse.hash})`);
            const result = await this.#txSenderChecked.getTransactionResult(txResponse.hash);
            return result.success;
        } catch (e) {
            this.#log(`Failed to set default file (Key: ${filename}). ${(e as any).message || e}`, true);
        }
        return false;
    }

    /**
     * Remove a file from the contract
     * @param key - File key to remove
     * @returns true if successful, false otherwise
     */
    async remove(key: string): Promise<boolean> {
        const fileContract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, this.#walletChecked) as any;
        try {
            const tx = await fileContract["remove"].populateTransaction(stringToHex(key));
            const resolvedFees = await this.#txSenderChecked.resolveGasFees();
            this.#applyGasFees(tx, resolvedFees);
            const txResponse = await this.#txSenderChecked.sendTx(tx);
            this.#log(`File removal initiated (Key: ${key}). Hash: ${txResponse.hash}`);
            const result = await this.#txSenderChecked.getTransactionResult(txResponse.hash);
            return result.success;
        } catch (e) {
            this.#log(`Failed to remove file (Key: ${key}). ${(e as any).message || e}`, true);
        }
        return false;
    }

    /**
     * Download a file from the contract
     * @param key - File key to download
     * @param cb - Download callback object
     */
    async download(key: string, cb: DownloadCallback = defaultCallback): Promise<void> {
        const hexName = stringToHex(key);
        const provider = new ethers.JsonRpcProvider(this.#ethStorageRpcChecked);
        const contract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, provider);
        try {
            const result = await getChunkCounts(contract, [key]);
            const totalChunks = result[0].chunkCount;
            if (totalChunks === 0) {
                cb.onFinish();
                return;
            }

            await this.#download(contract, hexName, totalChunks, cb);
            cb.onFinish();
        } catch (err) {
            cb.onFail(err as Error);
        }
    }

    /**
     * Fetch chunk hashes for multiple files
     * @param keys - Array of file keys
     * @param maxChunks - Maximum number of chunks requested in a single call, defaults to MAX_CHUNKS
     * @returns Object mapping file keys to their chunk hashes
     */
    async fetchHashes(keys: string[], maxChunks?: number): Promise<Record<string, string[]>> {
        if (!keys || !Array.isArray(keys)) {
            throw new Error('Invalid keys.');
        }

        // get file chunks
        const contract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, this.#walletChecked);
        const fileInfos = await getChunkCounts(contract, keys);
        return this.#fetchChunkHashes(fileInfos, maxChunks);
    }

    /**
     * Estimate cost for uploading a file
     * @param request - Upload request details
     * @returns Cost estimation object
     */
    async estimateCost(request: EstimateGasRequest): Promise<CostEstimate> {
        const { key } = request;
        if (!key) {
            throw new Error(`FlatDirectory: Invalid key!`);
        }

        return await this.#estimateCostByCallData(request);
    }

    /**
     * Upload a file to the contract
     * @param request - Upload request details
     * @throws Error if upload fails
     */
    async upload(request: UploadRequest): Promise<void> {
        const { key, callback } = request;
        if (!callback) {
            throw new Error(`FlatDirectory: Invalid callback object!`);
        }
        if (!key) {
            callback.onFail!(new Error(`FlatDirectory: Invalid key!`));
            callback.onFinish!(0, 0, 0n);
            return;
        }
        if (!this.#contractAddr) {
            callback.onFail!(new Error(`FlatDirectory: FlatDirectory not deployed!`));
            callback.onFinish!(0, 0, 0n);
            return;
        }
        if (!this.#wallet) {
            callback.onFail!(new Error(`FlatDirectory: Private key is required for this operation.`));
            callback.onFinish!(0, 0, 0n);
            return;
        }

        await this.#uploadByCalldata(request);
    }


    // -------------------- Private Methods --------------------
    async #initialize(config: SDKConfig): Promise<void> {
        const { privateKey, rpc, address, ethStorageRpc } = config;
        this.#contractAddr = address;
        this.#ethStorageRpc = ethStorageRpc;

        if (privateKey && rpc) {
            // normal
            const provider = new ethers.JsonRpcProvider(rpc);
            this.#wallet = new ethers.Wallet(privateKey, provider);
            this.#txSender = new TxSender(rpc, privateKey);
            if (!address) return;
        } else if (!ethStorageRpc || !address) {
            // check is read-only mode?
            throw new Error("FlatDirectory: Read-only mode requires both 'ethStorageRpc' and 'address'");
        }
    }

    async #download(
        contract: ethers.Contract,
        hexName: string,
        totalChunks: number,
        cb: DownloadCallback
    ) {
        // Ordered cache + sequential callback
        const downloadedResults = new Map<number, Uint8Array>();
        let nextCallbackStart = 0;
        const flushReadyChunks = () => {
            while (downloadedResults.has(nextCallbackStart)) {
                const data = downloadedResults.get(nextCallbackStart)!;
                cb.onProgress(nextCallbackStart, totalChunks, data);
                downloadedResults.delete(nextCallbackStart);
                nextCallbackStart++;
            }
        };

        const fetchChunk = (i: number) =>
            stableRetry<[string, boolean]>(() => contract['readChunk'](hexName, i));

        const fetchSingle = async (i: number) => {
            const [data] = await fetchChunk(i);
            downloadedResults.set(i, ethers.getBytes(data));
            flushReadyChunks();
        };

        // download task
        let maxConcurrency: number = 6;
        if (typeof process !== 'undefined' && process.versions?.node) {
            try {
                const os = await import('os');
                const cores = os.cpus().length;
                maxConcurrency = Math.max(2, Math.min(20, cores * 2));
            } catch (err) {
                maxConcurrency = 10;
            }
        }
        const limit = pLimit(maxConcurrency);
        const quests = Array.from({ length: totalChunks }, (_, i) =>
            limit(() => fetchSingle(i))
        );

        await Promise.all(quests);
        await new Promise(r => setTimeout(r, 0));
        flushReadyChunks(); // flush any remaining pages
    }

    async #fetchChunkHashes(fileInfos: ChunkCountResult[], maxChunks?: number): Promise<Record<string, string[]>> {
        const allHashes: Record<string, string[]> = {};

        const chunkLimit = maxChunks && maxChunks > 0 ? maxChunks : MAX_CHUNKS;
        const batchArray: Record<string, number[]>[] = [];
        let currentBatch: Record<string, number[]> = {};
        let currentChunkCount = 0;
        for (const { key, chunkCount } of fileInfos) {
            allHashes[key] = chunkCount === 0 ? [] : new Array(chunkCount);

            for (let i = 0; i < chunkCount; i++) {
                if (!currentBatch[key]) {
                    currentBatch[key] = [];
                }
                currentBatch[key].push(i);
                currentChunkCount++;
                // If the batch reaches the chunk limit, create a task
                if (currentChunkCount === chunkLimit) {
                    batchArray.push(currentBatch);
                    currentBatch = {};
                    currentChunkCount = 0;
                }
            }
        }
        if (Object.keys(currentBatch).length > 0) {
            batchArray.push(currentBatch);
        }

        // request
        if (batchArray.length > 0) {
            const contract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, this.#walletChecked);
            const hashResults = await Promise.all(batchArray.map(batch => {
                const fileChunksArray: FileBatch[] = Object.keys(batch).map(name => ({
                    name,
                    chunkIds: batch[name]
                }));
                return getChunkHashes(contract, fileChunksArray);
            }));
            // Combine results
            hashResults.flat().forEach(({ name, chunkId, hash }: ChunkHashResult) => {
                allHashes[name][chunkId] = hash;
            });
        }
        return allHashes;
    }

    // estimate cost
    async #estimateCostByCallData(request: EstimateGasRequest): Promise<CostEstimate> {
        let { key, content, chunkHashes, maxFeePerGas: customMaxFee, maxPriorityFeePerGas: customTip, gasPrice: customGasPrice, maxChunkSize, maxChunks } = request;

        // The payload must not exceed the on-chain maxChunkSize, otherwise writeChunkByCalldata reverts.
        if (toChunkSizeBytes(maxChunkSize) > CONTRACT_MAX_CHUNK_SIZE) {
            throw new Error(`FlatDirectory: Chunk size ${maxChunkSize} KB exceeds the on-chain max payload of ${CONTRACT_MAX_CHUNK_SIZE} bytes.`);
        }

        const { chunkDataSize, calldataChunkCount } = this.#calculateCalldataChunkDetails(content, maxChunkSize);
        if (chunkDataSize === -1) {
            throw new Error(`FlatDirectory: Invalid upload content!`);
        }

        const hexName = stringToHex(key);
        const fileContract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, this.#walletChecked) as any;
        // Resolve fees with the exact same chain-class logic used when sending,
        // so the estimate matches the real transaction.
        const [{ oldChunkCount, fileMode }, resolvedFees] = await Promise.all([
            getUploadInfo(fileContract, hexName),
            this.#txSenderChecked.resolveGasFees({ maxFeePerGas: customMaxFee, maxPriorityFeePerGas: customTip, gasPrice: customGasPrice }),
        ]);
        // On-chain file mode from getUploadInfo(): 0 = file not uploaded yet, 1 = calldata.
        // Calldata is the only supported upload mode; any other value (e.g. blob) is rejected.
        if (fileMode !== 0 && fileMode !== 1) {
            throw new Error(`FlatDirectory: This file does not support calldata upload!`);
        }

        // Get old chunk hashes, If the chunk hashes is not passed, it is obtained here
        if (!chunkHashes) {
            const hashes = await this.#fetchChunkHashes([{ key, chunkCount: oldChunkCount }], maxChunks);
            chunkHashes = hashes[key];
        }

        // Expected price actually charged per gas unit
        // (EIP-1559: min(maxFee, baseFee + tip); legacy: gasPrice).
        const effectiveGasPrice = resolvedFees.effectiveGasPrice;

        let totalGasCost = 0n;

        // Truncating leftover old chunks costs gas as well; include it when the new file is shorter.
        if (calldataChunkCount < oldChunkCount) {
            const truncateGas: bigint = await stableRetry(() => fileContract["truncate"].estimateGas(hexName, calldataChunkCount));
            totalGasCost += effectiveGasPrice * truncateGas;
        }

        // Chunk writes fall into two storage classes with very different gas costs:
        // overwriting an existing slot (i < oldChunkCount) vs appending a new one.
        // The contract only accepts sequential appends, so appends are estimated at the
        // next valid chunkId (oldChunkCount). The last chunk is usually shorter and is
        // always estimated individually.
        let overwriteGasLimit = 0n;
        let appendGasLimit = 0n;
        const estimateChunk = (chunkId: number, hexData: string): Promise<bigint> => stableRetry(
            () => fileContract["writeChunkByCalldata"].estimateGas(hexName, chunkId, hexData)
        );
        for (let i = 0; i < calldataChunkCount; i++) {
            const chunk = await getContentChunk(content, i * chunkDataSize, (i + 1) * chunkDataSize);

            // not change
            if (i < chunkHashes.length && ethers.keccak256(chunk) === chunkHashes[i]) {
                continue;
            }

            const hexData = ethers.hexlify(chunk);
            const isAppend = i >= oldChunkCount;
            const estChunkId = isAppend ? oldChunkCount : i;
            let chunkGas: bigint;
            if (i === calldataChunkCount - 1) {
                chunkGas = await estimateChunk(estChunkId, hexData);
            } else if (isAppend) {
                if (appendGasLimit === 0n) {
                    appendGasLimit = await estimateChunk(estChunkId, hexData);
                }
                chunkGas = appendGasLimit;
            } else {
                if (overwriteGasLimit === 0n) {
                    overwriteGasLimit = await estimateChunk(estChunkId, hexData);
                }
                chunkGas = overwriteGasLimit;
            }
            totalGasCost += effectiveGasPrice * chunkGas;
        }

        return {
            storageCost: 0n,
            gasCost: totalGasCost
        }
    }

    // upload
    async #uploadByCalldata(request: UploadRequest): Promise<void> {
        let totalUploadChunks = 0, totalUploadSize = 0;
        let totalCost = 0n;

        let { key, content, callback, chunkHashes, maxFeePerGas, maxPriorityFeePerGas, gasPrice, maxChunkSize, maxChunks } = request;
        const gasFee: GasFeeOptions = { maxFeePerGas, maxPriorityFeePerGas, gasPrice };

        // The payload must not exceed the on-chain maxChunkSize, otherwise writeChunkByCalldata reverts.
        if (toChunkSizeBytes(maxChunkSize) > CONTRACT_MAX_CHUNK_SIZE) {
            callback.onFail!(new Error(`FlatDirectory: Chunk size ${maxChunkSize} KB exceeds the on-chain max payload of ${CONTRACT_MAX_CHUNK_SIZE} bytes.`));
            callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
            return;
        }

        const { chunkDataSize, calldataChunkCount } = this.#calculateCalldataChunkDetails(content, maxChunkSize);
        if (chunkDataSize === -1) {
            callback.onFail!(new Error(`FlatDirectory: Invalid upload content!`));
            callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
            return;
        }

        const hexName = stringToHex(key);
        const fileContract = new ethers.Contract(this.#contractAddrChecked, FlatDirectoryAbi, this.#walletChecked);
        const { oldChunkCount, fileMode } = await getUploadInfo(fileContract, hexName);
        // On-chain file mode from getUploadInfo(): 0 = file not uploaded yet, 1 = calldata.
        // Calldata is the only supported upload mode; any other value (e.g. blob) is rejected.
        if (fileMode !== 0 && fileMode !== 1) {
            callback.onFail!(new Error(`FlatDirectory: This file does not support calldata upload!`));
            callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
            return;
        }

        // Resolve concrete gas fees once, by chain fee model (EIP-1559 classes or
        // legacy gasPrice), so every transaction of this upload uses the same values.
        let resolvedFees: ResolvedGasFees;
        try {
            resolvedFees = await this.#txSenderChecked.resolveGasFees(gasFee);
        } catch (e) {
            callback.onFail!(e as Error);
            callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
            return;
        }

        // check old data
        const clearResult = await this.#clearOldFile(fileContract, hexName, calldataChunkCount, oldChunkCount,
            resolvedFees);
        // count tx costs, regardless of success or failure.
        totalCost += clearResult.gasCost;
        if (!clearResult.success) {
            callback.onFail!(new Error(`FlatDirectory: Failed to truncate old data!`));
            callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
            return;
        }

        // Get old chunk hashes, If the chunk hashes is not passed, it is obtained here
        if (!chunkHashes) {
            try {
                const hashes = await this.#fetchChunkHashes([{ key, chunkCount: oldChunkCount }], maxChunks);
                chunkHashes = hashes[key];
            } catch (e) {
                callback.onFail!(e as Error);
                callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
                return;
            }
        }

        for (let i = 0; i < calldataChunkCount; i++) {
            const chunk = await getContentChunk(content, i * chunkDataSize, (i + 1) * chunkDataSize);

            // not change
            if (i < chunkHashes.length && ethers.keccak256(chunk) === chunkHashes[i]) {
                callback.onProgress!(i, calldataChunkCount, false);
                continue;
            }

            // upload (strictly sequential: each chunk transaction is confirmed before the next is sent)
            let uploadResult: UploadResult;
            try {
                const txResponse = await this.#sendCalldataTx(
                    fileContract, key, hexName, i,
                    chunk, resolvedFees, callback as UploadCallback
                );
                uploadResult = await this.#txSenderChecked.getTransactionResult(txResponse.hash);
            } catch (e) {
                // Submission or confirmation failed after retries; stop here so the caller
                // still receives a clean onFail + onFinish with the stats gathered so far.
                callback.onFail!(e as Error);
                break;
            }

            // count tx costs, regardless of success or failure.
            totalCost += uploadResult.txCost.normalGasCost; // gas cost only

            // fail
            if (!uploadResult.success) {
                callback.onFail!(new Error("FlatDirectory: Sending transaction failed."));
                break;
            }
            // success
            callback.onProgress!(i, calldataChunkCount, true);
            totalUploadChunks++;
            totalUploadSize += chunk.length;
        }

        callback.onFinish!(totalUploadChunks, totalUploadSize, totalCost);
    }

    async #clearOldFile(
        contract: any,
        key: string,
        chunkLength: number,
        oldChunkLength: number,
        resolvedFees: ResolvedGasFees
    ): Promise<{ success: boolean, gasCost: bigint }> {
        if (oldChunkLength <= chunkLength) {
            return { success: true, gasCost: 0n };
        }

        try {
            const tx = await contract.truncate.populateTransaction(key, chunkLength);
            this.#applyGasFees(tx, resolvedFees);

            const txResponse = await this.#txSenderChecked.sendTx(tx);
            this.#log(`Truncate transaction sent (Key: ${key}, New length: ${chunkLength}). Hash: ${txResponse.hash}`);

            let receipt: ethers.TransactionReceipt | null;
            try {
                receipt = await txResponse.wait();
            } catch {
                // wait() failed (e.g. RPC drop); the transaction may still be mined, so poll
                // for the receipt once more to keep the gas cost accounting accurate.
                const result = await this.#txSenderChecked.getTransactionResult(txResponse.hash).catch(() => null);
                return {
                    success: result?.success === true,
                    gasCost: result?.txCost.normalGasCost ?? 0n
                };
            }
            // Count the truncate transaction's gas like any other upload transaction.
            const gasCost = receipt ? receipt.gasUsed * receipt.gasPrice : 0n;
            return { success: receipt?.status === 1, gasCost };
        } catch (e) {
            this.#log(`Failed to truncate old data for file (Key: ${key}). ${(e as any).message || e}`, true);
            return { success: false, gasCost: 0n };
        }
    }

    // call data helper
    #calculateCalldataChunkDetails(content: ContentLike, maxChunkSize?: number): { chunkDataSize: number; calldataChunkCount: number } {
        const maxChunkSizeBytes = toChunkSizeBytes(maxChunkSize);
        const getChunkInfo = (size: number) => ({
            chunkDataSize: size > maxChunkSizeBytes ? maxChunkSizeBytes : size,
            calldataChunkCount: size > maxChunkSizeBytes ? Math.ceil(size / maxChunkSizeBytes) : 1
        });

        if (isFile(content)) {
            return getChunkInfo(content.size);
        } else if (isBuffer(content)) {
            return getChunkInfo(content.length);
        }
        return { chunkDataSize: -1, calldataChunkCount: 1 };
    }

    async #sendCalldataTx(
        fileContract: any,
        key: string,
        hexName: string,
        chunkId: number,
        chunk: Uint8Array,
        resolvedFees: ResolvedGasFees,
        callback: UploadCallback
    ): Promise<ethers.TransactionResponse> {
        const hexData = ethers.hexlify(chunk);
        const tx = await fileContract["writeChunkByCalldata"].populateTransaction(hexName, chunkId, hexData);
        // Pin the resolved fees so every transaction of this upload uses the same values.
        this.#applyGasFees(tx, resolvedFees);

        // send
        const txResponse = await this.#txSenderChecked.sendTx(tx);
        this.#logTransactionHash(key, chunkId, txResponse.hash, callback);
        return txResponse;
    }

    /**
     * Copy resolved gas fees onto a transaction request, by fee model:
     * legacy chains use gasPrice, EIP-1559 chains use max/priority fee fields.
     */
    #applyGasFees(tx: ethers.TransactionRequest, resolvedFees: ResolvedGasFees): void {
        if (resolvedFees.type === 'legacy') {
            tx.gasPrice = resolvedFees.gasPrice;
            return;
        }
        tx.maxFeePerGas = resolvedFees.maxFeePerGas;
        tx.maxPriorityFeePerGas = resolvedFees.maxPriorityFeePerGas;
    }

    #logTransactionHash(key: string, chunkId: number, hash: string, callback: UploadCallback) {
        const primaryMessage = `Transaction hash: ${hash} for chunk ${chunkId}.`;
        const fullMessage = `${primaryMessage} (Key: ${key})`;
        this.#log(fullMessage);

        if (callback?.onTransactionSent) {
            callback.onTransactionSent(hash, chunkId);
        }
    }

    #log(message: string, isError: boolean = false) {
        if (!this.#isLoggingEnabled) return;
        const prefix = "FlatDirectory: ";
        if (isError) {
            console.error(`${prefix}${message}`);
        } else {
            console.log(`${prefix}${message}`);
        }
    }

    // -------------------- Getters --------------------
    get #contractAddrChecked(): string {
        if (!this.#contractAddr) throw new Error("FlatDirectory: Not deployed!");
        return this.#contractAddr;
    }

    get #ethStorageRpcChecked(): string {
        if (!this.#ethStorageRpc) throw new Error("FlatDirectory: 'ethStorageRpc' required.");
        return this.#ethStorageRpc;
    }

    get #walletChecked(): ethers.Wallet {
        if (!this.#wallet) throw new Error("FlatDirectory: Private key required.");
        return this.#wallet;
    }

    get #txSenderChecked(): TxSender {
        if (!this.#txSender) throw new Error("FlatDirectory: TxSender not initialized.");
        return this.#txSender;
    }
}
