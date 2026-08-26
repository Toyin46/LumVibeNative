export default {
  "expo": {
    "name": "LumVibeNative",
    "slug": "LumVibeNative",
    "version": "1.0.0",
    "scheme": "lumvibenative",
    "orientation": "portrait",
    "icon": "./src/assets/images/icon.png",
    "runtimeVersion": {
      "policy": "appVersion"
    },
    "splash": {
      "image": "./src/assets/images/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#000000"
    },
    "extra": {
      "eas": {
        "projectId": "52b32ab2-baf0-4bba-9b9c-2fb64c455edd"
      },
      "livekitUrl": process.env.LIVEKIT_URL
    },
        "android": {
      "package": "com.kinsta.kinsta2",
      "googleServicesFile": "./google-services.json",
      "adaptiveIcon": {
        "foregroundImage": "./src/assets/images/adaptive-icon.png",
        "backgroundColor": "#000000"
      }
    },
    "plugins": [
      "expo-audio",
      "expo-localization",
      "expo-secure-store",
      "expo-video",
      "expo-web-browser",
      // ✅ NEW: this is the actual fix for "Audio device module is not
      // initialized — did you remember to call LiveKitReactNative.setup
      // in your Application.onCreate?" With EAS builds (no android/
      // folder to hand-edit), this plugin does that native setup call for
      // you automatically at build time. Needs a new EAS build to take
      // effect — a reload won't pick up a native config plugin change.
      ["@livekit/react-native-expo-plugin", { "android": { "audioType": "communication" } }],
      "@config-plugins/react-native-webrtc",
      // ✅ NEW: needed for expo-notifications' Android channel/icon setup
      // (the call-ringing push notifications added to chat/[id].tsx).
      "expo-notifications"
    ]
  }
}; 
   