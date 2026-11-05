// src/utils/appUpdate.ts   (new file, put it next to referralUtils.ts)
//
// expo-application is already installed in your project, so nothing else to install.
// Call checkForAppUpdate() from RootNavigator once `user` is signed in (see bottom).

import * as Application from 'expo-application';
import { Alert, Linking, Platform } from 'react-native';
import { supabase } from '../config/supabase';

let alreadyAskedThisLaunch = false;

export async function checkForAppUpdate() {
  if (Platform.OS !== 'android' || alreadyAskedThisLaunch) return;

  // On Android, nativeBuildVersion is the versionCode, the number Google Play compares.
  // EAS Update (over-the-air) never changes it, so OTA updates never trigger this popup.
  const build = parseInt(Application.nativeBuildVersion ?? '0', 10);
  const version = Application.nativeApplicationVersion ?? '';
  if (!build) return;

  try {
    // Tell the backend which version this person runs (for your own stats).
    await supabase.rpc('report_app_version', {
      p_version: version,
      p_build: build,
      p_platform: 'android',
    });

    // Ask the backend whether a newer Play Store build exists.
    const { data, error } = await supabase.rpc('check_app_update', {
      p_platform: 'android',
      p_build: build,
    });
    if (error || !data?.update_available) return;

    alreadyAskedThisLaunch = true;

    const openStore = () =>
      Linking.openURL(data.store_url).catch(() => Linking.openURL(data.web_url));

    Alert.alert(
      data.title || 'Update available',
      data.message || 'A new version of LumVibe is available. Please update to continue.',
      data.force
        ? [{ text: 'Update', onPress: openStore }] // required update: no cancel button
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Update', onPress: openStore },
          ],
      { cancelable: !data.force },
    );
  } catch {
    // An update check must never crash or block the app.
  }
}

// In RootNavigator (the component that already reads `user` from useAuthStore):
//
//   import { checkForAppUpdate } from '../utils/appUpdate';   // adjust the path if needed
//
//   const user = useAuthStore((s) => s.user);
//   useEffect(() => {
//     if (user?.id) checkForAppUpdate();
//   }, [user?.id]);
