import axios from 'axios';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

// Point to your backend; on device use your machine's LAN IP.
export const API_URL = 'https://groupo-app.onrender.com';
// export const API_URL = 'http://192.168.1.161:5000';
// export const API_URL = 'http://localhost:5000';

export const resolveUrl = (u: string) => (u.startsWith('http') ? u : `${API_URL}${u}`);

export const api = axios.create({ baseURL: API_URL });

export const setToken = (token: string | null) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

export const login = async (username: string, password: string) => {
  const { data } = await api.post('/api/login', { username, password });
  setToken(data.token);
  return data;
};

export const register = async (payload: { username: string; password: string; first_name: string; last_name: string }) => {
  const { data } = await api.post('/api/register', payload);
  setToken(data.token);
  return data;
};

export const fetchGroups = async () => {
  const { data } = await api.get('/api/groups');
  return data.groups;
};

export const fetchGroupMembers = async (groupId: number) => {
  const { data } = await api.get(`/api/groups/${groupId}/members`);
  return data.members;
};

export const fetchGroupPosts = async (groupId: number) => {
  const { data } = await api.get(`/api/groups/${groupId}/posts`);
  return data; // { group, posts }
};

export const createPost = async (groupId: number, content: string) => {
  const { data } = await api.post(`/api/groups/${groupId}/posts`, { content });
  return data;
};

export const createPostWithFiles = async (
  groupId: number,
  content: string,
  files: { uri: string; name?: string; mimeType?: string }[]
) => {
  let usedLowQuality = false;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Connection: 'close',
    Expect: '',
  };
  const auth = api.defaults.headers.common.Authorization;
  if (typeof auth === 'string' && auth.length) {
    headers.Authorization = auth;
  }
  const uploadSingle = async (
    url: string,
    file: { uri: string; mimeType?: string },
    params?: Record<string, string>
  ) => {
    try {
      const targetUrl = resolveUrl(url);
      const result = await FileSystem.uploadAsync(targetUrl, file.uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: file.mimeType,
        parameters: params,
        headers,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      });
      if (result.status < 200 || result.status >= 300) {
        console.error('[upload] uploadAsync error', { status: result.status, body: result.body });
        throw new Error(`Upload failed (${result.status})`);
      }
      try {
        return JSON.parse(result.body);
      } catch {
        return result.body as any;
      }
    } catch (err: any) {
      console.error('[upload] uploadAsync exception', {
        message: err?.message,
        code: err?.code,
        url: targetUrl,
      });
      throw err;
    }
  };

  const isVideo = (file: { uri: string; mimeType?: string }) => {
    if (file.mimeType?.startsWith('video/')) return true;
    const ext = file.uri.split('?')[0].split('.').pop()?.toLowerCase();
    return ext ? ['mp4', 'mov', 'm4v', 'hevc', 'webm', 'ogg'].includes(ext) : false;
  };

  const normalizeImage = async (
    file: { uri: string; name?: string; mimeType?: string },
    profile: { width: number; compress: number }
  ) => {
    if (!file.mimeType?.startsWith('image/')) {
      return file;
    }
    const result = await ImageManipulator.manipulateAsync(
      file.uri,
      [{ resize: { width: profile.width } }],
      { compress: profile.compress, format: ImageManipulator.SaveFormat.JPEG }
    );
    const name = file.name && file.name.includes('.') ? file.name.replace(/\.[^.]+$/, '.jpg') : 'upload.jpg';
    return { ...file, uri: result.uri, mimeType: 'image/jpeg', name };
  };

  const readAsBase64 = async (
    file: { uri: string; name?: string; mimeType?: string },
    profile: { width: number; compress: number; cap: number }
  ) => {
    const normalized = await normalizeImage(file, profile);
    const data = await FileSystem.readAsStringAsync(normalized.uri, { encoding: FileSystem.EncodingType.Base64 });
    const fileIsVideo = (normalized.mimeType || file.mimeType || '').startsWith('video/');
    const cap = fileIsVideo ? VIDEO_BASE64_CAP : profile.cap;
    if (data.length > cap) {
      const mb = Math.round(cap / 1_000_000);
      throw new Error(`Media too large to upload (limit ~${mb}MB).`);
    }
    return {
      name: normalized.name || 'upload',
      mimeType: normalized.mimeType || 'application/octet-stream',
      data,
    };
  };

  const HIGH_QUALITY = { width: 2048, compress: 0.9, cap: 700000 };
  const LOW_QUALITY = { width: 700, compress: 0.45, cap: 250000 };
  const VIDEO_BASE64_CAP = 25_000_000;

  const readAsBase64WithFallback = async (file: { uri: string; name?: string; mimeType?: string }) => {
    try {
      const payload = await readAsBase64(file, HIGH_QUALITY);
      return { payload, quality: 'high' as const };
    } catch {
      const payload = await readAsBase64(file, LOW_QUALITY);
      return { payload, quality: 'low' as const };
    }
  };

  const uploadCreateWithRetry = async (file: { uri: string; name?: string; mimeType?: string }) => {
    const firstTry = await readAsBase64WithFallback(file);
    try {
      const response = await uploadBase64Create([firstTry.payload]);
      return { response, quality: firstTry.quality };
    } catch {
      const payload = await readAsBase64(file, LOW_QUALITY);
      const response = await uploadBase64Create([payload]);
      return { response, quality: 'low' as const };
    }
  };

  const uploadMediaWithRetry = async (postId: number, file: { uri: string; name?: string; mimeType?: string }) => {
    const firstTry = await readAsBase64WithFallback(file);
    try {
      await uploadBase64Media(postId, [firstTry.payload]);
      return firstTry.quality;
    } catch {
      const payload = await readAsBase64(file, LOW_QUALITY);
      await uploadBase64Media(postId, [payload]);
      return 'low' as const;
    }
  };

  const postJson = async (path: string, body: Record<string, unknown>) => {
    const payload = JSON.stringify(body);
    console.log('[upload] base64 payload size', { bytes: payload.length, path });
    const { data } = await api.post(path, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(typeof auth === 'string' && auth.length ? { Authorization: auth } : {}),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000,
      validateStatus: () => true,
    });
    if (data?.error) {
      throw new Error(data.error);
    }
    return data;
  };

  const uploadBase64Create = async (payloadFiles: { name: string; mimeType: string; data: string }[]) =>
    await postJson(`/api/groups/${groupId}/posts/base64`, { content, files: payloadFiles });

  const uploadBase64Media = async (postId: number, payloadFiles: { name: string; mimeType: string; data: string }[]) =>
    await postJson(`/api/posts/${postId}/media/base64`, { files: payloadFiles });

  const uploadMultipartCreate = async (file: { uri: string; mimeType?: string }) =>
    await uploadSingle(`/api/groups/${groupId}/posts`, file, { content });

  const uploadMultipartMedia = async (postId: number, file: { uri: string; mimeType?: string }) =>
    await uploadSingle(`/api/posts/${postId}/media`, file);

  if (files.length === 1) {
    const file = files[0];
    if (isVideo(file)) {
      const response = await uploadMultipartCreate(file);
      return { response, uploadQuality: 'high' as const };
    }
    const result = await uploadCreateWithRetry(file);
    return { response: result.response, uploadQuality: result.quality };
  }

  const [first, ...rest] = files;
  let firstResp: any;
  if (isVideo(first)) {
    firstResp = await uploadMultipartCreate(first);
  } else {
    const firstResult = await uploadCreateWithRetry(first);
    firstResp = firstResult.response;
    if (firstResult.quality === 'low') {
      usedLowQuality = true;
    }
  }

  const postId = firstResp?.post_id;
  if (!postId) {
    throw new Error('Upload failed (missing post id)');
  }
  for (const file of rest) {
    if (isVideo(file)) {
      await uploadMultipartMedia(postId, file);
    } else {
      const quality = await uploadMediaWithRetry(postId, file);
      if (quality === 'low') {
        usedLowQuality = true;
      }
    }
  }
  return { response: firstResp, uploadQuality: usedLowQuality ? ('low' as const) : ('high' as const) };
};

