import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, FlatList, TextInput, Button, StyleSheet, Image, ScrollView, Dimensions } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  api,
  fetchGroupPosts,
  createPost,
  createPostWithFiles,
  resolveUrl,
  likePost,
  commentOnPost,
} from '../../lib/api';

const IMAGE_WIDTH = Dimensions.get('window').width - 32;

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

  useEffect(() => {
    load();
    navigation.setOptions({
      headerShown: false,
    });
  }, [groupId]);

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

  const handleLike = async (postId: number) => {
    try {
      const res = await likePost(postId);
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likes: res.likes } : p)));
    } catch (err: any) {
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
  postImage: { width: IMAGE_WIDTH, height: 220, marginTop: 8, borderRadius: 8, backgroundColor: '#ddd', marginRight: 8 },
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
