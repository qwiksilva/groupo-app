import axios from 'axios';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

// Point to your backend; on device use your machine's LAN IP.
export const API_URL = 'http://192.168.1.161:5000'; //'http://localhost:5000';

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
  const form = new FormData();
  form.append('content', content);
  files.forEach((file) => {
    form.append('file', {
      uri: file.uri,
      name: file.name || 'upload',
      type: file.mimeType || 'application/octet-stream',
    } as any);
  });
  const { data } = await api.post(`/api/groups/${groupId}/posts`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
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
