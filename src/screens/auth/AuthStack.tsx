import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Login from '../../(auth)/login';
import Signup from '../../(auth)/signup';

export type AuthStackParamList = {
  Login:  undefined;
  Signup: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login"  component={Login} />
      <Stack.Screen name="Signup" component={Signup} />
    </Stack.Navigator>
  );
}

export default AuthStack;