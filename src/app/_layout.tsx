import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { JournalProvider } from "@/hooks/use-journal";
import { colors } from "@/components/ui";

// Keep the tabs beneath any deep-linked or reloaded screen so back always works.
export const unstable_settings = { anchor: "(tabs)" };

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <JournalProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.ink,
              headerTitleStyle: { fontWeight: "600" },
              headerBackButtonDisplayMode: "minimal",
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen
              name="(tabs)"
              options={{ headerShown: false, title: "Follicle" }}
            />
            <Stack.Screen name="add-photo" options={{ title: "New photo" }} />
            <Stack.Screen name="import" options={{ title: "Import photos" }} />
            <Stack.Screen
              name="capture"
              options={{
                headerShown: false,
                presentation: "fullScreenModal",
                contentStyle: { backgroundColor: "#060B0A" },
              }}
            />
            <Stack.Screen name="photo/[id]" options={{ title: "" }} />
            <Stack.Screen name="line-up" options={{ title: "Line up" }} />
            <Stack.Screen name="treatment" options={{ title: "Treatment" }} />
            <Stack.Screen name="account" options={{ title: "Account" }} />
          </Stack>
        </JournalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
