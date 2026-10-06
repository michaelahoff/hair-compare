import { Tabs, router } from "expo-router";
import { HeaderButtons, Icon, IconButton, colors } from "@/components/ui";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: {
          fontWeight: "800",
          fontSize: 28,
          letterSpacing: -0.8,
        },
        headerTitleAlign: "left",
        headerTintColor: colors.ink,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          shadowColor: colors.stage,
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Photos",
          tabBarIcon: ({ color }) => <Icon name="photos" color={color} />,
          headerRight: () => (
            <HeaderButtons>
              <IconButton
                icon="upload"
                label="Import photos"
                onPress={() => router.push("/import")}
              />
              <IconButton
                icon="account"
                label="Account"
                onPress={() => router.push("/account")}
              />
            </HeaderButtons>
          ),
        }}
      />
      <Tabs.Screen
        name="compare"
        options={{
          title: "Compare",
          tabBarIcon: ({ color }) => <Icon name="compare" color={color} />,
        }}
      />
      <Tabs.Screen
        name="treatments"
        options={{
          title: "Treatments",
          tabBarIcon: ({ color }) => <Icon name="treatments" color={color} />,
        }}
      />
    </Tabs>
  );
}
