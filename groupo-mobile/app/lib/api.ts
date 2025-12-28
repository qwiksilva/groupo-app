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
      const result = await FileSystem.uploadAsync(url, file.uri, {
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
        url,
      });
      throw err;
    }
  };

  const readAsBase64 = async (file: { uri: string; name?: string; mimeType?: string }) => {
    const data = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    return {
      name: file.name || 'upload',
      mimeType: file.mimeType || 'application/octet-stream',
      data,
    };
  };

  const uploadBase64Create = async (payloadFiles: { name: string; mimeType: string; data: string }[]) => {
    const { data } = await api.post(`/api/groups/${groupId}/posts/base64`, {
      content,
      files: payloadFiles,
    });
    return data;
  };

  const uploadBase64Media = async (postId: number, payloadFiles: { name: string; mimeType: string; data: string }[]) => {
    const { data } = await api.post(`/api/posts/${postId}/media/base64`, { files: payloadFiles });
    return data;
  };

  if (files.length === 1) {
    const file = files[0];
    try {
      return await uploadSingle(`${API_URL}/api/groups/${groupId}/posts`, file, { content });
    } catch {
      const payload = [await readAsBase64(file)];
      return await uploadBase64Create(payload);
    }
  }

  const [first, ...rest] = files;
  let firstResp: any;
  try {
    firstResp = await uploadSingle(`${API_URL}/api/groups/${groupId}/posts`, first, { content });
  } catch {
    const payload = await Promise.all(files.map(readAsBase64));
    return await uploadBase64Create(payload);
  }

  const postId = firstResp?.post_id;
  if (!postId) {
    throw new Error('Upload failed (missing post id)');
  }
  for (const file of rest) {
    try {
      await uploadSingle(`${API_URL}/api/posts/${postId}/media`, file);
    } catch {
      const payload = [await readAsBase64(file)];
      await uploadBase64Media(postId, payload);
    }
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
