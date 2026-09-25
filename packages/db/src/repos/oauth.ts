/** OAuth identities linked to players (Google, GitHub, Discord when keys exist; ARCHITECTURE 6). */
import { isUniqueViolation, mapDbError } from '../errors.ts';
import { uuidv7 } from '../ids.ts';
import type { RepoContext } from '../db-types.ts';

export interface OauthAccount {
  provider: string;
  providerUserId: string;
  playerId: string;
  createdAt: number;
}

export function oauthAccountRepo(ctx: RepoContext) {
  const { kysely: k } = ctx;
  return {
    /**
     * Links a provider identity to a player. Returns false if that identity is already linked
     * (UNIQUE (provider, provider_user_id)); other errors reject.
     */
    async link(
      playerId: string,
      provider: string,
      providerUserId: string,
      now: number = ctx.now(),
    ): Promise<boolean> {
      try {
        await k
          .insertInto('oauth_accounts')
          .values({
            id: uuidv7(now),
            provider,
            provider_user_id: providerUserId,
            player_id: playerId,
            created_at: now,
          })
          .execute();
        return true;
      } catch (err) {
        const mapped = mapDbError(err);
        if (isUniqueViolation(mapped)) return false;
        throw mapped;
      }
    },

    async findPlayerId(provider: string, providerUserId: string): Promise<string | null> {
      const row = await k
        .selectFrom('oauth_accounts')
        .select('player_id')
        .where('provider', '=', provider)
        .where('provider_user_id', '=', providerUserId)
        .executeTakeFirst();
      return row?.player_id ?? null;
    },

    async listForPlayer(playerId: string): Promise<OauthAccount[]> {
      const list = await k
        .selectFrom('oauth_accounts')
        .selectAll()
        .where('player_id', '=', playerId)
        .orderBy('id')
        .execute();
      return list.map((r) => ({
        provider: r.provider,
        providerUserId: r.provider_user_id,
        playerId: r.player_id,
        createdAt: r.created_at,
      }));
    },
  };
}

export type OauthAccountRepo = ReturnType<typeof oauthAccountRepo>;
