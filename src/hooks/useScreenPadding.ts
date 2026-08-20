// src/hooks/useScreenPadding.ts
//
// POLISH FIX: 28 screens across the app use a hardcoded `paddingTop: 60` on
// their headers instead of reading the phone's real safe area. This is a
// guess that only happens to look right on the specific phone it was built
// on. Different Android phones have different status bar heights — a
// budget phone with a slim status bar ends up with extra dead space at the
// top, while a phone with a tall notch/punch-hole camera can have its
// header text or buttons partly covered. The bottom edge has the same
// problem with gesture bars and on-screen nav buttons.
//
// This hook reads the ACTUAL safe area for the device the app is currently
// running on, so headers and footers sit correctly no matter the phone.
//
// USAGE — replace this:
//   header: { paddingTop: 60, ... }
//
// with this:
//   const pad = useScreenPadding();
//   ...
//   <View style={[s.header, { paddingTop: pad.top + 16 }]}>
//
// (+16 keeps the same visual breathing room the old hardcoded value had
// baked in — adjust per-screen if a design needs more/less.)

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useScreenPadding() {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top,
    bottom: insets.bottom,
    left: insets.left,
    right: insets.right,
  };
}
