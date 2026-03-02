import React from 'react';
import { View, Text, Button, StyleSheet, Image, ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Video, ResizeMode } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';

const CARD_WIDTH = Dimensions.get('window').width - 32;
const CARD_MEDIA_HEIGHT = Math.round(CARD_WIDTH * 1.5);

type CommentItem = {
  id?: number | string;
  user: string;
  user_id?: number;
  content: string;
  created_at?: string | null;
};

type PostCardProps = {
  user: string;
  groupName?: string;
  groupId?: number;
  content: string;
  imageUrls?: string[];
  likes?: number;
  comments?: CommentItem[];
  onLike?: () => void;
  onOpenComment?: () => void;
  onDeletePost?: () => void;
  onDeleteComment?: (commentId: number | string) => void;
  resolveUrl?: (u: string) => string;
  interactive?: boolean;
  currentUserId?: number;
  postUserId?: number;
  forceDeleteUI?: boolean;
  createdAt?: string | null;
  associatedAlbums?: { id: number; name: string }[];
  onOpenAssociatedAlbum?: (albumId: number, albumName: string) => void;
};

const isVideoUrl = (uri: string) => {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  return ext ? ['mp4', 'mov', 'm4v', 'hevc', 'webm', 'ogg'].includes(ext) : false;
};

const formatTimestamp = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString();
};

