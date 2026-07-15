import { StyleSheet } from 'react-native';
import { colors } from './colors';

export const globalStyles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: colors.screenBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.screenTitle,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
