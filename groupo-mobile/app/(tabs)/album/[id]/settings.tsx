import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  Text,
  TextInput,
  Button,
  StyleSheet,
  FlatList,
  View,
  Keyboard,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { updateAlbum, addAlbumMember, fetchAlbumMembers } from '../../../lib/api';

const AlbumSettings = () => {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const albumId = Number(params.id);
  const router = useRouter();

  const [name, setName] = useState(params.name || '');
  const [memberLookup, setMemberLookup] = useState('');
  const [status, setStatus] = useState('');
  const [members, setMembers] = useState<any[]>([]);

  const loadMembers = useCallback(async () => {
    try {
      const data = await fetchAlbumMembers(albumId);
      setMembers(data || []);
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  }, [albumId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    setName(params.name || '');
  }, [params.name, params.id]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus('Album name is required.');
      return;
    }
    try {
      Keyboard.dismiss();
      const updated = await updateAlbum(albumId, trimmed);
      setName(updated?.name || trimmed);
      setStatus('Album name updated.');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const addMember = async () => {
    const lookup = memberLookup.trim();
    if (!lookup) return;
    try {
      Keyboard.dismiss();
      const added = await addAlbumMember(albumId, lookup);
      setStatus(`Added ${added?.username || lookup}`);
      setMemberLookup('');
      loadMembers();
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.content}>
            <Text style={styles.title}>Album settings</Text>

            <Text style={styles.label}>Album name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Album name"
              returnKeyType="done"
              onSubmitEditing={saveName}
              autoCorrect={false}
            />
            <Button title="Save" onPress={saveName} />

            <Text style={[styles.label, styles.addMemberLabel]}>Add member by username or phone</Text>
            <TextInput
              placeholder="username or phone number"
              value={memberLookup}
              onChangeText={setMemberLookup}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="none"
              returnKeyType="done"
              onSubmitEditing={addMember}
            />
            <Button title="Add" onPress={addMember} />

            <Text style={[styles.label, styles.membersLabel]}>Members</Text>
            <View style={styles.memberListWrap}>
              <FlatList
                data={members}
                keyExtractor={(m) => m.id.toString()}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.memberListContent}
                renderItem={({ item }) => (
                  <View style={styles.memberRow}>
                    <Text style={styles.memberName}>{item.username}</Text>
                    <Text style={styles.memberSub}>{item.first_name} {item.last_name}</Text>
                    {item.phone_number ? <Text style={styles.memberSub}>Phone: {item.phone_number}</Text> : null}
                  </View>
                )}
              />
            </View>

            {status ? <Text style={styles.status}>{status}</Text> : null}
            <Button
              title="Back to album"
              onPress={() => {
                Keyboard.dismiss();
                router.replace({ pathname: '/album/[id]', params: { id: String(albumId), name: name.trim() || params.name || `Album ${params.id}` } });
              }}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  content: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  label: { fontSize: 16, fontWeight: '600' },
  addMemberLabel: { marginTop: 10 },
  membersLabel: { marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#d8d8d8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  memberListWrap: { flex: 1, minHeight: 180, borderWidth: 1, borderColor: '#eee', borderRadius: 10 },
  memberListContent: { paddingHorizontal: 12, paddingVertical: 4 },
  status: { marginTop: 2, color: '#c00' },
  memberRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  memberName: { fontSize: 16, fontWeight: '600' },
  memberSub: { color: '#666' },
});

export default AlbumSettings;
