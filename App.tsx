import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { RootNavigator } from './src/navigation';
import { colors } from './src/constants';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

export default function App() {
  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7733/ingest/2ce51378-5f1a-4782-9a65-c75641847f4f',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46b743'},body:JSON.stringify({sessionId:'46b743',location:'App.tsx:boot',message:'App mounted — React Navigation entry (no expo-router)',data:{entryPoint:'index.js',devClient:true},timestamp:Date.now(),hypothesisId:'E',runId:'post-fix'})}).catch(()=>{});
  }, []);
  // #endregion

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer theme={navigationTheme}>
          <StatusBar style="light" />
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

