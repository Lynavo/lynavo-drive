import { apiPost } from './api';
import { getAppConfig } from './app-config-service';

export interface GiftCardConfig {
  enabled: boolean;
}

export interface GiftCardRedeemResult {
  plan: string;
  giftCardId: number;
  startAt: string;
  expireAt: string;
  redeemedAt: string;
  remainingUses: number;
  status: string;
}

interface GiftCardRedeemResponse {
  plan: string;
  gift_card_id: number;
  start_at: string;
  expire_at: string;
  redeemed_at: string;
  remaining_uses: number;
  status: string;
}

export async function getGiftCardConfig(): Promise<GiftCardConfig> {
  const config = await getAppConfig();
  return config.giftCard;
}

export async function redeemGiftCard(
  code: string,
): Promise<GiftCardRedeemResult> {
  const data = await apiPost<GiftCardRedeemResponse>('/gift-cards/redeem', {
    code: code.trim().toUpperCase(),
  });
  return {
    plan: data.plan,
    giftCardId: data.gift_card_id,
    startAt: data.start_at,
    expireAt: data.expire_at,
    redeemedAt: data.redeemed_at,
    remainingUses: data.remaining_uses,
    status: data.status,
  };
}
