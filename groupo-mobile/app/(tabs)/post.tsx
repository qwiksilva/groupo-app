import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, StyleSheet, TouchableOpacity, Modal, ScrollView, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { PostCard } from '@/components/post-card';
import {
  api,
  fetchGroups,
  createPost,
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
  const params = useLocalSearchParams<{ groupId?: string }>();
  const presetGroupId = params.groupId ? Number(params.groupId) : null;

  const [token, setTokenState] = useState<string | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [media, setMedia] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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
    if (!groups.length) return;
    if (presetGroupId) {
      setSelectedGroupId(presetGroupId);
      return;
    }
    if (!selectedGroupId) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, presetGroupId, selectedGroupId]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const selectedLabel = selectedGroup?.name || (selectedGroupId ? `Group ${selectedGroupId}` : 'Select a group');

  const previewUser = 'You';

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
    }
  };

  const handlePost = async () => {
    if (!selectedGroupId) {
      setStatus('Select a group to post in.');
      return;
    }
    if (!media.length) {
      setStatus('Select at least one photo or video before posting.');
      return;
    }
    try {
      if (media.length) {
        const res = await createPostWithFiles(selectedGroupId, content, media);
        if (res.uploadQuality === 'low') {
          setStatus('Uploaded in lower quality due to size.');
        } else {
          setStatus('Posted.');
        }
      } else {
        await createPost(selectedGroupId, content);
        setStatus('Posted.');
      }
      setContent('');
      setMedia([]);
    } catch (err: any) {
      if (err.response?.status === 401) {
        setStatus('Session expired. Please log in again.');
        return;
      }
      setStatus(err.response?.data?.error || err.message);
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
        />
        <View style={styles.buttonRow}>
          <Button title="Attach photo/video" onPress={pickMedia} />
          <Button
            title="Preview"
            onPress={() => {
              if (!media.length) {
                setStatus('Select at least one photo or video before previewing.');
                return;
              }
              setShowPreview(true);
            }}
          />
        </View>
        <Text style={styles.helper}>Videos should be {MAX_VIDEO_SECONDS}s or less and smaller file sizes upload faster.</Text>
        {media.length ? <Text style={styles.attachment}>{media.length} attachment(s) added (max {MAX_MEDIA_PER_POST})</Text> : null}
        {status ? <Text style={styles.status}>{status}</Text> : null}

      <Modal visible={showGroupPicker} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Select Group</Text>
              <ScrollView>
                {groups.map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.groupOption}
                    onPress={() => {
                      setSelectedGroupId(g.id);
                      setShowGroupPicker(false);
                    }}
                  >
                    <Text style={styles.groupOptionText}>{g.name}</Text>
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
            <Button title="Post" onPress={() => { setShowPreview(false); handlePost(); }} />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 8 },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  buttonRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  helper: { color: '#666', fontSize: 12 },
  attachment: { color: '#333' },
  status: { marginTop: 8, color: '#c00' },
  dropdown: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 8,
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
