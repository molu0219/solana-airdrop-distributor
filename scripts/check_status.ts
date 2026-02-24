import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaClaim } from "../target/types/solana_claim";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

/**
 * Script to check all claim statuses and global stats.
 */
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.SolanaClaim as Program<SolanaClaim>;

    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId
    );

    console.log("--- Global Statistics ---");
    try {
        const config = await program.account.globalConfig.fetch(configPda);
        console.log(`Owner: ${config.owner.toBase58()}`);
        console.log(`Paused: ${config.paused}`);
        console.log(`Total Allocated: ${config.totalAllocated.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
        console.log(`Total Claimed: ${config.totalClaimed.toNumber() / anchor.web3.LAMPORTS_PER_SOL} SOL`);
        console.log(`Remaining in Vault: ${(config.totalAllocated.toNumber() - config.totalClaimed.toNumber()) / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    } catch (e) {
        console.log("Global config not initialized or error fetching.");
    }

    console.log("\n--- User Claim Statuses ---");
    const allClaims = await program.account.claimStatus.all();

    if (allClaims.length === 0) {
        console.log("No claim records found.");
    } else {
        const data = allClaims.map(c => ({
            Address: c.account.user.toBase58(),
            Allocated: c.account.totalAllocated.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
            Claimed: c.account.totalClaimed.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
            Pending: (c.account.totalAllocated.toNumber() - c.account.totalClaimed.toNumber()) / anchor.web3.LAMPORTS_PER_SOL,
        }));

        console.table(data);

        // Export to CSV
        const csvContent = "address,allocated,claimed,pending\n" +
            data.map(d => `${d.Address},${d.Allocated},${d.Claimed},${d.Pending}`).join("\n");

        fs.writeFileSync("./status_report.csv", csvContent);
        console.log("\nStatus report exported to status_report.csv");
    }

}

main();
