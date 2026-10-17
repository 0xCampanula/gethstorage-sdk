import { ethers } from "ethers";
import { ContentLike, BufferLike, FileLike, TxCost } from "../param";

export const stringToHex = (s: string): string => ethers.hexlify(ethers.toUtf8Bytes(s));

/**
 * EIP-3541 forbids deploying new contract code whose first byte is 0xEF.
 * EthStorage stores each chunk as a contract via CREATE2, so a chunk whose
 * first byte is 0xEF will revert. We avoid this by shifting chunk boundaries.
 */
export const EF_MAGIC: number = 0xef;

/**
 * Number of bytes reserved at the end of each chunk as extension headroom.
 *
 * The base chunk size is reduced by this many bytes; when a boundary would
 * leave the next chunk starting with 0xEF, the current chunk is extended by
 * up to this many bytes to absorb the run. The extended size never exceeds
 * the original (unreserved) chunk size, so the contract's maxChunkSize limit
 * is never violated.
 *
 * Probability justification (uniform random bytes):
 *   P(16 consecutive 0xEF) = (1/256)^16 ≈ 1e-38, effectively zero.
 *   Even across billions of boundaries the probability remains negligible.
 *   If a longer run ever occurs, the shrink fallback handles it.
 */
export const EF_RESERVED_BYTES: number = 16;

export interface ChunkBoundary {
    start: number;
    end: number;
}

export async function getChainId(rpc: string): Promise<number> {
    const provider = new ethers.JsonRpcProvider(rpc);
    const network = await provider.getNetwork();
    return Number(network.chainId);
}

export async function getContentChunk(content: ContentLike, start: number, end: number) {
    if (isBuffer(content)) {
        return content.slice(start, Math.min(end, content.length));
    } else {
        const slice = content.slice(start, Math.min(end, content.size));
        const data = await slice.arrayBuffer();
        return new Uint8Array(data);
    }
}

/**
 * Compute chunk boundaries for a calldata upload, shifting any boundary that
 * would leave the next chunk starting with the 0xEF magic byte (EIP-3541).
 *
 * Strategy: for each boundary, if the byte at the boundary (first byte of the
 * next chunk) is 0xEF, extend the current chunk to absorb it. If extension
 * would exceed maxChunkSize, shrink the current chunk instead. In the extremely
 * unlikely case that every byte in the adjustment window is 0xEF, the original
 * fixed boundary is kept.
 */
export async function computeCalldataChunkBoundaries(
    content: ContentLike,
    baseChunkSize: number,
    maxChunkSize: number
): Promise<ChunkBoundary[]> {
    const size = isFile(content) ? content.size : content.length;
    const boundaries: ChunkBoundary[] = [];
    let pos = 0;

    while (pos < size) {
        let end = Math.min(pos + baseChunkSize, size);

        // Only non-final chunks need their leading byte checked.
        if (end < size) {
            const maxExtendEnd = Math.min(pos + maxChunkSize, size);

            // Try to extend: find the first non-0xEF byte within the extension window.
            if (maxExtendEnd > end) {
                const extWindow = await getContentChunk(content, end, maxExtendEnd);
                let safeOffset = -1;
                for (let i = 0; i < extWindow.length; i++) {
                    if (extWindow[i] !== EF_MAGIC) {
                        safeOffset = i;
                        break;
                    }
                }
                if (safeOffset >= 0) {
                    end = end + safeOffset;
                }
            }

            // If extension didn't resolve it (all 0xEF in the window), try shrinking.
            if (end < size) {
                const firstByte = await getContentChunk(content, end, end + 1);
                if (firstByte.length > 0 && firstByte[0] === EF_MAGIC) {
                    const shrinkStart = Math.max(pos, end - 256);
                    const shrinkWindow = await getContentChunk(content, shrinkStart, end);
                    let lastSafe = -1;
                    for (let i = shrinkWindow.length - 1; i >= 0; i--) {
                        if (shrinkWindow[i] !== EF_MAGIC) {
                            lastSafe = shrinkStart + i;
                            break;
                        }
                    }
                    if (lastSafe > pos) {
                        end = lastSafe;
                    }
                }
            }
        }

        boundaries.push({ start: pos, end });
        pos = end;
    }

    return boundaries;
}

export function isBuffer(content: ContentLike): content is BufferLike {
    return content instanceof Uint8Array;
}

export function isFile(content: ContentLike): content is FileLike {
    if (isNodejs()) {
        return content && typeof content === 'object' &&
            typeof (content as any).isNodeJs === 'boolean' &&
            (content as any).isNodeJs;
    } else {
        return content instanceof File;
    }
}

export function isNodejs(): boolean {
    return typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
}

export function calcTxCost(receipt: ethers.TransactionReceipt | null): TxCost {
    if (!receipt) {
        return { normalGasCost: 0n };
    }

    // gas cost
    const normalGasCost: bigint = receipt.gasUsed * receipt.gasPrice;
    return {
        normalGasCost,
    };
}
