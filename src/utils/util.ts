import { ethers } from "ethers";
import { ContentLike, BufferLike, FileLike, TxCost } from "../param";

export const stringToHex = (s: string): string => ethers.hexlify(ethers.toUtf8Bytes(s));

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
