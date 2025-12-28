import axios from 'axios';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

// Point to your backend; on device use your machine's LAN IP.
export const API_URL = 'https://groupo-app.onrender.com';
// export const API_URL = 'http://192.168.1.161:5000';
// export const API_URL = 'http://localhost:5000';

export const resolveUrl = (u: string) => (u.startsWith('http') ? u : `${API_URL}${u}`);

export const api = axios.create({ baseURL: API_URL });

export const setToken = (token: string) => {
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
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
  const headers: Record<string, string> = {};
  const auth = api.defaults.headers.common.Authorization;
  if (typeof auth === 'string' && auth.length) {
    headers.Authorization = auth;
  }
  const uploadSingle = async (url: string, file: { uri: string }, params?: Record<string, string>) => {
    const result = await FileSystem.uploadAsync(url, file.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      parameters: params,
      headers,
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
  };

  if (files.length === 1) {
    const file = files[0];
    return await uploadSingle(`${API_URL}/api/groups/${groupId}/posts`, file, { content });
  }

  const [first, ...rest] = files;
  const firstResp = await uploadSingle(`${API_URL}/api/groups/${groupId}/posts`, first, { content });
  const postId = firstResp?.post_id;
  if (!postId) {
    throw new Error('Upload failed (missing post id)');
  }
  for (const file of rest) {
    await uploadSingle(`${API_URL}/api/posts/${postId}/media`, file);
  }
  return firstResp;
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

export const updateGroup = async (groupId: number, name: string) => {
  const { data } = await api.post(`/api/groups/${groupId}/update`, { name });
  return data.group;
};

export const addGroupMember = async (groupId: number, username: string) => {
  const { data } = await api.post(`/api/groups/${groupId}/members`, { username });
  return data.user;
};