export const createGroup = async (name: string) => {
  const { data } = await api.post('/api/groups', { name });
  return data;
};

export const registerPushToken = async () => {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('Push permission denied');

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ||
    // @ts-ignore
    (Constants as any)?.easConfig?.projectId;
  if (!projectId) {
    throw new Error('Add extra.eas.projectId to app.json (run `npx eas init`)');
  }

  const expoToken = await Notifications.getExpoPushTokenAsync({
    projectId,
  });
  const token = expoToken.data;
  await api.post('/api/push/register', { token, platform: 'expo' });
  return token;
};

export const likePost = async (postId: number) => {
  const { data } = await api.post(`/api/posts/${postId}/like`);
  return data;
};

export const commentOnPost = async (postId: number, comment: string) => {
  const { data } = await api.post(`/api/posts/${postId}/comment`, { comment });
  return data;
};

export const deletePost = async (postId: number) => {
  const { data } = await api.delete(`/api/posts/${postId}`);
  return data;
};

export const deleteComment = async (commentId: number | string) => {
  const { data } = await api.delete(`/api/comments/${commentId}`);
  return data;
};

export const updateGroup = async (groupId: number, name: string) => {
  const { data } = await api.post(`/api/groups/${groupId}/update`, { name });
  return data.group;
};

export const addGroupMember = async (groupId: number, username: string) => {
  const { data } = await api.post(`/api/groups/${groupId}/members`, { username });
  return data.user;
};
