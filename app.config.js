export default {
  "expo": {
    "name": "LumVibeNative",
    "slug": "LumVibeNative",
    "version": "1.0.0",
    "scheme": "lumvibenative",
    "orientation": "portrait",
    "icon": "./src/assets/images/icon.png",
    "runtimeVersion": "1.0.0",
    "updates": {
  "url": "https://u.expo.dev/7c7127f1-b98d-4e09-b44b-68b0a05a434d"
},
    "splash": {
      "image": "./src/assets/images/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#000000"
    },
    "extra": {
      "eas": {
        "projectId": "7c7127f1-b98d-4e09-b44b-68b0a05a434d"
      },
      "livekitUrl": "wss://lumvibe-fn3kjths.livekit.cloud" 
    },
        "android": {
      "package": "com.lumvibeapp2",
      "googleServicesFile": "./google-services.json",
      "adaptiveIcon": {
        "foregroundImage": "./src/assets/images/adaptive-icon.png",
        "backgroundColor": "#000000"
      },
      // ✅ NEW (native incoming-call UI, step 2 — the actual permissions
      // this needs to work): each one is REQUIRED for notifee's
      // fullScreenAction + looping ring + foreground call service to
      // function at all — without these, the call notification would
      // either not show full-screen, not loop the ring, or Android would
      // kill the attempt outright. This is also exactly the permission
      // set Google Play Console will ask you to declare/justify with a
      // demo video (see our earlier conversation about that requirement —
      // it's real and mandatory, not optional).
      "permissions": [
        "android.permission.USE_FULL_SCREEN_INTENT",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
        "android.permission.WAKE_LOCK",
        "android.permission.VIBRATE"
      ]
    },
    "plugins": [
      "expo-audio",
      "expo-localization",
      "expo-secure-store",
      "expo-video",
      "expo-web-browser",
      ["@livekit/react-native-expo-plugin", { "android": { "audioType": "communication" } }],
      "@config-plugins/react-native-webrtc",
      "expo-notifications",
      "expo-iap",
      // ✅ NEW (native incoming-call UI, step 1 of 2 — plugins only, no
      // behavior change yet): these are purely additive to your native
      // build config. They do NOT touch expo-notifications, which stays
      // exactly as-is for messages/likes/comments/follows/calls-as-plain-
      // pushes. @react-native-firebase/messaging is only being added so a
      // SEPARATE, later code path can reliably wake up and show a real
      // full-screen ringing UI via notifee when a call notification
      // arrives with the app killed — nothing currently working reads
      // from these two yet, so this step alone changes zero runtime
      // behavior. Requires a new EAS build (native config), not eas update.
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      "@notifee/react-native"
    ]
  }
};
