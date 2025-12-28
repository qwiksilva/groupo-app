import React, { useEffect, useState, useCallback } from 'react';
import { SafeAreaView, View, Text, FlatList, TextInput, Button, StyleSheet, Image, ScrollView, Dimensions } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import {
  api,
  fetchGroupPosts,
  createPost,
  createPostWithFiles,
  resolveUrl,
  likePost,
  commentOnPost,
  setToken,
} from '../../lib/api';

const IMAGE_WIDTH = Dimensions.get('window').width - 32;
const POST_IMAGE_HEIGHT = Math.round(IMAGE_WIDTH * 1.5); // tall enough for portrait photos

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

const GroupDetail = () => {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);
  const groupName = params.name || `Group ${params.id}`;

  const [posts, setPosts] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [media, setMedia] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const navigation = useNavigation();
  const router = useRouter();
  const handleLogout = useCallback(
    async (message = 'Session expired. Please log in again.') => {
      await SecureStore.deleteItemAsync('groupo_auth_token');
      await SecureStore.deleteItemAsync('groupo_user');
      setToken(null);
      setStatus(message);
    },
    []
  );

  useEffect(() => {
    load();
    navigation.setOptions({
      headerShown: false,
    });
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [groupId])
  );

  const load = async () => {
    if (!api.defaults.headers.common.Authorization) {
      setStatus('Login on the Home tab to load posts.');
      return;
    }
    try {
      const data = await fetchGroupPosts(groupId);
      setPosts(data.posts || []);
      setStatus('');
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const handlePost = async () => {
    if (!content) return;
    try {
      if (media.length) {
        await createPostWithFiles(groupId, content, media);
      } else {
        await createPost(groupId, content);
      }
      setContent('');
      setMedia([]);
      load();
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const pickMedia = async () => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== 'granted') {
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

  const handleLike = async (postId: number) => {
    try {
      const res = await likePost(postId);
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: res.likes } : p)));
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
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
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, comments: [...(p.comments || []), res.comment] }
            : p
        )
      );
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{groupName}</Text>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.postCard}>
            <Text style={styles.postAuthor}>{item.user}</Text>
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
      <View style={styles.postInput}>
        <TextInput
          placeholder="Write something..."
          style={styles.input}
          value={content}
          onChangeText={setContent}
        />
        <Button title="Attach photo/video" onPress={pickMedia} />
        {media.length ? <Text style={styles.attachment}>{media.length} attachment(s) added</Text> : null}
        <Button title="Post" onPress={handlePost} />
        <Button title="Settings" onPress={() => router.push({ pathname: `/group/${groupId}/settings`, params: { name: groupName } })} />
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700' },
  postCard: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#fafafa' },
  postAuthor: { fontWeight: '700', marginBottom: 4 },
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
  postInput: { marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  status: { marginTop: 8, color: '#c00' },
  attachment: { marginVertical: 4, color: '#555' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  likeText: { fontWeight: '600' },
  commentLine: { marginTop: 4, color: '#444' },
  commentRow: { marginTop: 6 },
});

export default GroupDetail;
