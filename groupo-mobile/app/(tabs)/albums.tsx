import React, { useEffect, useLayoutEffect, useState } from 'react';
import { SafeAreaView, Text, FlatList, TouchableOpacity, StyleSheet, Button, TextInput, Modal, View } from 'react-native';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { api, fetchAlbums, createAlbum } from '../lib/api';

const AlbumsScreen = () => {
  const router = useRouter();
  const navigation = useNavigation();
  const [albums, setAlbums] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!api.defaults.headers.common.Authorization) {
        setStatus('Login on the Home tab to load albums.');
        return;
      }
      try {
        const data = await fetchAlbums();
        setAlbums(data);
        setStatus('');
      } catch (err: any) {
        setStatus(err.response?.data?.error || err.message);
      }
    };
    load();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      const refresh = async () => {
        if (!api.defaults.headers.common.Authorization) return;
        try {
          const data = await fetchAlbums();
          setAlbums(data);
        } catch (err: any) {
          setStatus(err.response?.data?.error || err.message);
        }
      };
      refresh();
    }, [])
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Albums',
      headerRight: () => <Button title="+" onPress={() => setShowModal(true)} />,
    });
  }, [navigation]);

  const openAlbum = (a: any) => {
    router.push({ pathname: '/album/[id]', params: { id: String(a.id), name: a.name } });
  };

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    try {
      const a = await createAlbum(newAlbumName.trim());
      setAlbums((prev) => [...prev, a]);
      setNewAlbumName('');
      setShowModal(false);
      setStatus('');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={albums}
        keyExtractor={(a, idx) => (a?.id ? a.id.toString() : `album-${idx}`)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.albumCard} onPress={() => openAlbum(item)}>
            <Text style={styles.albumName}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Album</Text>
            <TextInput
              placeholder="Album name"
              value={newAlbumName}
              onChangeText={setNewAlbumName}
              style={styles.input}
            />
            <Button title="Create" onPress={handleCreateAlbum} />
            <Button title="Cancel" onPress={() => setShowModal(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  albumCard: { padding: 14, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#fff9f1' },
  albumName: { fontSize: 16, fontWeight: '600' },
  status: { marginTop: 8, color: '#c00' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', backgroundColor: '#fff', padding: 16, borderRadius: 10, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
});

export default AlbumsScreen;
