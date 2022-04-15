import * as anchor from "@project-serum/anchor";
import {
  MangoClient,
  MangoGroup,
  QUOTE_INDEX,
} from "@blockworks-foundation/mango-client";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddress,
  MintLayout,
} from "@solana/spl-token";
import { expect } from "chai";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MANGO_PROGRAM_ID = new PublicKey("4skJ85cdxQAFVKbcGgfun8iZPL7BadVYXG3kGEGkufqA");
const DEX_PROGRAM_ID = new PublicKey("DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY");
const ZERO_KEY = new PublicKey(new Uint8Array(32));

const DAO_MEMBER = new PublicKey("Cwg1f6m4m3DGwMEbmsbAfDtUToUf5jRdKrJSGD7GfZCB");

const mintKeypairs = {
  usdc: [
    128, 233, 175, 86, 229, 167, 240, 86, 36, 45, 248, 140, 109, 119, 216, 1, 182, 248,
    200, 30, 70, 91, 225, 178, 104, 49, 146, 222, 250, 49, 144, 236, 13, 139, 116, 152,
    66, 15, 46, 90, 94, 151, 56, 126, 11, 93, 203, 155, 246, 237, 58, 53, 233, 140, 51,
    20, 208, 127, 111, 122, 249, 167, 22, 208,
  ],
  msrm: [
    91, 167, 121, 75, 146, 90, 210, 17, 88, 241, 18, 144, 244, 112, 213, 163, 194, 229,
    253, 2, 62, 100, 94, 147, 177, 12, 102, 219, 177, 126, 169, 5, 5, 60, 91, 211, 178,
    27, 221, 138, 143, 11, 251, 54, 181, 251, 32, 172, 223, 95, 121, 191, 233, 201, 149,
    68, 41, 20, 101, 156, 56, 27, 86, 72,
  ],
  mango: [
    50, 228, 135, 168, 150, 113, 169, 23, 156, 175, 178, 161, 224, 240, 79, 127, 163, 37,
    20, 82, 143, 4, 34, 208, 73, 171, 134, 56, 68, 209, 14, 102, 11, 107, 71, 144, 215,
    191, 166, 157, 195, 122, 107, 138, 143, 106, 33, 112, 81, 13, 68, 233, 170, 165, 44,
    75, 190, 243, 192, 242, 46, 240, 62, 38,
  ],
  srm: [
    1, 96, 210, 200, 111, 185, 187, 72, 63, 253, 205, 129, 174, 238, 134, 106, 25, 76,
    242, 37, 139, 171, 51, 20, 20, 186, 248, 224, 144, 144, 246, 145, 12, 234, 145, 81,
    70, 187, 231, 247, 65, 33, 101, 119, 189, 34, 231, 91, 182, 72, 15, 192, 0, 244, 228,
    81, 6, 20, 191, 127, 53, 224, 62, 51,
  ],
};

async function mintTokens(
  connection: Connection,
  mint: PublicKey,
  authority: Keypair,
  recipientToken: PublicKey,
  amount: number,
  decimals: number = 6
) {
  try {
    const mintIx = createMintToCheckedInstruction(
      mint,
      recipientToken,
      authority.publicKey,
      amount * 10 ** decimals,
      decimals
    );

    const transaction = new Transaction({ feePayer: authority.publicKey }).add(mintIx);

    await connection.confirmTransaction(
      await connection.sendTransaction(transaction, [authority])
    );
  } catch (err) {
    console.error(err);
  }
}

async function createMint(name: string, connection: Connection, payer: Keypair) {
  try {
    const mintKeypair = Keypair.fromSecretKey(Uint8Array.from(mintKeypairs[name]));
    const createIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(MintLayout.span),
      space: MintLayout.span,
      programId: TOKEN_PROGRAM_ID,
    });

    const initMintIx = createInitializeMintInstruction(
      mintKeypair.publicKey,
      6,
      payer.publicKey,
      payer.publicKey
    );

    const transaction = new Transaction({ feePayer: payer.publicKey }).add(
      createIx,
      initMintIx
    );

    await connection.confirmTransaction(
      await connection.sendTransaction(transaction, [payer, mintKeypair])
    );

    return mintKeypair.publicKey;
  } catch (err) {
    console.error(err);
  }
}

