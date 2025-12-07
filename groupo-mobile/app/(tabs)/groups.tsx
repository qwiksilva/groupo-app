import React, { useEffect, useLayoutEffect, useState } from 'react';
import { SafeAreaView, Text, FlatList, TouchableOpacity, StyleSheet, Button, TextInput, Modal, View } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { api, fetchGroups, createGroup } from '../lib/api';

const GroupsScreen = () => {
  const router = useRouter();
  const navigation = useNavigation();
  const [groups, setGroups] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!api.defaults.headers.common.Authorization) {
        setStatus('Login on the Home tab to load groups.');
        return;
      }
      try {
        const data = await fetchGroups();
        setGroups(data);
        setStatus('');
      } catch (err: any) {
        setStatus(err.response?.data?.error || err.message);
      }
    };
    load();
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <Button title="+" onPress={() => setShowModal(true)} />,
    });
  }, [navigation]);

  const openGroup = (g: any) => {
    router.push(`/group/${g.id}?name=${encodeURIComponent(g.name)}`);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const g = await createGroup(newGroupName.trim());
      setGroups((prev) => [...prev, g]);
      setNewGroupName('');
      setShowModal(false);
      setStatus('');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* <Text style={styles.title}>Groups</Text> */}
      <FlatList
        data={groups}
        keyExtractor={(g, idx) => (g?.id ? g.id.toString() : `group-${idx}`)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.groupCard} onPress={() => openGroup(item)}>
            <Text style={styles.groupName}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Group</Text>
            <TextInput
              placeholder="Group name"
              value={newGroupName}
              onChangeText={setNewGroupName}
              style={styles.input}
            />
            <Button title="Create" onPress={handleCreateGroup} />
            <Button title="Cancel" onPress={() => setShowModal(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  groupCard: { padding: 14, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#f7f9ff' },
  groupName: { fontSize: 16, fontWeight: '600' },
  status: { marginTop: 8, color: '#c00' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', backgroundColor: '#fff', padding: 16, borderRadius: 10, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
});

export default GroupsScreen;
