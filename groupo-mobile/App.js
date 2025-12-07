import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import axios from 'axios';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

// Point to your backend; on device use your machine's LAN IP.
const API_URL = 'http://localhost:5000';

const api = axios.create({ baseURL: API_URL });
const setToken = (token) => {
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
};

const login = async (username, password) => {
  const { data } = await api.post('/api/login', { username, password });
  setToken(data.token);
  return data;
};

const register = async ({ username, password, first_name, last_name }) => {
  const { data } = await api.post('/api/register', { username, password, first_name, last_name });
  setToken(data.token);
  return data;
};

const fetchGroups = async () => {
  const { data } = await api.get('/api/groups');
  return data.groups;
};

const fetchPosts = async (groupId) => {
  const { data } = await api.get(`/api/groups/${groupId}/posts`);
  return data.posts;
};

const createPost = async (groupId, content) => {
  const { data } = await api.post(`/api/groups/${groupId}/posts`, { content });
  return data;
};

const registerPushToken = async () => {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Push permission denied');

  const expoToken = await Notifications.getExpoPushTokenAsync({
    // projectId: Constants?.expoConfig?.extra?.eas?.projectId,
  });
  const token = expoToken.data;
  await api.post('/api/push/register', { token, platform: 'expo' });
  return token;
};

const App = () => {
  const [authMode, setAuthMode] = useState('login');
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (token) {
      loadGroups();
      registerPushToken().catch((err) => setStatus(`Push error: ${err.message}`));
    }
  }, [token]);

  const loadGroups = async () => {
    try {
      const gs = await fetchGroups();
      setGroups(gs);
      if (gs.length) {
        selectGroup(gs[0].id);
      }
    } catch (err) {
      setStatus(err.message);
    }
  };

  const selectGroup = async (groupId) => {
    setSelectedGroup(groupId);
    try {
      const p = await fetchPosts(groupId);
      setPosts(p);
    } catch (err) {
      setStatus(err.message);
    }
  };

  const handleAuth = async () => {
    try {
      setStatus('Working...');
      if (authMode === 'login') {
        const { token: t, user: u } = await login(username, password);
        setUser(u);
        setTokenState(t);
      } else {
        const { token: t, user: u } = await register({
          username,
          password,
          first_name: firstName,
          last_name: lastName,
        });
        setUser(u);
        setTokenState(t);
      }
      setStatus('Authenticated');
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const handlePost = async () => {
    if (!selectedGroup || !content) return;
    try {
      await createPost(selectedGroup, content);
      setContent('');
      selectGroup(selectedGroup);
    } catch (err) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>GroupGram Mobile</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity onPress={() => setAuthMode('login')}>
            <Text style={[styles.toggle, authMode === 'login' && styles.activeToggle]}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAuthMode('register')}>
            <Text style={[styles.toggle, authMode === 'register' && styles.activeToggle]}>Register</Text>
          </TouchableOpacity>
        </View>
        <TextInput placeholder="Username" style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" />
        <TextInput placeholder="Password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
        {authMode === 'register' && (
          <>
            <TextInput placeholder="First name" style={styles.input} value={firstName} onChangeText={setFirstName} />
            <TextInput placeholder="Last name" style={styles.input} value={lastName} onChangeText={setLastName} />
          </>
        )}
        <Button title={authMode === 'login' ? 'Login' : 'Register'} onPress={handleAuth} />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Welcome, {user?.username}</Text>
      <Text style={styles.subtitle}>Groups</Text>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id.toString()}
        horizontal
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => selectGroup(item.id)} style={[styles.groupChip, selectedGroup === item.id && styles.groupChipActive]}>
            <Text style={styles.groupText}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
      <Text style={styles.subtitle}>Posts</Text>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.postCard}>
            <Text style={styles.postAuthor}>{item.user}</Text>
            <Text>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.postInput}>
        <TextInput
          placeholder="Write something..."
          style={styles.input}
          value={content}
          onChangeText={setContent}
        />
        <Button title="Post" onPress={handlePost} />
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 18, fontWeight: '500', marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  toggleRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  toggle: { fontSize: 16, color: '#666' },
  activeToggle: { color: '#000', fontWeight: '700' },
  groupChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#ccc', marginRight: 8 },
  groupChipActive: { backgroundColor: '#e6f0ff', borderColor: '#6b8bff' },
  groupText: { fontSize: 14 },
  postCard: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#fafafa' },
  postAuthor: { fontWeight: '700', marginBottom: 4 },
  postInput: { marginTop: 12 },
  status: { marginTop: 8, color: '#c00' },
});

export default App;
