import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet, Image, ScrollView, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import {
  login,
  register,
  fetchGroups,
  fetchGroupPosts,
  registerPushToken,
  resolveUrl,
  likePost,
  commentOnPost,
  createPost,
  createPostWithFiles,
} from '../lib/api';

const IMAGE_WIDTH = Dimensions.get('window').width - 32; // container padding margin
const HomeScreen = () => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<any>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [feed, setFeed] = useState<any[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [content, setContent] = useState('');
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const [media, setMedia] = useState<any[]>([]);

  useEffect(() => {
    if (token) {
      loadFeed();
      registerPushToken().catch((err) => setStatus(`Push error: ${err.message}`));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadFeed();
      }
    }, [token])
  );

  const loadFeed = async () => {
    try {
      const groups = await fetchGroups();
      const postsArrays = await Promise.all(
        groups.map(async (g: any) => {
          try {
            const res = await fetchGroupPosts(g.id);
            const groupName = res.group?.name ?? g.name;
            const groupId = res.group?.id ?? g.id;
            return (res.posts || []).map((p: any) => ({
              ...p,
              group_id: p.group_id || groupId,
              group_name: p.group_name || groupName,
            }));
          } catch {
            return [];
          }
        })
      );
      const combined = postsArrays.flat().sort((a: any, b: any) => b.id - a.id);
      setFeed(combined);
      setStatus('');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
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
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Groupo</Text>
        <View style={styles.toggleRow}>
          <Text style={[styles.toggle, authMode === 'login' && styles.activeToggle]} onPress={() => setAuthMode('login')}>
            Login
          </Text>
          <Text style={[styles.toggle, authMode === 'register' && styles.activeToggle]} onPress={() => setAuthMode('register')}>
            Register
          </Text>
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

  const handleLike = async (postId: number) => {
    try {
      const res = await likePost(postId);
      setFeed((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: res.likes } : p)));
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const handleComment = async (postId: number) => {
    const text = commentInputs[postId];
    if (!text) return;
    try {
      const res = await commentOnPost(postId, text);
      setFeed((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, comments: [...(p.comments || []), res.comment] }
            : p
        )
      );
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setStatus('Media permission required');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });
    if (!result.canceled && result.assets?.length) {
      const files = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName || 'upload',
        mimeType: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      }));
      setMedia(files);
    }
  };

  const handlePost = async () => {
    if (!content) return;
    try {
      // Default to first group in feed if none selected, since Home is cross-group.
      const firstGroupId = feed[0]?.group_id;
      const targetGroup = firstGroupId;
      if (!targetGroup) {
        setStatus('No group available to post into.');
        return;
      }
      if (media.length) {
        await createPostWithFiles(targetGroup, content, media);
      } else {
        await createPost(targetGroup, content);
      }
      setContent('');
      setMedia([]);
      loadFeed();
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Latest posts</Text>
      {/* <View style={styles.postInput}>
        <TextInput
          placeholder="Write something..."
          style={styles.input}
          value={content}
          onChangeText={setContent}
        />
        <Button title="Attach photo/video" onPress={pickMedia} />
        {media.length ? <Text style={styles.attachment}>{media.length} attachment(s) added</Text> : null}
        <Button title="Post" onPress={handlePost} />
      </View> */}
      <FlatList
        data={feed}
        keyExtractor={(p) => p.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.postCard}>
            <Text style={styles.postMeta}>
              {item.user} • {item.group_name || `Group #${item.group_id}`}
            </Text>
            <Text>{item.content}</Text>
            {item.image_urls?.length ? (
              <ScrollView horizontal pagingEnabled style={styles.carousel}>
                {item.image_urls.map((u: string, idx: number) => (
                  <Image key={idx} source={{ uri: resolveUrl(u) }} style={styles.postImage} resizeMode="cover" />
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.actionsRow}>
              <Text style={styles.likeText}>Likes: {item.likes || 0}</Text>
              <Button title="Like" onPress={() => handleLike(item.id)} />
            </View>
            {(item.comments || []).map((c: any) => (
              <Text key={c.id} style={styles.commentLine}>
                {c.user}: {c.content}
              </Text>
            ))}
            <View style={styles.commentRow}>
              <TextInput
                placeholder="Add a comment"
                style={styles.input}
                value={commentInputs[item.id] || ''}
                onChangeText={(t) => setCommentInputs((prev) => ({ ...prev, [item.id]: t }))}
              />
              <Button title="Send" onPress={() => handleComment(item.id)} />
            </View>
          </View>
        )}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  toggleRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  toggle: { fontSize: 16, color: '#666' },
  activeToggle: { color: '#000', fontWeight: '700' },
  postCard: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#fafafa' },
  postMeta: { fontWeight: '600', marginBottom: 4 },
  postImage: { width: IMAGE_WIDTH, height: 220, marginTop: 8, borderRadius: 8, backgroundColor: '#ddd', marginRight: 8 },
  carousel: { marginTop: 8 },
  status: { marginTop: 8, color: '#c00' },
  postInput: { marginBottom: 12 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  likeText: { fontWeight: '600' },
  commentLine: { marginTop: 4, color: '#444' },
  commentRow: { marginTop: 6 },
  attachment: { marginVertical: 4, color: '#555' },
});

export default HomeScreen;
