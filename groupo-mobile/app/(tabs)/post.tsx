import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, StyleSheet, TouchableOpacity, Modal, ScrollView, TouchableWithoutFeedback, Keyboard, Image, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { PostCard } from '@/components/post-card';
import {
  api,
  fetchGroups,
  fetchAlbums,
  createPost,
  createAlbumPost,
  createPostWithFiles,
  setToken,
} from '../lib/api';

const TOKEN_KEY = 'groupo_auth_token';
const MAX_MEDIA_PER_POST = 20;
const MAX_VIDEO_SECONDS = 20;

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
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/hevc') return 'hevc';
  if (mime === 'video/x-m4v') return 'm4v';
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

const PostScreen = () => {
  const params = useLocalSearchParams<{ groupId?: string; albumId?: string }>();
  const albumParamId = params.albumId;
  const presetGroupId = params.groupId ? Number(params.groupId) : null;
  const presetAlbumId = albumParamId ? Number(albumParamId) : null;
  const router = useRouter();

  const [token, setTokenState] = useState<string | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{ type: 'group' | 'album'; id: number } | null>(null);
  const [content, setContent] = useState('');
  const [media, setMedia] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (storedToken) {
          setToken(storedToken);
          setTokenState(storedToken);
        }
      } catch {
        // ignore restore errors
      }
    };
    restoreSession();
  }, []);

  useEffect(() => {
    if (token) {
      setToken(token);
    }
  }, [token]);

  const loadGroups = async () => {
    if (!api.defaults.headers.common.Authorization) {
      setStatus('Login on the Home tab to load groups.');
      return;
    }
    try {
      const data = await fetchGroups();
      setGroups(data);
      const albumData = await fetchAlbums();
      setAlbums(albumData);
      setStatus('');
    } catch (err: any) {
      setStatus(err.response?.data?.error || err.message);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (token) {
        loadGroups();
      }
    }, [token])
  );

  useEffect(() => {
    if (!groups.length && !albums.length) return;
    if (presetGroupId) {
      if (!selectedTarget || selectedTarget.type !== 'group' || selectedTarget.id !== presetGroupId) {
        setSelectedTarget({ type: 'group', id: presetGroupId });
      }
      return;
    }
    if (presetAlbumId) {
      if (!selectedTarget || selectedTarget.type !== 'album' || selectedTarget.id !== presetAlbumId) {
        setSelectedTarget({ type: 'album', id: presetAlbumId });
      }
      return;
    }
    if (!selectedTarget) {
      if (groups.length) {
        setSelectedTarget({ type: 'group', id: groups[0].id });
      } else if (albums.length) {
        setSelectedTarget({ type: 'album', id: albums[0].id });
      }
    }
  }, [groups, albums, presetGroupId, presetAlbumId, selectedTarget]);

  const options = [
    ...groups.map((g) => ({ id: g.id, type: 'group' as const, name: g.name })),
    ...albums.map((a) => ({ id: a.id, type: 'album' as const, name: a.name })),
  ];
  const selectedOption = options.find((o) => selectedTarget && o.id === selectedTarget.id && o.type === selectedTarget.type);
  const selectedLabel = selectedOption ? `${selectedOption.type === 'album' ? 'Album' : 'Group'}: ${selectedOption.name}` : 'Select a destination';

  const previewUser = 'You';
  const clearDraft = () => {
    setContent('');
    setMedia([]);
    setStatus('Draft cleared.');
  };

  const confirmClearDraft = () => {
    if (!content.trim() && !media.length) return;
    Alert.alert('Discard current post?', 'This removes selected media and text for this draft.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: clearDraft },
    ]);
  };

  const removeMediaAtIndex = (index: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== index));
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
      selectionLimit: MAX_MEDIA_PER_POST,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled && result.assets?.length) {
      if (result.assets.length > MAX_MEDIA_PER_POST) {
        setStatus(`You can attach up to ${MAX_MEDIA_PER_POST} items per post.`);
      }
      const normalizedAssets = await Promise.all(
        result.assets.slice(0, MAX_MEDIA_PER_POST).map(async (asset) => ({
          asset,
          uri: await resolveAssetUri(asset),
        }))
      );
      const longVideos = normalizedAssets
        .filter(({ asset }) => asset.type === 'video' && typeof asset.duration === 'number')
        .filter(({ asset }) => (asset.duration || 0) / 1000 > MAX_VIDEO_SECONDS);
      if (longVideos.length) {
        setStatus(`Videos must be ${MAX_VIDEO_SECONDS}s or less. Please trim and try again.`);
        return;
      }
      console.log('[post] picked assets', result.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, type: a.type, fileName: a.fileName })));
      const unresolved = normalizedAssets.find(({ uri }) => uri.startsWith('ph://') || uri.startsWith('assets-library://'));
      if (unresolved) {
        setStatus('Selected media could not be accessed. Try picking a different item or allow full photo access.');
        return;
      }
      const fileInfos = await Promise.all(
        normalizedAssets.map(async ({ uri }) => ({ uri, info: await FileSystem.getInfoAsync(uri) }))
      );
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
      console.log('[post] upload files', files);
      setMedia(files);
      setStatus('');
    }
  };

  const handlePost = async () => {
    if (isPosting) return;
    if (!selectedTarget) {
      setStatus('Select a destination to post in.');
      return;
    }
    if (!media.length) {
      setStatus('Select at least one photo or video before posting.');
      return;
    }
    try {
      setIsPosting(true);
      setStatus('Uploading...');
      if (media.length) {
        const res = await createPostWithFiles(selectedTarget.id, content, media, selectedTarget.type);
        if (res.uploadQuality === 'low') {
          setStatus('Uploaded in lower quality due to size.');
        } else {
          setStatus('Posted.');
        }
      } else {
        if (selectedTarget.type === 'album') {
          await createAlbumPost(selectedTarget.id, content);
        } else {
          await createPost(selectedTarget.id, content);
        }
        setStatus('Posted.');
      }
      setContent('');
      setMedia([]);
      setShowPreview(false);
      if (selectedTarget.type === 'album') {
        router.replace({ pathname: '/album/[id]', params: { id: String(selectedTarget.id), name: selectedOption?.name || selectedLabel } });
      } else {
        router.replace({ pathname: '/group/[id]', params: { id: String(selectedTarget.id), name: selectedOption?.name || selectedLabel } });
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        setStatus('Session expired. Please log in again.');
        return;
      }
      setStatus(err.response?.data?.error || err.message);
    } finally {
      setIsPosting(false);
    }
  };

  if (!token) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.status}>Login on the Home tab to create posts.</Text>
      </SafeAreaView>
    );
  }

  return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView style={styles.container}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent}>
          <Text style={styles.title}>Create Post</Text>

          <TouchableOpacity style={styles.dropdown} onPress={() => setShowGroupPicker(true)}>
            <Text style={styles.dropdownLabel}>{selectedLabel}</Text>
            <Text style={styles.dropdownChevron}>▼</Text>
          </TouchableOpacity>

          <TextInput
            placeholder="Write a post..."
            style={[styles.input, styles.textarea]}
            value={content}
            onChangeText={setContent}
            multiline
            autoCorrect
            textAlignVertical="top"
            returnKeyType="default"
          />
          <View style={styles.buttonRow}>
            <Button title="Attach photo/video" onPress={pickMedia} disabled={isPosting} />
            <Button
              title="Preview"
              onPress={() => {
                if (!media.length) {
                  setStatus('Select at least one photo or video before previewing.');
                  return;
                }
                setShowPreview(true);
              }}
              disabled={isPosting}
            />
          </View>
          {media.length ? (
            <View style={styles.thumbnailSection}>
              <Text style={styles.attachment}>{media.length} attachment(s) added (max {MAX_MEDIA_PER_POST})</Text>
              <ScrollView style={styles.thumbnailScroll} contentContainerStyle={styles.thumbnailGrid}>
                {media.map((m, index) => (
                  <TouchableOpacity key={`${m.uri}-${index}`} style={styles.thumbWrap} onPress={() => removeMediaAtIndex(index)}>
                    <Image source={{ uri: m.uri }} style={styles.thumbImage} resizeMode="cover" />
                    <View style={styles.thumbBadge}>
                      <Text style={styles.thumbBadgeText}>Remove</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <Text style={styles.helper}>Videos should be {MAX_VIDEO_SECONDS}s or less and smaller file sizes upload faster.</Text>
          <View style={styles.draftActions}>
            <Button title="Discard current post" color="#a00" onPress={confirmClearDraft} disabled={isPosting} />
          </View>
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </ScrollView>

      <Modal visible={showGroupPicker} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Select Destination</Text>
              <ScrollView>
                {options.map((g) => (
                  <TouchableOpacity
                    key={`${g.type}-${g.id}`}
                    style={styles.groupOption}
                    onPress={() => {
                      setSelectedTarget({ type: g.type, id: g.id });
                      setShowGroupPicker(false);
                    }}
                  >
                    <Text style={styles.groupOptionText}>{g.type === 'album' ? `Album: ${g.name}` : `Group: ${g.name}`}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Button title="Cancel" onPress={() => setShowGroupPicker(false)} />
            </View>
          </View>
      </Modal>
      <Modal visible={showPreview} animationType="slide">
        <SafeAreaView style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>Preview</Text>
            <Button title="Close" onPress={() => setShowPreview(false)} />
          </View>
          <ScrollView contentContainerStyle={styles.previewContent}>
            <PostCard
              user={previewUser}
              groupName={selectedLabel}
              content={content.trim() || 'No text yet.'}
              imageUrls={media.map((m) => m.uri)}
              likes={0}
              comments={[]}
              resolveUrl={(u) => u}
              interactive={false}
            />
          </ScrollView>
          <View style={styles.previewFooter}>
            <Button title={isPosting ? 'Posting...' : 'Post'} onPress={handlePost} disabled={isPosting} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  formContent: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#d8d8d8', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fff' },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  buttonRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  draftActions: { marginTop: 2 },
  helper: { color: '#666', fontSize: 12 },
  attachment: { color: '#333' },
  status: { marginTop: 8, color: '#c00' },
  thumbnailSection: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 10, gap: 8, maxHeight: 240 },
  thumbnailScroll: { maxHeight: 190 },
  thumbnailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 94, height: 94, borderRadius: 8, overflow: 'hidden', backgroundColor: '#f0f0f0' },
  thumbImage: { width: '100%', height: '100%' },
  thumbBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 2, alignItems: 'center' },
  thumbBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  dropdown: {
    borderWidth: 1,
    borderColor: '#d8d8d8',
    padding: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownLabel: { fontSize: 16, fontWeight: '600' },
  dropdownChevron: { fontSize: 14, color: '#666' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', backgroundColor: '#fff', padding: 16, borderRadius: 10, gap: 12, maxHeight: '70%' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  groupOption: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  groupOptionText: { fontSize: 16 },
  previewContainer: { flex: 1, backgroundColor: '#fff' },
  previewHeader: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewTitle: { fontSize: 20, fontWeight: '700' },
  previewContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  previewFooter: { paddingHorizontal: 16, paddingBottom: 16 },
});

export default PostScreen;
