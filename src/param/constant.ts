
const MAINNET_CHAIN_ID: number = 1;
const SEPOLIA_CHAIN_ID: number = 11155111;
const QUARKCHAIN_L2_TESTNET_CHAIN_ID: number = 3335;

export const ETHSTORAGE_MAPPING: Record<number, string> = {
    [MAINNET_CHAIN_ID]: '0xf0193d6E8fc186e77b6E63af4151db07524f6a7A',
    [SEPOLIA_CHAIN_ID]: '0xAb3d380A268d088BA21Eb313c1C23F3BEC5cfe93',
    [QUARKCHAIN_L2_TESTNET_CHAIN_ID]: '0x64003adbdf3014f7E38FC6BE752EB047b95da89A',
};

/**
 * On-chain max chunk size passed to the FlatDirectory constructor (uint32 maxChunkSize).
 */
export const CONTRACT_MAX_CHUNK_SIZE: number = (4 * 31 + 3) * 1024 - 4;

/**
 * eth_call consumes gas, so we need to estimate the maximum number of chunks based on a 30 million gas limit.
 * Additionally, we need to reserve a portion of the gas for the cost of the request parameters (which can vary dynamically).
 */
export const MAX_CHUNKS: number = 100;


/**
 * Calldata overhead of a single chunk, i.e. the difference between the chunk size
 * configured by the user and the actual data size carried by the transaction.
 */
export const CALLDATA_CHUNK_OVERHEAD: number = 326;

/**
 * Default size of each data chunk when uploading by calldata, in KB.
 */
export const DEFAULT_MAX_CHUNK_SIZE_KB: number = 64;

/**
 * Default priority fee per gas (tip) for upload transactions, in wei.
 * Used when the caller does not provide maxPriorityFeePerGas.
 */
export const DEFAULT_PRIORITY_FEE_PER_GAS: bigint = 100n;

/**
 * Fraction applied to the latest-block base fee when deriving the default
 * maxFeePerGas: baseFee * NUMERATOR / DENOMINATOR + priority fee.
 * 11/10 = 1.1x, leaving headroom for one ~10% base-fee increase between blocks.
 */
export const BASE_FEE_MULTIPLIER_NUMERATOR: bigint = 11n;
export const BASE_FEE_MULTIPLIER_DENOMINATOR: bigint = 10n;

/**
 * Gas fee model classification by chain.
 *
 * LEGACY_GAS_CHAIN_IDS: chains without an EIP-1559 base fee (legacy single-gasPrice
 * model, price paid in full). BNB Smart Chain mainnet (56) and testnet (97).
 *
 * AVALANCHE_GAS_CHAIN_IDS: Avalanche C-Chain mainnet (43114) and Fuji testnet
 * (43113). EIP-1559 like the default class, but the protocol enforces a minimum
 * base fee of 25 nAVAX.
 * All other chains use the default EIP-1559 mechanism (tip + 1.1x base fee).
 */
export const LEGACY_GAS_CHAIN_IDS: ReadonlySet<number> = new Set([56, 97]);
export const AVALANCHE_GAS_CHAIN_IDS: ReadonlySet<number> = new Set([43114, 43113]);

/**
 * Minimum base fee per gas on Avalanche C-Chain (25 nAVAX), in wei.
 * Used as a floor when deriving the default maxFeePerGas.
 */
export const AVALANCHE_MIN_BASE_FEE_PER_GAS: bigint = 25_000_000_000n;

/**
 * Resolve the chunk size (in bytes) used to slice the content.
 * @param maxChunkSizeKB - Chunk size in KB, falls back to DEFAULT_MAX_CHUNK_SIZE_KB when not set.
 */
export function toChunkSizeBytes(maxChunkSizeKB?: number): number {
    const kb = maxChunkSizeKB && maxChunkSizeKB > 0 ? maxChunkSizeKB : DEFAULT_MAX_CHUNK_SIZE_KB;
    return kb * 1024 - CALLDATA_CHUNK_OVERHEAD;
}
