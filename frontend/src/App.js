import React, { useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState('');

  useEffect(() => {
    axios.get('/api/groups').then(res => setGroups(res.data.groups));
  }, []);

  const loadPosts = (groupId) => {
    setSelectedGroup(groupId);
    axios.get(`/api/groups/${groupId}/posts`).then(res => setPosts(res.data.posts));
  };

  const submitPost = (e) => {
    e.preventDefault();
    const form = new FormData();
    form.append('content', newPost);
    axios.post(`/api/groups/${selectedGroup}/posts`, form)
      .then(() => loadPosts(selectedGroup));
    setNewPost('');
  };

  return (
    <div>
      <h1>GroupGram</h1>
      <h2>Groups</h2>
      <ul>
        {groups.map(group => (
          <li key={group.id} onClick={() => loadPosts(group.id)}>
            {group.name}
          </li>
        ))}
      </ul>
      {selectedGroup && (
        <div>
          <h2>Posts</h2>
          <form onSubmit={submitPost}>
            <textarea value={newPost} onChange={e => setNewPost(e.target.value)}></textarea>
            <button type="submit">Post</button>
          </form>
          <ul>
            {posts.map((post, idx) => (
              <li key={idx}>{post.user}: {post.content}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;