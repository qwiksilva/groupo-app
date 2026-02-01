import React, { useEffect, useState, useCallback, useLayoutEffect } from 'react';
import { SafeAreaView, View, Text, FlatList, TextInput, Button, StyleSheet, TouchableOpacity, Modal, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PostCard } from '@/components/post-card';
import {
  api,
  fetchGroupPosts,
  resolveUrl,
  likePost,
  commentOnPost,
  deletePost,
  deleteComment,
  setToken,
} from '../../lib/api';

const GroupDetail = () => {
  const FORCE_DELETE_UI = false;
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const groupId = Number(params.id);
  const groupName = params.name || `Group ${params.id}`;

  const [posts, setPosts] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
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

  useEffect(() => {
    const loadUser = async () => {
      try {
        const stored = await SecureStore.getItemAsync('groupo_user');
        if (stored) {
          const parsed = JSON.parse(stored);
          setUserId(parsed?.id ?? null);
        }
      } catch {
        setUserId(null);
      }
    };
    loadUser();
  }, []);

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

  const handleComment = async (postId: number, overrideText?: string) => {
    const text = (overrideText ?? commentInputs[postId])?.trim();
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

  const handleDeletePost = async (postId: number) => {
    try {
      await deletePost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const handleDeleteComment = async (postId: number, commentId: number | string) => {
    try {
      await deleteComment(commentId);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, comments: (p.comments || []).filter((c: any) => c.id !== commentId) } : p
        )
      );
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const confirmDeletePost = (postId: number) => {
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeletePost(postId) },
    ]);
  };

  const confirmDeleteComment = (postId: number, commentId: number | string) => {
    Alert.alert('Delete comment?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteComment(postId, commentId) },
    ]);
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
    await handleComment(activeCommentPostId, text);
    closeCommentModal();
  };

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id.toString()}
        renderItem={({ item }) => (
          <PostCard
            user={item.user}
            groupName={item.group_name}
            groupId={item.group_id}
            content={item.content}
            imageUrls={item.image_urls || []}
            likes={item.likes || 0}
            comments={item.comments || []}
            createdAt={item.created_at}
            resolveUrl={resolveUrl}
            onLike={() => handleLike(item.id)}
            onOpenComment={() => openCommentModal(item.id)}
            onDeletePost={() => confirmDeletePost(item.id)}
            onDeleteComment={(commentId) => confirmDeleteComment(item.id, commentId)}
            currentUserId={userId ?? undefined}
            postUserId={item.user_id}
            forceDeleteUI={FORCE_DELETE_UI}
          />
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
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  status: { marginTop: 8, color: '#c00' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start' },
  modalCard: { marginTop: 40, marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalInput: { minHeight: 90, textAlignVertical: 'top' },
  headerButton: { paddingHorizontal: 8, paddingVertical: 4 },
});

export default GroupDetail;
