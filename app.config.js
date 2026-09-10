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
      ["@livekit/react-native-expo-plugin", { "android": { "audioType": "communication" } }],
      "@config-plugins/react-native-webrtc",
      "expo-notifications",
      "expo-iap"
    ]
  }
};
