import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet, Modal, KeyboardAvoidingView, Platform, TouchableOpacity, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import { PostCard } from '@/components/post-card';
import {
  login,
  register,
  fetchGroups,
  fetchGroupPosts,
  registerPushToken,
  resolveUrl,
  likePost,
  commentOnPost,
  deletePost,
  deleteComment,
  setToken,
} from '../lib/api';

const TOKEN_KEY = 'groupo_auth_token';
const USER_KEY = 'groupo_user';
const FORCE_DELETE_UI = false;

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
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});
  const [activeCommentPostId, setActiveCommentPostId] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [showCommentModal, setShowCommentModal] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

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
        <TextInput
          placeholder="Username"
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          importantForAutofill="yes"
          returnKeyType={authMode === 'register' ? 'next' : 'done'}
          onSubmitEditing={() => {
            if (authMode === 'register') {
              firstNameRef.current?.focus();
            } else {
              passwordRef.current?.focus();
            }
          }}
          blurOnSubmit={false}
          ref={usernameRef}
        />
        <TextInput
          placeholder="Password"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={authMode === 'register' ? 'new-password' : 'password'}
          textContentType={authMode === 'register' ? 'newPassword' : 'password'}
          importantForAutofill="yes"
          passwordRules="minlength: 8;"
          returnKeyType="done"
          onSubmitEditing={handleAuth}
          ref={passwordRef}
        />
        {authMode === 'register' && (
          <>
            <TextInput
              placeholder="First name"
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              onSubmitEditing={() => lastNameRef.current?.focus()}
              blurOnSubmit={false}
              ref={firstNameRef}
            />
            <TextInput
              placeholder="Last name"
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
              ref={lastNameRef}
            />
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

  const handleComment = async (postId: number, overrideText?: string) => {
    const text = (overrideText ?? commentInputs[postId])?.trim();
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

  const handleDeletePost = async (postId: number) => {
    try {
      await deletePost(postId);
      setFeed((prev) => prev.filter((p) => p.id !== postId));
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    }
  };

  const handleDeleteComment = async (postId: number, commentId: number | string) => {
    try {
      await deleteComment(commentId);
      setFeed((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, comments: (p.comments || []).filter((c: any) => c.id !== commentId) } : p
        )
      );
    } catch (err: any) {
      if (err.response?.status === 401) {
        await handleLogout('Session expired. Please log in again.');
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
      <View style={styles.headerRow}>
        <Text style={styles.title}>Latest posts</Text>
        <Button title="Log out" onPress={() => handleLogout('Logged out.')} />
      </View>
      <FlatList
        data={feed}
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
            currentUserId={user?.id}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 24, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8, marginVertical: 6 },
  toggleRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  toggle: { fontSize: 16, color: '#666' },
  activeToggle: { color: '#000', fontWeight: '700' },
  status: { marginTop: 8, color: '#c00' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start' },
  modalCard: { marginTop: 40, marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalInput: { minHeight: 90, textAlignVertical: 'top' },
});

export default HomeScreen;
