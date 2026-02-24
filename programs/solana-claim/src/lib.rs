use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod solana_claim {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let global_config = &mut ctx.accounts.global_config;
        global_config.owner = ctx.accounts.owner.key();
        global_config.vault_bump = *ctx.bumps.get("vault").unwrap();
        global_config.paused = false;
        global_config.total_allocated = 0;
        global_config.total_claimed = 0;
        Ok(())
    }

    /// Owner can explicitly set the pause status
    pub fn set_paused(ctx: Context<OwnerOnly>, paused: bool) -> Result<()> {
        let global_config = &mut ctx.accounts.global_config;
        global_config.paused = paused;
        Ok(())
    }

    /// Optimized batch allocation for dynamic user lists
    /// Note: This still requires passing all PDA accounts in remaining_accounts
    pub fn set_claims_batch(
        ctx: Context<SetClaimsBatch>,
        add_amounts: Vec<u64>,
    ) -> Result<()> {
        let global_config = &mut ctx.accounts.global_config;
        let mut total_added: u64 = 0;

        for (i, account_info) in ctx.remaining_accounts.iter().enumerate() {
            let mut claim_status = Account::<ClaimStatus>::try_from(account_info)?;
            let add_amount = add_amounts[i];
            
            claim_status.total_allocated = claim_status.total_allocated.checked_add(add_amount).unwrap();
            total_added = total_added.checked_add(add_amount).unwrap();
            
            claim_status.exit(ctx.program_id)?;
        }

        global_config.total_allocated = global_config.total_allocated.checked_add(total_added).unwrap();
        Ok(())
    }

    /// Owner sets or increases the allocation for a single user
    pub fn set_claim(ctx: Context<SetClaim>, add_amount: u64) -> Result<()> {
        let global_config = &mut ctx.accounts.global_config;
        let claim_status = &mut ctx.accounts.claim_status;

        claim_status.user = ctx.accounts.user.key();
        claim_status.total_allocated = claim_status.total_allocated.checked_add(add_amount).unwrap();
        
        global_config.total_allocated = global_config.total_allocated.checked_add(add_amount).unwrap();

        Ok(())
    }

    /// User claims their pending SOL allocation
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let global_config = &mut ctx.accounts.global_config;
        require!(!global_config.paused, ClaimError::ProgramPaused);

        let claim_status = &mut ctx.accounts.claim_status;
        let vault = &ctx.accounts.vault;
        let user = &ctx.accounts.user;

        let pending_amount = claim_status.total_allocated.checked_sub(claim_status.total_claimed).unwrap();
        require!(pending_amount > 0, ClaimError::NothingToClaim);

        // Transfer SOL from vault to user
        let vault_bump = global_config.vault_bump;
        let seeds = &[b"vault".as_ref(), &[vault_bump]];
        let signer = &[&seeds[..]];

        anchor_lang::solana_program::program::invoke_signed(
            &system_instruction::transfer(vault.key, user.key, pending_amount),
            &[
                vault.to_account_info(),
                user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        // Update state
        claim_status.total_claimed = claim_status.total_claimed.checked_add(pending_amount).unwrap();
        global_config.total_claimed = global_config.total_claimed.checked_add(pending_amount).unwrap();

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        anchor_lang::solana_program::program::invoke(
            &system_instruction::transfer(&ctx.accounts.owner.key(), &ctx.accounts.vault.key(), amount),
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 1 + 1 + 8 + 8,
        seeds = [b"config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [b"vault"],
        bump
    )]
    /// CHECK: Vault PDA
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(mut, has_one = owner)]
    pub global_config: Account<'info, GlobalConfig>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetClaimsBatch<'info> {
    #[account(mut, has_one = owner)]
    pub global_config: Account<'info, GlobalConfig>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(add_amount: u64)]
pub struct SetClaim<'info> {
    #[account(mut, has_one = owner)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: User to allocate
    pub user: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + 32 + 8 + 8,
        seeds = [b"claim", user.key().as_ref()],
        bump
    )]
    pub claim_status: Account<'info, ClaimStatus>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump = global_config.vault_bump
    )]
    /// CHECK: Vault PDA
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"claim", user.key().as_ref()],
        bump,
        has_one = user
    )]
    pub claim_status: Account<'info, ClaimStatus>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(has_one = owner)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault"],
        bump = global_config.vault_bump
    )]
    /// CHECK: Vault PDA
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct GlobalConfig {
    pub owner: Pubkey,
    pub vault_bump: u8,
    pub paused: bool,
    pub total_allocated: u64,
    pub total_claimed: u64,
}

#[account]
pub struct ClaimStatus {
    pub user: Pubkey,
    pub total_allocated: u64,
    pub total_claimed: u64,
}

#[error_code]
pub enum ClaimError {
    #[msg("Program is currently paused")]
    ProgramPaused,
    #[msg("Nothing to claim")]
    NothingToClaim,
}


