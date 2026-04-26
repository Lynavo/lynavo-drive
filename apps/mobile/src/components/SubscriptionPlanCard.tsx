import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const DARK = '#202022';
const CARD_BG = '#ffffff';
const CARD_BORDER = 'rgba(187, 214, 233, 0.72)';
const MUTED_TEXT = '#7893ab';
const DESTRUCTIVE_RED = '#e53935';
const PLAN_DISABLED_BG = '#edf5fb';
const PLAN_DISABLED_TEXT = '#afb6bf';
const PLAN_SELECTED_BORDER = '#3a3a3d';

export interface SubscriptionPlanCardProps {
  title: string;
  description: string;
  badges: readonly string[];
  price: string;
  unit: string;
  oldPrice?: string;
  savingsBadge?: string;
  selected: boolean;
  disabled?: boolean;
  recommended?: boolean;
  /** When set, renders a small "目前方案" / "Current Plan" label in the
   *  top-right corner. Callers should also pass `disabled` to block the
   *  pointless self-select tap. */
  currentBadge?: string;
  /** Card width override — calculated by `planCardWidth(N)` so 1/2/3 cards
   *  always tile edge-to-edge under the section padding. */
  width: number;
  onPress: () => void;
}

export function SubscriptionPlanCard({
  title,
  description,
  badges,
  price,
  unit,
  oldPrice,
  savingsBadge,
  selected,
  disabled,
  recommended,
  currentBadge,
  width,
  onPress,
}: SubscriptionPlanCardProps) {
  return (
    <TouchableOpacity
      style={[
        planStyles.card,
        { width },
        // Layer order matters: recommended decoration first (so it surfaces
        // when the card is *not* the active selection), selection overlay
        // wins on top, disabled overrides everything because tapping a
        // current/downgrade plan is a no-op.
        !disabled && !selected && recommended
          ? planStyles.cardRecommended
          : null,
        !disabled && selected
          ? planStyles.cardSelected
          : !disabled && !recommended
          ? planStyles.cardUnselected
          : null,
        disabled ? planStyles.cardDisabled : null,
      ]}
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
    >
      {currentBadge ? (
        <View style={planStyles.currentBadge}>
          <Text style={planStyles.currentBadgeText}>{currentBadge}</Text>
        </View>
      ) : null}
      {badges.length > 0 ? (
        <View style={planStyles.badgeRow}>
          {badges.map(label => (
            <View key={label} style={planStyles.metaBadge}>
              <Text style={planStyles.metaBadgeText} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text
        style={[
          planStyles.title,
          disabled ? planStyles.textDisabled : planStyles.textTitle,
        ]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={[
            planStyles.description,
            disabled ? planStyles.textDisabled : planStyles.textDescription,
          ]}
          numberOfLines={2}
        >
          {description}
        </Text>
      ) : null}
      <Text
        style={[
          planStyles.price,
          disabled
            ? planStyles.textDisabled
            : selected
            ? planStyles.textSelected
            : planStyles.textUnselected,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {price}
      </Text>
      <Text
        style={[
          planStyles.unit,
          disabled
            ? planStyles.unitDisabled
            : selected
            ? planStyles.unitSelected
            : planStyles.unitUnselected,
        ]}
        numberOfLines={1}
      >
        {unit}
      </Text>
      {oldPrice ? (
        <View style={planStyles.metaRow}>
          <Text
            style={planStyles.oldPrice}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {oldPrice}
          </Text>
          {savingsBadge ? (
            <View style={planStyles.savingsBadge}>
              <Text
                style={planStyles.savingsBadgeText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {savingsBadge}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={planStyles.metaSpacer} />
      )}
    </TouchableOpacity>
  );
}

const planStyles = StyleSheet.create({
  card: {
    minHeight: 178,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  cardSelected: {
    backgroundColor: CARD_BG,
    borderColor: PLAN_SELECTED_BORDER,
    shadowColor: '#1f2937',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardUnselected: {
    backgroundColor: CARD_BG,
    borderColor: CARD_BORDER,
  },
  cardRecommended: {
    backgroundColor: CARD_BG,
    // Muted accent so the recommended card reads as "elevated default" without
    // visually shouting over an actually-selected card. PLAN_SELECTED_BORDER
    // (dark) stays exclusive to the selection state — see render-time priority
    // above.
    borderColor: MUTED_TEXT,
    shadowColor: '#1f2937',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 5,
  },
  cardDisabled: {
    backgroundColor: PLAN_DISABLED_BG,
    borderColor: 'rgba(196, 214, 228, 0.72)',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'center',
    marginBottom: 6,
  },
  metaBadge: {
    backgroundColor: 'rgba(58, 58, 61, 0.08)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3a3a3d',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  textTitle: {
    color: DARK,
  },
  description: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  textDescription: {
    color: MUTED_TEXT,
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
  },
  textSelected: {
    color: DARK,
  },
  textUnselected: {
    color: DARK,
  },
  textDisabled: {
    color: PLAN_DISABLED_TEXT,
  },
  unit: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  unitSelected: {
    color: '#6f747c',
  },
  unitUnselected: {
    color: MUTED_TEXT,
  },
  unitDisabled: {
    color: '#c2c8cf',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  metaSpacer: {
    height: 23,
    marginTop: 10,
  },
  oldPrice: {
    fontSize: 11,
    color: '#b9b0b0',
    textDecorationLine: 'line-through',
  },
  savingsBadge: {
    backgroundColor: DESTRUCTIVE_RED,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  savingsBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  currentBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(83, 200, 120, 0.16)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2e7d4f',
  },
});
