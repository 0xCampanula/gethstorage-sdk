// NodeFile Type
export interface NodeFile {
    isNodeJs: boolean;
    size: number;
    start: number;
    end: number;
    slice(start: number, end: number): NodeFile;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
}


// Type
export type BufferLike = Uint8Array;
export type FileLike = File | NodeFile;
export type ContentLike = BufferLike | FileLike;


// Interface
export interface SDKConfig {
    rpc?: string;
    privateKey?: string; //  only read?
    ethStorageRpc?: string;
    address?: string;
}

export interface UploadCallback {
    onProgress: (currentChunk: number, totalChunks: number, isChange: boolean) => void;
    onFail: (error: Error) => void;
    onFinish: (totalUploadChunks: number, totalUploadSize: number, totalCost: bigint) => void;
    onTransactionSent?: (txHash: string, chunkIds: number[] | number) => void;
}

export interface DownloadCallback {
    onProgress: (currentChunk: number, totalChunks: number, chunkData: Uint8Array) => void;
    onFail: (error: Error) => void;
    onFinish: () => void;
}

/**
 * Custom gas fees, in wei.
 * EIP-1559 fields apply to EIP-1559 chains; gasPrice applies to legacy chains
 * (e.g. BNB Chain). Unset fields fall back to chain-class defaults.
 */
export interface GasFeeOptions {
    maxFeePerGas?: bigint,
    maxPriorityFeePerGas?: bigint,
    gasPrice?: bigint,
}

/**
 * Concrete fees resolved for a transaction, tagged by fee model.
 * effectiveGasPrice is the expected price actually charged per gas unit:
 * min(maxFeePerGas, baseFee + priorityFee) under EIP-1559, gasPrice on legacy chains.
 */
export type ResolvedGasFees =
    | { type: 'eip1559', maxFeePerGas: bigint, maxPriorityFeePerGas: bigint, effectiveGasPrice: bigint }
    | { type: 'legacy', gasPrice: bigint, effectiveGasPrice: bigint };

export interface EstimateGasRequest {
    key: string,
    content: ContentLike,
    /** Custom max fee per gas, in wei (EIP-1559). */
    maxFeePerGas?: bigint,
    /** Custom priority fee per gas, in wei (EIP-1559). */
    maxPriorityFeePerGas?: bigint,
    /** Custom gas price, in wei (legacy chains without EIP-1559, e.g. BNB Chain). */
    gasPrice?: bigint,
    chunkHashes?: string[],
    /** Size of each data chunk, in KB. Defaults to DEFAULT_MAX_CHUNK_SIZE_KB. */
    maxChunkSize?: number,
    /** Maximum number of chunks requested in a single call. Defaults to MAX_CHUNKS. */
    maxChunks?: number,
}

export interface UploadRequest extends EstimateGasRequest {
    callback: Partial<UploadCallback>,
}

export interface CostEstimate {
    storageCost: bigint;
    gasCost: bigint;
}

export interface TxCost {
    normalGasCost: bigint;
}

export interface UploadResult {
    txCost: TxCost;
    success: boolean;
}

export interface FileBatch {
    name: string;
    chunkIds: number[];
}

export interface UploadDetails {
    fileMode: number;
    oldChunkCount: number;
    cost: bigint;
}

export interface ChunkCountResult {
    key: string;
    chunkCount: number;
}

export interface ChunkHashResult {
    name: string;
    chunkId: number;
    hash: string;
}
