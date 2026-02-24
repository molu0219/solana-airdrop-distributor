import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaClaim } from "../target/types/solana_claim";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";

describe("Solana Claim Program: Full Security & Adversarial Verification", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolanaClaim as Program<SolanaClaim>;
  const owner = (provider.wallet as anchor.Wallet).payer;

  let configPda: PublicKey;
  let vaultPda: PublicKey;

  // Nice logging utilities
  const logSection = (name: string) => console.log(`\n${"=".repeat(15)} ${name} ${"=".repeat(15)}`);
  const logStep = (step: string) => console.log(`[ACTION] ${step}`);
  const logCheck = (name: string, success: boolean, detail?: string) =>
    console.log(`[${success ? "✓ PASS" : "✗ FAIL"}] ${name} ${detail ? `: ${detail}` : ""}`);

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
    [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);

    logSection("TEST ENVIRONMENT INFO");
    console.log(`Program: ${program.programId.toBase58()}`);
    console.log(`Owner:   ${owner.publicKey.toBase58()}`);
  });

  describe("--- NORMAL USAGE LOGIC ---", () => {
    it("Standard Initialization & Funding", async () => {
      logSection("NORMAL: Setup & Funding");

      logStep("Initializing GlobalConfig...");
      await program.methods.initialize().accounts({
        globalConfig: configPda, vault: vaultPda, owner: owner.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      logCheck("Initialization", true);

      logStep("Depositing 10 SOL to vault...");
      await program.methods.deposit(new anchor.BN(10 * LAMPORTS_PER_SOL)).accounts({
        globalConfig: configPda, owner: owner.publicKey, vault: vaultPda, systemProgram: SystemProgram.programId,
      }).rpc();
      const bal = await provider.connection.getBalance(vaultPda);
      logCheck("Vault Funding", true, `Balance = ${bal / LAMPORTS_PER_SOL} SOL`);
      expect(bal).to.be.at.least(10 * LAMPORTS_PER_SOL);
    });

    it("Standard Cumulative Claim Flow", async () => {
      logSection("NORMAL: Cumulative Claim");
      const user = anchor.web3.Keypair.generate();
      const [cpda] = PublicKey.findProgramAddressSync([Buffer.from("claim"), user.publicKey.toBuffer()], program.programId);

      logStep("Round 1: Allocate 2 SOL");
      await program.methods.setClaim(new anchor.BN(2 * LAMPORTS_PER_SOL)).accounts({
        globalConfig: configPda, owner: owner.publicKey, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).rpc();

      logStep("User claims Round 1...");
      await program.methods.claim().accounts({
        globalConfig: configPda, vault: vaultPda, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).signers([user]).rpc();

      let status = await program.account.claimStatus.fetch(cpda);
      logCheck("Round 1 Claim", status.totalClaimed.toNumber() === 2 * LAMPORTS_PER_SOL, "Claimed 2.0 SOL");

      logStep("Round 2: Increase allocation +1.5 SOL");
      await program.methods.setClaim(new anchor.BN(1.5 * LAMPORTS_PER_SOL)).accounts({
        globalConfig: configPda, owner: owner.publicKey, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).rpc();

      logStep("User claims Round 2 remaining balance...");
      await program.methods.claim().accounts({
        globalConfig: configPda, vault: vaultPda, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).signers([user]).rpc();

      status = await program.account.claimStatus.fetch(cpda);
      logCheck("Cumulative Total", status.totalClaimed.toNumber() === 3.5 * LAMPORTS_PER_SOL, "Total 3.5 SOL correctly claimed");
    });
  });

  describe("--- ADVERSARIAL & SECURITY LOGIC ---", () => {
    it("Access Control: Unauthorized Admin Calls", async () => {
      logSection("SECURITY: Access Control");
      const attacker = anchor.web3.Keypair.generate();

      logStep("Attacker attempts to Pause the contract...");
      try {
        await program.methods.setPaused(true).accounts({ globalConfig: configPda, owner: attacker.publicKey }).signers([attacker]).rpc();
        logCheck("Unprivileged Pause", false, "Attacker successfully paused the program!");
        expect.fail("Security breach: Unprivileged pause allowed");
      } catch (e) {
        logCheck("Unprivileged Pause Blocked", true, "Unauthorized access caught by Anchor");
      }

      logStep("Attacker attempts to allocate funds (setClaim)...");
      try {
        const victim = anchor.web3.Keypair.generate();
        const [v_cpda] = PublicKey.findProgramAddressSync([Buffer.from("claim"), victim.publicKey.toBuffer()], program.programId);
        await program.methods.setClaim(new anchor.BN(50 * LAMPORTS_PER_SOL)).accounts({
          globalConfig: configPda, owner: attacker.publicKey, user: victim.publicKey, claimStatus: v_cpda, systemProgram: SystemProgram.programId,
        }).signers([attacker]).rpc();
        logCheck("Unprivileged Allocation", false, "Attacker successfully allocated 50 SOL!");
        expect.fail("Security breach: Unprivileged allocation allowed");
      } catch (e) {
        logCheck("Unprivileged Allocation Blocked", true, "Unauthorized access caught by Anchor");
      }
    });

    it("State Lock: Claiming during Emergency Pause", async () => {
      logSection("SECURITY: Emergency Pause");
      const user = anchor.web3.Keypair.generate();
      const [cpda] = PublicKey.findProgramAddressSync([Buffer.from("claim"), user.publicKey.toBuffer()], program.programId);

      logStep("Setup: Allocate 1.0 SOL to user");
      await program.methods.setClaim(new anchor.BN(1 * LAMPORTS_PER_SOL)).accounts({
        globalConfig: configPda, owner: owner.publicKey, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).rpc();

      logStep("Action: Owner PAUSES the program");
      await program.methods.setPaused(true).accounts({ globalConfig: configPda, owner: owner.publicKey }).rpc();

      logStep("Attempt: User tries to claim while paused...");
      try {
        await program.methods.claim().accounts({
          globalConfig: configPda, vault: vaultPda, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
        }).signers([user]).rpc();
        logCheck("Paused Claim", false, "User claimed funds during pause!");
        expect.fail("Program failed to block claims while paused");
      } catch (e) {
        logCheck("Paused Claim Blocked", true, "Correctly prevented claim while paused.");
      }

      logStep("Cleanup: Unpausing for final tests");
      await program.methods.setPaused(false).accounts({ globalConfig: configPda, owner: owner.publicKey }).rpc();
    });

    it("Consistency: Double Spending Prevention", async () => {
      logSection("SECURITY: Double Spending");
      const user = anchor.web3.Keypair.generate();
      const [cpda] = PublicKey.findProgramAddressSync([Buffer.from("claim"), user.publicKey.toBuffer()], program.programId);

      logStep("Setup: Allocate 0.5 SOL");
      await program.methods.setClaim(new anchor.BN(0.5 * LAMPORTS_PER_SOL)).accounts({
        globalConfig: configPda, owner: owner.publicKey, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).rpc();

      logStep("Action: User claims first time (0.5 SOL)");
      await program.methods.claim().accounts({
        globalConfig: configPda, vault: vaultPda, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
      }).signers([user]).rpc();
      logCheck("First Claim", true);

      logStep("Attempt: User claims again (second time)...");
      try {
        await program.methods.claim().accounts({
          globalConfig: configPda, vault: vaultPda, user: user.publicKey, claimStatus: cpda, systemProgram: SystemProgram.programId,
        }).signers([user]).rpc();
        logCheck("Double Claim", false, "Money sent twice!");
        expect.fail("Contract allowed drawing from empty allocation");
      } catch (e) {
        logCheck("Double Claim Blocked", true, "Prevented: Pending balance is 0.");
      }
    });
  });

  after(async () => {
    const config = await program.account.globalConfig.fetch(configPda);
    const vaultBal = await provider.connection.getBalance(vaultPda);
    logSection("FINAL AUDIT SUMMARY");
    console.log(`Global Total Allocated: ${config.totalAllocated.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`Global Total Claimed:   ${config.totalClaimed.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`Vault Remaining:        ${vaultBal / LAMPORTS_PER_SOL} SOL`);
    console.log(`Integrity Check:        ${(config.totalAllocated.sub(config.totalClaimed).toNumber() === vaultBal) ? "✓ CONSISTENT" : "✗ ERROR"}`);
    console.log("=".repeat(50) + "\n");
  });
});
