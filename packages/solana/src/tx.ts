import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  AddressLookupTableAccount,
} from "@solana/web3.js";

const DONT_FRONT = new PublicKey("jitodontfront111111111111111111111111111111");

export interface ApiInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export function decodeInstruction(ix: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

export function withDontFront(ix: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: [...ix.keys, { pubkey: DONT_FRONT, isSigner: false, isWritable: false }],
    data: ix.data,
  });
}

export async function loadAltAccounts(
  connection: Connection,
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  const accounts: AddressLookupTableAccount[] = [];
  for (const addr of addresses) {
    const res = await connection.getAddressLookupTable(new PublicKey(addr));
    if (res.value) accounts.push(res.value);
  }
  return accounts;
}

export interface BuildTxParams {
  connection: Connection;
  payer: PublicKey;
  instructions: TransactionInstruction[];
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
  altAccounts?: AddressLookupTableAccount[];
}

export async function buildV0Transaction(p: BuildTxParams): Promise<VersionedTransaction> {
  const { blockhash } = await p.connection.getLatestBlockhash("confirmed");
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: p.computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.computeUnitPriceMicroLamports }),
    ...p.instructions,
  ];
  const message = new TransactionMessage({
    payerKey: p.payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(p.altAccounts ?? []);
  return new VersionedTransaction(message);
}

export async function simulateForCuLimit(
  connection: Connection,
  tx: VersionedTransaction,
  fallback = 200_000,
): Promise<number> {
  try {
    const sim = await connection.simulateTransaction(tx, { sigVerify: false });
    const used = sim.value.unitsConsumed;
    if (used && used > 0) return Math.ceil(used * 1.1);
    return fallback;
  } catch {
    return fallback;
  }
}

export function signTx(tx: VersionedTransaction, signer: Keypair): VersionedTransaction {
  tx.sign([signer]);
  return tx;
}
