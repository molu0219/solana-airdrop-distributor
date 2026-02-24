import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaClaim } from "../target/types/solana_claim";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import { parse } from "csv-parse/sync";

/**
 * Workflow: set_paused(true) -> Read CSV -> set_claim one by one (or batch) -> set_paused(false)
 */
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.SolanaClaim as Program<SolanaClaim>;

    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId
    );

    // 1. Pause the program
    console.log("Pausing program for updates...");
    await program.methods
        .setPaused(true)
        .accounts({
            globalConfig: configPda,
            owner: provider.wallet.publicKey,
        })
        .rpc();

    try {
        // 2. Read CSV
        const fileContent = fs.readFileSync("./claims.csv", "utf-8");
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
        });

        console.log(`Processing ${records.length} records from CSV...`);

        for (const record of records) {
            const userPubkey = new PublicKey(record.address.trim());
            const addAmount = new anchor.BN(parseFloat(record.amount) * anchor.web3.LAMPORTS_PER_SOL);

            const [claimPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("claim"), userPubkey.toBuffer()],
                program.programId
            );

            console.log(`Updating ${record.address}: +${record.amount} SOL`);
            await program.methods
                .setClaim(addAmount)
                .accounts({
                    globalConfig: configPda,
                    owner: provider.wallet.publicKey,
                    user: userPubkey,
                    claimStatus: claimPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
        }
    } catch (e) {
        console.error("Error during update:", e);
    } finally {
        // 3. Unpause
        console.log("Unpausing program...");
        await program.methods
            .setPaused(false)
            .accounts({
                globalConfig: configPda,
                owner: provider.wallet.publicKey,
            })
            .rpc();
        console.log("All updates completed.");
    }
}

main();

