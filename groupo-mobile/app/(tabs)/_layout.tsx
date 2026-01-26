import { Tabs, usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const pathname = usePathname();
  const groupMatch = pathname.match(/\/group\/([^/]+)/);
  const activeGroupId = groupMatch?.[1];

  const handlePostPress = () => {
    if (process.env.EXPO_OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (activeGroupId) {
      router.push(`/post?groupId=${encodeURIComponent(activeGroupId)}`);
      return;
    }
    router.push('/post');
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: '',
          tabBarLabel: '',
          headerShown: false,
          tabBarButton: (props) => (
            <Pressable
              {...props}
              onPress={handlePostPress}
              style={[styles.postButton, props.style]}
            >
              <View style={[styles.postButtonInner, { backgroundColor: Colors[colorScheme ?? 'light'].tint }]}>
                <IconSymbol size={28} name="plus" color="#fff" />
              </View>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.3.fill" color={color} />,
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="group/[id]"
        options={{
          href: null, // hide from tab bar, still accessible via navigation
          headerShown: true,
        }}
      />
      <Tabs.Screen
        name="group/[id]/settings"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  postButton: {
    top: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
