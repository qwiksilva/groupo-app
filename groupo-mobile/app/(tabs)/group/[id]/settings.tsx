import React, { useState } from 'react';
import { SafeAreaView, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { updateGroup, addGroupMember } from '../../../lib/api';

const GroupSettings = () => {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);
  const router = useRouter();

  const [name, setName] = useState(params.name || '');
  const [usernameToAdd, setUsernameToAdd] = useState('');
  const [status, setStatus] = useState('');

  const saveName = async () => {
    try {
      await updateGroup(groupId, name);
      setStatus('Group name updated');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const addMember = async () => {
    if (!usernameToAdd) return;
    try {
      await addGroupMember(groupId, usernameToAdd);
      setStatus(`Added ${usernameToAdd}`);
      setUsernameToAdd('');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Group settings</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput value={name} onChangeText={setName} style={styles.input} />
      <Button title="Save" onPress={saveName} />

      <Text style={[styles.label, { marginTop: 16 }]}>Add member by username</Text>
      <TextInput
        placeholder="username"
        value={usernameToAdd}
        onChangeText={setUsernameToAdd}
        style={styles.input}
        autoCapitalize="none"
      />
      <Button title="Add" onPress={addMember} />

      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Button title="Back to group" onPress={() => router.back()} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  status: { marginTop: 8, color: '#c00' },
});

export default GroupSettings;
