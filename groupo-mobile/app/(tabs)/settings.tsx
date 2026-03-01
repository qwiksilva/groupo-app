import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Button,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { setToken, fetchMe, updateMe, changePassword, deleteAccount } from '../lib/api';

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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const persistUser = async (nextUser: any) => {
    setUser(nextUser);
    setFirstName(nextUser?.first_name || '');
    setLastName(nextUser?.last_name || '');
    setPhoneNumber(nextUser?.phone_number || '');
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
  };

  useEffect(() => {
    const loadUser = async () => {
      try {
        const stored = await SecureStore.getItemAsync(USER_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed);
          setFirstName(parsed?.first_name || '');
          setLastName(parsed?.last_name || '');
          setPhoneNumber(parsed?.phone_number || '');
        }
        const fresh = await fetchMe();
        await persistUser(fresh);
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

  const handleSaveProfile = async () => {
    try {
      setBusy(true);
      const updated = await updateMe({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim() || null,
      });
      await persistUser(updated);
      setStatus('Profile updated.');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus('Fill out all password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setStatus('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('New password confirmation does not match.');
      return;
    }
    try {
      setBusy(true);
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus('Password changed.');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteAccount = () => {
    Alert.alert('Delete account?', 'This permanently deletes your account and your posts.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(true);
            await deleteAccount();
            await handleLogout();
          } catch (err: any) {
            setStatus(err.response?.data?.error || err.message);
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Settings</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Username</Text>
              <Text style={styles.value}>{user?.username || 'Unknown'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Joined</Text>
              <Text style={styles.value}>{formatDate(user?.created_at)}</Text>
            </View>

            <Text style={styles.fieldLabel}>First name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>Last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="Phone number"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="done"
            />

            <Button title={busy ? 'Saving...' : 'Save profile'} onPress={handleSaveProfile} disabled={busy} />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Password</Text>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              returnKeyType="next"
            />
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              returnKeyType="next"
            />
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleChangePassword}
            />
            <Button title={busy ? 'Updating...' : 'Change password'} onPress={handleChangePassword} disabled={busy} />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Danger Zone</Text>
            <Button title="Delete account" color="#a00" onPress={confirmDeleteAccount} disabled={busy} />
          </View>

          {status ? <Text style={styles.status}>{status}</Text> : null}

          <View style={styles.footer}>
            <Button title="Log out" color="#a00" onPress={handleLogout} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '700' },
  section: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: '#666' },
  value: { fontWeight: '600', color: '#111' },
  fieldLabel: { fontSize: 13, color: '#555', marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: '#d8d8d8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  status: { color: '#c00', paddingHorizontal: 4 },
  footer: { marginTop: 4 },
});

export default SettingsScreen;
