import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet, Image, ScrollView, Dimensions } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
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
  setToken,
} from '../lib/api';

const IMAGE_WIDTH = Dimensions.get('window').width - 32; // container padding margin
const POST_IMAGE_HEIGHT = Math.round(IMAGE_WIDTH * 1.5); // tall enough for portrait photos
const TOKEN_KEY = 'groupo_auth_token';
const USER_KEY = 'groupo_user';

const extensionFromMime = (mime?: string) => {
  if (!mime) return null;
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/ogg') return 'ogg';
  return null;
};

const buildUploadName = (asset: ImagePicker.ImagePickerAsset) => {
  if (asset.fileName && asset.fileName.includes('.')) {
    return asset.fileName;
  }
  const uriExt = asset.uri.split('?')[0].split('.').pop();
  if (uriExt && uriExt !== asset.uri) {
    return `upload.${uriExt}`;
  }
  const mimeExt = extensionFromMime(asset.mimeType);
  return `upload.${mimeExt || (asset.type === 'video' ? 'mp4' : 'jpg')}`;
};

const resolveAssetUri = async (asset: ImagePicker.ImagePickerAsset) => {
  if (!asset.uri.startsWith('ph://') && !asset.uri.startsWith('assets-library://')) {
    return asset.uri;
  }
  if (!asset.assetId) {
    return asset.uri;
  }
  try {
    const info = await MediaLibrary.getAssetInfoAsync(asset.assetId);
    return info.localUri || info.uri || asset.uri;
  } catch {
    return asset.uri;
  }
};

const PostImage = ({ uri }: { uri: string }) => (
  <View style={[styles.postImageContainer, { height: POST_IMAGE_HEIGHT }]}>
    <Image source={{ uri }} style={[styles.postImage, { width: IMAGE_WIDTH, height: POST_IMAGE_HEIGHT }]} resizeMode="contain" />
  </View>
);

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

  const handleLogout = useCallback(
    async (message = 'Logged out.') => {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_KEY);
      setToken(null);
      setTokenState(null);
      setUser(null);
      setStatus(message);
    },
    []
  );

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        const storedUser = await SecureStore.getItemAsync(USER_KEY);
        if (storedToken) {
          setToken(storedToken);
          setTokenState(storedToken);
        }
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
      } catch {
        // ignore restore errors and continue unauthenticated
      }
    };
    restoreSession();
  }, []);

  useEffect(() => {
    if (token) {
      loadFeed();
      registerPushToken().catch(async (err) => {
        if (err.response?.status === 401) {
          await handleLogout('Session expired. Please log in again.');
          return;
        }
        setStatus(`Push error: ${err.message}`);
      });
    }
  }, [token, handleLogout]);

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
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
        return;
      }
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
        setToken(t);
        await SecureStore.setItemAsync(TOKEN_KEY, t);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(u));
      } else {
        const { token: t, user: u } = await register({
          username,
          password,
          first_name: firstName,
          last_name: lastName,
        });
        setUser(u);
        setTokenState(t);
        setToken(t);
        await SecureStore.setItemAsync(TOKEN_KEY, t);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(u));
      }
      setStatus('Authenticated');
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
        return;
      }
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
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
        return;
      }
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
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
        return;
      }
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
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled && result.assets?.length) {
      const normalizedAssets = await Promise.all(
        result.assets.map(async (asset) => ({
          asset,
          uri: await resolveAssetUri(asset),
        }))
      );
      const unresolved = normalizedAssets.find(({ uri }) => uri.startsWith('ph://') || uri.startsWith('assets-library://'));
      if (unresolved) {
        setStatus('Selected media could not be accessed. Try picking a different item or allow full photo access.');
        return;
      }
      const fileInfos = await Promise.all(
        normalizedAssets.map(async ({ uri }) => ({ uri, info: await FileSystem.getInfoAsync(uri) }))
      );
      console.log('[upload] picked file info', fileInfos);
      const missingFile = fileInfos.find(({ info }) => !info.exists);
      if (missingFile) {
        setStatus('Selected media is not available on this device. Try another photo or download it first.');
        return;
      }
      const files = normalizedAssets.map(({ asset, uri }) => ({
        uri,
        name: buildUploadName(asset),
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
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Latest posts</Text>
        <Button title="Log out" onPress={() => handleLogout('Logged out.')} />
      </View>
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
                  <PostImage key={idx} uri={resolveUrl(u)} />
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  toggleRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  toggle: { fontSize: 16, color: '#666' },
  activeToggle: { color: '#000', fontWeight: '700' },
  postCard: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#fafafa' },
  postMeta: { fontWeight: '600', marginBottom: 4 },
  postImageContainer: {
    width: IMAGE_WIDTH,
    marginTop: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postImage: {
    borderRadius: 8,
    backgroundColor: '#fff',
  },
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