async function createToken(
  connection: Connection,
  mint: PublicKey,
  payer: Keypair,
  owner: PublicKey
) {
  try {
    const tokenAddress = await getAssociatedTokenAddress(mint, owner);
    const createTokenIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      tokenAddress,
      owner,
      mint
    );

    const transaction = new Transaction({ feePayer: payer.publicKey }).add(createTokenIx);

    await connection.confirmTransaction(
      await connection.sendTransaction(transaction, [payer])
    );

    return tokenAddress;
  } catch (err) {
    console.error(err);
  }
}

async function sleep(timeMs: number) {
  return new Promise((r) => setTimeout(r, timeMs));
}

describe("MangoClient", async () => {
  let payer: Keypair;
  let feeVault: PublicKey;
  let userUSDCToken: PublicKey;

  let usdc: PublicKey;
  let msrm: PublicKey;

  let mangoGroup: MangoGroup;

  const validInterval = 5;
  const quoteOptimalUtil = 0.7;
  const quoteOptimalRate = 0.06;
  const quoteMaxRate = 1.5;
  const depositAmount = 10;

  const connection = new Connection("http://localhost:8899", {
    commitment: "confirmed",
  });

  const client = new MangoClient(connection, MANGO_PROGRAM_ID);

  before(async () => {
    payer = Keypair.generate();

    await connection.confirmTransaction(
      await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL)
    );

    usdc = await createMint("usdc", connection, payer);
    msrm = await createMint("msrm", connection, payer);
    feeVault = await createToken(connection, usdc, payer, DAO_MEMBER);
    userUSDCToken = await createToken(connection, usdc, payer, payer.publicKey);

    console.log(`USDC Address: ${usdc.toString()}`);
    console.log(`MSRM Address: ${msrm.toString()}`);

    console.log("Init");

    const groupKey = await client.initMangoGroup(
      usdc,
      msrm,
      DEX_PROGRAM_ID,
      feeVault,
      validInterval,
      quoteOptimalUtil,
      quoteOptimalRate,
      quoteMaxRate,
      payer
    );

    await sleep(50);

    mangoGroup = await client.getMangoGroup(groupKey);
  });

  it("should successfully create a mango group", async () => {
    expect(mangoGroup).to.not.be.undefined;
    expect(mangoGroup.tokens[QUOTE_INDEX].mint.toBase58(), "quoteMint").to.equal(
      usdc.toBase58()
    );
    expect(mangoGroup.admin.toBase58(), "admin").to.equal(payer.publicKey.toBase58());
    expect(mangoGroup.dexProgramId.toBase58(), "dexPerogramId").to.equal(
      DEX_PROGRAM_ID.toBase58()
    );
  });

  it("should successfully update the cache", async () => {
    const rootBankPks = mangoGroup.tokens
      .filter((tokenInfo) => !tokenInfo.mint.equals(ZERO_KEY))
      .map((tokenInfo) => tokenInfo.rootBank);

    await client.cacheRootBanks(
      mangoGroup.publicKey,
      mangoGroup.mangoCache,
      rootBankPks,
      payer
    );
  });

  it("deposit USDC and then WITHDRAW the USDC", async () => {
    const rootBanks = await mangoGroup.loadRootBanks(client.connection);
    const usdcRootBank = rootBanks[QUOTE_INDEX];

    const mangoAccountPk = await client.initMangoAccount(mangoGroup, payer);
    const mangoAccount = await client.getMangoAccount(mangoAccountPk, DEX_PROGRAM_ID);

    if (usdcRootBank) {
      console.log("USDC Root bank exists");
      const nodeBanks = await usdcRootBank.loadNodeBanks(client.connection);

      const filteredNodeBanks = nodeBanks.filter((nodeBank) => !!nodeBank);
      expect(filteredNodeBanks.length).to.equal(1);

      await mintTokens(connection, usdc, payer, userUSDCToken, depositAmount);

      await client.deposit(
        mangoGroup,
        mangoAccount,
        payer,
        mangoGroup.tokens[QUOTE_INDEX].rootBank,
        usdcRootBank.nodeBanks[0],
        filteredNodeBanks[0]!.vault,
        userUSDCToken,
        depositAmount
      );

      await client.withdraw(
        mangoGroup,
        mangoAccount,
        payer,
        mangoGroup.tokens[QUOTE_INDEX].rootBank,
        usdcRootBank.nodeBanks[0],
        filteredNodeBanks[0]!.vault,
        depositAmount,
        true
      );
    }
  });
});