const PostMedia = ({ uri, interactive = true }: { uri: string; interactive?: boolean }) => {
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const handleSave = async () => {
    if (!interactive || saving) return;
    setSaving(true);
    let statusMsg: string | null = null;
    try {
      const { status: perm } = await MediaLibrary.requestPermissionsAsync();
      if (perm !== 'granted') {
        statusMsg = 'Permission needed to save.';
        return;
      }
      let localUri = uri;
      if (uri.startsWith('http')) {
        const path = uri.split('?')[0];
        const ext = path.includes('.') ? path.split('.').pop() : null;
        const fallbackExt = isVideoUrl(uri) ? 'mp4' : 'jpg';
        const filename = `groupo-${Date.now()}.${ext || fallbackExt}`;
        const target = `${FileSystem.cacheDirectory}${filename}`;
        const result = await FileSystem.downloadAsync(uri, target);
        localUri = result.uri;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      statusMsg = 'Saved to Photos.';
    } catch (err) {
      console.log('[post] save media error', err);
      statusMsg = 'Unable to save media.';
    } finally {
      setSaving(false);
      if (statusMsg) {
        setStatus(statusMsg);
        setTimeout(() => setStatus(null), 2000);
      }
    }
  };

  return (
    <View style={[styles.postImageContainer, { height: CARD_MEDIA_HEIGHT }]}>
      {interactive ? (
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>
      ) : null}
      {status ? <Text style={styles.saveStatus}>{status}</Text> : null}
      {isVideoUrl(uri) ? (
        <Video
          source={{ uri }}
          style={[styles.postImage, { width: CARD_WIDTH, height: CARD_MEDIA_HEIGHT }]}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls
        />
      ) : (
        <Image source={{ uri }} style={[styles.postImage, { width: CARD_WIDTH, height: CARD_MEDIA_HEIGHT }]} resizeMode="contain" />
      )}
    </View>
  );
};

export const PostCard = ({
  user,
  groupName,
  groupId,
  content,
  imageUrls = [],
  likes = 0,
  comments = [],
  onLike,
  onOpenComment,
  onDeletePost,
  onDeleteComment,
  resolveUrl,
  interactive = true,
  currentUserId,
  postUserId,
  forceDeleteUI = false,
  createdAt,
  associatedAlbums = [],
  onOpenAssociatedAlbum,
}: PostCardProps) => {
  const displayGroup = groupName || (groupId ? `Group #${groupId}` : '');
  const resolved = resolveUrl ? imageUrls.map((u) => resolveUrl(u)) : imageUrls;
  const canDeletePost =
    interactive &&
    !!onDeletePost &&
    (forceDeleteUI || (!!currentUserId && !!postUserId && currentUserId === postUserId));
  const formattedPostTime = formatTimestamp(createdAt);
  const [showPostMenu, setShowPostMenu] = React.useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = React.useState(0);
  const [showAlbums, setShowAlbums] = React.useState(false);
  React.useEffect(() => {
    setActiveMediaIndex(0);
  }, [resolved.length]);

  const renderCommentDelete = (commentId: number | string) => (
    <TouchableOpacity style={styles.swipeDelete} onPress={() => onDeleteComment?.(commentId)}>
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.postCard}>
      <View style={styles.postMetaRow}>
        <Text style={styles.postMeta}>
          {user}
          {displayGroup ? ` • ${displayGroup}` : ''}
        </Text>
        <View style={styles.postMetaRight}>
          {formattedPostTime ? <Text style={styles.postTime}>{formattedPostTime}</Text> : null}
          {canDeletePost ? (
            <View style={styles.menuWrapper}>
              <TouchableOpacity style={styles.ellipsisButton} onPress={() => setShowPostMenu((prev) => !prev)}>
                <Text style={styles.ellipsisText}>⋯</Text>
              </TouchableOpacity>
              {showPostMenu ? (
                <View style={styles.menuPopover}>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      setShowPostMenu(false);
                      onDeletePost?.();
                    }}
                  >
                    <Text style={styles.menuItemDelete}>Delete post</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      <Text>{content}</Text>
      {resolved.length ? (
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            style={styles.carousel}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const offsetX = event.nativeEvent.contentOffset.x;
              const nextIndex = Math.round(offsetX / CARD_WIDTH);
              setActiveMediaIndex(nextIndex);
            }}
          >
          {resolved.map((u, idx) => (
            <PostMedia key={idx} uri={u} interactive={interactive} />
          ))}
          </ScrollView>
          {resolved.length > 1 ? (
            <View style={styles.dotsRow}>
              {resolved.map((_, idx) => (
                <View key={idx} style={[styles.dot, idx === activeMediaIndex && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actionsRow}>
        <Text style={styles.likeText}>Likes: {likes || 0}</Text>
        <View style={styles.actionsRight}>
          <Button title="Like" onPress={onLike} disabled={!interactive || !onLike} />
          {associatedAlbums.length ? (
            <TouchableOpacity style={styles.albumsButton} onPress={() => setShowAlbums((prev) => !prev)}>
              <Text style={styles.albumsButtonText}>Albums ({associatedAlbums.length})</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {showAlbums && associatedAlbums.length ? (
        <View style={styles.albumsRow}>
          {associatedAlbums.map((album) => (
            <TouchableOpacity
              key={album.id}
              style={styles.albumChip}
              onPress={() => onOpenAssociatedAlbum?.(album.id, album.name)}
            >
              <Text style={styles.albumChipText}>{album.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {comments.map((c, idx) => (
        <Swipeable
          key={c.id ?? idx}
          enabled={!!(interactive && onDeleteComment && (forceDeleteUI || (currentUserId && c.user_id === currentUserId)))}
          renderRightActions={() => renderCommentDelete(c.id ?? idx)}
        >
          <View style={styles.commentLine}>
            <Text style={styles.commentText}>
              {c.user}: {c.content}
            </Text>
            {c.created_at ? <Text style={styles.commentTime}>{formatTimestamp(c.created_at)}</Text> : null}
          </View>
        </Swipeable>
      ))}
      <TouchableOpacity
        style={styles.commentRow}
        onPress={onOpenComment}
        disabled={!interactive || !onOpenComment}
      >
        <Text style={styles.commentPlaceholder}>Add a comment…</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  postCard: { padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginVertical: 6, backgroundColor: '#fafafa' },
  postMetaRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  postMeta: { fontWeight: '600', flex: 1 },
  postMetaRight: { alignItems: 'flex-end', gap: 4 },
  postTime: { fontSize: 12, color: '#666' },
  postImageContainer: {
    width: CARD_WIDTH,
    marginTop: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postImage: { borderRadius: 8, backgroundColor: '#fff' },
  saveButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    zIndex: 2,
  },
  saveButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  saveStatus: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#fff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    fontSize: 12,
    zIndex: 2,
  },
  carousel: { marginTop: 8 },
  dotsRow: { marginTop: 6, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ccc' },
  dotActive: { backgroundColor: '#444', width: 7, height: 7, borderRadius: 3.5 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  likeText: { fontWeight: '600' },
  albumsButton: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  albumsButtonText: { fontSize: 12, color: '#333', fontWeight: '600' },
  albumsRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  albumChip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff' },
  albumChipText: { fontSize: 12, color: '#333' },
  menuWrapper: { position: 'relative' },
  ellipsisButton: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6 },
  ellipsisText: { fontSize: 20, lineHeight: 20, color: '#444' },
  menuPopover: {
    position: 'absolute',
    top: 28,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    paddingVertical: 6,
    minWidth: 120,
    zIndex: 5,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  menuItem: { paddingVertical: 8, paddingHorizontal: 12 },
  menuItemDelete: { color: '#a00', fontWeight: '600' },
  commentLine: { marginTop: 4, minHeight: 44, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  commentText: { color: '#444', flex: 1 },
  commentTime: { fontSize: 11, color: '#777' },
  swipeDelete: { backgroundColor: '#a00', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, marginTop: 4, minHeight: 44 },
  swipeDeleteText: { color: '#fff', fontWeight: '700' },
  commentRow: { marginTop: 6, padding: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  commentPlaceholder: { color: '#666' },
});
