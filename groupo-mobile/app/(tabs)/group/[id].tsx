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
  fetchGroupMembers,
  fetchGroupAlbums,
  createGroupAlbum,
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
  const [members, setMembers] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'albums' | 'members'>('posts');
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const [activeCommentPostId, setActiveCommentPostId] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [showCreateAlbumModal, setShowCreateAlbumModal] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
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

  const load = useCallback(async () => {
    if (!api.defaults.headers.common.Authorization) {
      setStatus('Login on the Home tab to load group data.');
      return;
    }
    try {
      const [postsRes, membersRes, albumsRes] = await Promise.all([
        fetchGroupPosts(groupId),
        fetchGroupMembers(groupId),
        fetchGroupAlbums(groupId),
      ]);
      setPosts(postsRes.posts || []);
      setMembers(membersRes || []);
      setAlbums(albumsRes || postsRes.albums || []);
      setStatus('');
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout();
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  }, [groupId, handleLogout]);

  useEffect(() => {
    load();
  }, [load]);

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
          onPress={() => router.push({ pathname: '/group/[id]/settings', params: { id: String(groupId), name: groupName } })}
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
    }, [load])
  );

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

  const handleCreateAlbum = async () => {
    if (!newAlbumName.trim()) return;
    try {
      const created = await createGroupAlbum(groupId, newAlbumName.trim());
      setAlbums((prev) => [...prev, created]);
      setNewAlbumName('');
      setShowCreateAlbumModal(false);
      setStatus('Album created.');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const renderTab = () => {
    if (activeTab === 'members') {
      return (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.memberRow}>
              <Text style={styles.memberName}>{item.username}</Text>
              <Text style={styles.memberSub}>{item.first_name} {item.last_name}</Text>
            </View>
          )}
        />
      );
    }
    if (activeTab === 'albums') {
      return (
        <View style={styles.flex}>
          <View style={styles.albumHeaderRow}>
            <Text style={styles.sectionTitle}>Albums in this group</Text>
            <Button title="+ Album" onPress={() => setShowCreateAlbumModal(true)} />
          </View>
          <FlatList
            data={albums}
            keyExtractor={(a) => a.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.albumRow}
                onPress={() => router.push({ pathname: '/album/[id]', params: { id: String(item.id), name: item.name } })}
              >
                <Text style={styles.albumName}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      );
    }
    return (
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
            associatedAlbums={item.associated_albums || []}
            onOpenAssociatedAlbum={(albumId, albumName) =>
              router.push({ pathname: '/album/[id]', params: { id: String(albumId), name: albumName } })
            }
          />
        )}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'posts' && styles.tabButtonActive]} onPress={() => setActiveTab('posts')}>
          <Text style={[styles.tabText, activeTab === 'posts' && styles.tabTextActive]}>Posts</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'albums' && styles.tabButtonActive]} onPress={() => setActiveTab('albums')}>
          <Text style={[styles.tabText, activeTab === 'albums' && styles.tabTextActive]}>Albums</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'members' && styles.tabButtonActive]} onPress={() => setActiveTab('members')}>
          <Text style={[styles.tabText, activeTab === 'members' && styles.tabTextActive]}>Members</Text>
        </TouchableOpacity>
      </View>

      {renderTab()}
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

      <Modal visible={showCreateAlbumModal} transparent animationType="slide">
        <View style={styles.modalOverlayCenter}>
          <View style={styles.createAlbumCard}>
            <Text style={styles.modalTitle}>Create Album</Text>
            <TextInput
              placeholder="Album name"
              value={newAlbumName}
              onChangeText={setNewAlbumName}
              style={styles.input}
            />
            <Button title="Create" onPress={handleCreateAlbum} />
            <Button title="Cancel" onPress={() => setShowCreateAlbumModal(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  flex: { flex: 1 },
  tabRow: { flexDirection: 'row', borderWidth: 1, borderColor: '#ddd', borderRadius: 10, overflow: 'hidden' },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: '#fff' },
  tabButtonActive: { backgroundColor: '#111' },
  tabText: { color: '#444', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  albumHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  albumRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  albumName: { fontSize: 16, fontWeight: '600' },
  memberRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  memberName: { fontSize: 16, fontWeight: '600' },
  memberSub: { color: '#666' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  status: { marginTop: 8, color: '#c00' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 16 },
  modalCard: { marginTop: 40, marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  createAlbumCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalInput: { minHeight: 90, textAlignVertical: 'top' },
  headerButton: { paddingHorizontal: 8, paddingVertical: 4 },
});

export default GroupDetail;
