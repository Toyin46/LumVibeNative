// src/lib/ringReliability.ts   (NEW FILE)
//
// Why this exists: on Infinix / Tecno / itel (Transsion), Xiaomi, Oppo, Realme,
// Vivo, Huawei and Samsung "battery saver" modes, Android or the phone maker's
// own power manager kills apps that are closed — and with them the push that
// makes a call ring. WhatsApp works only because these makers whitelist it by
// default; every other app has to be allowed once by the person, in a settings
// page that is different on every brand. No code can silently do this for the
// user, so the app asks ONCE, explains why in one sentence, and opens exactly
// the right page for THEIR phone (notifee knows each maker's page).
//
// Works on every Android phone: on stock Android (Pixel, Motorola, Nokia…) it
// only asks if battery optimisation is actually on for the app; on makers with
// a custom power manager it also opens that manager's page.

import { Alert, AppState, Linking, Platform } from 'react-native';
import notifee from '@notifee/react-native';
import * as SecureStore from 'expo-secure-store';

const PROMPTED_KEY = 'lumvibe_ring_reliability_prompted_v1';
const FULLSCREEN_KEY = 'lumvibe_fullscreen_prompted_v1';

async function markPrompted() {
  try { await SecureStore.setItemAsync(PROMPTED_KEY, '1'); } catch (_) {}
}

async function getState() {
  let batteryRestricted = false;
  let oem: { manufacturer: string } | null = null;
  try { batteryRestricted = await notifee.isBatteryOptimizationEnabled(); } catch (_) {}
  try {
    const info = await notifee.getPowerManagerInfo();
    if (info?.activity) oem = { manufacturer: info.manufacturer || 'your phone' };
  } catch (_) {}
  return { batteryRestricted, oem };
}

/** Opens the settings pages that matter (used by the prompt below, and can be
 *  wired to a "Fix call ringing" row in your Settings screen). */
export async function openRingSettings() {
  if (Platform.OS !== 'android') return;
  const { batteryRestricted, oem } = await getState();
  if (batteryRestricted) {
    await notifee.openBatteryOptimizationSettings();
    if (oem) {
      // second page, shown when they come back to the app
      const sub = AppState.addEventListener('change', (next) => {
        if (next !== 'active') return;
        sub.remove();
        Alert.alert(
          'One more step',
          `On ${oem.manufacturer} phones, also allow LumVibe to auto-start and run with no restrictions.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open', onPress: () => { notifee.openPowerManagerSettings().catch(() => {}); } },
          ],
        );
      });
    }
  } else if (oem) {
    await notifee.openPowerManagerSettings();
  }
}

/**
 * Android 14+ only: showing the call screen over the LOCK SCREEN needs the
 * "Full screen notifications" switch on for the app (Android turns it off by
 * default for apps that aren't the phone dialer). Nothing can flip it silently;
 * the app asks once and opens the app's settings page.
 */
export async function promptFullScreenOnce() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 34) return;
  try { if (await SecureStore.getItemAsync(FULLSCREEN_KEY)) return; } catch (_) {}
  try { await SecureStore.setItemAsync(FULLSCREEN_KEY, '1'); } catch (_) {}
  Alert.alert(
    'Show calls on the lock screen',
    'To see the call screen when your phone is locked, open LumVibe\'s settings and allow "Full screen notifications" (if it is off).',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
    ],
  );
}

/** Asks once, only if this phone actually needs it. Call after login. */
export async function promptReliableRingingOnce() {
  if (Platform.OS !== 'android') return;
  try { if (await SecureStore.getItemAsync(PROMPTED_KEY)) return; } catch (_) {}

  const { batteryRestricted, oem } = await getState();
  if (!batteryRestricted && !oem) { await markPrompted(); await promptFullScreenOnce(); return; }

  Alert.alert(
    'Get calls even when LumVibe is closed',
    'To ring like a normal call when the app is closed, allow LumVibe to run in the background. It takes a few seconds.',
    [
      { text: 'Not now', style: 'cancel', onPress: () => { markPrompted(); setTimeout(() => { promptFullScreenOnce(); }, 800); } },
      { text: 'Open settings', onPress: () => { markPrompted(); openRingSettings().catch(() => {}); setTimeout(() => { promptFullScreenOnce(); }, 2500); } },
    ],
  );
}
