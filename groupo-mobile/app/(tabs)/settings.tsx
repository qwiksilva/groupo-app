import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, Button } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { setToken } from '../lib/api';

const TOKEN_KEY = 'groupo_auth_token';
const USER_KEY = 'groupo_user';

const formatDate = (value?: string | null) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString();
};

const SettingsScreen = () => {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    const loadUser = async () => {
      try {
        const stored = await SecureStore.getItemAsync(USER_KEY);
        if (stored) {
          setUser(JSON.parse(stored));
        }
      } catch {
        setUser(null);
      }
    };
    loadUser();
  }, []);

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setToken(null);
    router.replace('/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Info</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Username</Text>
          <Text style={styles.value}>{user?.username || 'Unknown'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>
            {user?.first_name || user?.last_name ? `${user?.first_name || ''} ${user?.last_name || ''}`.trim() : 'Unknown'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Joined</Text>
          <Text style={styles.value}>{formatDate(user?.created_at)}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Button title="Log out" color="#a00" onPress={handleLogout} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  section: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#666' },
  value: { fontWeight: '600', color: '#111' },
  footer: { marginTop: 'auto' },
});

export default SettingsScreen;
