import React, { useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { SafeAreaView, View, Text, FlatList, TextInput, Button, StyleSheet, Image, ScrollView, Dimensions, TouchableOpacity, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useLocalSearchParams, useNavigation, useRouter, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  api,
  fetchGroupPosts,
  resolveUrl,
  likePost,
  commentOnPost,
  setToken,
} from '../../lib/api';

const IMAGE_WIDTH = Dimensions.get('window').width - 32;
const POST_IMAGE_HEIGHT = Math.round(IMAGE_WIDTH * 1.5); // tall enough for portrait photos

const PostImage = ({ uri }: { uri: string }) => (
  <View style={[styles.postImageContainer, { height: POST_IMAGE_HEIGHT }]}>
    <Image source={{ uri }} style={[styles.postImage, { width: IMAGE_WIDTH, height: POST_IMAGE_HEIGHT }]} resizeMode="contain" />
  </View>
);

const isVideoUrl = (uri: string) => {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  return ext ? ['mp4', 'mov', 'm4v', 'hevc', 'webm', 'ogg'].includes(ext) : false;
};

const PostMedia = ({ uri }: { uri: string }) => (
  <View style={[styles.postImageContainer, { height: POST_IMAGE_HEIGHT }]}>
    {isVideoUrl(uri) ? (
      <Video
        source={{ uri }}
        style={[styles.postImage, { width: IMAGE_WIDTH, height: POST_IMAGE_HEIGHT }]}
        resizeMode={ResizeMode.CONTAIN}
        useNativeControls
      />
    ) : (
      <Image source={{ uri }} style={[styles.postImage, { width: IMAGE_WIDTH, height: POST_IMAGE_HEIGHT }]} resizeMode="contain" />
    )}
  </View>
);
const GroupDetail = () => {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);
  const groupName = params.name || `Group ${params.id}`;

  const [posts, setPosts] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const [activeCommentPostId, setActiveCommentPostId] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [showCommentModal, setShowCommentModal] = useState(false);
  const navigation = useNavigation();
  const router = useRouter();
  const colorScheme = useColorScheme();
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
  }, [groupId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: groupName,
      headerRight: () => (
        <TouchableOpacity
          onPress={() => router.push({ pathname: `/group/${groupId}/settings`, params: { name: groupName } })}
          style={styles.headerButton}
        >
          <IconSymbol size={22} name="gearshape" color={Colors[colorScheme ?? 'light'].tint} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, router, groupId, groupName, colorScheme]);

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

  const openCommentModal = (postId: number) => {
    setActiveCommentPostId(postId);
    setCommentDraft(commentInputs[postId] || '');
    setShowCommentModal(true);
  };

  const closeCommentModal = () => {
    setShowCommentModal(false);
    setActiveCommentPostId(null);
    setCommentDraft('');
  };

  const submitCommentModal = async () => {
    if (!activeCommentPostId) return;
    const text = commentDraft.trim();
    if (!text) return;
    setCommentInputs((prev) => ({ ...prev, [activeCommentPostId]: text }));
    await handleComment(activeCommentPostId);
    closeCommentModal();
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
                  <PostMedia key={idx} uri={resolveUrl(u)} />
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
            <TouchableOpacity style={styles.commentRow} onPress={() => openCommentModal(item.id)}>
              <Text style={styles.commentPlaceholder}>Add a comment…</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Modal visible={showCommentModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.modalCard}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Comment</Text>
              <Button title="Post" onPress={submitCommentModal} />
            </View>
            <TextInput
              placeholder="Write a comment..."
              style={[styles.input, styles.modalInput]}
              value={commentDraft}
              onChangeText={setCommentDraft}
              multiline
              autoFocus
            />
            <Button title="Cancel" onPress={closeCommentModal} />
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  status: { marginTop: 8, color: '#c00' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  likeText: { fontWeight: '600' },
  commentLine: { marginTop: 4, color: '#444' },
  commentRow: { marginTop: 6, padding: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  commentPlaceholder: { color: '#666' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start' },
  modalCard: { marginTop: 40, marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalInput: { minHeight: 90, textAlignVertical: 'top' },
  headerButton: { paddingHorizontal: 8, paddingVertical: 4 },
});

export default GroupDetail;
