import { ethers } from "ethers";
import { calcTxCost } from "./util";
import { stableRetry } from "./retry";
import { UploadResult, GasFeeOptions, ResolvedGasFees, DEFAULT_PRIORITY_FEE_PER_GAS,
    BASE_FEE_MULTIPLIER_NUMERATOR, BASE_FEE_MULTIPLIER_DENOMINATOR,
    LEGACY_GAS_CHAIN_IDS, AVALANCHE_GAS_CHAIN_IDS, AVALANCHE_MIN_BASE_FEE_PER_GAS } from "../param";

// ====================== Main Class ======================
/**
 * Generic transaction sender: owns the provider and wallet, and exposes
 * gas price / send / receipt helpers used by the calldata upload path.
 * Transactions are sent strictly one at a time; callers must await
 * confirmation before sending the next transaction.
 */
export class TxSender {
    readonly #provider: ethers.JsonRpcProvider;
    readonly #wallet: ethers.Wallet;
    #chainId?: number;

    constructor(rpc: string, privateKey: string) {
        this.#provider = new ethers.JsonRpcProvider(rpc);
        this.#wallet = new ethers.Wallet(privateKey, this.#provider);
    }

    async getChainId(): Promise<number> {
        if (this.#chainId === undefined) {
            const network = await stableRetry(() => this.#provider.getNetwork());
            this.#chainId = Number(network.chainId);
        }
        return this.#chainId;
    }

    // ====================== Gas API ======================
    async getFeeData(): Promise<ethers.FeeData> {
        return await stableRetry(() => this.#provider.getFeeData());
    }

    /**
     * Base fee of the latest block (EIP-1559), or null on legacy chains.
     */
    async getBaseFee(): Promise<bigint | null> {
        const block = await stableRetry(() => this.#provider.getBlock('latest'));
        return block?.baseFeePerGas ?? null;
    }

    /**
     * Resolve concrete gas fees for a transaction, by chain fee model:
     * - Legacy chains (no base fee, e.g. BNB Chain): a single gasPrice paid in full,
     *   taken from the node unless overridden via custom.gasPrice.
     * - Avalanche C-Chain: EIP-1559 with a protocol-enforced minimum base fee of
     *   25 nAVAX; the node-reported base fee is clamped to that floor.
     * - Other (EIP-1559) chains: tip defaults to 100 wei,
     *   maxFeePerGas defaults to 1.1 * baseFee + tip (baseFee from the latest block).
     * Caller-provided fields take precedence. effectiveGasPrice is the expected
     * price actually charged per gas unit.
     */
    async resolveGasFees(custom: GasFeeOptions = {}): Promise<ResolvedGasFees> {
        const chainId = await this.getChainId();
        const isLegacyChain = LEGACY_GAS_CHAIN_IDS.has(chainId);
        let baseFee = isLegacyChain ? null : await this.getBaseFee();

        // Avalanche C-Chain enforces a minimum base fee of 25 nAVAX; clamp to the
        // floor so an under-reporting RPC can never yield an under-priced cap.
        if (AVALANCHE_GAS_CHAIN_IDS.has(chainId) &&
            (baseFee == null || baseFee < AVALANCHE_MIN_BASE_FEE_PER_GAS)) {
            baseFee = AVALANCHE_MIN_BASE_FEE_PER_GAS;
        }

        if (baseFee != null) {
            const maxPriorityFeePerGas = custom.maxPriorityFeePerGas ?? DEFAULT_PRIORITY_FEE_PER_GAS;
            const bufferedBaseFee = (baseFee * BASE_FEE_MULTIPLIER_NUMERATOR) / BASE_FEE_MULTIPLIER_DENOMINATOR;
            const maxFeePerGas = custom.maxFeePerGas ?? (bufferedBaseFee + maxPriorityFeePerGas);
            const baseAndTip = baseFee + maxPriorityFeePerGas;
            const effectiveGasPrice = maxFeePerGas < baseAndTip ? maxFeePerGas : baseAndTip;
            return { type: 'eip1559', maxFeePerGas, maxPriorityFeePerGas, effectiveGasPrice };
        }

        // Legacy model (known legacy chain, or no base fee reported): a single gas price.
        const feeData = await this.getFeeData();
        const gasPrice = custom.gasPrice ?? feeData.gasPrice;
        if (gasPrice != null) {
            return { type: 'legacy', gasPrice, effectiveGasPrice: gasPrice };
        }
        // Last resort for chains that report no base fee but suggest EIP-1559 fields.
        if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
            const maxFeePerGas = custom.maxFeePerGas ?? feeData.maxFeePerGas;
            const maxPriorityFeePerGas = custom.maxPriorityFeePerGas ?? feeData.maxPriorityFeePerGas;
            return { type: 'eip1559', maxFeePerGas, maxPriorityFeePerGas, effectiveGasPrice: maxFeePerGas };
        }
        throw new Error("Failed to resolve gas fees: the network provides neither base fee nor gas price.");
    }

    async waitForReceipt(hash: string): Promise<ethers.TransactionReceipt | null> {
        if (!hash || !ethers.isHexString(hash)) throw new Error("Invalid transaction hash");
        return await stableRetry(() => this.#provider.waitForTransaction(hash));
    }

    async getTransactionResult(hash: string): Promise<UploadResult> {
        const receipt = await this.waitForReceipt(hash);
        return {txCost: calcTxCost(receipt), success: receipt?.status === 1};
    }

    // ====================== Public Send API ======================
    /**
     * Sends a single transaction. No locking or manual nonce management:
     * uploads are strictly sequential, so the wallet's automatic nonce
     * handling is always up to date.
     */
    async sendTx(tx: ethers.TransactionRequest): Promise<ethers.TransactionResponse> {
        return stableRetry(() => this.#wallet.sendTransaction(tx));
    }
}
