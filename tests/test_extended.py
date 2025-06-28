import pytest
from app import app, db, User, Group, Post, Comment
from flask_login import login_user

@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['WTF_CSRF_ENABLED'] = False
    with app.test_client() as client:
        with app.app_context():
            db.create_all()
            user1 = User(username='user1', password='pw1')
            user2 = User(username='user2', password='pw2')
            db.session.add_all([user1, user2])
            db.session.commit()

            group = Group(name='SampleGroup')
            group.members.extend([user1, user2])
            db.session.add(group)
            db.session.commit()
        yield client


def login(client, username, password):
    return client.post('/login', json={'username': username, 'password': password})


def test_post_with_image(client):
    login(client, 'user1', 'pw1')
    data = {
        'content': 'A post with image'
    }
    response = client.post('/groups/1/posts', data=data)
    assert response.status_code == 302  # Redirect to posts page


def test_comment_and_like(client):
    login(client, 'user2', 'pw2')
    # Add a comment
    comment_resp = client.post('/comment_post/1', data={'comment': 'Looks great!'})
    assert b"Comment added" in comment_resp.data

    # Like the post
    like_resp = client.post('/like_post/1')
    assert like_resp.status_code == 200
    assert b"likes" in like_resp.data


def test_forbidden_delete(client):
    login(client, 'user2', 'pw2')
    forbidden = client.post('/delete_post/1')
    assert forbidden.status_code == 403